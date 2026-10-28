// The volume of the music player for the app's Music screen. Windows' media sessions (MediaControl.cs) have no volume, so
// this uses Windows Core Audio: every program has its own audio session with a volume (the sliders in the Windows volume
// mixer). The player is found by its program name (Spotify.exe, chrome.exe, vlc.exe ...); a browser that plays in several
// processes has several sessions, all set together. A player that is not in the mixer (a store app, or one that is silent
// right now) falls back to the volume of the PC itself (the speaker volume).

using System.Diagnostics;
using NAudio.CoreAudioApi;

static class MediaVolume
{
    /** Percent 0-100, muted, and whose volume it is: "app" (the player's own) or "system" (the PC's). */
    public sealed record Level(int Percent, bool Muted, string Scope);

    static MMDevice Device(MMDeviceEnumerator e) => e.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);

    /** "Spotify.exe" -> "Spotify"; a store app's id has no program name: null. */
    static string? Program(string appId) =>
        appId.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? appId[..^4] : null;

    static List<AudioSessionControl> SessionsOf(MMDevice device, string? program)
    {
        var found = new List<AudioSessionControl>();
        if (program == null) return found;
        var sessions = device.AudioSessionManager.Sessions;
        for (int i = 0; i < sessions.Count; i++)
        {
            var s = sessions[i];
            try
            {
                string name = Process.GetProcessById((int)s.GetProcessID).ProcessName;
                if (name.Equals(program, StringComparison.OrdinalIgnoreCase)) found.Add(s);
            }
            catch (Exception) { } // the process ended while looking
        }
        return found;
    }

    public static Level? Get(string appId)
    {
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            using var device = Device(enumerator);
            var sessions = SessionsOf(device, Program(appId));
            if (sessions.Count > 0)
            {
                var v = sessions[0].SimpleAudioVolume;
                return new Level((int)Math.Round(v.Volume * 100), v.Mute, "app");
            }
            var master = device.AudioEndpointVolume;
            return new Level((int)Math.Round(master.MasterVolumeLevelScalar * 100), master.Mute, "system");
        }
        catch (Exception e)
        {
            Console.WriteLine($"media volume: {e.Message}");
            return null;
        }
    }

    public static bool Set(string appId, int percent)
    {
        percent = Math.Clamp(percent, 0, 100);
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            using var device = Device(enumerator);
            var sessions = SessionsOf(device, Program(appId));
            if (sessions.Count > 0)
            {
                foreach (var s in sessions)
                {
                    s.SimpleAudioVolume.Volume = percent / 100f;
                    if (percent > 0) s.SimpleAudioVolume.Mute = false; // moving the slider up ends a mute
                }
                return true;
            }
            device.AudioEndpointVolume.MasterVolumeLevelScalar = percent / 100f;
            if (percent > 0) device.AudioEndpointVolume.Mute = false;
            return true;
        }
        catch (Exception e)
        {
            Console.WriteLine($"media volume: {e.Message}");
            return false;
        }
    }

    public static bool ToggleMute(string appId)
    {
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            using var device = Device(enumerator);
            var sessions = SessionsOf(device, Program(appId));
            if (sessions.Count > 0)
            {
                bool to = !sessions[0].SimpleAudioVolume.Mute;
                foreach (var s in sessions) s.SimpleAudioVolume.Mute = to;
                return true;
            }
            device.AudioEndpointVolume.Mute = !device.AudioEndpointVolume.Mute;
            return true;
        }
        catch (Exception e)
        {
            Console.WriteLine($"media volume: {e.Message}");
            return false;
        }
    }
}
