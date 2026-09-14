// Live log viewer: follows logs\*.log (the app and each Node service) so users
// can see what is happening, and copy it into a bug report.

sealed class LogForm : Form
{
    static readonly (string File, string Title)[] Logs =
    [
        ("rigbuddy.log", "Rig Buddy"),
        ("server.log", "svc.server"), // titles: L keys
        ("agent.log", "logs.agent"),
        ("telemetry.log", "logs.telemetry"),
    ];
    const int MaxInitialBytes = 256 * 1024; // show the tail of big logs
    const int MaxChars = 1_000_000;         // then keep the view bounded

    readonly FlowLayoutPanel _tabs = new() { Dock = DockStyle.Top, Height = 44, Padding = new Padding(10, 8, 10, 0), WrapContents = false };
    readonly FlowLayoutPanel _bar = new() { Dock = DockStyle.Bottom, Height = 48, Padding = new Padding(10, 8, 10, 8), FlowDirection = FlowDirection.RightToLeft };
    readonly TextBox _text = new()
    {
        Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false,
        BorderStyle = BorderStyle.None, Font = new Font("Consolas", 9.5F),
    };
    readonly List<Button> _tabButtons = new();
    readonly Button _pause, _copy, _folder;
    readonly System.Windows.Forms.Timer _timer = new() { Interval = 500 };
    string _file = Logs[0].File;
    long _pos;
    bool _paused, _exiting;
    readonly Action _onThemeChanged;

    public LogForm()
    {
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Text = L.T("logs.title");
        ClientSize = new Size(900, 560);
        MinimumSize = new Size(520, 320);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);

        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!); } catch { }

        foreach (var (file, title) in Logs)
        {
            var b = Tab(L.T(title));
            b.Click += (_, _) => Select(file);
            b.Tag = file;
            _tabButtons.Add(b);
            _tabs.Controls.Add(b);
        }
        _folder = Action(L.T("logs.folder"), () => TrayApp.OpenPath(Log.Dir));
        _copy = Action(L.T("logs.copy"), () => { if (_text.TextLength > 0) Clipboard.SetText(_text.Text); });
        _pause = Action(L.T("logs.pause"), () =>
        {
            _paused = !_paused;
            _pause!.Text = L.T(_paused ? "logs.resume" : "logs.pause");
            if (!_paused) Poll();
        });
        _bar.Controls.AddRange([_folder, _copy, _pause]);

        Controls.Add(_text);
        Controls.Add(_tabs);
        Controls.Add(_bar);

        ApplyTheme();
        _onThemeChanged = () => { if (IsHandleCreated) BeginInvoke(ApplyTheme); else ApplyTheme(); };
        Theme.Changed += _onThemeChanged;
        _timer.Tick += (_, _) => { if (!_paused) Poll(); };
        VisibleChanged += (_, _) => { if (Visible) { Select(_file); _timer.Start(); } else _timer.Stop(); };
    }

    public void ShowInFront()
    {
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing && !_exiting)
        {
            e.Cancel = true; // reused; hidden instead of disposed
            Hide();
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

    /** For TrayApp on exit / language change: really close instead of hiding. */
    public void CloseForExit()
    {
        _exiting = true;
        Close();
    }

    void Select(string file)
    {
        _file = file;
        _pos = 0;
        _text.Clear();
        foreach (var b in _tabButtons) StyleTab(b, (string)b.Tag! == file);
        Poll();
    }

    /** Appends what was written to the current log since the last poll. */
    void Poll()
    {
        string path = Path.Combine(Log.Dir, _file);
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (fs.Length < _pos) { _pos = 0; _text.Clear(); } // truncated: the service restarted
            if (_pos == 0 && fs.Length > MaxInitialBytes) _pos = fs.Length - MaxInitialBytes;
            if (fs.Length == _pos) return;
            fs.Seek(_pos, SeekOrigin.Begin);
            using var reader = new StreamReader(fs, System.Text.Encoding.UTF8);
            string chunk = reader.ReadToEnd();
            _pos = fs.Length;
            if (_text.TextLength + chunk.Length > MaxChars) _text.Clear();
            _text.AppendText(chunk.Replace("\r\n", "\n").Replace("\n", Environment.NewLine));
        }
        catch (FileNotFoundException)
        {
            if (_text.TextLength == 0) _text.Text = L.T("logs.empty");
        }
        catch (IOException) { }
    }

    void ApplyTheme()
    {
        var p = Theme.Current;
        BackColor = p.Bg;
        _tabs.BackColor = p.Bg;
        _bar.BackColor = p.Bg;
        _text.BackColor = p.Card;
        _text.ForeColor = p.Text1;
        foreach (var b in _tabButtons) StyleTab(b, (string)b.Tag! == _file);
        foreach (var b in new[] { _pause, _copy, _folder }) StatusForm.StyleButton(b);
        if (IsHandleCreated) Theme.ApplyTitleBar(Handle);
    }

    static void StyleTab(Button b, bool selected)
    {
        var p = Theme.Current;
        b.BackColor = selected ? p.Accent : p.Card;
        b.ForeColor = selected ? (p.Dark ? p.Bg : Color.White) : p.Text1;
        b.FlatAppearance.BorderColor = selected ? p.Accent : p.Border;
        b.FlatAppearance.MouseOverBackColor = selected ? p.Accent : p.Hover;
    }

    static Button Tab(string title) => new()
    {
        Text = title, AutoSize = true, Height = 30, FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand,
        Margin = new Padding(0, 0, 6, 0), Padding = new Padding(8, 0, 8, 0),
    };

    Button Action(string text, Action onClick)
    {
        var b = new Button
        {
            Text = text, AutoSize = true, Height = 32, FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand,
            Margin = new Padding(6, 0, 0, 0), Padding = new Padding(8, 0, 8, 0),
        };
        b.Click += (_, _) => onClick();
        return b;
    }
}
