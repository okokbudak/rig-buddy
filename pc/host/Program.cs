// Rig Buddy PC app. Start it once (or with Windows); it sits in the tray and
// runs everything the head unit talks to. See README.md.
//
//   RigBuddy.exe                     start (or, if already running, say so)
//   RigBuddy.exe --quit              stop the running app and all services
//   RigBuddy.exe --restart [svc]     restart server|agent|telemetry (default: all)
//   RigBuddy.exe --stop <svc> / --start <svc> / --status

static class Program
{
    static readonly string[] Commands = ["--quit", "--restart", "--stop", "--start", "--status"];

    [STAThread]
    static int Main(string[] args)
    {
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

        string root = FindRoot();
        Log.Init(Path.Combine(root, "logs"));
        Console.WriteLine($"Rig Buddy starting, root {root}");
        Application.ThreadException += (_, e) => Console.WriteLine($"ui error: {e.Exception}");
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Console.WriteLine($"fatal: {e.ExceptionObject}");
        ApplicationConfiguration.Initialize();

        var bridge = new TelemetryBridge();
        try { bridge.Start(); }
        catch (Exception e) { Console.WriteLine($"bridge: disabled ({e.Message}); is another Rig Buddy running?"); }
        _ = Task.Run(async () =>
        {
            try { await new MediaService().RunAsync(); }
            catch (Exception e) { Console.WriteLine($"media: disabled ({e.GetType().Name}: {e.Message})"); }
        });

        var sup = new Supervisor(root);
        var app = new TrayApp(sup, bridge, quiet: args.Contains("--autostart"));
        ControlPort.Listen(cmd => Handle(cmd, sup, app));
        sup.Start();
        Application.Run(app);
        sup.StopAll();
        Console.WriteLine("Rig Buddy stopped");
        return 0;
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
            case "show": app.Post(() => app.Balloon("Zaten çalışıyor. Durum için tepsi simgesine tıklayın.")); return "ok";
            case "restart": sup.Restart(svc); return "ok";
            case "stop" when svc != null: sup.SetEnabled(svc, false); return "ok";
            case "start" when svc != null: sup.SetEnabled(svc, true); return "ok";
            case "status":
                return string.Join("; ", sup.Services.Select(s => $"{s.Name}={s.State.ToString().ToLowerInvariant()}")) +
                       (sup.SetupProblem != null ? $"; setup: {sup.SetupProblem}" : "");
            default: return $"error: unknown command '{cmd}'";
        }
    }

    /** The repo folder: the first parent of the exe that holds pc\agent (exe normally lives in bin\). */
    static string FindRoot()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d != null; d = d.Parent)
            if (File.Exists(Path.Combine(d.FullName, @"pc\agent\index.mjs"))) return d.FullName;
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));
    }

    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    static extern bool AttachConsole(int processId);
    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    static extern IntPtr GetStdHandle(int handle);
}
