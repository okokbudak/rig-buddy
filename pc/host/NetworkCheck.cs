// The firewall rules the installer adds apply to PRIVATE (and domain) networks only. Windows marks many Wi-Fi networks
// "Public" by default, and then the phone / head unit cannot reach the PC. This finds that case for the network the
// phones are on (the interface that holds the PC address shown in the window) and can switch the network to Private
// (one administrator prompt).

using System.Diagnostics;
using System.Net.NetworkInformation;

static class NetworkCheck
{
    public sealed record Problem(int InterfaceIndex, string Name);

    /** The LAN interface whose Windows network type is "Public", or null (private / domain / unknown). Slow: run it off the UI thread. */
    public static Problem? FindPublicLan()
    {
        try
        {
            if (TrayApp.LanAddresses().FirstOrDefault() is not string ip) return null;
            var nic = NetworkInterface.GetAllNetworkInterfaces()
                .FirstOrDefault(n => n.GetIPProperties().UnicastAddresses.Any(a => a.Address.ToString() == ip));
            if (nic == null) return null;
            int index = nic.GetIPProperties().GetIPv4Properties().Index;
            string category = Powershell($"(Get-NetConnectionProfile -InterfaceIndex {index} -ErrorAction SilentlyContinue).NetworkCategory");
            return category.Trim() == "Public" ? new Problem(index, nic.Name) : null;
        }
        catch (Exception e)
        {
            Console.WriteLine($"network check: {e.Message}");
            return null;
        }
    }

    /** Sets the network of that interface to Private (asks for administrator rights). True when it worked. */
    public static bool MakePrivate(Problem problem)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("powershell.exe",
                $"-NoProfile -NonInteractive -WindowStyle Hidden -Command \"Set-NetConnectionProfile -InterfaceIndex {problem.InterfaceIndex} -NetworkCategory Private\"")
            {
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden,
            });
            p?.WaitForExit(15000);
        }
        catch (Exception) { return false; } // the user declined the prompt
        return FindPublicLan() == null;
    }

    static string Powershell(string command)
    {
        using var p = Process.Start(new ProcessStartInfo("powershell.exe", $"-NoProfile -NonInteractive -Command \"{command}\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
        });
        if (p == null) return "";
        string output = p.StandardOutput.ReadToEnd();
        p.WaitForExit(8000);
        return output;
    }
}
