// Rig Buddy's sound plugin (pc\sound-plugin: rigbuddy-sound.dll, based on dariowouters/ts-fmod-plugin, MIT) rides along
// with Rig Buddy: a second game plugin, next to the telemetry plugin, that plays FMOD sound mods (.bank files) in the
// game. The installer ships it (plugin\sound\ next to the exe); this puts it into each game, keeps it current, and writes
// the list of sound mods to load (selected.bank.txt). The plugin watches that list and the sound levels and loads changes
// while the game runs. Everything the user added (mods, the list, sound levels) is left alone.
//
// Rig Buddy 0.4.0 put the original ts-fmod-plugin.dll into the games: that copy (and only that one) is taken out again,
// and the mods / list / levels from its folder are copied over to the new plugin's folder.

using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Win32;

static class SoundMods
{
    const string Key = @"Software\Rig Buddy";
    const string Dll = "rigbuddy-sound.dll";
    const string Folder = "rigbuddy-sound";
    /** SHA-256 of the ts-fmod-plugin.dll (1.61) Rig Buddy 0.4.0 installed. */
    const string OldDllSha256 = "6c0a32f2c58e3bd02c413bfd30ace994286ef1c5e433b904af43e7b759074450";

    static string Bundle => Path.Combine(AppContext.BaseDirectory, @"plugin\sound");

    public static bool Shipped => File.Exists(Path.Combine(Bundle, Dll));

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
    public static string FolderOf(Game g) => Path.Combine(Plugins(g), Folder);

    /** A ts-fmod-plugin the user installed by hand (not Rig Buddy's): with both, every sound plays twice. */
    public static bool ForeignPlugin(Game g)
    {
        string old = Path.Combine(Plugins(g), "ts-fmod-plugin.dll");
        return File.Exists(old) && !HashIs(old, OldDllSha256);
    }

    /** Puts the shipped plugin into every game (or takes it out when switched off). Returns how many games could not be done (game running, no rights). */
    public static int Sync()
    {
        if (!Shipped) return 0;
        int failed = 0;
        foreach (var g in Games())
        {
            try
            {
                string dll = Path.Combine(Plugins(g), Dll);
                string shippedDll = Path.Combine(Bundle, Dll);
                MoveFromOldPlugin(g);
                if (!Enabled)
                {
                    // only our own copy: a plugin the user put there by hand is not ours to delete
                    if (File.Exists(dll) && SameFile(shippedDll, dll)) File.Delete(dll);
                    continue;
                }
                string dir = FolderOf(g);
                Directory.CreateDirectory(dir);
                CopyIfDifferent(shippedDll, dll);
                CopyIfDifferent(Path.Combine(Bundle, g.Master, "master.bank"), Path.Combine(dir, "master.bank"));
                string selected = Path.Combine(dir, "selected.bank.txt");
                if (!File.Exists(selected)) File.WriteAllText(selected, ""); // no mod yet: the plugin stays loaded and waits
                string levels = Path.Combine(dir, "sound_levels.txt");
                string shippedLevels = Path.Combine(Bundle, "sound_levels.txt");
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

    /** Rig Buddy 0.4.0's ts-fmod-plugin: its mods, list and levels come over, its DLL goes (when it is the one we installed). */
    static void MoveFromOldPlugin(Game g)
    {
        string oldDll = Path.Combine(Plugins(g), "ts-fmod-plugin.dll");
        string oldDir = Path.Combine(Plugins(g), "ts-fmod-plugin");
        if (!File.Exists(oldDll) || !HashIs(oldDll, OldDllSha256)) return;
        string dir = FolderOf(g);
        Directory.CreateDirectory(dir);
        if (Directory.Exists(oldDir))
        {
            foreach (string f in Directory.GetFiles(oldDir))
            {
                string name = Path.GetFileName(f);
                if (name.Equals("master.bank", StringComparison.OrdinalIgnoreCase)) continue;
                bool mod = name.EndsWith(".bank", StringComparison.OrdinalIgnoreCase) || name.EndsWith(".bank.guids", StringComparison.OrdinalIgnoreCase);
                bool setting = name is "selected.bank.txt" or "sound_levels.txt";
                string to = Path.Combine(dir, name);
                if ((mod || setting) && !File.Exists(to)) File.Copy(f, to);
            }
        }
        File.Delete(oldDll); // the old folder (the user's files) stays where it is
        Console.WriteLine($"sound plugin: {g.Name}: ts-fmod-plugin from Rig Buddy 0.4.0 replaced by {Dll}");
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

    /** The volumes in sound_levels.txt: key, the plugin's default (0 to 1.5 in the file; the sliders show percent). */
    public static readonly (string Key, double Default)[] LevelKeys =
    [
        ("master", 0.5), ("engine", 0.5), ("exhaust", 0.5), ("turbo", 0.5), ("interior", 0.75), ("navigation", 0.75),
        ("exterior_when_windows_closed", 0.75),
    ];
    const double MaxLevel = 1.5;

    static JsonObject ReadLevelsFile(Game g)
    {
        try
        {
            return JsonNode.Parse(File.ReadAllText(Path.Combine(FolderOf(g), "sound_levels.txt"))) as JsonObject ?? new JsonObject();
        }
        catch (Exception)
        {
            return new JsonObject(); // no file or a broken one: the defaults
        }
    }

    public static Dictionary<string, double> ReadLevels(Game g)
    {
        var json = ReadLevelsFile(g);
        var levels = new Dictionary<string, double>();
        foreach (var (key, def) in LevelKeys)
            levels[key] = json[key] is JsonValue v && v.TryGetValue(out double d) ? d : def;
        return levels;
    }

    /** Sets one volume in sound_levels.txt (the other keys stay); the plugin applies it within a second, in the running game too. */
    public static void SetLevel(Game g, string key, double value)
    {
        if (!LevelKeys.Any(k => k.Key == key)) return;
        var json = ReadLevelsFile(g);
        json[key] = Math.Round(Math.Clamp(value, 0, MaxLevel), 2);
        if (json["config_version"] == null) json["config_version"] = 2; // an old file would be "upgraded" (halved) by the plugin
        Directory.CreateDirectory(FolderOf(g));
        File.WriteAllText(Path.Combine(FolderOf(g), "sound_levels.txt"), json.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
    }

    /** Writes the list; the plugin notices within a second and loads it, also while the game runs. */
    public static void SaveSelected(Game g, IEnumerable<string> names)
    {
        Directory.CreateDirectory(FolderOf(g));
        File.WriteAllText(Path.Combine(FolderOf(g), "selected.bank.txt"), string.Join("\n", names));
    }

    /**
     * Adds a sound mod to the plugin folder and returns the names of the banks it brought. A ".scs" mod archive (a zip)
     * is opened and the banks under sound/truck/ come out with their ".bank.guids"; a ".bank" is copied with the
     * ".bank.guids" next to it, if there is one.
     */
    public static List<string> AddMod(Game g, string file)
    {
        string dir = FolderOf(g);
        Directory.CreateDirectory(dir);
        var names = new List<string>();
        if (file.EndsWith(".scs", StringComparison.OrdinalIgnoreCase))
        {
            using var zip = System.IO.Compression.ZipFile.OpenRead(file);
            foreach (var entry in zip.Entries)
            {
                string path = entry.FullName.Replace('\\', '/');
                if (!path.StartsWith("sound/truck/", StringComparison.OrdinalIgnoreCase)) continue;
                bool bank = path.EndsWith(".bank", StringComparison.OrdinalIgnoreCase);
                if (!bank && !path.EndsWith(".bank.guids", StringComparison.OrdinalIgnoreCase)) continue;
                string target = Path.Combine(dir, Path.GetFileName(path)); // GetFileName: nothing from the archive can leave the folder
                System.IO.Compression.ZipFileExtensions.ExtractToFile(entry, target, overwrite: true);
                if (bank) names.Add(Path.GetFileNameWithoutExtension(path));
            }
            return names;
        }
        string name = Path.GetFileNameWithoutExtension(file);
        File.Copy(file, Path.Combine(dir, name + ".bank"), overwrite: true);
        string guids = file + ".guids";
        if (File.Exists(guids)) File.Copy(guids, Path.Combine(dir, name + ".bank.guids"), overwrite: true);
        names.Add(name);
        return names;
    }

    /**
     * Takes a sound mod out: it leaves selected.bank.txt first (the plugin lets go of it within a second), then its
     * ".bank" and ".bank.guids" are deleted from the plugin folder. Nothing else is touched: only files of that name in
     * that folder. Throws IOException when the game still holds the bank (the list is already updated then).
     */
    public static void RemoveMod(Game g, string name)
    {
        if (name.Length == 0 || name != Path.GetFileName(name) || name.Equals("master", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException(name);
        string dir = FolderOf(g);
        SaveSelected(g, Selected(g).Where(s => !s.Equals(name, StringComparison.OrdinalIgnoreCase)));
        foreach (string f in new[] { name + ".bank", name + ".bank.guids" })
        {
            string path = Path.Combine(dir, f);
            if (File.Exists(path)) File.Delete(path);
        }
    }

    /** The plugin finds a mod's sounds through its ".bank.guids" list; without it the mod loads but plays nothing. */
    public static bool HasGuids(Game g, string name) => File.Exists(Path.Combine(FolderOf(g), name + ".bank.guids"));

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
        return Sha256(a) == Sha256(b);
    }

    static bool HashIs(string file, string sha256) => Sha256(file) == sha256;

    static string Sha256(string file)
    {
        using var sha = SHA256.Create();
        using var s = File.Open(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        return Convert.ToHexString(sha.ComputeHash(s)).ToLowerInvariant();
    }
}
