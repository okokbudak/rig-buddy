// Music controls for the app: what plays on this PC and play / pause / next / previous / shuffle / repeat, through Windows'
// own media sessions (System Media Transport Controls). Everything that shows up in the Windows volume flyout works:
// Spotify, YouTube and YouTube Music in Chrome / Edge / Firefox, Apple Music, Tidal, Deezer, VLC, Windows Media Player...
// The current session is the one Windows treats as the current one (the player that was used last).

using System.Text.Json;
using Windows.Media;
using Windows.Media.Control;

static class MediaControl
{
    static GlobalSystemMediaTransportControlsSessionManager? _manager;

    static async Task<GlobalSystemMediaTransportControlsSession?> Current()
    {
        _manager ??= await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        return _manager.GetCurrentSession();
    }

    /** One line of JSON: {"active":false} or the player, the track, its state, the controls that work and the position. */
    public static string State()
    {
        try
        {
            return Json(StateAsync().GetAwaiter().GetResult());
        }
        catch (Exception e)
        {
            Console.WriteLine($"media: {e.Message}");
            return Json(new { active = false });
        }
    }

    static async Task<object> StateAsync()
    {
        var s = await Current();
        if (s == null) return new { active = false };
        var props = await s.TryGetMediaPropertiesAsync();
        var info = s.GetPlaybackInfo();
        var tl = s.GetTimelineProperties();
        var c = info.Controls;
        double position = tl.Position.TotalSeconds;
        double duration = (tl.EndTime - tl.StartTime).TotalSeconds;
        if (info.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
        {
            // the position was read at LastUpdatedTime: add what has played since
            position += Math.Max(0, (DateTimeOffset.UtcNow - tl.LastUpdatedTime).TotalSeconds);
        }
        if (duration > 0) position = Math.Min(position, duration);
        var volume = MediaVolume.Get(s.SourceAppUserModelId);
        return new
        {
            active = true,
            volume = volume?.Percent ?? -1,           // -1: not known
            muted = volume?.Muted ?? false,
            volumeScope = volume?.Scope ?? "",        // "app": the player's own volume, "system": the PC's
            app = AppName(s.SourceAppUserModelId),
            title = props.Title ?? "",
            artist = props.Artist ?? "",
            album = props.AlbumTitle ?? "",
            status = info.PlaybackStatus.ToString().ToLowerInvariant(), // playing, paused, stopped, ...
            canPlay = c.IsPlayEnabled || c.IsPlayPauseToggleEnabled,
            canPause = c.IsPauseEnabled || c.IsPlayPauseToggleEnabled,
            canNext = c.IsNextEnabled,
            canPrevious = c.IsPreviousEnabled,
            canShuffle = c.IsShuffleEnabled,
            canRepeat = c.IsRepeatEnabled,
            shuffle = info.IsShuffleActive ?? false,
            repeat = info.AutoRepeatMode switch { MediaPlaybackAutoRepeatMode.Track => "track", MediaPlaybackAutoRepeatMode.List => "list", _ => "none" },
            position = Math.Round(position, 1),
            duration = Math.Round(Math.Max(0, duration), 1),
        };
    }

    /** playpause | play | pause | next | previous | shuffle | repeat | mute | volume (arg = 0-100). Returns true when it took the command. */
    public static bool Command(string action, string? arg = null)
    {
        try
        {
            if (action is "mute" or "volume")
            {
                var current = Current().GetAwaiter().GetResult();
                if (current == null) return false;
                string app = current.SourceAppUserModelId;
                if (action == "mute") return MediaVolume.ToggleMute(app);
                return int.TryParse(arg, out int percent) && percent is >= 0 and <= 100 && MediaVolume.Set(app, percent);
            }
            return CommandAsync(action).GetAwaiter().GetResult();
        }
        catch (Exception e)
        {
            Console.WriteLine($"media: {action}: {e.Message}");
            return false;
        }
    }

    static async Task<bool> CommandAsync(string action)
    {
        var s = await Current();
        if (s == null) return false;
        switch (action)
        {
            case "playpause": return await s.TryTogglePlayPauseAsync();
            case "play": return await s.TryPlayAsync();
            case "pause": return await s.TryPauseAsync();
            case "next": return await s.TrySkipNextAsync();
            case "previous": return await s.TrySkipPreviousAsync();
            case "shuffle":
                return await s.TryChangeShuffleActiveAsync(!(s.GetPlaybackInfo().IsShuffleActive ?? false));
            case "repeat":
            {
                // off -> all (list) -> one (track) -> off
                var next = s.GetPlaybackInfo().AutoRepeatMode switch
                {
                    MediaPlaybackAutoRepeatMode.None => MediaPlaybackAutoRepeatMode.List,
                    MediaPlaybackAutoRepeatMode.List => MediaPlaybackAutoRepeatMode.Track,
                    _ => MediaPlaybackAutoRepeatMode.None,
                };
                return await s.TryChangeAutoRepeatModeAsync(next);
            }
            default: return false;
        }
    }

    /** "Spotify.exe" -> "Spotify", "chrome.exe" -> "Chrome", "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic" -> "Zune Music". */
    static string AppName(string id)
    {
        if (string.IsNullOrEmpty(id)) return "";
        string name = id;
        int bang = name.IndexOf('!');
        if (bang > 0) name = name[..bang];
        int under = name.IndexOf('_');
        if (under > 0) name = name[..under];
        if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
        int dot = name.LastIndexOf('.');
        if (dot > 0 && name.Contains("Microsoft", StringComparison.OrdinalIgnoreCase)) name = name[(dot + 1)..];
        return name.Length > 0 ? char.ToUpperInvariant(name[0]) + name[1..] : "";
    }

    static string Json(object o) => JsonSerializer.Serialize(o);
}
