// Notification-area (tray) icon: left click opens the window (StatusForm),
// right click the menu with service/game status, restart, logs, theme,
// language, autostart, exit. A language change rebuilds the menu and windows.

using System.Drawing.Drawing2D;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using Microsoft.Win32;

sealed class TrayApp : ApplicationContext
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunValue = "Rig Buddy";
    const string OldRunValue = "ETS2 Nav"; // before the rename; migrated on start

    readonly Supervisor _sup;
    readonly TelemetryBridge _bridge;
    readonly NotifyIcon _tray;
    readonly System.Windows.Forms.Timer _timer = new() { Interval = 1000 };
    readonly SynchronizationContext _ui;
    ContextMenuStrip _menu = null!;
    ToolStripMenuItem _problem = null!, _game = null!, _pair = null!, _address = null!, _autostart = null!;
    readonly Dictionary<NodeService, ToolStripMenuItem> _svcItems = new();
    StatusForm _window = null!;
    LogForm _logs = null!;
    Color _lastColor = Color.Empty;
    bool _hiddenHintShown;

    public TrayApp(Supervisor sup, TelemetryBridge bridge, bool quiet)
    {
        _sup = sup;
        _bridge = bridge;
        MigrateAutostart();
        _tray = new NotifyIcon { Text = "Rig Buddy", Visible = true };
        // left click: the window; right click: the menu
        _tray.MouseUp += (_, e) => { if (e.Button == MouseButtons.Left) ShowWindow(); };
        _ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        BuildUi();
        L.Changed += () => Post(RebuildUi);
        _timer.Tick += (_, _) => Refresh();
        _timer.Start();
        Refresh();

        // started with Windows: stay in the tray unless something needs attention
        if (!quiet || sup.SetupProblem != null) ShowWindow();
    }

    void BuildUi()
    {
        _logs = new LogForm();
        _window = new StatusForm(_sup, _bridge, ShowLogs);
        _window.HiddenToTray += () =>
        {
            if (_hiddenHintShown) return;
            _hiddenHintShown = true;
            Balloon(L.T("tray.hidden"));
        };

        _menu = new ContextMenuStrip();
        var open = new ToolStripMenuItem(L.T("tray.open")) { Font = new Font(_menu.Font, FontStyle.Bold) };
        open.Click += (_, _) => ShowWindow();
        _problem = new ToolStripMenuItem { Visible = false, ForeColor = Color.Firebrick };
        _problem.Click += (_, _) => OpenPath(Path.Combine(_sup.Root, "README.md"));
        _menu.Items.AddRange([open, _problem, new ToolStripSeparator()]);
        _svcItems.Clear();
        foreach (var s in _sup.Services)
        {
            var item = new ToolStripMenuItem(L.T(s.Title)) { ToolTipText = L.T("tray.restart_hint") };
            item.Click += (_, _) => _sup.Restart(s.Name);
            _svcItems[s] = item;
            _menu.Items.Add(item);
        }
        _game = new ToolStripMenuItem { Enabled = false };
        _pair = new ToolStripMenuItem { Enabled = false, Visible = false };
        _address = new ToolStripMenuItem { ToolTipText = L.T("tray.copy_hint") };
        _address.Click += (_, _) => { if (LanAddresses().FirstOrDefault() is string ip) Clipboard.SetText(ip); };
        _menu.Items.AddRange([_game, _pair, _address, new ToolStripSeparator()]);

        var restart = new ToolStripMenuItem(L.T("win.restart"));
        restart.Click += (_, _) => _sup.Restart(null);
        var logs = new ToolStripMenuItem(L.T("tray.logs"));
        logs.Click += (_, _) => ShowLogs();
        var theme = Choices(L.T("tray.theme"), Theme.Choices.Select(c => (c.Value, L.T(c.Label))),
            () => Theme.Setting, v => Theme.Setting = v);
        var language = Choices(L.T("tray.language"), new[] { ("system", L.T("lang.system")) }.Concat(L.Languages),
            () => L.Setting, v => L.Setting = v);
        _autostart = new ToolStripMenuItem(L.T("win.autostart")) { CheckOnClick = true };
        _autostart.Click += (_, _) => SetAutostart(_autostart.Checked);
        var exit = new ToolStripMenuItem(L.T("tray.exit"));
        exit.Click += (_, _) => Exit();
        _menu.Items.AddRange([restart, logs, theme, language, _autostart, new ToolStripSeparator(), exit]);
        _menu.Opening += (_, _) => _autostart.Checked = AutostartEnabled(); // the window may have changed it
        _tray.ContextMenuStrip = _menu;
    }

    /** Language changed: rebuild menu and windows, keeping which windows were open. */
    void RebuildUi()
    {
        bool windowOpen = _window.Visible, logsOpen = _logs.Visible;
        var oldMenu = _menu;
        _window.CloseForExit();
        _logs.CloseForExit();
        _window.Dispose();
        _logs.Dispose();
        BuildUi();
        oldMenu.Dispose();
        _lastColor = Color.Empty;
        Refresh();
        if (windowOpen) ShowWindow();
        if (logsOpen) ShowLogs();
    }

    static ToolStripMenuItem Choices(string title, IEnumerable<(string Value, string Label)> choices,
        Func<string> current, Action<string> set)
    {
        var menu = new ToolStripMenuItem(title);
        foreach (var (value, label) in choices)
        {
            var item = new ToolStripMenuItem(label) { Tag = value };
            item.Click += (_, _) => set(value);
            menu.DropDownItems.Add(item);
        }
        menu.DropDownOpening += (_, _) =>
        {
            foreach (ToolStripMenuItem i in menu.DropDownItems) i.Checked = (string)i.Tag! == current();
        };
        return menu;
    }

    public void ShowWindow() => _window.ShowInFront();

    public void ShowLogs() => _logs.ShowInFront();

    /** Runs `action` on the UI thread (for calls from the control port). */
    public void Post(Action action) => _ui.Post(_ => action(), null);

    public void Balloon(string text, ToolTipIcon icon = ToolTipIcon.Info) =>
        _tray.ShowBalloonTip(4000, "Rig Buddy", text, icon);

    public void Exit()
    {
        _timer.Stop();
        _tray.Visible = false;
        _window.CloseForExit();
        _logs.CloseForExit();
        _sup.StopAll();
        ExitThread();
    }

    void Refresh()
    {
        Theme.CheckSystem();
        _problem.Visible = _sup.SetupProblem != null;
        _problem.Text = _sup.SetupProblem != null ? L.T(_sup.SetupProblem) : "";

        bool allRunning = _sup.SetupProblem == null;
        foreach (var (s, item) in _svcItems)
        {
            string state = s.State switch
            {
                ServiceState.Running => "state.running",
                ServiceState.Starting => "state.starting",
                ServiceState.Waiting => s.Process == null && s.NextStartAt > DateTime.UtcNow ? "state.restarting" : "state.waiting",
                _ => "state.stopped",
            };
            item.Text = $"{L.T(s.Title)}: {L.T(state)}";
            item.Image = Dot(s.State == ServiceState.Running ? Color.SeaGreen : s.State == ServiceState.Stopped ? Color.Gray : Color.Orange);
            allRunning &= s.State == ServiceState.Running;
        }
        _game.Text = L.T(_bridge.GameConnected ? "tray.game_on" : "tray.game_off");
        _game.Image = Dot(_bridge.GameConnected ? Color.SeaGreen : Color.Gray);
        _pair.Visible = _sup.PairingCode != null;
        _pair.Text = L.T("tray.pair", _sup.PairingCode);
        var ips = LanAddresses().ToList();
        _address.Text = ips.Count > 0 ? L.T("tray.address", string.Join(", ", ips)) : L.T("tray.no_network");

        var color = _sup.SetupProblem != null ? Color.Firebrick : allRunning ? Color.SeaGreen : Color.Orange;
        if (color != _lastColor)
        {
            _lastColor = color;
            var old = _tray.Icon;
            _tray.Icon = MakeIcon(color);
            old?.Dispose();
        }
        string tip = $"Rig Buddy: {L.T(_sup.SetupProblem != null ? "tip.setup" : allRunning ? "tip.ready" : "tip.starting")}" +
                     (_bridge.GameConnected ? ", " + L.T("tip.game") : "");
        _tray.Text = tip.Length > 63 ? tip[..63] : tip;
    }

    /**
     * IPv4 addresses of interfaces that have a gateway (i.e. the LAN the phones
     * are on). Querying the adapters is slow, so it is cached and refreshed in
     * the background when the network changes; the UI polls this often.
     */
    internal static IReadOnlyList<string> LanAddresses() => _lan;

    static volatile IReadOnlyList<string> _lan = QueryLan();

    static TrayApp()
    {
        NetworkChange.NetworkAddressChanged += (_, _) => Task.Run(() => _lan = QueryLan());
        NetworkChange.NetworkAvailabilityChanged += (_, _) => Task.Run(() => _lan = QueryLan());
    }

    static IReadOnlyList<string> QueryLan()
    {
        try
        {
            return NetworkInterface.GetAllNetworkInterfaces()
                .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .Select(n => n.GetIPProperties())
                .Where(p => p.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork))
                .SelectMany(p => p.UnicastAddresses)
                .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork)
                .Select(a => a.Address.ToString())
                .ToList();
        }
        catch
        {
            return [];
        }
    }

    internal static bool AutostartEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(RunValue) is string;
    }

    /** Carries a "start with Windows" choice over from the old app name. */
    static void MigrateAutostart()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey, writable: true);
        if (key?.GetValue(OldRunValue) == null) return;
        key.DeleteValue(OldRunValue, throwOnMissingValue: false);
        SetAutostart(true);
    }

    internal static void SetAutostart(bool on)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (on) key.SetValue(RunValue, $"\"{Environment.ProcessPath}\" --autostart");
        else key.DeleteValue(RunValue, throwOnMissingValue: false);
    }

    internal static void OpenPath(string path) =>
        System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(path) { UseShellExecute = true });

    static readonly Dictionary<Color, Bitmap> Dots = new();

    static Bitmap Dot(Color c)
    {
        if (Dots.TryGetValue(c, out var bmp)) return bmp;
        bmp = new Bitmap(12, 12);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using var b = new SolidBrush(c);
            g.FillEllipse(b, 2, 2, 8, 8);
        }
        return Dots[c] = bmp;
    }

    /** The app icon (art/MakeIcon.java, embedded in the exe) plus a status dot. */
    static Icon MakeIcon(Color status)
    {
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var app = Icon.ExtractAssociatedIcon(Environment.ProcessPath!))
                if (app != null) g.DrawIcon(app, new Rectangle(0, 0, 32, 32));
            using var dot = new SolidBrush(status);
            using var ring = new Pen(Color.White, 2);
            g.FillEllipse(dot, 19, 19, 12, 12);
            g.DrawEllipse(ring, 19, 19, 12, 12);
        }
        IntPtr h = bmp.GetHicon();
        var icon = (Icon)Icon.FromHandle(h).Clone();
        DestroyIcon(h);
        return icon;
    }

    [DllImport("user32.dll")]
    static extern bool DestroyIcon(IntPtr handle);
}
