// Notification-area (tray) icon: shows service/game status, the PC address the
// head unit needs, and offers restart / logs / start-with-Windows / exit.

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
    readonly ContextMenuStrip _menu = new();
    readonly ToolStripMenuItem _problem, _game, _pair, _address, _autostart;
    readonly Dictionary<NodeService, ToolStripMenuItem> _svcItems = new();
    readonly System.Windows.Forms.Timer _timer = new() { Interval = 1000 };
    readonly SynchronizationContext _ui;
    Color _lastColor = Color.Empty;

    public TrayApp(Supervisor sup, TelemetryBridge bridge, bool quiet)
    {
        _sup = sup;
        _bridge = bridge;

        MigrateAutostart();
        var title = new ToolStripMenuItem("Rig Buddy") { Enabled = false, Font = new Font(_menu.Font, FontStyle.Bold) };
        _problem = new ToolStripMenuItem { Visible = false, ForeColor = Color.Firebrick };
        _problem.Click += (_, _) => OpenPath(Path.Combine(sup.Root, "README.md"));
        _menu.Items.Add(title);
        _menu.Items.Add(_problem);
        _menu.Items.Add(new ToolStripSeparator());
        foreach (var s in sup.Services)
        {
            var item = new ToolStripMenuItem(s.Title) { ToolTipText = "Tıkla: yeniden başlat" };
            item.Click += (_, _) => sup.Restart(s.Name);
            _svcItems[s] = item;
            _menu.Items.Add(item);
        }
        _game = new ToolStripMenuItem { Enabled = false };
        _pair = new ToolStripMenuItem { Enabled = false, Visible = false };
        _address = new ToolStripMenuItem { ToolTipText = "Tıkla: kopyala" };
        _address.Click += (_, _) => { if (LanAddresses().FirstOrDefault() is string ip) Clipboard.SetText(ip); };
        _menu.Items.AddRange([_game, _pair, _address, new ToolStripSeparator()]);

        var restart = new ToolStripMenuItem("Servisleri yeniden başlat");
        restart.Click += (_, _) => sup.Restart(null);
        var logs = new ToolStripMenuItem("Log klasörünü aç");
        logs.Click += (_, _) => OpenPath(Log.Dir);
        _autostart = new ToolStripMenuItem("Windows açılışında başlat") { CheckOnClick = true, Checked = AutostartEnabled() };
        _autostart.Click += (_, _) => SetAutostart(_autostart.Checked);
        var exit = new ToolStripMenuItem("Çıkış");
        exit.Click += (_, _) => Exit();
        _menu.Items.AddRange([restart, logs, _autostart, new ToolStripSeparator(), exit]);

        _tray = new NotifyIcon { ContextMenuStrip = _menu, Text = "Rig Buddy", Visible = true };
        // left click opens the menu too (NotifyIcon only does that for right click)
        _tray.MouseUp += (_, e) =>
        {
            if (e.Button != MouseButtons.Left) return;
            typeof(NotifyIcon).GetMethod("ShowContextMenu",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)?.Invoke(_tray, null);
        };
        _ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        _timer.Tick += (_, _) => Refresh();
        _timer.Start();
        Refresh();

        if (sup.SetupProblem != null) Balloon(sup.SetupProblem, ToolTipIcon.Warning);
        else if (!quiet) Balloon("Arka planda çalışıyor. Durum için simgeye tıklayın.", ToolTipIcon.Info);
    }

    /** Runs `action` on the UI thread (for calls from the control port). */
    public void Post(Action action) => _ui.Post(_ => action(), null);

    public void Balloon(string text, ToolTipIcon icon = ToolTipIcon.Info) =>
        _tray.ShowBalloonTip(4000, "Rig Buddy", text, icon);

    public void Exit()
    {
        _timer.Stop();
        _tray.Visible = false;
        _sup.StopAll();
        ExitThread();
    }

    void Refresh()
    {
        _problem.Visible = _sup.SetupProblem != null;
        _problem.Text = _sup.SetupProblem ?? "";

        bool allRunning = _sup.SetupProblem == null;
        foreach (var (s, item) in _svcItems)
        {
            string state = s.State switch
            {
                ServiceState.Running => "çalışıyor",
                ServiceState.Starting => "başlatılıyor…",
                ServiceState.Waiting => s.Process == null && s.NextStartAt > DateTime.UtcNow ? "yeniden başlatılacak" : "bekliyor",
                _ => "durduruldu",
            };
            item.Text = $"{s.Title}: {state}";
            item.Image = Dot(s.State == ServiceState.Running ? Color.SeaGreen : s.State == ServiceState.Stopped ? Color.Gray : Color.Orange);
            allRunning &= s.State == ServiceState.Running;
        }
        _game.Text = _bridge.GameConnected ? "Oyun: bağlı" : "Oyun: bekleniyor";
        _game.Image = Dot(_bridge.GameConnected ? Color.SeaGreen : Color.Gray);
        _pair.Visible = _sup.PairingCode != null;
        _pair.Text = $"Eşleştirme kodu: {_sup.PairingCode}";
        var ips = LanAddresses().ToList();
        _address.Text = ips.Count > 0 ? $"PC adresi: {string.Join(", ", ips)}" : "PC adresi: ağ yok";

        var color = _sup.SetupProblem != null ? Color.Firebrick : allRunning ? Color.SeaGreen : Color.Orange;
        if (color != _lastColor)
        {
            _lastColor = color;
            var old = _tray.Icon;
            _tray.Icon = MakeIcon(color);
            old?.Dispose();
        }
        string tip = $"Rig Buddy: {(_sup.SetupProblem != null ? "kurulum eksik" : allRunning ? "hazır" : "başlatılıyor")}" +
                     (_bridge.GameConnected ? ", oyun bağlı" : "");
        _tray.Text = tip.Length > 63 ? tip[..63] : tip;
    }

    /** IPv4 addresses of interfaces that have a gateway (i.e. the LAN the head unit is on). */
    static IEnumerable<string> LanAddresses() =>
        NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback)
            .Select(n => n.GetIPProperties())
            .Where(p => p.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork))
            .SelectMany(p => p.UnicastAddresses)
            .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork)
            .Select(a => a.Address.ToString());

    static bool AutostartEnabled()
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

    static void SetAutostart(bool on)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (on) key.SetValue(RunValue, $"\"{Environment.ProcessPath}\" --autostart");
        else key.DeleteValue(RunValue, throwOnMissingValue: false);
    }

    static void OpenPath(string path) =>
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
