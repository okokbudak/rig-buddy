// Media side of the bridge: exposes Windows' "now playing" sessions (Spotify,
// Apple Music, browsers, ... via Windows.Media.Control / GSMTC) and per-app
// audio volume (Core Audio via NAudio) to the Node agent.
//
// Protocol on 127.0.0.1:62844, one JSON object per line:
//   bridge -> agent: {"type":"media","data":{...}}  (on change, and every second while playing)
//                    {"type":"art","key":"...","mime":"image/jpeg","data":"<base64>"}  (once per track)
//   agent -> bridge: {"cmd":"toggle|play|pause|next|prev","session":"<id>"}
//                    {"cmd":"seek","positionMs":12345,"session":"<id>"}
//                    {"cmd":"volume","target":"app|master","value":0.5,"session":"<id>"}
//                    {"cmd":"select","session":"<id>"}   (which player the controls act on)

using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using NAudio.CoreAudioApi;
using Windows.Media.Control;

sealed class MediaService
{
    const int Port = 62844;
    /** Windows media sessions are available (shown in the PC app's window). */
    public static bool Running { get; private set; }
    GlobalSystemMediaTransportControlsSessionManager? _mgr;
    string? _selectedId;                 // user's pick; null = Windows' current session
    string _lastStateJson = "";
    DateTime _lastSent = DateTime.MinValue;
    string? _artKey;
    JsonObject? _artMsg;
    string _lastTrack = "";
    readonly List<StreamWriter> _clients = new();
    readonly object _lock = new();
    readonly MMDeviceEnumerator _devices = new();

    public async Task RunAsync()
    {
        _mgr = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        var listener = new TcpListener(IPAddress.Loopback, Port);
        listener.Start();
        Running = true;
        Console.WriteLine($"media: listening on 127.0.0.1:{Port}");
        _ = Task.Run(AcceptLoop);
        async Task AcceptLoop()
        {
            while (true)
            {
                var c = await listener.AcceptTcpClientAsync();
                _ = Task.Run(() => ServeClient(c));
            }
        }
        while (true)
        {
            try { await Tick(); }
            catch (Exception e) { Console.WriteLine($"media: {e.GetType().Name}: {e.Message}"); }
            await Task.Delay(500);
        }
    }

    GlobalSystemMediaTransportControlsSession? Current()
    {
        var sessions = _mgr!.GetSessions();
        if (_selectedId != null)
        {
            var sel = sessions.FirstOrDefault(s => s.SourceAppUserModelId == _selectedId);
            if (sel != null) return sel;
        }
        // Prefer whatever is actually playing, then Windows' notion of current.
        return sessions.FirstOrDefault(s => s.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
            ?? _mgr.GetCurrentSession();
    }

    async Task Tick()
    {
        var state = new JsonObject();
        var list = new JsonArray();
        foreach (var s in _mgr!.GetSessions())
        {
            string title = "", artist = "";
            try
            {
                var p = await s.TryGetMediaPropertiesAsync();
                title = p?.Title ?? "";
                artist = p?.Artist ?? "";
            }
            catch { }
            list.Add(new JsonObject
            {
                ["id"] = s.SourceAppUserModelId,
                ["app"] = AppName(s.SourceAppUserModelId),
                ["title"] = title,
                ["artist"] = artist,
                ["status"] = Status(s),
            });
        }
        state["sessions"] = list;

        var cur = Current();
        bool playing = false;
        if (cur != null)
        {
            var props = await cur.TryGetMediaPropertiesAsync();
            var info = cur.GetPlaybackInfo();
            var tl = cur.GetTimelineProperties();
            playing = info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
            var pos = tl.Position;
            if (playing) pos += DateTimeOffset.Now - tl.LastUpdatedTime;
            var dur = tl.EndTime - tl.StartTime;
            if (pos > dur && dur > TimeSpan.Zero) pos = dur;
            string track = $"{cur.SourceAppUserModelId}|{props?.Title}|{props?.Artist}|{props?.AlbumTitle}";
            if (track != _lastTrack)
            {
                _lastTrack = track;
                await LoadArt(props);
            }
            state["current"] = new JsonObject
            {
                ["id"] = cur.SourceAppUserModelId,
                ["app"] = AppName(cur.SourceAppUserModelId),
                ["title"] = props?.Title ?? "",
                ["artist"] = props?.Artist ?? "",
                ["album"] = props?.AlbumTitle ?? "",
                ["status"] = Status(cur),
                ["positionMs"] = (long)Math.Max(0, pos.TotalMilliseconds),
                ["durationMs"] = (long)Math.Max(0, dur.TotalMilliseconds),
                ["canNext"] = info.Controls.IsNextEnabled,
                ["canPrev"] = info.Controls.IsPreviousEnabled,
                ["canSeek"] = info.Controls.IsPlaybackPositionEnabled,
                ["canToggle"] = info.Controls.IsPlayPauseToggleEnabled || info.Controls.IsPlayEnabled || info.Controls.IsPauseEnabled,
                ["artKey"] = _artKey,
            };
            state["appVolume"] = AppVolume(cur.SourceAppUserModelId) is float v ? v : null;
        }
        else
        {
            _lastTrack = "";
        }
        try
        {
            var dev = _devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            state["masterVolume"] = dev.AudioEndpointVolume.MasterVolumeLevelScalar;
            state["masterMuted"] = dev.AudioEndpointVolume.Mute;
        }
        catch { }

        // Positions tick constantly; compare everything else to detect real changes.
        var cmp = state.DeepClone().AsObject();
        if (cmp["current"] is JsonObject cc) cc.Remove("positionMs");
        string cmpJson = cmp.ToJsonString();
        bool changed = cmpJson != _lastStateJson;
        if (changed || (playing && DateTime.UtcNow - _lastSent > TimeSpan.FromSeconds(1)))
        {
            _lastStateJson = cmpJson;
            _lastSent = DateTime.UtcNow;
            Broadcast(new JsonObject { ["type"] = "media", ["data"] = state }.ToJsonString());
        }
    }

    async Task LoadArt(GlobalSystemMediaTransportControlsSessionMediaProperties? props)
    {
        _artKey = null;
        _artMsg = null;
        if (props?.Thumbnail == null) return;
        try
        {
            using var ras = await props.Thumbnail.OpenReadAsync();
            using var s = ras.AsStreamForRead();
            using var ms = new MemoryStream();
            await s.CopyToAsync(ms);
            var bytes = ms.ToArray();
            if (bytes.Length == 0) return;
            _artKey = Convert.ToHexString(SHA1.HashData(bytes))[..16];
            _artMsg = new JsonObject
            {
                ["type"] = "art",
                ["key"] = _artKey,
                ["mime"] = string.IsNullOrEmpty(ras.ContentType) ? "image/jpeg" : ras.ContentType,
                ["data"] = Convert.ToBase64String(bytes),
            };
            Broadcast(_artMsg.ToJsonString());
        }
        catch (Exception e)
        {
            Console.WriteLine($"media: thumbnail failed: {e.Message}");
        }
    }

    static string Status(GlobalSystemMediaTransportControlsSession s) =>
        s.GetPlaybackInfo().PlaybackStatus switch
        {
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing => "playing",
            GlobalSystemMediaTransportControlsSessionPlaybackStatus.Paused => "paused",
            _ => "stopped",
        };

    /** "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" / "Spotify.exe" -> "Spotify". */
    static string AppName(string aumid)
    {
        string a = aumid.ToLowerInvariant();
        if (a.Contains("spotify")) return "Spotify";
        if (a.Contains("applemusic") || a.Contains("itunes")) return "Apple Music";
        if (a.Contains("chrome")) return "Chrome";
        if (a.Contains("msedge") || a.Contains("microsoftedge")) return "Edge";
        if (a.Contains("firefox")) return "Firefox";
        if (a.Contains("opera")) return "Opera";
        if (a.Contains("zunemusic") || a.Contains("media player")) return "Medya Oynatıcı";
        if (a.Contains("vlc")) return "VLC";
        if (a.Contains("deezer")) return "Deezer";
        if (a.Contains("tidal")) return "TIDAL";
        string s = aumid.Split('!')[^1];
        s = Path.GetFileNameWithoutExtension(s);
        return s.Length > 0 ? char.ToUpper(s[0]) + s[1..] : aumid;
    }

    /** Process-name fragment used to find the app's Core Audio session. */
    static string AudioKey(string aumid)
    {
        string a = aumid.ToLowerInvariant();
        foreach (var k in new[] { "spotify", "applemusic", "itunes", "chrome", "msedge", "firefox", "opera", "vlc", "deezer", "tidal" })
            if (a.Contains(k)) return k == "applemusic" ? "applemusic" : k;
        return Path.GetFileNameWithoutExtension(aumid.Split('!')[^1]).ToLowerInvariant();
    }

    IEnumerable<AudioSessionControl> AppSessions(string aumid)
    {
        string key = AudioKey(aumid);
        var dev = _devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        var sessions = dev.AudioSessionManager.Sessions;
        for (int i = 0; i < sessions.Count; i++)
        {
            var s = sessions[i];
            string name;
            try { name = Process.GetProcessById((int)s.GetProcessID).ProcessName.ToLowerInvariant(); }
            catch { continue; }
            if (name.Contains(key)) yield return s;
        }
    }

    float? AppVolume(string aumid)
    {
        try
        {
            var s = AppSessions(aumid).FirstOrDefault();
            return s?.SimpleAudioVolume.Volume;
        }
        catch { return null; }
    }

    async Task Handle(string line)
    {
        var msg = JsonNode.Parse(line)?.AsObject();
        if (msg == null) return;
        string cmd = msg["cmd"]?.GetValue<string>() ?? "";
        string? id = msg["session"]?.GetValue<string>();
        if (cmd == "select")
        {
            _selectedId = id;
            _lastStateJson = "";
            return;
        }
        if (cmd == "volume")
        {
            float v = Math.Clamp(msg["value"]?.GetValue<float>() ?? 0.5f, 0f, 1f);
            if (msg["target"]?.GetValue<string>() == "master")
            {
                _devices.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia).AudioEndpointVolume.MasterVolumeLevelScalar = v;
            }
            else
            {
                var target = id ?? Current()?.SourceAppUserModelId;
                if (target != null) foreach (var s in AppSessions(target)) s.SimpleAudioVolume.Volume = v;
            }
            _lastStateJson = "";
            return;
        }
        var session = (id != null ? _mgr!.GetSessions().FirstOrDefault(s => s.SourceAppUserModelId == id) : null) ?? Current();
        if (session == null) return;
        switch (cmd)
        {
            case "toggle": await session.TryTogglePlayPauseAsync(); break;
            case "play": await session.TryPlayAsync(); break;
            case "pause": await session.TryPauseAsync(); break;
            case "next": await session.TrySkipNextAsync(); break;
            case "prev": await session.TrySkipPreviousAsync(); break;
            case "seek":
                long ms = msg["positionMs"]?.GetValue<long>() ?? 0;
                await session.TryChangePlaybackPositionAsync(TimeSpan.FromMilliseconds(ms).Ticks);
                break;
        }
        _lastStateJson = "";
    }

    async Task ServeClient(TcpClient client)
    {
        using (client)
        {
            var stream = client.GetStream();
            var writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
            lock (_lock) _clients.Add(writer);
            _lastStateJson = ""; // send full state to the newcomer
            if (_artMsg != null) Send(writer, _artMsg.ToJsonString());
            Console.WriteLine("media: client connected");
            try
            {
                using var reader = new StreamReader(stream, Encoding.UTF8);
                string? line;
                while ((line = await reader.ReadLineAsync()) != null)
                {
                    try { await Handle(line); }
                    catch (Exception e) { Console.WriteLine($"media: command failed: {e.Message}"); }
                }
            }
            catch (IOException) { }
            finally
            {
                lock (_lock) _clients.Remove(writer);
                Console.WriteLine("media: client disconnected");
            }
        }
    }

    void Broadcast(string json)
    {
        List<StreamWriter> copy;
        lock (_lock) copy = new(_clients);
        foreach (var w in copy) Send(w, json);
    }

    void Send(StreamWriter w, string json)
    {
        try { lock (w) w.WriteLine(json); }
        catch { lock (_lock) _clients.Remove(w); }
    }
}
