// "New version" window: shown at start when GitHub has a newer Rig Buddy (and from the tray entry). Download and install:
// the installer is fetched from this repository's release, checked against the SHA-256 GitHub published for it, and only
// then started; it asks the running Rig Buddy to quit and starts it again when it is done (setup\rigbuddy.iss). Skip: that
// version is not asked again. Later (or closing the window): asked again at the next start.

using System.Diagnostics;
using System.Net.Http;
using System.Security.Cryptography;

sealed class UpdateForm : Form
{
    readonly UpdateCheck.Info _info;
    readonly Label _text = new() { AutoSize = true, MaximumSize = new Size(440, 0), Margin = new Padding(0, 0, 0, 8) };
    readonly LinkLabel _notes = new() { AutoSize = true, Margin = new Padding(0, 0, 0, 10) };
    readonly ProgressBar _progress = new() { Width = 440, Height = 14, Maximum = 1000, Visible = false, Margin = new Padding(0, 0, 0, 10) };
    readonly Button _install, _skip, _later;
    bool _busy;

    public UpdateForm(UpdateCheck.Info info)
    {
        _info = info;
        AutoScaleDimensions = new SizeF(96F, 96F);
        AutoScaleMode = AutoScaleMode.Dpi;
        Text = L.T("update.prompt_title");
        Font = new Font("Segoe UI", 9.5F);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        TopMost = true; // at start the desktop is busy with other windows coming up: do not end up behind them
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(18, 16, 18, 14);
        try { Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath!); } catch { }

        _text.Text = L.T("update.prompt", info.Version, UpdateCheck.Current);
        _notes.Text = L.T("update.notes");
        _notes.LinkClicked += (_, _) => TrayApp.OpenPath(info.Url);

        _install = MakeButton(L.T("update.install"), () => _ = Install());
        _skip = MakeButton(L.T("update.skip"), () =>
        {
            UpdateCheck.SkippedVersion = info.Version;
            Close();
        });
        _later = MakeButton(L.T("update.later"), Close);
        AcceptButton = _install;
        CancelButton = _later;

        var buttons = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = true, Margin = Padding.Empty };
        buttons.Controls.AddRange([_install, _skip, _later]);
        var column = new FlowLayoutPanel
        {
            AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Margin = Padding.Empty,
        };
        column.Controls.AddRange([_text, _notes, _progress, buttons]);
        Controls.Add(column);

        var p = Theme.Current;
        BackColor = p.Bg;
        ForeColor = p.Text1;
        _text.ForeColor = p.Text1;
        _notes.LinkColor = _notes.ActiveLinkColor = p.Text2;
        foreach (var b in new[] { _install, _skip, _later }) StatusForm.StyleButton(b);
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Theme.ApplyTitleBar(Handle);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (_busy && e.CloseReason == CloseReason.UserClosing) e.Cancel = true; // let the download finish or fail first
        base.OnFormClosing(e);
    }

    Button MakeButton(string text, Action onClick)
    {
        var b = new Button
        {
            Text = text, AutoSize = true, Height = 32, FlatStyle = FlatStyle.Flat, Cursor = Cursors.Hand,
            Margin = new Padding(0, 0, 8, 0), Padding = new Padding(10, 0, 10, 0),
        };
        b.Click += (_, _) => onClick();
        return b;
    }

    void SetBusy(bool busy)
    {
        _busy = busy;
        _install.Enabled = _skip.Enabled = _later.Enabled = !busy;
        _progress.Visible = busy;
    }

    async Task Install()
    {
        // no checksum from GitHub: nothing to check a download against, so the page is opened instead (the browser's download)
        if (_info.Setup is not { } setup)
        {
            TrayApp.OpenPath(_info.Url);
            Close();
            return;
        }
        SetBusy(true);
        string dir = Path.Combine(Path.GetTempPath(), "RigBuddy-update");
        string file = Path.Combine(dir, $"RigBuddy-Setup-{_info.Version}.exe");
        string part = file + ".part";
        try
        {
            Directory.CreateDirectory(dir);
            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(15) };
            http.DefaultRequestHeaders.UserAgent.ParseAdd("RigBuddy-update");
            using (var res = await http.GetAsync(setup.Url, HttpCompletionOption.ResponseHeadersRead))
            {
                res.EnsureSuccessStatusCode();
                long total = res.Content.Headers.ContentLength ?? setup.Size ?? 0;
                using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                await using (var input = await res.Content.ReadAsStreamAsync())
                await using (var output = File.Create(part))
                {
                    var buf = new byte[1 << 16];
                    long done = 0;
                    int n;
                    while ((n = await input.ReadAsync(buf)) > 0)
                    {
                        await output.WriteAsync(buf.AsMemory(0, n));
                        hash.AppendData(buf, 0, n);
                        done += n;
                        if (total > 0) _progress.Value = (int)Math.Min(1000, done * 1000 / total);
                        _text.Text = L.T("update.downloading", done / 1_000_000, Math.Max(total, done) / 1_000_000);
                    }
                }
                string got = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
                if (got != setup.Sha256) throw new InvalidDataException(L.T("update.bad_hash"));
            }
            File.Move(part, file, overwrite: true);
            _text.Text = L.T("update.starting");
            // the installer asks for administrator rights (Program Files) and closes this program itself
            Process.Start(new ProcessStartInfo(file) { UseShellExecute = true });
            _busy = false;
            Close();
        }
        catch (Exception e)
        {
            try { File.Delete(part); } catch { }
            _text.Text = L.T("update.failed", e.Message);
            SetBusy(false);
        }
    }
}
