// The SCS telemetry plugin (scs-telemetry.dll) lives in each game's
// bin\win_x64\plugins folder. A game verify/update can delete it, and without it
// the game sends Rig Buddy nothing ("No data from the game"). This finds the games
// where it is missing and puts it back; the installer's own copy stays the source.
// A plugin that is there but differs (another telemetry tool's build) is left alone.

using System.Diagnostics;

static class PluginCheck
{
    public sealed record Problem(string Game, string GameDir);

    static string Shipped => Path.Combine(AppContext.BaseDirectory, @"plugin\scs-telemetry.dll");

    static string Target(string gameDir) => Path.Combine(gameDir, @"bin\win_x64\plugins\scs-telemetry.dll");

    /** Installed games that have no telemetry plugin. */
    public static List<Problem> Find()
    {
        var (ets2, ats) = MapBuilder.FindGames();
        var list = new List<Problem>();
        foreach (var (name, dir) in new[] { ("ETS2", ets2), ("ATS", ats) })
            if (dir != null && !File.Exists(Target(dir))) list.Add(new Problem(name, dir));
        return list;
    }

    public static bool GameRunning() =>
        Process.GetProcessesByName("eurotrucks2").Length > 0 || Process.GetProcessesByName("amtrucks").Length > 0;

    /** Copies the plugin into every game that lacks it; returns how many could not be done (no rights). */
    public static int CopyMissing()
    {
        if (!File.Exists(Shipped)) return 1;
        int failed = 0;
        foreach (var p in Find())
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(Target(p.GameDir))!);
                File.Copy(Shipped, Target(p.GameDir), overwrite: false);
            }
            catch (Exception) { failed++; }
        }
        return failed;
    }

    /**
     * The Fix now button: tries with the user's own rights (a Steam library on another drive
     * needs none), then once more elevated for games under Program Files.
     */
    public static bool Fix()
    {
        if (CopyMissing() == 0 && Find().Count == 0) return true;
        if (Find().Count == 0) return true;
        try
        {
            using var p = Process.Start(new ProcessStartInfo(Environment.ProcessPath!, "--fix-plugin")
            {
                UseShellExecute = true,
                Verb = "runas",
            });
            p?.WaitForExit();
        }
        catch (Exception) { } // the user declined the prompt
        return Find().Count == 0;
    }
}
