// The FMOD sound plugin (dariowouters/ts-fmod-plugin, MIT) rides along with Rig Buddy: a second game plugin, next to the
// telemetry plugin, that loads FMOD sound mods (.bank files) into the game. The installer ships one tested copy per
// Rig Buddy release (plugin\fmod\ next to the exe); this puts it into each game, keeps it current, and writes the list of
// sound mods to load (selected.bank.txt). Everything the user added (mods, selected list, sound levels) is left alone.
//
// The plugin reads the game's memory and only loads on the game version it was made for; on another version it stays
// out of the way, and a new Rig Buddy release brings the new one.

using System.Security.Cryptography;
using Microsoft.Win32;

static class SoundMods
{
    const string Key = @"Software\Rig Buddy";

    static string Bundle => Path.Combine(AppContext.BaseDirectory, @"plugin\fmod");

    public static bool Shipped => File.Exists(Path.Combine(Bundle, "ts-fmod-plugin.dll"));

    /** On by default; off removes the plugin from the games (only the copy Rig Buddy put there). */
    public static bool Enabled
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(Key);
            return key?.GetValue("SoundPlugin") is not int v || v != 0;
        }
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(Key);
            key.SetValue("SoundPlugin", value ? 1 : 0, RegistryValueKind.DWord);
        }
    }

    public sealed record Game(string Name, string Dir, string Master);

    public static List<Game> Games()
    {
        var (ets2, ats) = MapBuilder.FindGames();
        var list = new List<Game>();
        if (ets2 != null) list.Add(new Game("Euro Truck Simulator 2", ets2, "ETS2"));
        if (ats != null) list.Add(new Game("American Truck Simulator", ats, "ATS"));
        return list;
    }

    static string Plugins(Game g) => Path.Combine(g.Dir, @"bin\win_x64\plugins");

    /** The plugin's own folder in a game: sound mods, selected.bank.txt, sound_levels.txt. */
    public static string FolderOf(Game g) => Path.Combine(Plugins(g), "ts-fmod-plugin");

    /** Puts the shipped plugin into every game (or takes it out when switched off). Returns how many games could not be done (game running, no rights). */
    public static int Sync()
    {
        if (!Shipped) return 0;
        int failed = 0;
        foreach (var g in Games())
        {
            try
            {
                string dll = Path.Combine(Plugins(g), "ts-fmod-plugin.dll");
                string shippedDll = Path.Combine(Bundle, "ts-fmod-plugin.dll");
                if (!Enabled)
                {
                    // only our own copy: a plugin the user installed by hand is not ours to delete
                    if (File.Exists(dll) && SameFile(shippedDll, dll)) File.Delete(dll);
                    continue;
                }
                string dir = FolderOf(g);
                Directory.CreateDirectory(dir);
                CopyIfDifferent(shippedDll, dll);
                CopyIfDifferent(Path.Combine(Bundle, g.Master, "master.bank"), Path.Combine(dir, "master.bank"));
                string selected = Path.Combine(dir, "selected.bank.txt");
                string shippedSelected = Path.Combine(Bundle, @"ts-fmod-plugin\selected.bank.txt");
                if (!File.Exists(selected))
                {
                    if (File.Exists(shippedSelected)) File.Copy(shippedSelected, selected);
                    else File.WriteAllText(selected, Placeholder);
                }
                string levels = Path.Combine(dir, "sound_levels.txt");
                string shippedLevels = Path.Combine(Bundle, @"ts-fmod-plugin\sound_levels.txt");
                if (!File.Exists(levels) && File.Exists(shippedLevels)) File.Copy(shippedLevels, levels);
            }
            catch (Exception e)
            {
                failed++;
                Console.WriteLine($"sound plugin: {g.Name}: {e.Message}");
            }
        }
        return failed;
    }

    /** Sound mods (.bank files) in a game's plugin folder, without master.bank. */
    public static List<string> Banks(Game g)
    {
        string dir = FolderOf(g);
        if (!Directory.Exists(dir)) return [];
        return Directory.GetFiles(dir, "*.bank")
            .Select(f => Path.GetFileNameWithoutExtension(f))
            .Where(n => !n.Equals("master", StringComparison.OrdinalIgnoreCase) && !n.EndsWith(".strings", StringComparison.OrdinalIgnoreCase))
            .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /** The mods the plugin loads, top to bottom. */
    public static List<string> Selected(Game g)
    {
        string file = Path.Combine(FolderOf(g), "selected.bank.txt");
        if (!File.Exists(file)) return [];
        return File.ReadAllLines(file).Select(l => l.Trim()).Where(l => l.Length > 0).ToList();
    }

    /** What the plugin's own package puts in selected.bank.txt ("no mod yet"); an empty file is not something the author ships. */
    const string Placeholder = "the_sound_mod_you_want_to_use";

    public static void SaveSelected(Game g, IEnumerable<string> names)
    {
        Directory.CreateDirectory(FolderOf(g));
        var list = names.ToList();
        File.WriteAllText(Path.Combine(FolderOf(g), "selected.bank.txt"), string.Join("\n", list.Count > 0 ? list : new List<string> { Placeholder }));
    }

    /** Copies a sound mod (its .bank and the .bank.guids next to it) into the plugin folder. Returns the mod's name. */
    public static string AddMod(Game g, string bankFile)
    {
        string dir = FolderOf(g);
        Directory.CreateDirectory(dir);
        string name = Path.GetFileNameWithoutExtension(bankFile);
        File.Copy(bankFile, Path.Combine(dir, name + ".bank"), overwrite: true);
        string guids = bankFile + ".guids";
        if (File.Exists(guids)) File.Copy(guids, Path.Combine(dir, name + ".bank.guids"), overwrite: true);
        return name;
    }

    static void CopyIfDifferent(string from, string to)
    {
        if (!File.Exists(from)) return;
        if (File.Exists(to) && SameFile(from, to)) return;
        Directory.CreateDirectory(Path.GetDirectoryName(to)!);
        File.Copy(from, to, overwrite: true);
    }

    static bool SameFile(string a, string b)
    {
        var fa = new FileInfo(a);
        var fb = new FileInfo(b);
        if (!fa.Exists || !fb.Exists || fa.Length != fb.Length) return false;
        using var sha = SHA256.Create();
        using var sa = File.Open(a, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var sb = File.Open(b, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        return sha.ComputeHash(sa).AsSpan().SequenceEqual(sha.ComputeHash(sb));
    }
}
