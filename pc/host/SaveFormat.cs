// Rig Buddy reads jobs, profile and explored roads from the game's save, which it can only do when the game writes text
// saves: `uset g_save_format "2"` in Documents\<game>\config.cfg (the default, a binary save, is not readable). This
// sets it for every game that has a config.cfg, so nobody has to edit it by hand.
//
// The game writes config.cfg again when it closes and would put its old value back, so nothing is changed while a game
// is running: the installer does it once, and the app tries again at every start and every minute after.

using System.Text;
using System.Text.RegularExpressions;

static class SaveFormat
{
    static readonly string[] Games = ["Euro Truck Simulator 2", "American Truck Simulator"];
    static readonly Regex Line = new(@"^uset\s+g_save_format\s+""[^""]*""\s*$", RegexOptions.Multiline);
    static System.Threading.Timer? _timer;

    /** Looks now and then (the game may run when Rig Buddy starts, or be installed later). */
    public static void Watch()
    {
        _timer ??= new System.Threading.Timer(_ => Ensure(), null, TimeSpan.FromSeconds(5), TimeSpan.FromMinutes(1));
    }

    /** Sets g_save_format to "2" in the config.cfg of each game; returns how many files were changed. */
    public static int Ensure()
    {
        if (PluginCheck.GameRunning()) return 0;
        int changed = 0;
        string docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        foreach (string game in Games)
        {
            string file = Path.Combine(docs, game, "config.cfg");
            try
            {
                if (!File.Exists(file)) continue; // the game has not been started yet: no config to change
                string text = File.ReadAllText(file);
                string eol = text.Contains("\r\n") ? "\r\n" : "\n";
                string? updated = null;
                if (Line.IsMatch(text))
                {
                    var m = Line.Match(text);
                    if (!m.Value.Contains("\"2\"")) updated = Line.Replace(text, "uset g_save_format \"2\"", 1);
                }
                else
                {
                    updated = text + (text.EndsWith('\n') || text.Length == 0 ? "" : eol) + "uset g_save_format \"2\"" + eol;
                }
                if (updated == null) continue; // already "2"
                string backup = file + ".rigbuddy-backup";
                if (!File.Exists(backup)) File.Copy(file, backup); // the first change keeps the original
                File.WriteAllText(file, updated, new UTF8Encoding(false));
                changed++;
                Console.WriteLine($"save format: {game}: g_save_format set to 2 in {file}");
            }
            catch (Exception e)
            {
                Console.WriteLine($"save format: {game}: {e.Message}");
            }
        }
        return changed;
    }
}
