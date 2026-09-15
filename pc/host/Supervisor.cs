// Runs the Node services with the bundled Node.js (vendor\node), hidden, and
// keeps them alive:
//   server     truckermudgeon navigation server (routes, search)  :62840
//   agent      pc\agent: full telemetry, save game, media, radio   :62843
//   telemetry  truckermudgeon telemetry client (bridge -> server), after the server is up
// Output goes to logs\<name>.log. All children live in a kill-on-close job
// object, so they never outlive this app, even if it crashes.

using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

enum ServiceState { Stopped, Starting, Running, Waiting }

sealed partial class NodeService
{
    public required string Name { get; init; }
    public required string Title { get; init; }
    public required string WorkDir { get; init; }
    public required string[] Args { get; init; }
    public Dictionary<string, string> Env { get; init; } = new();
    public string? HealthUrl { get; init; }
    public Func<bool> CanStart { get; init; } = () => true;
    public Action? BeforeStart { get; init; }
    public Action<string>? OnLine { get; set; }

    public volatile bool Enabled = true;
    public ServiceState State { get; set; } = ServiceState.Stopped;
    public Process? Process { get; set; }
    public DateTime StartedAt, NextStartAt;
    public TimeSpan Backoff = TimeSpan.FromSeconds(3);
    public StreamWriter? LogFile;

    [GeneratedRegex(@"\x1b\[[0-9;]*m")]
    public static partial Regex Ansi();
}

sealed class Supervisor
{
    public string Root { get; }
    public IReadOnlyList<NodeService> Services { get; }
    public string? PairingCode { get; private set; }
    public string? SetupProblem { get; }

    /** Start-up progress of the navigation stack, for the window's progress bar. */
    public StartupStage Stage { get; private set; } = StartupStage.Initial;
    /** From the agent's /health: save game read, apps connected over Wi-Fi. */
    public bool SaveLoaded { get; private set; }
    public int Clients { get; private set; }

    readonly string _node, _data;
    readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(2) };
    readonly object _lock = new();
    readonly SemaphoreSlim _wake = new(0);
    CancellationTokenSource? _cts;

    // Server log line -> progress milestone. Percentages follow measured ETS2
    // load times; `Expect` is the typical seconds until the next milestone,
    // which lets the bar keep creeping instead of sitting still.
    // Labels are L keys; {0} is the game.
    static readonly (Regex Pattern, int Percent, string Label, double Expect)[] ServerStages =
    [
        (new(@"reading (\w+) map JSON files"), 8, "stage.read", 6.5),
        (new(@"reading (\w+) graph data"), 40, "stage.graph", 3),
        (new(@"building road and prefab rtree"), 55, "stage.geometry", 5.5),
        (new(@"building graph node rtree"), 85, "stage.index", 1),
        (new(@"lookup data loaded"), 92, "stage.open", 1),
        (new(@"listening on port"), 95, "stage.telemetry", 2),
    ];

    void SetStage(int percent, string key, double expect, string arg = "")
    {
        int next = ServerStages.Select(s => s.Percent).Where(p => p > percent).DefaultIfEmpty(100).First();
        Stage = new StartupStage(percent, next, key, arg, expect, DateTime.UtcNow);
    }

    void OnServerLine(NodeService server, string line)
    {
        foreach (var (pattern, percent, label, expect) in ServerStages)
        {
            var m = pattern.Match(line);
            if (!m.Success || percent <= Stage.Percent) continue;
            string map = m.Groups.Count > 1 ? (m.Groups[1].Value == "usa" ? "ATS" : "ETS2") : "";
            SetStage(percent, label, expect, map);
        }
        if (line.Contains("listening on port"))
        {
            server.State = ServiceState.Running; // don't wait for the next health poll
            _wake.Release();
        }
    }

    public Supervisor(AppPaths paths)
    {
        Root = paths.Root;
        _node = paths.Node;
        string tm = paths.TmMaps;
        string tsx = Path.Combine(tm, @"node_modules\tsx\dist\cli.mjs");
        string data = paths.Data;
        string shim = Path.Combine(paths.Root, @"pc\patches\scsSDKTelemetry.js");
        string? dist = paths.Dist;
        // bundled services (release, or dev after setup\bundle.mjs), else the sources through tsx
        string[] Entry(string bundle, string source) =>
            dist != null ? [Path.Combine(dist, bundle, "index.mjs")] : [tsx, source];
        string Cwd(string bundle, string sourceDir) => dist != null ? Path.Combine(dist, bundle) : sourceDir;

        _data = data;
        if (!File.Exists(_node) || (dist == null && !File.Exists(tsx)))
            SetupProblem = "setup.missing"; // L key
        // No map data yet (first start): the server waits for MapBuilder; the
        // agent runs anyway (media, radio, jobs and profile need no map).

        var server = new NodeService
        {
            Name = "server",
            Title = "svc.server",
            WorkDir = Cwd("server", Path.Combine(tm, @"packages\apis\navigation")),
            Args = ["--max-old-space-size=8192", .. Entry("server", "index.ts"), data],
            Env = new()
            {
                ["NODE_ENV"] = "development",
                ["RATE_LIMIT_ENABLED"] = "false",
                ["ALLOWED_ORIGIN"] = "http://ets2nav.local",
                ["LOG_LEVEL"] = "info",
            },
            HealthUrl = "http://127.0.0.1:62840/health",
            CanStart = () => HasMap("europe") || HasMap("usa"),
        };
        server.OnLine = line => OnServerLine(server, line);
        var agent = new NodeService
        {
            Name = "agent",
            Title = "svc.agent",
            WorkDir = Cwd("agent", Path.Combine(paths.Root, @"pc\agent")),
            Args = dist != null ? [Path.Combine(dist, @"agent\index.mjs")] : [Path.Combine(paths.Root, @"pc\agent\index.mjs")],
            Env = new() { ["ETS2NAV_DATA"] = data, ["RIGBUDDY_MEDIA_TOKEN"] = MediaService.Token },
            HealthUrl = "http://127.0.0.1:62843/health",
            BeforeStart = dist != null ? null
                : () => CopyShim(shim, Path.Combine(paths.Root, @"pc\agent\node_modules\trucksim-telemetry\build\Release")),
        };
        var telemetry = new NodeService
        {
            Name = "telemetry",
            Title = "svc.telemetry",
            WorkDir = Cwd("navigator", Path.Combine(tm, @"packages\clis\navigator")),
            Args = Entry("navigator", "index.ts"),
            Env = new() { ["NODE_ENV"] = "development" },
            CanStart = () => server.State == ServiceState.Running,
            BeforeStart = dist != null ? null
                : () => CopyShim(shim, Path.Combine(tm, @"node_modules\trucksim-telemetry\build\Release")),
            OnLine = line =>
            {
                // "enter pairing code: abcd" / "... use pairing code: abcd"
                var m = Regex.Match(line, @"pairing code:\s+(\w{4})\b");
                if (!m.Success) return;
                PairingCode = m.Groups[1].Value;
                SetStage(100, "stage.ready", 0);
            },
        };
        Services = [server, agent, telemetry];
    }

    public NodeService? Find(string name) => Services.FirstOrDefault(s => s.Name == name);

    public void Start()
    {
        if (SetupProblem != null)
        {
            Console.WriteLine($"supervisor: not starting services: {SetupProblem}");
            return;
        }
        _cts = new CancellationTokenSource();
        _ = Task.Run(() => Loop(_cts.Token));
    }

    async Task Loop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            foreach (var s in Services)
            {
                try { await Tick(s); }
                catch (Exception e) { Console.WriteLine($"supervisor: {s.Name}: {e.GetType().Name}: {e.Message}"); }
            }
            try { await _wake.WaitAsync(1000, ct); } catch (OperationCanceledException) { }
        }
    }

    async Task Tick(NodeService s)
    {
        bool alive;
        lock (_lock) alive = s.Process is { HasExited: false };
        if (!s.Enabled)
        {
            if (alive) Kill(s);
            s.State = ServiceState.Stopped;
            return;
        }
        if (!alive)
        {
            if (s.Process != null) Exited(s);
            if (DateTime.UtcNow < s.NextStartAt) { s.State = ServiceState.Waiting; return; }
            if (!s.CanStart()) { s.State = ServiceState.Waiting; return; }
            Launch(s);
            return;
        }
        if (s.HealthUrl == null) { s.State = ServiceState.Running; return; }
        try
        {
            using var r = await _http.GetAsync(s.HealthUrl);
            s.State = r.IsSuccessStatusCode ? ServiceState.Running : ServiceState.Starting;
            if (s.Name == "agent" && r.IsSuccessStatusCode)
            {
                using var doc = System.Text.Json.JsonDocument.Parse(await r.Content.ReadAsStringAsync());
                var root = doc.RootElement;
                SaveLoaded = root.TryGetProperty("save", out var save) && save.GetBoolean();
                Clients = root.TryGetProperty("clients", out var clients) ? clients.GetInt32() : 0;
            }
        }
        catch { s.State = ServiceState.Starting; }
    }

    bool HasMap(string map) => File.Exists(Path.Combine(_data, $"{map}-navigation.zip"));

    /**
     * The map the server loads before it starts listening (others load when
     * that game is played): the running game's, else ETS2's, else ATS's.
     */
    string PreloadMap()
    {
        bool atsRunning = Process.GetProcessesByName("amtrucks").Length > 0;
        bool ets2Running = Process.GetProcessesByName("eurotrucks2").Length > 0;
        if (atsRunning && HasMap("usa")) return "usa";
        if (ets2Running && HasMap("europe")) return "europe";
        return HasMap("europe") ? "europe" : "usa";
    }

    void Launch(NodeService s)
    {
        if (s.Name == "server")
        {
            SetStage(2, "stage.start", 2);
            s.Env["PRELOAD_MAPS"] = PreloadMap();
        }
        s.BeforeStart?.Invoke();
        s.LogFile ??= Log.Open(Path.Combine(Log.Dir, s.Name + ".log"));
        var psi = new ProcessStartInfo(_node)
        {
            WorkingDirectory = s.WorkDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in s.Args) psi.ArgumentList.Add(a);
        psi.Environment["PATH"] = Path.GetDirectoryName(_node) + ";" + Environment.GetEnvironmentVariable("PATH");
        foreach (var (k, v) in s.Env) psi.Environment[k] = v;

        var p = new Process { StartInfo = psi };
        DataReceivedEventHandler onData = (_, e) =>
        {
            if (e.Data == null) return;
            string line = NodeService.Ansi().Replace(e.Data, "");
            lock (s.LogFile) s.LogFile.WriteLine(line);
            s.OnLine?.Invoke(line);
        };
        p.OutputDataReceived += onData;
        p.ErrorDataReceived += onData;
        p.Start();
        ChildJob.Add(p);
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        lock (_lock) s.Process = p;
        s.StartedAt = DateTime.UtcNow;
        s.State = ServiceState.Starting;
        lock (s.LogFile) s.LogFile.WriteLine($"----- {DateTime.Now:yyyy-MM-dd HH:mm:ss} started (pid {p.Id})");
        Console.WriteLine($"supervisor: {s.Name} started (pid {p.Id})");
    }

    void Exited(NodeService s)
    {
        Process p;
        lock (_lock) { p = s.Process!; s.Process = null; }
        int code = p.ExitCode;
        p.Dispose();
        // crash loops back off (3 s .. 30 s); a run that lasted a while resets it
        bool shortRun = DateTime.UtcNow - s.StartedAt < TimeSpan.FromSeconds(20);
        s.Backoff = shortRun ? TimeSpan.FromSeconds(Math.Min(30, s.Backoff.TotalSeconds * 2)) : TimeSpan.FromSeconds(3);
        s.NextStartAt = DateTime.UtcNow + s.Backoff;
        if (s.Name == "telemetry") PairingCode = null;
        lock (s.LogFile!) s.LogFile.WriteLine($"----- exited with code {code}, restarting in {s.Backoff.TotalSeconds:0} s");
        Console.WriteLine($"supervisor: {s.Name} exited ({code}), restart in {s.Backoff.TotalSeconds:0} s");
    }

    void Kill(NodeService s)
    {
        Process? p;
        lock (_lock) { p = s.Process; s.Process = null; }
        s.State = ServiceState.Stopped;
        if (p == null) return;
        try { p.Kill(entireProcessTree: true); p.WaitForExit(3000); } catch { }
        p.Dispose();
        Console.WriteLine($"supervisor: {s.Name} stopped");
    }

    /** Restarts one service (or all with null) right away. */
    public void Restart(string? name)
    {
        foreach (var s in Services.Where(s => name == null || s.Name == name))
        {
            Kill(s);
            s.Enabled = true;
            s.Backoff = TimeSpan.FromSeconds(3);
            s.NextStartAt = DateTime.MinValue;
            if (s.Name == "telemetry") PairingCode = null;
        }
    }

    public void SetEnabled(string name, bool on)
    {
        var s = Find(name) ?? throw new ArgumentException($"unknown service: {name}");
        s.Enabled = on;
        if (on) s.NextStartAt = DateTime.MinValue; else Kill(s);
    }

    public void StopAll()
    {
        _cts?.Cancel();
        foreach (var s in Services) Kill(s);
    }

    static void CopyShim(string shim, string dir)
    {
        Directory.CreateDirectory(dir);
        File.Copy(shim, Path.Combine(dir, Path.GetFileName(shim)), overwrite: true);
    }
}

/** Start-up position: `Percent` reached at `At`; `Next` typically comes `Expect` s later. */
sealed record StartupStage(int Percent, int Next, string Key, string Arg, double Expect, DateTime At)
{
    public static readonly StartupStage Initial = new(0, 2, "stage.init", "", 1, DateTime.UtcNow);
    public bool Done => Percent >= 100;
    public string Label => L.T(Key, Arg);

    /** Estimated progress 0..1: creeps toward `Next` (never reaching it) while waiting. */
    public double Estimate()
    {
        if (Done) return 1;
        double t = (DateTime.UtcNow - At).TotalSeconds;
        double creep = Expect > 0 ? 0.9 * (1 - Math.Exp(-t / Expect)) : 0;
        return (Percent + (Next - Percent) * creep) / 100.0;
    }
}

/** Kill-on-close job object: children die with this process. */
static class ChildJob
{
    static readonly IntPtr Job = Create();

    public static void Add(Process p)
    {
        if (Job != IntPtr.Zero) AssignProcessToJobObject(Job, p.Handle);
    }

    static IntPtr Create()
    {
        var job = CreateJobObject(IntPtr.Zero, null);
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        SetInformationJobObject(job, 9 /* JobObjectExtendedLimitInformation */, ref info, Marshal.SizeOf(info));
        return job;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string? name);
    [DllImport("kernel32.dll")]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);
    [DllImport("kernel32.dll")]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
}
