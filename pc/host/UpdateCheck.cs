// Tells the user that a newer Rig Buddy is on GitHub: at start a window offering to download and install it or skip that
// version (UpdateForm), otherwise a balloon once per version, and an entry in the tray menu. The PC agent does the asking (pc/agent/update.mjs: GitHub's API at most every 6 hours, 127.0.0.1:62843
// /update); this only asks the agent. Can be switched off in the tray menu ("Check for updates"): then nothing is sent
// to GitHub at all.

using System.Net.Http;
using System.Text.Json;
using Microsoft.Win32;

static class UpdateCheck
{
    const string Key = @"Software\Rig Buddy";
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(12) };
    static System.Threading.Timer? _timer;
    static System.Threading.Timer? _retry;
    static int _startupTries;

    /** The installer of a release (pc/agent/update.mjs setupAsset): its URL on GitHub and the SHA-256 GitHub computed. */
    public sealed record Setup(string Url, string Sha256, long? Size);

    /** Setup is null when GitHub gave no checksum for the installer: then only its page is offered. */
    public sealed record Info(string Version, string Url, Setup? Setup);

    /** When this program started: the "new version" question is only asked in its first minutes. */
    public static readonly DateTime StartedAt = DateTime.UtcNow;

    /** The newer release, or null (up to date, switched off, or not known yet). */
    public static Info? Available { get; private set; }

    /** Raised (on a pool thread) when Available changed; `fresh` is true the first time this version is seen. */
    public static event Action<bool>? Changed;

    /** This program's version, "0.6.2". */
    public static string Current
    {
        get
        {
            string v = Application.ProductVersion.Split('+')[0];
            return Version.TryParse(v, out var parsed) ? $"{parsed.Major}.{parsed.Minor}.{Math.Max(0, parsed.Build)}" : v;
        }
    }

    public static bool Enabled
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(Key);
            return key?.GetValue("UpdateCheck") is not int v || v != 0;
        }
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(Key);
            key.SetValue("UpdateCheck", value ? 1 : 0, RegistryValueKind.DWord);
            if (!value)
            {
                Available = null;
                Changed?.Invoke(false);
            }
        }
    }

    /**
     * First look 15 seconds after the start, so the "new version" question comes while the user is still at the desk;
     * while the agent is not up yet or GitHub has not answered, again every 30 seconds for a few minutes. Then every 3 hours.
     */
    public static void Start()
    {
        _timer ??= new System.Threading.Timer(_ => _ = Check(), null, TimeSpan.FromSeconds(15), TimeSpan.FromHours(3));
    }

    static void RetrySoon()
    {
        if (++_startupTries > 8) return;
        _retry?.Dispose();
        _retry = new System.Threading.Timer(_ => _ = Check(), null, TimeSpan.FromSeconds(30), Timeout.InfiniteTimeSpan);
    }

    public static void CheckNow() => _ = Check();

    static async Task Check()
    {
        if (!Enabled) return;
        try
        {
            string json = await Http.GetStringAsync("http://127.0.0.1:62843/update");
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            bool newer = root.TryGetProperty("newer", out var n) && n.ValueKind == JsonValueKind.True;
            string? latest = root.TryGetProperty("latest", out var l) && l.ValueKind == JsonValueKind.String ? l.GetString() : null;
            string? url = root.TryGetProperty("url", out var u) && u.ValueKind == JsonValueKind.String ? u.GetString() : null;
            if (latest == null && Available == null) RetrySoon(); // GitHub not answered yet (agent just started, offline)
            var found = newer && latest != null && url != null && url.StartsWith("https://github.com/okokbudak/rig-buddy/")
                ? new Info(latest, url, ReadSetup(root))
                : null;
            if (found == Available) return;
            Available = found;
            bool fresh = found != null && NotifiedVersion != found.Version;
            if (fresh) NotifiedVersion = found!.Version;
            Changed?.Invoke(fresh);
        }
        catch (Exception e)
        {
            Console.WriteLine($"update check: {e.Message}"); // the agent may not be up yet
            RetrySoon();
        }
    }

    /** The agent's "setup" (only a file of this repository's releases, with a 64-hex SHA-256), or null. */
    static Setup? ReadSetup(JsonElement root)
    {
        if (!root.TryGetProperty("setup", out var s) || s.ValueKind != JsonValueKind.Object) return null;
        string? url = s.TryGetProperty("url", out var u) && u.ValueKind == JsonValueKind.String ? u.GetString() : null;
        string? sha = s.TryGetProperty("sha256", out var h) && h.ValueKind == JsonValueKind.String ? h.GetString() : null;
        long? size = s.TryGetProperty("size", out var z) && z.ValueKind == JsonValueKind.Number && z.TryGetInt64(out long n) ? n : null;
        if (url == null || !url.StartsWith("https://github.com/okokbudak/rig-buddy/releases/download/")) return null;
        if (sha == null || sha.Length != 64 || !sha.All(Uri.IsHexDigit)) return null;
        return new Setup(url, sha.ToLowerInvariant(), size);
    }

    /** A version the user chose to skip in the "new version" window: not asked again (the tray entry stays). */
    public static string? SkippedVersion
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(Key);
            return key?.GetValue("UpdateSkipped") as string;
        }
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(Key);
            key.SetValue("UpdateSkipped", value ?? "");
        }
    }

    /** The version the balloon has been shown for, so it does not come back at every start. */
    static string? NotifiedVersion
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(Key);
            return key?.GetValue("UpdateNotified") as string;
        }
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(Key);
            key.SetValue("UpdateNotified", value ?? "");
        }
    }
}
