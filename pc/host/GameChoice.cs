// Which game's map Rig Buddy builds, serves and loads (HKCU\Software\Rig Buddy\
// Game: "ets2" or "ats"). Unset = both installed games, like before the choice existed.

using Microsoft.Win32;

static class GameChoice
{
    const string Key = @"Software\Rig Buddy";

    public static string? Setting
    {
        get
        {
            using var key = Registry.CurrentUser.OpenSubKey(Key);
            string? g = key?.GetValue("Game") as string;
            return g is "ets2" or "ats" ? g : null;
        }
        set
        {
            using var key = Registry.CurrentUser.CreateSubKey(Key);
            if (value is "ets2" or "ats") key.SetValue("Game", value);
            else key.DeleteValue("Game", throwOnMissingValue: false);
        }
    }

    /** Name the map data files carry: europe-navigation.zip, usa-... */
    public static string MapName(string game) => game == "ats" ? "usa" : "europe";

    /** Is this game's map wanted? (everything is, until a game has been chosen) */
    public static bool Wants(string game) => Setting is not { } chosen || chosen == game;
}
