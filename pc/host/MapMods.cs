// ETS2 map-mod archives (HKCU\Software\Rig Buddy\MapMods, "|"-separated .scs paths,
// highest priority first, like the game's mod manager). They are read after the
// game's own files when the map is built, so a map mod such as RoExtended shows
// up on the head unit's map.

using Microsoft.Win32;

static class MapMods
{
    const string Key = @"Software\Rig Buddy";

    /** Where ETS2 keeps the mods it loads. */
    public static string ModFolder => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Euro Truck Simulator 2", "mod");

    /** The chosen archives that still exist. */
    public static string[] Paths
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(Key);
            string raw = key?.GetValue("MapMods") as string ?? "";
            return raw.Split('|', StringSplitOptions.RemoveEmptyEntries).Where(File.Exists).ToArray();
        }
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(Key);
            if (value.Length == 0) key.DeleteValue("MapMods", throwOnMissingValue: false);
            else key.SetValue("MapMods", string.Join('|', value));
        }
    }
}
