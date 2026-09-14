// Lets scripts drive the running app: `ETS2Nav.exe --quit`,
// `--restart [server|agent|telemetry]`, `--stop <svc>`, `--start <svc>`, `--status`.
// One text command per connection on 127.0.0.1:62845, answered with one line.

using System.Net;
using System.Net.Sockets;
using System.Text;

static class ControlPort
{
    const int Port = 62845;

    public static void Listen(Func<string, string> handle)
    {
        var listener = new TcpListener(IPAddress.Loopback, Port);
        listener.Start();
        _ = Task.Run(async () =>
        {
            while (true)
            {
                using var c = await listener.AcceptTcpClientAsync();
                try
                {
                    var stream = c.GetStream();
                    using var reader = new StreamReader(stream, Encoding.UTF8, leaveOpen: true);
                    string cmd = (await reader.ReadLineAsync())?.Trim() ?? "";
                    string reply;
                    try { reply = handle(cmd); }
                    catch (Exception e) { reply = "error: " + e.Message; }
                    var bytes = Encoding.UTF8.GetBytes(reply + "\n");
                    await stream.WriteAsync(bytes);
                }
                catch (IOException) { }
            }
        });
    }

    /** Client side. Returns the app's reply, or null if it isn't running. */
    public static string? Send(string cmd)
    {
        try
        {
            using var c = new TcpClient();
            c.Connect(IPAddress.Loopback, Port);
            var stream = c.GetStream();
            stream.Write(Encoding.UTF8.GetBytes(cmd + "\n"));
            using var reader = new StreamReader(stream, Encoding.UTF8);
            return reader.ReadLine();
        }
        catch (SocketException) { return null; }
    }
}
