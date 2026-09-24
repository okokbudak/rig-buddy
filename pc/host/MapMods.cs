// ETS2 map-mod archives, one .scs path per line in %LOCALAPPDATA%\Rig Buddy\mapmods.txt,
// highest priority first, like the game's mod manager. They are read after the
// game's own files when the map is built, so a map mod such as RoExtended shows
// up on the head unit's map. (A file rather than the registry: it is easy to
// look at, edit and copy along with the rest of the user data.)

static class MapMods
{
    static string File_ => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Rig Buddy", "mapmods.txt");

    /** Where ETS2 keeps the mods it loads. */
    public static string ModFolder => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Euro Truck Simulator 2", "mod");

    /** The chosen archives that still exist. */
    public static string[] Paths
    {
        get
        {
            try
            {
                return System.IO.File.Exists(File_)
                    ? System.IO.File.ReadAllLines(File_).Select(l => l.Trim()).Where(l => l.Length > 0 && System.IO.File.Exists(l)).ToArray()
                    : [];
            }
            catch (IOException) { return []; }
        }
        set
        {
            Directory.CreateDirectory(Path.GetDirectoryName(File_)!);
            if (value.Length == 0) System.IO.File.Delete(File_);
            else System.IO.File.WriteAllLines(File_, value);
        }
    }
}
