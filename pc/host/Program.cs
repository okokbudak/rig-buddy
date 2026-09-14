// Rig Buddy PC app. Start it once (or with Windows); it sits in the tray and
// runs everything the head unit talks to. See README.md.
//
//   RigBuddy.exe                     start (or, if already running, say so)
//   RigBuddy.exe --quit              stop the running app and all services
//   RigBuddy.exe --restart [svc]     restart server|agent|telemetry (default: all)
//   RigBuddy.exe --stop <svc> / --start <svc> / --status
//   RigBuddy.exe --install-plugin    copy the SCS telemetry plugin into ETS2 / ATS (installer, as admin)

static class Program
{
    static readonly string[] Commands = ["--quit", "--restart", "--stop", "--start", "--status"];

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--install-plugin") return InstallPlugin();
        if (args.Length > 0 && Commands.Contains(args[0]))
        {
            string? reply = ControlPort.Send(string.Join(' ', args).TrimStart('-'));
            // A GUI exe has no console: write to redirected stdout if there is
            // one (scripts capturing the reply), else into the calling console.
            if (GetStdHandle(-11) == IntPtr.Zero) AttachConsole(-1);
            Console.WriteLine(reply ?? "Rig Buddy is not running");
            return reply == null || reply.StartsWith("error") ? 1 : 0;
        }

        using var mutex = new Mutex(true, @"Local\RigBuddy.Host", out bool first);
        if (!first)
        {
            ControlPort.Send("show");
            return 0;
        }

        var paths = AppPaths.Detect();
        Log.Init(paths.Logs);
        Console.WriteLine($"Rig Buddy starting ({(paths.Release ? "release" : "dev")}), app {paths.Root}, data {paths.Data}" +
                          (paths.Dist != null ? ", bundled services" : ", services from source"));
        Application.ThreadException += (_, e) => Console.WriteLine($"ui error: {e.Exception}");
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Console.WriteLine($"fatal: {e.ExceptionObject}");
        ApplicationConfiguration.Initialize();

        var bridge = new TelemetryBridge();
        try { bridge.Start(); }
        catch (Exception e) { Console.WriteLine($"bridge: disabled ({e.Message}); is another Rig Buddy running?"); }
        Discovery.Start();
        _ = Task.Run(async () =>
        {
            try { await new MediaService().RunAsync(); }
            catch (Exception e) { Console.WriteLine($"media: disabled ({e.GetType().Name}: {e.Message})"); }
        });

        var sup = new Supervisor(paths);
        // new map data: the server reloads it (or starts, on the first build)
        var maps = new MapBuilder(paths, onBuilt: () => sup.Restart("server"));
        var app = new TrayApp(sup, bridge, maps, quiet: args.Contains("--autostart"));
        ControlPort.Listen(cmd => Handle(cmd, sup, app));
        sup.Start();
        if (sup.SetupProblem == null) maps.Check();
        Application.Run(app);
        sup.StopAll();
        maps.Stop();
        Console.WriteLine("Rig Buddy stopped");
        return 0;
    }

    /** plugin\scs-telemetry.dll (next to the exe) -> <game>\bin\win_x64\plugins, for each installed game. */
    static int InstallPlugin()
    {
        string dll = Path.Combine(AppContext.BaseDirectory, @"plugin\scs-telemetry.dll");
        if (!File.Exists(dll)) return 2;
        var (ets2, ats) = MapBuilder.FindGames();
        int failed = 0;
        foreach (var game in new[] { ets2, ats })
        {
            if (game == null) continue;
            try
            {
                string dir = Path.Combine(game, @"bin\win_x64\plugins");
                Directory.CreateDirectory(dir);
                File.Copy(dll, Path.Combine(dir, "scs-telemetry.dll"), overwrite: true);
            }
            catch (Exception) { failed++; } // game running (dll in use) or no rights
        }
        return failed == 0 ? 0 : 1;
    }

    static string Handle(string cmd, Supervisor sup, TrayApp app)
    {
        var parts = cmd.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        string verb = parts.Length > 0 ? parts[0] : "";
        string? svc = parts.Length > 1 ? parts[1] : null;
        if (svc != null && sup.Find(svc) == null) return $"error: unknown service '{svc}' (server, agent, telemetry)";
        switch (verb)
        {
            case "quit": app.Post(app.Exit); return "ok";
            case "show": app.Post(app.ShowWindow); return "ok";
            case "logs": app.Post(app.ShowLogs); return "ok";
            case "restart": sup.Restart(svc); return "ok";
            case "stop" when svc != null: sup.SetEnabled(svc, false); return "ok";
            case "start" when svc != null: sup.SetEnabled(svc, true); return "ok";
            case "status":
                return string.Join("; ", sup.Services.Select(s => $"{s.Name}={s.State.ToString().ToLowerInvariant()}")) +
                       (sup.SetupProblem != null ? $"; setup: {sup.SetupProblem}" : "");
            default: return $"error: unknown command '{cmd}'";
        }
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    static extern bool AttachConsole(int processId);
    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    static extern IntPtr GetStdHandle(int handle);
}
