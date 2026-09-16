// Builds the map/route/game data from the user's own game files by running
// the map pipeline (dist\pipeline\build-map-data.mjs, or pipeline\ in dev)
// with the bundled Node, and reports its progress to the window.
//   - first start (no data yet): runs by itself
//   - after a game update or a new map DLC: offers "Update map"

using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

enum MapState { Unknown, UpToDate, UpdateAvailable, Building, Failed, NoGame }

sealed partial class MapBuilder
{
    readonly AppPaths _paths;
    readonly Action _onBuilt;
    Process? _process;
    StreamWriter? _log;

    public MapState State { get; private set; } = MapState.Unknown;
    int _percent, _stepEnd;
    double _stepSeconds;
    DateTime _stepStart;
    /** Within a long step (parsing takes minutes) it creeps on by the step's usual duration. */
    public int Percent
    {
        get
        {
            if (State != MapState.Building || _stepSeconds <= 0 || _stepEnd <= _percent) return _percent;
            double f = Math.Min(0.95, (DateTime.UtcNow - _stepStart).TotalSeconds / _stepSeconds);
            return _percent + (int)((_stepEnd - _percent) * f);
        }
        private set { _percent = value; _stepSeconds = 0; }
    }
    /** L key + argument of the current step, or of the failure. */
    public string StepKey { get; private set; } = "map.check";
    public string StepArg { get; private set; } = "";
    public string? Error { get; private set; }
    public (string? Ets2, string? Ats) Games { get; private set; }

    public MapBuilder(AppPaths paths, Action onBuilt)
    {
        _paths = paths;
        _onBuilt = onBuilt;
    }

    bool HasAnyData() =>
        File.Exists(Path.Combine(_paths.Data, "europe-navigation.zip")) ||
        File.Exists(Path.Combine(_paths.Data, "usa-navigation.zip"));

    /** Looks at the installed games; builds right away when there is no data at all. */
    public void Check()
    {
        Task.Run(() =>
        {
            Games = FindGames();
            if (Games.Ets2 == null && Games.Ats == null)
            {
                State = MapState.NoGame;
                return;
            }
            if (!HasAnyData())
            {
                Build();
                return;
            }
            var output = RunPipeline("--check").Output;
            State = output.Contains(" yes") ? MapState.UpdateAvailable : MapState.UpToDate;
            Console.WriteLine($"map: {State} ({output.Trim().Replace('\n', ' ')})");
        });
    }

    /** Builds (or rebuilds) the data for the installed games that changed. */
    public void Build(bool force = false)
    {
        if (State == MapState.Building) return;
        State = MapState.Building;
        Percent = 0;
        Error = null;
        StepKey = "map.parse";
        StepArg = "";
        Task.Run(() =>
        {
            var (code, output) = force ? RunPipeline("--force") : RunPipeline();
            if (code == 0)
            {
                State = MapState.UpToDate;
                Percent = 100;
                Console.WriteLine("map: build done");
                _onBuilt();
            }
            else
            {
                State = MapState.Failed;
                Console.WriteLine($"map: build failed ({code}): {Error}");
                // one game failed, the other was built: load that one's new data anyway
                if (output.Contains("@@built ")) _onBuilt();
            }
        });
    }

    (int Code, string Output) RunPipeline(params string[] extra)
    {
        string script = _paths.Dist != null
            ? Path.Combine(_paths.Dist, @"pipeline\build-map-data.mjs")
            : Path.Combine(_paths.Root, @"pipeline\build-map-data.mjs");
        var psi = new ProcessStartInfo(_paths.Node)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            WorkingDirectory = Path.GetDirectoryName(script)!,
        };
        psi.ArgumentList.Add(script);
        foreach (var (flag, value) in new[] { ("--tm", _paths.TmMaps), ("--data", _paths.Data), ("--work", _paths.Work) })
        {
            psi.ArgumentList.Add(flag);
            psi.ArgumentList.Add(value);
        }
        if (Games.Ets2 != null) { psi.ArgumentList.Add("--ets2"); psi.ArgumentList.Add(Games.Ets2); }
        if (Games.Ats != null) { psi.ArgumentList.Add("--ats"); psi.ArgumentList.Add(Games.Ats); }
        // the game being played gets its map first
        string? playing = Process.GetProcessesByName("amtrucks").Length > 0 ? "ats"
            : Process.GetProcessesByName("eurotrucks2").Length > 0 ? "ets2" : null;
        if (playing != null) { psi.ArgumentList.Add("--first"); psi.ArgumentList.Add(playing); }
        foreach (var e in extra) psi.ArgumentList.Add(e);

        Directory.CreateDirectory(_paths.Data);
        bool check = extra.Contains("--check");
        if (!check) _log = Log.Open(Path.Combine(Log.Dir, "mapbuild.log"));
        var output = new StringBuilder();
        using var p = new Process { StartInfo = psi };
        DataReceivedEventHandler onLine = (_, e) =>
        {
            if (e.Data == null) return;
            string line = NodeService.Ansi().Replace(e.Data, "");
            lock (output) output.AppendLine(line);
            if (_log != null) lock (_log) _log.WriteLine(line);
            var m = ProgressLine().Match(line);
            if (m.Success)
            {
                Percent = int.Parse(m.Groups[1].Value);
                StepKey = m.Groups[2].Value;
                StepArg = m.Groups[3].Value;
            }
            else if (ExpectLine().Match(line) is { Success: true } x)
            {
                _stepEnd = int.Parse(x.Groups[1].Value);
                _stepSeconds = double.Parse(x.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture);
                _stepStart = DateTime.UtcNow;
            }
            else if (line.StartsWith("@@error ")) Error = line[8..];
        };
        p.OutputDataReceived += onLine;
        p.ErrorDataReceived += onLine;
        p.Start();
        ChildJob.Add(p);
        _process = p;
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        p.WaitForExit();
        _process = null;
        _log?.Dispose();
        _log = null;
        return (p.ExitCode, output.ToString());
    }

    public void Stop()
    {
        try { _process?.Kill(entireProcessTree: true); } catch { }
    }

    [GeneratedRegex(@"^@@progress (\d+) (\S+) ?(.*)$")]
    private static partial Regex ProgressLine();
    [GeneratedRegex(@"^@@expect (\d+) ([\d.]+)$")]
    private static partial Regex ExpectLine();

    // --- games ---------------------------------------------------------------------------

    /** ETS2 / ATS install folders from every Steam library ($env:ETS2_DIR / ATS_DIR override). */
    public static (string? Ets2, string? Ats) FindGames()
    {
        string? ets2 = Environment.GetEnvironmentVariable("ETS2_DIR");
        string? ats = Environment.GetEnvironmentVariable("ATS_DIR");
        foreach (var lib in SteamLibraries())
        {
            string e = Path.Combine(lib, @"steamapps\common\Euro Truck Simulator 2");
            string a = Path.Combine(lib, @"steamapps\common\American Truck Simulator");
            if (ets2 == null && File.Exists(Path.Combine(e, "base.scs"))) ets2 = e;
            if (ats == null && File.Exists(Path.Combine(a, "base.scs"))) ats = a;
        }
        return (ets2, ats);
    }

    static IEnumerable<string> SteamLibraries()
    {
        string steam = (Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam", "SteamPath", null) as string
                        ?? @"C:\Program Files (x86)\Steam").Replace('/', '\\');
        var libs = new List<string> { steam };
        string vdf = Path.Combine(steam, @"steamapps\libraryfolders.vdf");
        if (File.Exists(vdf))
        {
            foreach (Match m in Regex.Matches(File.ReadAllText(vdf), "\"path\"\\s+\"([^\"]+)\""))
                libs.Add(m.Groups[1].Value.Replace(@"\\", @"\"));
        }
        return libs.Distinct(StringComparer.OrdinalIgnoreCase);
    }
}
