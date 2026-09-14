// Answers the app's "where is Rig Buddy?" broadcast on the LAN, so phones and
// head units find the PC without typing its IP address.
// UDP 62846: app -> broadcast "RIGBUDDY?", PC -> reply "RIGBUDDY <machine name>".

using System.Net;
using System.Net.Sockets;
using System.Text;

static class Discovery
{
    public const int Port = 62846;

    public static void Start()
    {
        _ = Task.Run(async () =>
        {
            try
            {
                using var udp = new UdpClient(new IPEndPoint(IPAddress.Any, Port)) { EnableBroadcast = true };
                var reply = Encoding.UTF8.GetBytes($"RIGBUDDY {Environment.MachineName}");
                Console.WriteLine($"discovery: listening on udp {Port}");
                while (true)
                {
                    var r = await udp.ReceiveAsync();
                    if (Encoding.UTF8.GetString(r.Buffer).Trim() != "RIGBUDDY?") continue;
                    await udp.SendAsync(reply, reply.Length, r.RemoteEndPoint);
                    Console.WriteLine($"discovery: answered {r.RemoteEndPoint.Address}");
                }
            }
            catch (Exception e)
            {
                Console.WriteLine($"discovery: disabled ({e.GetType().Name}: {e.Message})");
            }
        });
    }
}
