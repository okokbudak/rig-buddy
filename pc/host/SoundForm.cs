// "Sound mods" window: which FMOD sound mods the sound plugin loads in each game, add mods, open the folder / the sound
// levels file, switch the plugin off. Writes selected.bank.txt in the plugin's folder; the plugin (rigbuddy-sound.dll)
// notices the change within a second and loads the mods, also while the game runs.

sealed class SoundForm : Form
{
    readonly ComboBox _game = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 300 };
    readonly CheckBox _on = new() { AutoSize = true };
    readonly CheckedListBox _list = new() { CheckOnClick = true, Dock = DockStyle.Fill, IntegralHeight = false, BorderStyle = BorderStyle.None };
    readonly Label _hint = new() { Dock = DockStyle.Bottom, Height = 96, Padding = new Padding(12, 6, 12, 6) };
    readonly Label _status = new() { AutoSize = true, Margin = new Padding(12, 9, 0, 0) };
    readonly FlowLayoutPanel _top = new() { Dock = DockStyle.Top, Height = 48, Padding = new Padding(10, 10, 10, 0), WrapContents = false };
    readonly FlowLayoutPanel _bar = new() { Dock = DockStyle.Bottom, Height = 48, Padding = new Padding(10, 8, 10, 8) };
    readonly List<Button> _buttons = new();
    readonly Action _onThemeChanged;
    List<SoundMods.Game> _games = [];

    public SoundForm()
    {
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Text = L.T("sound.title");
        ClientSize = new Size(640, 760);
        MinimumSize = new Size(560, 640);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!); } catch { }

        _on.Text = L.T("sound.on");
        _on.Margin = new Padding(16, 5, 0, 0);
        _on.Checked = SoundMods.Enabled;
        _on.Click += (_, _) =>
        {
            SoundMods.Enabled = _on.Checked;
            int failed = SoundMods.Sync();
            _status.Text = failed == 0 ? L.T("sound.synced") : L.T("sound.sync_failed");
        };
        _top.Controls.AddRange([_game, _on]);

        _hint.Text = L.T("sound.hint");

        var add = Add(L.T("sound.add"), AddMods);
        var up = Add(L.T("sound.up"), () => Move(-1));
        var down = Add(L.T("sound.down"), () => Move(1));
        var folder = Add(L.T("sound.folder"), () => { if (Current is { } g) TrayApp.OpenPath(SoundMods.FolderOf(g)); });
        var levels = Add(L.T("sound.levels"), () =>
        {
            if (Current is { } g) TrayApp.OpenPath(Path.Combine(SoundMods.FolderOf(g), "sound_levels.txt"));
        });
        var save = Add(L.T("sound.save"), Save);
        _bar.Controls.AddRange([add, up, down, folder, levels, save, _status]);

        BuildLevels();

        Controls.Add(_list);
        Controls.Add(_hint);
        Controls.Add(_levels);
        Controls.Add(_bar);
        Controls.Add(_top);

        _games = SoundMods.Games();
        foreach (var g in _games) _game.Items.Add(g.Name);
        _game.SelectedIndexChanged += (_, _) => Reload();
        if (_games.Count > 0) _game.SelectedIndex = 0;
        else _status.Text = L.T("sound.nogame");

        ApplyTheme();
        _onThemeChanged = () => { if (IsHandleCreated) BeginInvoke(ApplyTheme); else ApplyTheme(); };
        Theme.Changed += _onThemeChanged;
    }

    // ---- volumes: a slider per entry of sound_levels.txt (0 to 150 %), written a moment after the slider stops ----

    static readonly string[] LevelLabels = ["sound.lv.master", "sound.lv.engine", "sound.lv.exhaust", "sound.lv.turbo", "sound.lv.interior",
        "sound.lv.navigation", "sound.lv.outside"];
    readonly TableLayoutPanel _levels = new()
    {
        Dock = DockStyle.Bottom, AutoSize = true, ColumnCount = 3, Padding = new Padding(12, 6, 12, 6),
    };
    readonly List<TrackBar> _sliders = new();
    readonly List<Label> _percents = new();
    readonly List<Label> _levelNames = new();
    readonly System.Windows.Forms.Timer _levelTimer = new() { Interval = 250 };
    readonly HashSet<int> _levelDirty = new();
    bool _loadingLevels;

    void BuildLevels()
    {
        _levels.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 190));
        _levels.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        _levels.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 56));
        for (int i = 0; i < SoundMods.LevelKeys.Length; i++)
        {
            int index = i;
            var name = new Label { Text = L.T(LevelLabels[i]), AutoSize = true, Anchor = AnchorStyles.Left, Margin = new Padding(0, 8, 0, 0) };
            var slider = new TrackBar { Minimum = 0, Maximum = 150, TickFrequency = 25, SmallChange = 1, LargeChange = 10, Dock = DockStyle.Fill, Height = 32 };
            var percent = new Label { Text = "", AutoSize = true, Anchor = AnchorStyles.Right, Margin = new Padding(0, 8, 0, 0) };
            slider.ValueChanged += (_, _) =>
            {
                percent.Text = $"{slider.Value} %";
                if (_loadingLevels) return;
                _levelDirty.Add(index); // written when the slider has stopped for a moment
                _levelTimer.Stop();
                _levelTimer.Start();
            };
            _levelNames.Add(name);
            _sliders.Add(slider);
            _percents.Add(percent);
            _levels.Controls.Add(name, 0, i);
            _levels.Controls.Add(slider, 1, i);
            _levels.Controls.Add(percent, 2, i);
        }
        _levelTimer.Tick += (_, _) =>
        {
            _levelTimer.Stop();
            if (Current is not { } g) return;
            foreach (int i in _levelDirty.ToList())
            {
                try { SoundMods.SetLevel(g, SoundMods.LevelKeys[i].Key, _sliders[i].Value / 100.0); }
                catch (Exception e) { _status.Text = e.Message; }
            }
            _levelDirty.Clear();
        };
    }

    void LoadLevels()
    {
        _loadingLevels = true;
        _levelDirty.Clear();
        var levels = Current is { } g ? SoundMods.ReadLevels(g) : null;
        for (int i = 0; i < _sliders.Count; i++)
        {
            double v = levels != null ? levels[SoundMods.LevelKeys[i].Key] : SoundMods.LevelKeys[i].Default;
            _sliders[i].Value = (int)Math.Clamp(Math.Round(v * 100), 0, 150);
            _percents[i].Text = $"{_sliders[i].Value} %";
            _sliders[i].Enabled = levels != null;
        }
        _loadingLevels = false;
    }

    SoundMods.Game? Current => _game.SelectedIndex >= 0 && _game.SelectedIndex < _games.Count ? _games[_game.SelectedIndex] : null;

    public void ShowInFront()
    {
        Show();
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Activate();
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
            _levelTimer.Dispose();
        }
        base.Dispose(disposing);
    }

    /** The list: the mods in use first (in load order, checked), then the other .bank files in the folder. */
    void Reload(string? alsoCheck = null)
    {
        LoadLevels();
        _list.Items.Clear();
        if (Current is not { } g) return;
        var banks = SoundMods.Banks(g);
        // names in selected.bank.txt without a .bank file (the plugin's placeholder, a removed mod) are not shown
        var selected = SoundMods.Selected(g).Where(s => banks.Contains(s, StringComparer.OrdinalIgnoreCase)).ToList();
        if (alsoCheck != null && !selected.Contains(alsoCheck, StringComparer.OrdinalIgnoreCase)) selected.Add(alsoCheck);
        foreach (string s in selected) _list.Items.Add(s, true);
        foreach (string b in banks.Where(b => !selected.Contains(b, StringComparer.OrdinalIgnoreCase))) _list.Items.Add(b, false);
        _status.Text = SoundMods.ForeignPlugin(g) ? L.T("sound.foreign") : banks.Count == 0 ? L.T("sound.empty") : "";
    }

    void AddMods()
    {
        if (Current is not { } g) return;
        using var dlg = new OpenFileDialog
        {
            Title = L.T("sound.add"),
            Filter = "Sound mods (*.scs;*.bank)|*.scs;*.bank|SCS mod archive (*.scs)|*.scs|FMOD sound bank (*.bank)|*.bank",
            Multiselect = true,
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        var chosen = new List<string>();
        string? problem = null;
        foreach (string f in dlg.FileNames)
        {
            try
            {
                var added = SoundMods.AddMod(g, f);
                if (added.Count == 0) problem = L.T("sound.none_in_scs", Path.GetFileName(f));
                chosen.AddRange(added);
            }
            catch (InvalidDataException) { problem = L.T("sound.not_zip", Path.GetFileName(f)); }
            catch (Exception e) { problem = e.Message; }
        }
        Reload();
        foreach (string name in chosen)
        {
            int i = _list.Items.IndexOf(name);
            if (i >= 0) _list.SetItemChecked(i, true);
        }
        var noGuids = chosen.Where(n => !SoundMods.HasGuids(g, n)).ToList();
        if (noGuids.Count > 0) _status.Text = L.T("sound.no_guids", string.Join(", ", noGuids));
        else if (problem != null) _status.Text = problem;
    }

    void Move(int delta)
    {
        int i = _list.SelectedIndex, j = i + delta;
        if (i < 0 || j < 0 || j >= _list.Items.Count) return;
        object item = _list.Items[i];
        bool wasChecked = _list.GetItemChecked(i);
        bool otherChecked = _list.GetItemChecked(j);
        _list.Items[i] = _list.Items[j];
        _list.Items[j] = item;
        _list.SetItemChecked(i, otherChecked);
        _list.SetItemChecked(j, wasChecked);
        _list.SelectedIndex = j;
    }

    void Save()
    {
        if (Current is not { } g) return;
        var names = new List<string>();
        for (int i = 0; i < _list.Items.Count; i++)
            if (_list.GetItemChecked(i)) names.Add((string)_list.Items[i]);
        try
        {
            SoundMods.SaveSelected(g, names);
            var noGuids = names.Where(n => !SoundMods.HasGuids(g, n)).ToList();
            _status.Text = noGuids.Count > 0 ? L.T("sound.no_guids", string.Join(", ", noGuids)) : L.T("sound.saved");
        }
        catch (Exception e)
        {
            _status.Text = e.Message;
        }
    }

    void ApplyTheme()
    {
        var p = Theme.Current;
        BackColor = p.Bg;
        ForeColor = p.Text1;
        _top.BackColor = p.Bg;
        _bar.BackColor = p.Bg;
        _on.ForeColor = p.Text1;
        _hint.ForeColor = p.Text2;
        _status.ForeColor = p.Text2;
        _list.BackColor = p.Card;
        _list.ForeColor = p.Text1;
        _levels.BackColor = p.Bg;
        foreach (var l in _levelNames) l.ForeColor = p.Text1;
        foreach (var l in _percents) l.ForeColor = p.Text2;
        foreach (var s in _sliders) s.BackColor = p.Bg;
        foreach (var b in _buttons) StatusForm.StyleButton(b);
        if (IsHandleCreated) Theme.ApplyTitleBar(Handle);
    }

    Button Add(string text, Action onClick)
    {
        var b = new Button
        {
            Text = text, AutoSize = true, Height = 32, FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand,
            Margin = new Padding(0, 0, 6, 0), Padding = new Padding(8, 0, 8, 0),
        };
        b.Click += (_, _) => onClick();
        _buttons.Add(b);
        return b;
    }
}
