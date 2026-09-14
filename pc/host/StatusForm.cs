// The Rig Buddy window (9:16): start-up progress, the PC address to type into
// the app, what is working, and the few actions a user needs. Closing it only
// hides it; the app keeps running in the tray. Colors come from Theme.

using System.Drawing.Drawing2D;

sealed class StatusForm : Form
{
    readonly Supervisor _sup;
    readonly TelemetryBridge _bridge;
    readonly Label _status, _stage, _percent, _ip, _pair, _themeLink, _langLink;
    readonly Action _onThemeChanged;
    readonly ProgressLine _bar;
    readonly FeatureRow _nav, _vehicle, _jobs, _media, _devices;
    readonly CheckBox _autostart;
    readonly Button[] _buttons;
    readonly List<(Control Control, Func<Palette, Color> Fore)> _labels = new();
    readonly System.Windows.Forms.Timer _timer = new() { Interval = 100 };
    double _shown;
    DateTime _copiedUntil;
    bool _exiting;

    /** Raised when the user closes the window (the app keeps running). */
    public event Action? HiddenToTray;

    public StatusForm(Supervisor sup, TelemetryBridge bridge, Action showLogs)
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
        Font = new Font("Segoe UI", 9F);
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!); } catch { }

        // header
        var logo = new PictureBox { Location = new Point(20, 20), Size = new Size(48, 48), SizeMode = PictureBoxSizeMode.Zoom };
        try { logo.Image = Icon.ExtractIcon(Environment.ProcessPath!, 0, 128)?.ToBitmap(); } catch { }
        Controls.Add(logo);
        Controls.Add(Lbl("Rig Buddy", 80, 18, 16F, p => p.Text1, bold: true));
        Controls.Add(Lbl(L.T("win.subtitle", Application.ProductVersion.Split('+')[0]), 82, 50, 9F, p => p.Text2));
        _themeLink = HeaderLink(16);
        _themeLink.Click += (_, _) => ThemeMenu().Show(_themeLink, new Point(0, _themeLink.Height));
        _langLink = HeaderLink(38);
        _langLink.Click += (_, _) => LanguageMenu().Show(_langLink, new Point(0, _langLink.Height));
        Controls.AddRange([_themeLink, _langLink]);

        // start-up progress
        var progress = new RoundedPanel { Location = new Point(16, 88), Size = new Size(328, 118) };
        _status = Lbl(L.T("win.preparing"), 16, 12, 14F, p => p.Orange, bold: true);
        _stage = Lbl("", 16, 46, 9F, p => p.Text2);
        _stage.AutoSize = false;
        _stage.Size = new Size(296, 20);
        _stage.AutoEllipsis = true;
        _bar = new ProgressLine { Location = new Point(16, 82), Size = new Size(244, 8) };
        _percent = Lbl("%0", 264, 75, 9F, p => p.Text2);
        _percent.AutoSize = false;
        _percent.Size = new Size(48, 20);
        _percent.TextAlign = ContentAlignment.MiddleRight;
        progress.Controls.AddRange([_status, _stage, _bar, _percent]);
        Controls.Add(progress);

        // PC address
        var address = new RoundedPanel { Location = new Point(16, 216), Size = new Size(328, 104) };
        address.Controls.Add(Lbl(L.T("win.address_title"), 16, 12, 9F, p => p.Text2));
        _ip = Lbl("…", 14, 32, 20F, p => p.Accent, bold: true);
        _ip.Cursor = Cursors.Hand;
        _ip.Click += (_, _) => CopyAddress();
        _pair = Lbl("", 16, 74, 9F, p => p.Text2);
        address.Controls.AddRange([_ip, _pair]);
        Controls.Add(address);

        // features
        var features = new RoundedPanel { Location = new Point(16, 330), Size = new Size(328, 222) };
        features.Controls.Add(Lbl(L.T("win.features"), 16, 10, 9F, p => p.Text2));
        _nav = Row(features, 0, L.T("f.nav"));
        _vehicle = Row(features, 1, L.T("f.vehicle"));
        _jobs = Row(features, 2, L.T("f.jobs"));
        _media = Row(features, 3, L.T("f.media"));
        _devices = Row(features, 4, L.T("f.devices"));
        Controls.Add(features);

        // actions
        _autostart = new CheckBox { Text = L.T("win.autostart"), Location = new Point(18, 560), AutoSize = true };
        _autostart.Click += (_, _) => TrayApp.SetAutostart(_autostart.Checked);
        Controls.Add(_autostart);
        var restart = Btn(L.T("win.restart"), 16, 592, 200);
        restart.Click += (_, _) => { _sup.Restart(null); _shown = 0; };
        var logs = Btn(L.T("win.logs"), 224, 592, 120);
        logs.Click += (_, _) => showLogs();
        _buttons = [restart, logs];
        Controls.AddRange(_buttons);
        ResumeLayout(false);

        ApplyTheme();
        _onThemeChanged = () => { if (IsHandleCreated) BeginInvoke(ApplyTheme); else ApplyTheme(); };
        Theme.Changed += _onThemeChanged;
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
        Theme.ApplyTitleBar(Handle);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Theme.Changed -= _onThemeChanged;
            _timer.Dispose();
        }
        base.Dispose(disposing);
    }

    Label HeaderLink(int y)
    {
        var l = Lbl("", 174, y, 9F, p => p.Text2);
        l.AutoSize = false;
        l.Size = new Size(170, 20);
        l.TextAlign = ContentAlignment.MiddleRight;
        l.Cursor = Cursors.Hand;
        return l;
    }

    static ContextMenuStrip LanguageMenu()
    {
        var menu = new ContextMenuStrip();
        foreach (var (value, label) in new[] { ("system", L.T("lang.system")) }.Concat(L.Languages))
        {
            var item = new ToolStripMenuItem(label) { Checked = L.Setting == value };
            item.Click += (_, _) => L.Setting = value; // TrayApp rebuilds the UI
            menu.Items.Add(item);
        }
        return menu;
    }

    void ApplyTheme()
    {
        var p = Theme.Current;
        BackColor = p.Bg;
        ForeColor = p.Text1;
        foreach (var (control, fore) in _labels) control.ForeColor = fore(p);
        foreach (var c in Controls.OfType<RoundedPanel>()) c.BackColor = p.Card;
        _autostart.ForeColor = p.Text1;
        _autostart.BackColor = p.Bg;
        foreach (var b in _buttons) StyleButton(b);
        _themeLink.Text = L.T("win.theme", Theme.Label(Theme.Setting));
        _langLink.Text = L.T("win.language", L.LanguageName(L.Setting));
        if (IsHandleCreated) Theme.ApplyTitleBar(Handle);
        Invalidate(true);
    }

    ContextMenuStrip ThemeMenu()
    {
        var menu = new ContextMenuStrip();
        foreach (var (value, label) in Theme.Choices)
        {
            var item = new ToolStripMenuItem(L.T(label)) { Checked = Theme.Setting == value };
            item.Click += (_, _) => { Theme.Setting = value; ApplyTheme(); };
            menu.Items.Add(item);
        }
        return menu;
    }

    void Refresh2()
    {
        var p = Theme.Current;
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
        _percent.Text = L.T("percent", Math.Round(_shown * 100));

        if (_sup.SetupProblem != null)
        {
            Set(_status, L.T("win.setup"), p.Red);
            _stage.Text = L.T(_sup.SetupProblem);
            _bar.Fill = p.Red;
        }
        else if (navReady)
        {
            Set(_status, L.T("win.ready"), p.Green);
            _stage.Text = L.T(_bridge.GameConnected ? "win.game_connected" : "win.open_game");
            _bar.Fill = p.Green;
        }
        else
        {
            Set(_status, L.T("win.preparing"), p.Orange);
            _stage.Text = server.State == ServiceState.Stopped ? L.T("win.server_stopped") : st.Label;
            _bar.Fill = p.Accent;
        }

        var ips = TrayApp.LanAddresses().ToList();
        _ip.Text = ips.Count > 0 ? ips[0] : L.T("win.no_network");
        _pair.Text = DateTime.UtcNow < _copiedUntil ? L.T("win.copied")
            : _sup.PairingCode != null ? L.T("win.pair", _sup.PairingCode)
            : L.T("win.click_copy");

        _nav.Set(navReady ? p.Green : server.State == ServiceState.Stopped ? p.Gray : p.Orange,
            L.T(navReady ? "fs.ready" : server.State == ServiceState.Stopped ? "fs.stopped" : "fs.loading", Math.Round(_shown * 100)));
        _vehicle.Set(!agentUp ? p.Orange : _bridge.GameConnected ? p.Green : p.Gray,
            L.T(!agentUp ? "fs.starting" : _bridge.GameConnected ? "fs.game_data" : "fs.game_wait"));
        _jobs.Set(!agentUp ? p.Orange : _sup.SaveLoaded ? p.Green : p.Gray,
            L.T(!agentUp ? "fs.starting" : _sup.SaveLoaded ? "fs.save_ok" : "fs.save_wait"));
        _media.Set(agentUp && MediaService.Running ? p.Green : p.Orange,
            L.T(agentUp && MediaService.Running ? "fs.ready" : "fs.starting"));
        _devices.Set(_sup.Clients > 0 ? p.Green : p.Gray,
            _sup.Clients > 0 ? L.T("fs.devices", _sup.Clients) : L.T("fs.devices_wait"));
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

    Label Lbl(string text, int x, int y, float size, Func<Palette, Color> fore, bool bold = false)
    {
        var l = new Label
        {
            Text = text, Location = new Point(x, y), AutoSize = true, BackColor = Color.Transparent,
            Font = new Font("Segoe UI", size, bold ? FontStyle.Bold : FontStyle.Regular),
        };
        _labels.Add((l, fore));
        return l;
    }

    static Button Btn(string text, int x, int y, int w) => new()
    {
        Text = text, Location = new Point(x, y), Size = new Size(w, 32), FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand,
    };

    internal static void StyleButton(Button b)
    {
        var p = Theme.Current;
        b.BackColor = p.Card;
        b.ForeColor = p.Text1;
        b.FlatAppearance.BorderColor = p.Border;
        b.FlatAppearance.MouseOverBackColor = p.Hover;
    }

    static FeatureRow Row(Control parent, int index, string title)
    {
        var row = new FeatureRow { Title = title, Location = new Point(16, 36 + index * 36), Size = new Size(296, 36) };
        parent.Controls.Add(row);
        return row;
    }
}

/** Card background with rounded corners. */
sealed class RoundedPanel : Panel
{
    public RoundedPanel()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
        BackColor = Theme.Current.Card; // children with a transparent back color paint over this
    }

    protected override void OnPaintBackground(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.Clear(Parent?.BackColor ?? Theme.Current.Bg);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        using var brush = new SolidBrush(Theme.Current.Card);
        using var path = Shapes.Rounded(new RectangleF(0, 0, Width - 1, Height - 1), 12 * DeviceDpi / 96f);
        g.FillPath(brush, path);
    }
}

/** Thin rounded progress bar. */
sealed class ProgressLine : Control
{
    double _value;
    Color _fill = Theme.Current.Accent;

    public ProgressLine()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
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
        g.Clear(Theme.Current.Card);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        float r = Height / 2f;
        using (var track = new SolidBrush(Theme.Current.Track))
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
    Color _dot = Theme.Current.Gray;
    string _state = "";

    public string Title { get; set; } = "";

    public FeatureRow()
    {
        SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
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
        var p = Theme.Current;
        var g = e.Graphics;
        g.Clear(p.Card);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        float d = Height * 0.24f;
        using (var b = new SolidBrush(_dot))
            g.FillEllipse(b, 1, (Height - d) / 2, d, d);
        var textLeft = (int)(d + Height * 0.3f);
        using var titleFont = new Font("Segoe UI", 10F);
        TextRenderer.DrawText(g, Title, titleFont, new Rectangle(textLeft, 0, Width - textLeft, Height),
            p.Text1, TextFormatFlags.VerticalCenter | TextFormatFlags.Left);
        TextRenderer.DrawText(g, _state, Font, new Rectangle(0, 0, Width, Height),
            p.Text2, TextFormatFlags.VerticalCenter | TextFormatFlags.Right);
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
