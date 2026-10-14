// Finds out, before anything starts, whether Windows lets Rig Buddy open the ports it needs.
//
// PCs with Hyper-V, WSL2 or Docker have Windows reserve ranges of TCP ports at every start
// ("netsh int ipv4 show excludedportrange protocol=tcp"). Opening a reserved port fails with
// "an attempt was made to access a socket in a way forbidden by its access permissions" (10013),
// which used to end the app with a crash. Now the app says what is wrong and how to fix it.

using System.Net;
using System.Net.Sockets;

static class PortCheck
{
    /** The ports Rig Buddy and its services listen on. Critical: nothing works without it. */
    static readonly (int Port, ProtocolType Proto, bool Critical)[] Ports =
    [
        (62840, ProtocolType.Tcp, true),  // navigation server
        (62841, ProtocolType.Tcp, true),  // telemetry bridge
        (62843, ProtocolType.Tcp, true),  // agent
        (62845, ProtocolType.Tcp, true),  // control port (RigBuddy.exe --quit and friends)
        (62847, ProtocolType.Tcp, false), // serial ports for Studio
        (62850, ProtocolType.Tcp, false), // Studio page
        (62846, ProtocolType.Udp, false), // the app finds the PC with this
    ];

    /** Reserves 62840-62850 for Rig Buddy (once, in an administrator PowerShell). wsl --shutdown first: it frees the ranges Windows took for WSL. */
    public const string FixCommands =
        "wsl --shutdown\r\nnetsh int ipv4 add excludedportrange protocol=tcp startport=62840 numberofports=11";

    public sealed record Problem(int Port, ProtocolType Proto, bool Critical, SocketError Error);

    /** The ports that cannot be opened right now: reserved by Windows, or used by another program. */
    public static List<Problem> Find()
    {
        var found = new List<Problem>();
        foreach (var (port, proto, critical) in Ports)
        {
            try
            {
                // bind only, never listen: no firewall prompt, nothing left behind
                using var s = proto == ProtocolType.Tcp
                    ? new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp)
                    : new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
                s.Bind(new IPEndPoint(IPAddress.Loopback, port));
            }
            catch (SocketException e) when (e.SocketErrorCode is SocketError.AccessDenied or SocketError.AddressAlreadyInUse)
            {
                found.Add(new Problem(port, proto, critical, e.SocketErrorCode));
            }
            catch (SocketException)
            {
                // anything else: the real listener reports it when it starts
            }
        }
        return found;
    }

    /** Tells the user what is wrong and offers the fix. Returns when the dialog is closed. */
    public static void Explain(List<Problem> problems)
    {
        foreach (var p in problems) Console.WriteLine($"ports: {p.Proto} {p.Port}: {p.Error}");
        var reserved = problems.Where(p => p.Error == SocketError.AccessDenied).Select(p => p.Port).Distinct().OrderBy(p => p).ToList();
        if (reserved.Count > 0)
        {
            string text = L.T("ports.reserved", string.Join(", ", reserved), FixCommands);
            if (MessageBox.Show(text, "Rig Buddy", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
            {
                try { Clipboard.SetText(FixCommands); }
                catch (Exception e) { Console.WriteLine($"ports: could not copy to the clipboard: {e.Message}"); }
            }
            return;
        }
        var inUse = problems.Select(p => p.Port).Distinct().OrderBy(p => p);
        MessageBox.Show(L.T("ports.inuse", string.Join(", ", inUse)), "Rig Buddy", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }
}
