// Tells the user that a newer Rig Buddy is on GitHub: a balloon once per version and an entry in the tray menu that opens
// the release page. The PC agent does the asking (pc/agent/update.mjs: GitHub's API at most every 6 hours, 127.0.0.1:62843
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

    public sealed record Info(string Version, string Url);

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

    /** First look 2 minutes after the start (the agent is up by then), then every 3 hours. */
    public static void Start()
    {
        _timer ??= new System.Threading.Timer(_ => _ = Check(), null, TimeSpan.FromMinutes(2), TimeSpan.FromHours(3));
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
            var found = newer && latest != null && url != null && url.StartsWith("https://github.com/okokbudak/rig-buddy/") ? new Info(latest, url) : null;
            if (found == Available) return;
            Available = found;
            bool fresh = found != null && NotifiedVersion != found.Version;
            if (fresh) NotifiedVersion = found!.Version;
            Changed?.Invoke(fresh);
        }
        catch (Exception e)
        {
            Console.WriteLine($"update check: {e.Message}"); // the agent may not be up yet: the next round
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
