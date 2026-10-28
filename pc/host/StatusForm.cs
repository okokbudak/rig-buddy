// The Rig Buddy window: start-up progress, the PC address to type into the app, what
// is working, and everything the tray menu offers (services, game and map mods,
// theme, language, autostart, logs, exit). Closing it only hides it; the app keeps
// running in the tray. Colors come from Theme.
//
// Layout (two columns, design units at 96 dpi):
//   header   logo, name, version
//   left     progress / PC address / features
//   right    services / map (game, mods, update)        / preferences
//   bottom   [ Logs ]                                         [ Exit ]

using System.Drawing.Drawing2D;

sealed class StatusForm : Form
{
    const int Width0 = 704, Height0 = 612, FixExtra = 64;

    readonly Supervisor _sup;
    readonly TelemetryBridge _bridge;
    readonly MapBuilder _maps;
    readonly TrayApp _app;
    readonly Label _mapLink;
    readonly Label _status, _stage, _percent, _ip, _pair, _modsText;
    readonly Action _onThemeChanged;
    readonly ProgressLine _bar;
    readonly FeatureRow _nav, _vehicle, _jobs, _radio, _devices;
    readonly List<(NodeService Svc, FeatureRow Row)> _svcRows = new();
    readonly CheckBox _autostart;
    readonly Button _restartAll, _gameEts2, _gameAts, _modsPick, _modsClear, _mapButton, _themeButton, _langButton, _logs, _exit;
    readonly Button[] _plain; // flat buttons that only follow the palette
    readonly List<(Control Control, Func<Palette, Color> Fore)> _labels = new();
    readonly System.Windows.Forms.Timer _timer = new() { Interval = 100 };
    readonly RoundedPanel _fixPanel;
    readonly Label _fixText;
    readonly Button _fixButton;
    DateTime _nextPluginCheck, _nextModsRead;
    int _modCount;
    bool _restartGame, _fixShown;
    string? _fixFailed;
    double _shown;
    DateTime _copiedUntil;
    bool _exiting;

    /** Raised when the user closes the window (the app keeps running). */
    public event Action? HiddenToTray;

    public StatusForm(Supervisor sup, TelemetryBridge bridge, MapBuilder maps, TrayApp app)
    {
        _sup = sup;
        _bridge = bridge;
        _maps = maps;
        _app = app;
        SuspendLayout();
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Text = "Rig Buddy";
        ClientSize = new Size(Width0, Height0);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!); } catch { }
        var tips = new ToolTip();

        // header
        var logo = new PictureBox { Location = new Point(20, 20), Size = new Size(48, 48), SizeMode = PictureBoxSizeMode.Zoom };
        try { logo.Image = Icon.ExtractIcon(Environment.ProcessPath!, 0, 128)?.ToBitmap(); } catch { }
        Controls.Add(logo);
        Controls.Add(Lbl("Rig Buddy", 80, 18, 16F, p => p.Text1, bold: true));
        Controls.Add(Lbl(L.T("win.subtitle", Application.ProductVersion.Split('+')[0]), 82, 50, 9F, p => p.Text2));

        // ---- left column --------------------------------------------------------------
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
        // "update available" / "try again" / "only once" under the bar
        _mapLink = Lbl("", 16, 96, 8.5F, p => p.Accent);
        _mapLink.AutoSize = false;
        _mapLink.Size = new Size(296, 18);
        _mapLink.Click += (_, _) =>
        {
            if (_maps.State is MapState.UpdateAvailable or MapState.Failed) _maps.Build();
        };
        progress.Controls.AddRange([_status, _stage, _bar, _percent, _mapLink]);
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
        _radio = Row(features, 3, L.T("f.radio"));
        _devices = Row(features, 4, L.T("f.devices"));
        Controls.Add(features);

        // ---- right column -------------------------------------------------------------
        // services: state of each, restart one or all
        var services = new RoundedPanel { Location = new Point(360, 88), Size = new Size(328, 156) };
        services.Controls.Add(Lbl(L.T("win.services"), 16, 10, 9F, p => p.Text2));
        _restartAll = Btn("↻  " + L.T("win.restart"), 138, 5, 174);
        _restartAll.Height = 26;
        _restartAll.Font = new Font("Segoe UI", 8.5F);
        _restartAll.Click += (_, _) => { _sup.Restart(null); _shown = 0; };
        services.Controls.Add(_restartAll);
        int si = 0;
        foreach (var s in _sup.Services)
        {
            var row = new FeatureRow { Title = L.T(s.Title), Location = new Point(16, 38 + si * 36), Size = new Size(252, 32) };
            var one = Btn("↻", 274, 38 + si * 36, 38);
            one.Height = 32;
            var svc = s;
            one.Click += (_, _) => _sup.Restart(svc.Name);
            tips.SetToolTip(one, L.T("tray.restart_hint"));
            services.Controls.AddRange([row, one]);
            _svcRows.Add((s, row));
            _svcButtons.Add(one);
            si++;
        }
        Controls.Add(services);

        // map: which game, map mods, update / rebuild
        var map = new RoundedPanel { Location = new Point(360, 252), Size = new Size(328, 176) };
        map.Controls.Add(Lbl(L.T("win.map"), 16, 10, 9F, p => p.Text2));
        _gameEts2 = Btn("ETS2", 16, 34, 144);
        _gameAts = Btn("ATS", 168, 34, 144);
        foreach (var g in new[] { _gameEts2, _gameAts })
        {
            g.Height = 30;
            g.Font = new Font("Segoe UI", 9.5F, FontStyle.Bold);
            g.TextAlign = ContentAlignment.MiddleCenter;
        }
        tips.SetToolTip(_gameEts2, "Euro Truck Simulator 2");
        tips.SetToolTip(_gameAts, "American Truck Simulator");
        _gameEts2.Click += (_, _) => { if (_maps.State != MapState.Building) _maps.SelectGame("ets2"); };
        _gameAts.Click += (_, _) => { if (_maps.State != MapState.Building) _maps.SelectGame("ats"); };
        _modsText = Lbl("", 16, 74, 9F, p => p.Text1);
        _modsText.AutoSize = false;
        _modsText.Size = new Size(296, 20);
        _modsText.AutoEllipsis = true;
        _modsPick = Btn(L.T("tray.mods_pick"), 16, 98, 180);
        _modsPick.Height = 28;
        _modsPick.Click += (_, _) => { _app.PickMapMods(); _nextModsRead = DateTime.MinValue; };
        _modsClear = Btn(L.T("tray.mods_clear"), 200, 98, 112);
        _modsClear.Height = 28;
        _modsClear.Click += (_, _) => { MapMods.Paths = []; _maps.Check(); _nextModsRead = DateTime.MinValue; };
        _mapButton = Btn(L.T("tray.map_update"), 16, 134, 296);
        // update when the game changed, full rebuild otherwise
        _mapButton.Click += (_, _) => _maps.Build(force: _maps.State == MapState.UpToDate);
        map.Controls.AddRange([_gameEts2, _gameAts, _modsText, _modsPick, _modsClear, _mapButton]);
        Controls.Add(map);

        // preferences
        var prefs = new RoundedPanel { Location = new Point(360, 436), Size = new Size(328, 116) };
        prefs.Controls.Add(Lbl(L.T("win.prefs"), 16, 8, 9F, p => p.Text2));
        prefs.Controls.Add(Lbl(L.T("tray.theme"), 16, 34, 9.5F, p => p.Text1));
        _themeButton = Btn("", 150, 29, 162);
        _themeButton.Height = 28;
        _themeButton.Click += (_, _) => ThemeMenu().Show(_themeButton, new Point(0, _themeButton.Height));
        prefs.Controls.Add(Lbl(L.T("tray.language"), 16, 62, 9.5F, p => p.Text1));
        _langButton = Btn("", 150, 57, 162);
        _langButton.Height = 28;
        _langButton.Click += (_, _) => LanguageMenu().Show(_langButton, new Point(0, _langButton.Height));
        _autostart = new CheckBox { Text = L.T("win.autostart"), Location = new Point(16, 88), AutoSize = true, BackColor = Color.Transparent };
        _autostart.Click += (_, _) => TrayApp.SetAutostart(_autostart.Checked);
        prefs.Controls.AddRange([_themeButton, _langButton, _autostart]);
        Controls.Add(prefs);

        // ---- bottom bar ---------------------------------------------------------------
        _logs = Btn(L.T("win.logs"), 16, 564, 160);
        _logs.Click += (_, _) => _app.ShowLogs();
        _exit = Btn(L.T("tray.exit"), 528, 564, 160);
        _exit.Click += (_, _) =>
        {
            if (MessageBox.Show(this, L.T("win.exit_ask"), "Rig Buddy", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes) _app.Exit();
        };
        Controls.AddRange([_logs, _exit]);
        _plain = [_restartAll, _modsPick, _modsClear, _mapButton, _themeButton, _langButton, _logs, .. _svcButtons];

        // at the very bottom, only while a game has lost the telemetry plugin
        _fixPanel = new RoundedPanel { Location = new Point(16, Height0), Size = new Size(Width0 - 32, 52), Visible = false };
        _fixText = Lbl("", 12, 6, 8.5F, p => p.Red);
        _fixText.AutoSize = false;
        _fixText.Size = new Size(Width0 - 32 - 24 - 116, 40);
        _fixButton = Btn(L.T("plugin.fix"), Width0 - 32 - 108, 10, 96);
        _fixButton.Click += async (_, _) =>
        {
            _fixButton.Enabled = false;
            bool ok = await Task.Run(PluginCheck.Fix);
            _fixButton.Enabled = true;
            _restartGame = ok && PluginCheck.GameRunning();
            _fixFailed = ok ? null : L.T("plugin.failed");
            _nextPluginCheck = DateTime.MinValue;
            CheckPlugin();
        };
        _fixPanel.Controls.AddRange([_fixText, _fixButton]);
        Controls.Add(_fixPanel);
        ResumeLayout(false);

        ApplyTheme();
        _onThemeChanged = () => { if (IsHandleCreated) BeginInvoke(ApplyTheme); else ApplyTheme(); };
        Theme.Changed += _onThemeChanged;
        _timer.Tick += (_, _) => Refresh2();
        VisibleChanged += (_, _) =>
        {
            if (Visible) { _autostart.Checked = TrayApp.AutostartEnabled(); _nextModsRead = DateTime.MinValue; Refresh2(); _timer.Start(); }
            else _timer.Stop();
        };
    }

    readonly List<Button> _svcButtons = new();

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
        _autostart.BackColor = p.Card;
        foreach (var b in _plain) StyleButton(b);
        StyleButton(_fixButton);
        // the two prominent buttons
        StyleButton(_exit);
        _exit.ForeColor = p.Red;
        StyleGame(_gameEts2, GameChoice.Setting == "ets2");
        StyleGame(_gameAts, GameChoice.Setting == "ats");
        _themeButton.Text = $"◐  {Theme.Label(Theme.Setting)}  ▾";
        _langButton.Text = $"🌐  {(L.Setting == "system" ? L.T("lang.auto") : L.LanguageName(L.Setting))}  ▾";
        if (IsHandleCreated) Theme.ApplyTitleBar(Handle);
        Invalidate(true);
    }

    /** The chosen game's button is filled with the accent color. */
    static void StyleGame(Button b, bool on)
    {
        var p = Theme.Current;
        StyleButton(b);
        if (!on) return;
        b.BackColor = p.Accent;
        b.ForeColor = p.Dark ? p.Bg : Color.White;
        b.FlatAppearance.BorderColor = p.Accent;
        b.FlatAppearance.MouseOverBackColor = p.Accent;
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

    /** Once every few seconds: is the telemetry plugin still in each game? Shows the Fix now bar if not. */
    void CheckPlugin()
    {
        if (DateTime.UtcNow < _nextPluginCheck) return;
        _nextPluginCheck = DateTime.UtcNow.AddSeconds(3);
        var problems = PluginCheck.Find();
        var p = Theme.Current;
        bool show = true;
        if (problems.Count > 0)
        {
            Set(_fixText, _fixFailed ?? L.T("plugin.missing", string.Join(", ", problems.Select(x => x.Game))), p.Red);
            _fixButton.Visible = true;
        }
        else if (_restartGame && PluginCheck.GameRunning())
        {
            Set(_fixText, L.T("plugin.restart"), p.Orange); // the game only loads plugins as it starts
            _fixButton.Visible = false;
        }
        else
        {
            _restartGame = false;
            _fixFailed = null;
            show = false;
        }
        _fixPanel.Visible = show;
        if (show != _fixShown)
        {
            _fixShown = show;
            ClientSize = new Size(ClientSize.Width, LogicalToDeviceUnits(show ? Height0 + FixExtra : Height0));
        }
    }

    void Refresh2()
    {
        CheckPlugin();
        var p = Theme.Current;
        var st = _sup.Stage;
        var server = _sup.Find("server")!;
        var agent = _sup.Find("agent")!;
        var telemetry = _sup.Find("telemetry")!;
        bool navReady = st.Done && server.State == ServiceState.Running && telemetry.State == ServiceState.Running;
        bool agentUp = agent.State == ServiceState.Running;

        var map = _maps.State;
        bool building = map == MapState.Building;
        bool noGame = map == MapState.NoGame && !_sup.Find("server")!.CanStart();
        double target = _sup.SetupProblem != null || noGame ? 0
            : building ? _maps.Percent / 100.0
            : navReady ? 1 : Math.Min(st.Estimate(), 0.99);
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
        else if (noGame)
        {
            Set(_status, L.T("win.no_game"), p.Red);
            _stage.Text = L.T("win.no_game_hint");
            _bar.Fill = p.Red;
        }
        else if (building)
        {
            Set(_status, L.T("win.map_building"), p.Orange);
            _stage.Text = L.T(_maps.StepKey, _maps.StepArg);
            _bar.Fill = p.Accent;
        }
        else if (map == MapState.Failed)
        {
            Set(_status, L.T("win.map_failed"), p.Red);
            _stage.Text = _maps.Error ?? "";
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

        _mapLink.Text = building ? L.T("win.map_once")
            : map == MapState.Failed ? L.T("win.map_retry")
            : map == MapState.UpdateAvailable ? L.T("win.map_update") : "";
        _mapLink.ForeColor = building ? p.Text2 : p.Accent;
        _mapLink.Cursor = building ? Cursors.Default : Cursors.Hand;

        var ips = TrayApp.LanAddresses().ToList();
        _ip.Text = ips.Count > 0 ? ips[0] : L.T("win.no_network");
        _pair.Text = DateTime.UtcNow < _copiedUntil ? L.T("win.copied")
            : _sup.PairingCode != null ? L.T("win.pair", _sup.PairingCode)
            : L.T("win.click_copy");

        if (building) _nav.Set(p.Orange, L.T("fs.map_building", _maps.Percent));
        else _nav.Set(navReady ? p.Green : server.State == ServiceState.Stopped ? p.Gray : p.Orange,
            L.T(navReady ? "fs.ready" : server.State == ServiceState.Stopped ? "fs.stopped" : "fs.loading", Math.Round(_shown * 100)));
        _vehicle.Set(!agentUp ? p.Orange : _bridge.GameConnected ? p.Green : p.Gray,
            L.T(!agentUp ? "fs.starting" : _bridge.GameConnected ? "fs.game_data" : "fs.game_wait"));
        _jobs.Set(!agentUp ? p.Orange : _sup.SaveLoaded ? p.Green : p.Gray,
            L.T(!agentUp ? "fs.starting" : _sup.SaveLoaded ? "fs.save_ok" : "fs.save_wait"));
        _radio.Set(agentUp ? p.Green : p.Orange, L.T(agentUp ? "fs.ready" : "fs.starting"));
        _devices.Set(_sup.Clients > 0 ? p.Green : p.Gray,
            _sup.Clients > 0 ? L.T("fs.devices", _sup.Clients) : L.T("fs.devices_wait"));

        // services
        foreach (var (s, row) in _svcRows)
        {
            string state = s.State switch
            {
                ServiceState.Running => "state.running",
                ServiceState.Starting => "state.starting",
                ServiceState.Waiting => s.Process == null && s.NextStartAt > DateTime.UtcNow ? "state.restarting" : "state.waiting",
                _ => "state.stopped",
            };
            row.Set(s.State == ServiceState.Running ? p.Green : s.State == ServiceState.Stopped ? p.Gray : p.Orange, L.T(state));
        }

        // map: game, mods, update / rebuild (the mods file is read once a second, not at every tick)
        if (DateTime.UtcNow >= _nextModsRead)
        {
            _nextModsRead = DateTime.UtcNow.AddSeconds(1);
            _modCount = MapMods.Paths.Length;
        }
        bool idle = !building;
        string? choice = GameChoice.Setting;
        _gameEts2.Enabled = _gameAts.Enabled = idle;
        StyleGame(_gameEts2, choice == "ets2");
        StyleGame(_gameAts, choice == "ats");
        _modsText.Text = $"{L.T("tray.mods")} · {L.T("tray.mods_count", _modCount)}";
        _modsPick.Enabled = idle;
        _modsClear.Enabled = idle && _modCount > 0;
        _mapButton.Text = L.T(map == MapState.UpToDate ? "tray.map_rebuild" : "tray.map_update");
        _mapButton.Enabled = map is not (MapState.Building or MapState.NoGame);
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
        // a long title is cut with "…" rather than running into the state text
        int stateWidth = string.IsNullOrEmpty(_state) ? 0 : TextRenderer.MeasureText(g, _state, Font).Width + 10;
        TextRenderer.DrawText(g, Title, titleFont, new Rectangle(textLeft, 0, Math.Max(20, Width - textLeft - stateWidth), Height),
            p.Text1, TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.EndEllipsis);
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
