// The SCS telemetry plugin (scs-telemetry.dll) lives in each game's
// bin\win_x64\plugins folder. A game verify/update can delete it, and without it
// the game sends Rig Buddy nothing ("No data from the game"). This finds the games
// where it is missing and puts it back; the installer's own copy stays the source.
// A plugin that is there but differs (another telemetry tool's build) is left alone.
//
// Next to it goes Rig Buddy's own telemetry plugin (rigbuddy-telemetry.dll, pc\telemetry-plugin) for the bus DLC's
// job, which scs-telemetry.dll predates. That one is ours: it is also replaced when it differs from the shipped copy
// (a newer Rig Buddy), which only works while the game is not running.

using System.Diagnostics;

static class PluginCheck
{
    public sealed record Problem(string Game, string GameDir);

    static string Shipped => Path.Combine(AppContext.BaseDirectory, @"plugin\scs-telemetry.dll");

    static string Target(string gameDir) => Path.Combine(gameDir, @"bin\win_x64\plugins\scs-telemetry.dll");

    const string OwnDll = "rigbuddy-telemetry.dll";

    static string OwnShipped => Path.Combine(AppContext.BaseDirectory, "plugin", OwnDll);

    static string OwnTarget(string gameDir) => Path.Combine(gameDir, @"bin\win_x64\plugins", OwnDll);

    static IEnumerable<(string Name, string Dir)> Games()
    {
        var (ets2, ats) = MapBuilder.FindGames();
        foreach (var (name, dir) in new[] { ("ETS2", ets2), ("ATS", ats) })
            if (dir != null) yield return (name, dir);
    }

    /** Installed games without the telemetry plugin (or, when this Rig Buddy ships it, without rigbuddy-telemetry.dll). */
    public static List<Problem> Find()
    {
        bool own = File.Exists(OwnShipped);
        return Games()
            .Where(g => !File.Exists(Target(g.Dir)) || (own && !File.Exists(OwnTarget(g.Dir))))
            .Select(g => new Problem(g.Name, g.Dir))
            .ToList();
    }

    public static bool GameRunning() =>
        Process.GetProcessesByName("eurotrucks2").Length > 0 || Process.GetProcessesByName("amtrucks").Length > 0;

    /**
     * Copies the telemetry plugin into every game that lacks it, and rigbuddy-telemetry.dll where it is missing or
     * not the shipped one; returns how many games could not be done (no rights, the game running).
     */
    public static int CopyMissing()
    {
        bool own = File.Exists(OwnShipped);
        if (!File.Exists(Shipped) && !own) return 1;
        int failed = 0;
        foreach (var g in Games())
        {
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(Target(g.Dir))!);
                if (File.Exists(Shipped) && !File.Exists(Target(g.Dir))) File.Copy(Shipped, Target(g.Dir), overwrite: false);
                if (own && !SameFile(OwnShipped, OwnTarget(g.Dir))) File.Copy(OwnShipped, OwnTarget(g.Dir), overwrite: true);
            }
            catch (Exception) { failed++; }
        }
        return failed;
    }

    static bool SameFile(string a, string b)
    {
        if (!File.Exists(b)) return false;
        if (new FileInfo(a).Length != new FileInfo(b).Length) return false;
        return File.ReadAllBytes(a).AsSpan().SequenceEqual(File.ReadAllBytes(b));
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
