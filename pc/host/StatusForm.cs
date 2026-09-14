// The Rig Buddy window (9:16): start-up progress, the PC address to type into
// the app, what is working, and the few actions a user needs. Closing it only
// hides it; the app keeps running in the tray.

using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

sealed class StatusForm : Form
{
    // same palette as the Android app's dark theme
    internal static readonly Color Bg = Color.FromArgb(0x0F, 0x11, 0x15);
    internal static readonly Color Card = Color.FromArgb(0x1E, 0x21, 0x28);
    internal static readonly Color Text1 = Color.FromArgb(0xE8, 0xEA, 0xED);
    internal static readonly Color Text2 = Color.FromArgb(0x9A, 0xA0, 0xA6);
    internal static readonly Color Accent = Color.FromArgb(0x8A, 0xB4, 0xF8);
    internal static readonly Color Green = Color.FromArgb(0x81, 0xC9, 0x95);
    internal static readonly Color Orange = Color.FromArgb(0xFD, 0xD6, 0x63);
    internal static readonly Color Red = Color.FromArgb(0xF2, 0x8B, 0x82);
    internal static readonly Color Gray = Color.FromArgb(0x5F, 0x63, 0x68);

    readonly Supervisor _sup;
    readonly TelemetryBridge _bridge;
    readonly Label _status, _stage, _percent, _ip, _pair;
    readonly ProgressLine _bar;
    readonly FeatureRow _nav, _vehicle, _jobs, _media, _devices;
    readonly CheckBox _autostart;
    readonly System.Windows.Forms.Timer _timer = new() { Interval = 100 };
    double _shown;
    DateTime _copiedUntil;
    bool _exiting;

    /** Raised when the user closes the window (the app keeps running). */
    public event Action? HiddenToTray;

    public StatusForm(Supervisor sup, TelemetryBridge bridge)
    {
        _sup = sup;
        _bridge = bridge;
        SuspendLayout();
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Text = "Rig Buddy";
        ClientSize = new Size(360, 640);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Bg;
        ForeColor = Text1;
        Font = new Font("Segoe UI", 9F);
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!); } catch { }

        // header
        var logo = new PictureBox { Location = new Point(20, 20), Size = new Size(48, 48), SizeMode = PictureBoxSizeMode.Zoom };
        try { logo.Image = Icon.ExtractIcon(Environment.ProcessPath!, 0, 128)?.ToBitmap(); } catch { }
        Controls.Add(logo);
        Controls.Add(Lbl("Rig Buddy", 80, 18, 16F, Text1, bold: true));
        Controls.Add(Lbl($"PC servisi · v{Application.ProductVersion.Split('+')[0]}", 82, 50, 9F, Text2));

        // start-up progress
        var progress = new RoundedPanel { Location = new Point(16, 88), Size = new Size(328, 118) };
        _status = Lbl("Hazırlanıyor…", 16, 12, 14F, Orange, bold: true);
        _stage = Lbl("", 16, 46, 9F, Text2);
        _stage.AutoSize = false;
        _stage.Size = new Size(296, 20);
        _stage.AutoEllipsis = true;
        _bar = new ProgressLine { Location = new Point(16, 82), Size = new Size(244, 8) };
        _percent = Lbl("%0", 264, 75, 9F, Text2);
        _percent.AutoSize = false;
        _percent.Size = new Size(48, 20);
        _percent.TextAlign = ContentAlignment.MiddleRight;
        progress.Controls.AddRange([_status, _stage, _bar, _percent]);
        Controls.Add(progress);

        // PC address
        var address = new RoundedPanel { Location = new Point(16, 216), Size = new Size(328, 104) };
        address.Controls.Add(Lbl("Uygulamada girilecek PC adresi", 16, 12, 9F, Text2));
        _ip = Lbl("…", 14, 32, 20F, Accent, bold: true);
        _ip.Cursor = Cursors.Hand;
        _ip.Click += (_, _) => CopyAddress();
        _pair = Lbl("", 16, 74, 9F, Text2);
        address.Controls.AddRange([_ip, _pair]);
        Controls.Add(address);

        // features
        var features = new RoundedPanel { Location = new Point(16, 330), Size = new Size(328, 222) };
        features.Controls.Add(Lbl("Özellikler", 16, 10, 9F, Text2));
        _nav = Row(features, 0, "Navigasyon ve rota");
        _vehicle = Row(features, 1, "Araç bilgisayarı");
        _jobs = Row(features, 2, "İşler ve profil");
        _media = Row(features, 3, "Medya ve radyo");
        _devices = Row(features, 4, "Bağlı cihazlar");
        Controls.Add(features);

        // actions
        _autostart = new CheckBox
        {
            Text = "Windows açılışında başlat", Location = new Point(18, 560), AutoSize = true,
            ForeColor = Text1, BackColor = Bg,
        };
        _autostart.Click += (_, _) => TrayApp.SetAutostart(_autostart.Checked);
        Controls.Add(_autostart);
        var restart = Btn("Servisleri yeniden başlat", 16, 592, 200);
        restart.Click += (_, _) => { _sup.Restart(null); _shown = 0; };
        var logs = Btn("Loglar", 224, 592, 120);
        logs.Click += (_, _) => TrayApp.OpenPath(Log.Dir);
        Controls.AddRange([restart, logs]);
        ResumeLayout(false);

        _timer.Tick += (_, _) => Refresh2();
        VisibleChanged += (_, _) =>
        {
            if (Visible) { _autostart.Checked = TrayApp.AutostartEnabled(); Refresh2(); _timer.Start(); }
            else _timer.Stop();
        };
    }

    /** Shows the window in front, restoring it if minimized. */
    public void ShowInFront()
    {
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    public void CloseForExit()
    {
        _exiting = true;
        Close();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing && !_exiting)
        {
            e.Cancel = true;
            Hide();
            HiddenToTray?.Invoke();
            return;
        }
        base.OnFormClosing(e);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int dark = 1; // dark title bar (Windows 10 20H1+ / 11)
        DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));
    }

    void Refresh2()
    {
        var st = _sup.Stage;
        var server = _sup.Find("server")!;
        var agent = _sup.Find("agent")!;
        var telemetry = _sup.Find("telemetry")!;
        bool navReady = st.Done && server.State == ServiceState.Running && telemetry.State == ServiceState.Running;
        bool agentUp = agent.State == ServiceState.Running;

        double target = _sup.SetupProblem != null ? 0 : navReady ? 1 : Math.Min(st.Estimate(), 0.99);
        _shown += (target - _shown) * 0.2;
        if (Math.Abs(target - _shown) < 0.002) _shown = target;
        _bar.Value = _shown;
        _percent.Text = $"%{Math.Round(_shown * 100)}";

        if (_sup.SetupProblem != null)
        {
            Set(_status, "Kurulum eksik", Red);
            _stage.Text = _sup.SetupProblem;
            _bar.Fill = Red;
        }
        else if (navReady)
        {
            Set(_status, "Hazır", Green);
            _stage.Text = _bridge.GameConnected ? "Oyun bağlı, iyi yolculuklar" : "Oyunu açabilirsiniz";
            _bar.Fill = Green;
        }
        else
        {
            Set(_status, "Hazırlanıyor…", Orange);
            _stage.Text = server.State == ServiceState.Stopped ? "Navigasyon sunucusu durduruldu" : st.Label;
            _bar.Fill = Accent;
        }

        var ips = TrayApp.LanAddresses().ToList();
        _ip.Text = ips.Count > 0 ? ips[0] : "Ağ bağlantısı yok";
        _pair.Text = DateTime.UtcNow < _copiedUntil ? "Kopyalandı ✓"
            : _sup.PairingCode != null ? $"Eşleştirme kodu: {_sup.PairingCode}  ·  uygulama otomatik eşleşir"
            : "Tıklayınca kopyalanır";

        _nav.Set(navReady ? Green : server.State == ServiceState.Stopped ? Gray : Orange,
            navReady ? "Hazır" : server.State == ServiceState.Stopped ? "Durduruldu" : $"Yükleniyor… %{Math.Round(_shown * 100)}");
        _vehicle.Set(!agentUp ? Orange : _bridge.GameConnected ? Green : Gray,
            !agentUp ? "Başlatılıyor…" : _bridge.GameConnected ? "Oyundan veri geliyor" : "Oyun bekleniyor");
        _jobs.Set(!agentUp ? Orange : _sup.SaveLoaded ? Green : Gray,
            !agentUp ? "Başlatılıyor…" : _sup.SaveLoaded ? "Kayıt okundu" : "Kayıt bekleniyor");
        _media.Set(agentUp && MediaService.Running ? Green : Orange,
            agentUp && MediaService.Running ? "Hazır" : "Başlatılıyor…");
        _devices.Set(_sup.Clients > 0 ? Green : Gray,
            _sup.Clients > 0 ? $"{_sup.Clients} cihaz bağlı" : "Cihaz bekleniyor");
    }

    void CopyAddress()
    {
        if (TrayApp.LanAddresses().FirstOrDefault() is not string ip) return;
        Clipboard.SetText(ip);
        _copiedUntil = DateTime.UtcNow.AddSeconds(1.5);
    }

    static void Set(Label l, string text, Color color)
    {
        l.Text = text;
        l.ForeColor = color;
    }

    static Label Lbl(string text, int x, int y, float size, Color color, bool bold = false) => new()
    {
        Text = text, Location = new Point(x, y), AutoSize = true, ForeColor = color, BackColor = Color.Transparent,
        Font = new Font("Segoe UI", size, bold ? FontStyle.Bold : FontStyle.Regular),
    };

    static Button Btn(string text, int x, int y, int w)
    {
        var b = new Button
        {
            Text = text, Location = new Point(x, y), Size = new Size(w, 32),
            FlatStyle = FlatStyle.Flat, BackColor = Card, ForeColor = Text1, Cursor = Cursors.Hand,
        };
        b.FlatAppearance.BorderColor = Gray;
        b.FlatAppearance.MouseOverBackColor = Color.FromArgb(0x2A, 0x2E, 0x36);
        return b;
    }

    static FeatureRow Row(Control parent, int index, string title)
    {
        var row = new FeatureRow { Title = title, Location = new Point(16, 36 + index * 36), Size = new Size(296, 36) };
        parent.Controls.Add(row);
        return row;
    }

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}

/** Card background with rounded corners. */
sealed class RoundedPanel : Panel
{
    public RoundedPanel()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = StatusForm.Card; // children with a transparent back color paint over this
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Parent?.BackColor ?? StatusForm.Bg);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using var brush = new SolidBrush(StatusForm.Card);
        using var path = Shapes.Rounded(new RectangleF(0, 0, Width - 1, Height - 1), 12 * DeviceDpi / 96f);
        g.FillPath(brush, path);
    }
}

/** Thin rounded progress bar. */
sealed class ProgressLine : Control
{
    double _value;
    Color _fill = StatusForm.Accent;

    public ProgressLine()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = StatusForm.Card;
    }

    public double Value
    {
        get => _value;
        set { if (Math.Abs(value - _value) > 0.0005) { _value = Math.Clamp(value, 0, 1); Invalidate(); } }
    }

    public Color Fill
    {
        get => _fill;
        set { if (value != _fill) { _fill = value; Invalidate(); } }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(StatusForm.Card);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        float r = Height / 2f;
        using (var track = new SolidBrush(Color.FromArgb(0x2E, 0x32, 0x3A)))
        using (var path = Shapes.Rounded(new RectangleF(0, 0, Width - 1, Height - 1), r))
            g.FillPath(track, path);
        float w = (float)(_value * (Width - 1));
        if (w < Height) w = _value > 0 ? Height : 0;
        if (w <= 0) return;
        using var fill = new SolidBrush(_fill);
        using var bar = Shapes.Rounded(new RectangleF(0, 0, w, Height - 1), r);
        g.FillPath(fill, bar);
    }
}

/** One line of the features list: status dot, name, state on the right. */
sealed class FeatureRow : Control
{
    Color _dot = StatusForm.Gray;
    string _state = "";

    public string Title { get; set; } = "";

    public FeatureRow()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = StatusForm.Card;
    }

    public void Set(Color dot, string state)
    {
        if (dot == _dot && state == _state) return;
        _dot = dot;
        _state = state;
        Invalidate();
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(StatusForm.Card);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        float d = Height * 0.24f;
        using (var b = new SolidBrush(_dot))
            g.FillEllipse(b, 1, (Height - d) / 2, d, d);
        var textLeft = (int)(d + Height * 0.3f);
        using var titleFont = new Font("Segoe UI", 10F);
        TextRenderer.DrawText(g, Title, titleFont, new Rectangle(textLeft, 0, Width - textLeft, Height),
            StatusForm.Text1, TextFormatFlags.VerticalCenter | TextFormatFlags.Left);
        TextRenderer.DrawText(g, _state, Font, new Rectangle(0, 0, Width, Height),
            StatusForm.Text2, TextFormatFlags.VerticalCenter | TextFormatFlags.Right);
    }
}

static class Shapes
{
    public static GraphicsPath Rounded(RectangleF r, float radius)
    {
        var p = new GraphicsPath();
        float d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
        if (d <= 0) { p.AddRectangle(r); return p; }
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }
}
