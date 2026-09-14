// Light / dark palettes for the app's windows. The setting ("system", "light",
// "dark"; HKCU\Software\Rig Buddy\Theme) defaults to "system", which follows
// Windows' app theme (Settings > Personalization > Colors) live.

using System.Runtime.InteropServices;
using Microsoft.Win32;

sealed record Palette(
    bool Dark, Color Bg, Color Card, Color Text1, Color Text2, Color Accent,
    Color Green, Color Orange, Color Red, Color Gray, Color Track, Color Hover, Color Border);

static class Theme
{
    const string Key = @"Software\Rig Buddy";

    // same colors as the Android app
    public static readonly Palette DarkPalette = new(
        true,
        Bg: Color.FromArgb(0x0F, 0x11, 0x15), Card: Color.FromArgb(0x1E, 0x21, 0x28),
        Text1: Color.FromArgb(0xE8, 0xEA, 0xED), Text2: Color.FromArgb(0x9A, 0xA0, 0xA6),
        Accent: Color.FromArgb(0x8A, 0xB4, 0xF8), Green: Color.FromArgb(0x81, 0xC9, 0x95),
        Orange: Color.FromArgb(0xFD, 0xD6, 0x63), Red: Color.FromArgb(0xF2, 0x8B, 0x82),
        Gray: Color.FromArgb(0x5F, 0x63, 0x68), Track: Color.FromArgb(0x2E, 0x32, 0x3A),
        Hover: Color.FromArgb(0x2A, 0x2E, 0x36), Border: Color.FromArgb(0x5F, 0x63, 0x68));

    public static readonly Palette LightPalette = new(
        false,
        Bg: Color.FromArgb(0xF1, 0xF3, 0xF4), Card: Color.White,
        Text1: Color.FromArgb(0x20, 0x21, 0x24), Text2: Color.FromArgb(0x5F, 0x63, 0x68),
        Accent: Color.FromArgb(0x1A, 0x73, 0xE8), Green: Color.FromArgb(0x18, 0x80, 0x38),
        Orange: Color.FromArgb(0xB0, 0x60, 0x00), Red: Color.FromArgb(0xD9, 0x30, 0x25),
        Gray: Color.FromArgb(0x9A, 0xA0, 0xA6), Track: Color.FromArgb(0xDA, 0xDC, 0xE0),
        Hover: Color.FromArgb(0xE8, 0xEA, 0xED), Border: Color.FromArgb(0xDA, 0xDC, 0xE0));

    public static readonly (string Value, string Label)[] Choices =
        [("system", "theme.system_long"), ("light", "theme.light"), ("dark", "theme.dark")]; // labels: L keys

    public static Palette Current { get; private set; } = Resolve();

    /** Raised on the UI thread when the palette changes. */
    public static event Action? Changed;

    /**
     * Picks up a Windows light/dark switch; called from the tray's 1 s timer.
     * (Not SystemEvents.UserPreferenceChanged: subscribing to it before the UI
     * loop runs deadlocked the UI thread when a second window opened.)
     */
    public static void CheckSystem()
    {
        if (Setting == "system") Reapply();
    }

    public static string Setting
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(Key);
            return key?.GetValue("Theme") as string ?? "system";
        }
        set
        {
            using (var key = Registry.CurrentUser.CreateSubKey(Key)) key.SetValue("Theme", value);
            Reapply();
        }
    }

    public static string Label(string setting) =>
        L.T(setting is "light" or "dark" ? "theme." + setting : "theme.system");

    static void Reapply()
    {
        var p = Resolve();
        if (p == Current) return;
        Current = p;
        Changed?.Invoke();
    }

    static Palette Resolve() => Setting switch
    {
        "light" => LightPalette,
        "dark" => DarkPalette,
        _ => WindowsUsesLightTheme() ? LightPalette : DarkPalette,
    };

    static bool WindowsUsesLightTheme() =>
        Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            "AppsUseLightTheme", 1) is not int v || v != 0;

    /** Dark or light title bar to match (Windows 10 20H1+ / 11). */
    public static void ApplyTitleBar(IntPtr hwnd)
    {
        int dark = Current.Dark ? 1 : 0;
        DwmSetWindowAttribute(hwnd, 20, ref dark, sizeof(int));
    }

    [DllImport("dwmapi.dll")]
    static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
}
