// Where things are, in the two layouts RigBuddy.exe runs in:
//   release  (installer)  <app dir>\RigBuddy.exe, node\node.exe, dist\...;
//                         data, logs and the map build in %LOCALAPPDATA%\Rig Buddy
//   dev      (git repo)   <repo>\bin\RigBuddy.exe, vendor\node, dist\ (setup\bundle.mjs)
//                         or, without dist, the sources through tsx; data\, logs\ in the repo

sealed class AppPaths
{
    public required bool Release { get; init; }
    /** Repo root (dev) or install dir (release). */
    public required string Root { get; init; }
    public required string Node { get; init; }
    /** Bundled Node services (setup\bundle.mjs), or null to run the sources (dev). */
    public required string? Dist { get; init; }
    public required string Data { get; init; }
    public required string Logs { get; init; }
    /** Scratch space of the map build (parser output, GeoJSON). */
    public required string Work { get; init; }
    /** tm-maps checkout (dev without dist only). */
    public string TmMaps => Path.Combine(Root, @"vendor\tm-maps");

    public static AppPaths Detect()
    {
        string exeDir = AppContext.BaseDirectory.TrimEnd('\\');
        if (File.Exists(Path.Combine(exeDir, @"node\node.exe")) && Directory.Exists(Path.Combine(exeDir, "dist")))
        {
            string user = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Rig Buddy");
            return new AppPaths
            {
                Release = true,
                Root = exeDir,
                Node = Path.Combine(exeDir, @"node\node.exe"),
                Dist = Path.Combine(exeDir, "dist"),
                Data = Path.Combine(user, "data"),
                Logs = Path.Combine(user, "logs"),
                Work = Path.Combine(user, "map-build"),
            };
        }
        string root = FindRepo(exeDir);
        string dist = Path.Combine(root, "dist");
        return new AppPaths
        {
            Release = false,
            Root = root,
            Node = Path.Combine(root, @"vendor\node\node.exe"),
            Dist = File.Exists(Path.Combine(dist, @"server\index.mjs")) ? dist : null,
            Data = Path.Combine(root, "data"),
            Logs = Path.Combine(root, "logs"),
            Work = Path.Combine(root, @"local\map-build"),
        };
    }

    /** The first parent of the exe that holds pc\agent (the exe normally lives in bin\). */
    static string FindRepo(string exeDir)
    {
        for (var d = new DirectoryInfo(exeDir); d != null; d = d.Parent)
            if (File.Exists(Path.Combine(d.FullName, @"pc\agent\index.mjs"))) return d.FullName;
        return Path.GetFullPath(Path.Combine(exeDir, ".."));
    }
}
