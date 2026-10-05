// Serial ports for Rig Buddy Studio (the Node agent decides what to send, this
// owns the COM ports: .NET has serial support built in, Node would need a native addon).
// One TCP client at a time per connection, loopback only (127.0.0.1:62847),
// one JSON object per line in both directions:
//   -> {op:"ports", reqId}                       <- {ev:"ports", reqId, ports:[{name, desc}]}
//   -> {op:"open", id, port, baud}               <- {ev:"state", id, state:"open"|"closed"|"error", msg}
//   -> {op:"write", id, b64}
//   -> {op:"close", id}
//   -> {op:"probe", reqId, port, baud}           <- {ev:"probe", reqId, ok, reply, msg}
//   <- {ev:"rx", id, text}                       a line the device sent
// An opened device is kept open: when it is unplugged or the port is taken by
// another program (SimHub), it is retried every 2 s until closed.

using System.IO.Ports;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Win32;

sealed partial class SerialHub
{
    const int Port = 62847;

    [GeneratedRegex(@"^COM\d{1,3}$")]
    private static partial Regex ComName();

    public void Start()
    {
        var listener = new TcpListener(IPAddress.Loopback, Port);
        listener.Start();
        Console.WriteLine($"serial hub: listening on 127.0.0.1:{Port}");
        _ = Task.Run(async () =>
        {
            while (true)
            {
                var client = await listener.AcceptTcpClientAsync();
                client.NoDelay = true;
                _ = Task.Run(() => new Session(client).Run());
            }
        });
    }

    /** Names plus what Windows knows about the device ("USB-SERIAL CH340 (COM11)"), from the USB enum keys. */
    static List<(string Name, string Desc)> ListPorts()
    {
        var descs = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var usb = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Enum\USB");
            foreach (string vid in usb?.GetSubKeyNames() ?? [])
            {
                using var vk = usb!.OpenSubKey(vid);
                foreach (string inst in vk?.GetSubKeyNames() ?? [])
                {
                    using var ik = vk!.OpenSubKey(inst);
                    using var pk = ik?.OpenSubKey("Device Parameters");
                    string? port = pk?.GetValue("PortName") as string;
                    if (port == null) continue;
                    string? name = ik!.GetValue("FriendlyName") as string ?? ik.GetValue("DeviceDesc") as string;
                    if (name != null && name.Contains(';')) name = name[(name.LastIndexOf(';') + 1)..];
                    descs[port] = $"{name ?? "USB serial"} [{vid}]";
                }
            }
        }
        catch (Exception) { /* no registry access: names only */ }
        return SerialPort.GetPortNames()
            .OrderBy(p => int.TryParse(p.AsSpan(3), out int n) ? n : 999)
            .Select(p => (p, descs.TryGetValue(p, out var d) ? d : ""))
            .ToList();
    }

    sealed class Session
    {
        readonly TcpClient _client;
        readonly StreamWriter _out;
        readonly object _outLock = new();
        readonly Dictionary<string, Device> _devices = new();

        public Session(TcpClient client)
        {
            _client = client;
            _out = new StreamWriter(client.GetStream(), new UTF8Encoding(false)) { AutoFlush = true, NewLine = "\n" };
        }

        public async Task Run()
        {
            try
            {
                using var reader = new StreamReader(_client.GetStream(), Encoding.UTF8);
                string? line;
                while ((line = await reader.ReadLineAsync()) != null)
                {
                    try { Handle(JsonDocument.Parse(line).RootElement); }
                    catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException)
                    {
                        Console.WriteLine($"serial hub: bad request: {e.Message}");
                    }
                }
            }
            catch (IOException) { }
            catch (ObjectDisposedException) { }
            finally
            {
                lock (_devices) foreach (var d in _devices.Values) d.Stop();
                _devices.Clear();
                _client.Close();
            }
        }

        public void Send(object o)
        {
            try { lock (_outLock) _out.WriteLine(JsonSerializer.Serialize(o)); }
            catch (Exception e) when (e is IOException or ObjectDisposedException) { }
        }

        void Handle(JsonElement m)
        {
            string op = m.GetProperty("op").GetString() ?? "";
            m.TryGetProperty("reqId", out var req);
            object? reqId = req.ValueKind == JsonValueKind.Number ? req.GetInt64() : null;
            switch (op)
            {
                case "ports":
                    Send(new { ev = "ports", reqId, ports = ListPorts().Select(p => new { name = p.Name, desc = p.Desc }) });
                    break;
                case "open":
                {
                    string id = m.GetProperty("id").GetString()!;
                    string port = m.GetProperty("port").GetString()!;
                    int baud = m.GetProperty("baud").GetInt32();
                    if (!ComName().IsMatch(port) || baud < 300 || baud > 2_000_000) { Send(new { ev = "state", id, state = "error", msg = "bad port or baud rate" }); break; }
                    lock (_devices)
                    {
                        if (_devices.Remove(id, out var old)) old.Stop();
                        _devices[id] = new Device(id, port, baud, this);
                    }
                    break;
                }
                case "write":
                {
                    string id = m.GetProperty("id").GetString()!;
                    byte[] data = Convert.FromBase64String(m.GetProperty("b64").GetString()!);
                    Device? d;
                    lock (_devices) _devices.TryGetValue(id, out d);
                    d?.Write(data);
                    break;
                }
                case "close":
                {
                    string id = m.GetProperty("id").GetString()!;
                    lock (_devices) if (_devices.Remove(id, out var d)) d.Stop();
                    Send(new { ev = "state", id, state = "closed", msg = "" });
                    break;
                }
                case "probe":
                {
                    string port = m.GetProperty("port").GetString()!;
                    int baud = m.GetProperty("baud").GetInt32();
                    _ = Task.Run(() => Send(Probe(reqId, port, baud)));
                    break;
                }
            }
        }

        /** Opens the port, waits out the Arduino's reset, asks "?" and returns the first line (firmware: CLUSTER1 / CLUSTER2). */
        object Probe(object? reqId, string port, int baud)
        {
            lock (_devices)
                foreach (var d in _devices.Values)
                    if (d.Port.Equals(port, StringComparison.OrdinalIgnoreCase))
                        return new { ev = "probe", reqId, ok = false, reply = "", msg = $"{port} is in use by an enabled device" };
            if (!ComName().IsMatch(port)) return new { ev = "probe", reqId, ok = false, reply = "", msg = "bad port" };
            try
            {
                using var sp = new SerialPort(port, baud) { ReadTimeout = 1500, WriteTimeout = 500, DtrEnable = true, NewLine = "\n" };
                sp.Open();
                Thread.Sleep(2200); // opening the port resets an Uno
                sp.DiscardInBuffer();
                sp.Write("?\n");
                string reply = sp.ReadLine().Trim();
                return new { ev = "probe", reqId, ok = true, reply, msg = "" };
            }
            catch (TimeoutException) { return new { ev = "probe", reqId, ok = false, reply = "", msg = "no answer to \"?\" (other firmware, or wrong baud rate)" }; }
            catch (Exception e) { return new { ev = "probe", reqId, ok = false, reply = "", msg = Describe(e) }; }
        }
    }

    static string Describe(Exception e) => e switch
    {
        UnauthorizedAccessException => "access denied: another program has the port open (SimHub?)",
        FileNotFoundException => "port not found (device unplugged?)",
        _ => e.Message,
    };

    /** One configured serial device: keeps its port open, reconnecting until stopped. */
    sealed class Device
    {
        readonly string _id;
        readonly int _baud;
        readonly Session _session;
        readonly CancellationTokenSource _cts = new();
        volatile SerialPort? _sp;
        volatile bool _broken;
        public string Port { get; }

        public Device(string id, string port, int baud, Session session)
        {
            _id = id; Port = port; _baud = baud; _session = session;
            _ = Task.Run(Loop);
        }

        async Task Loop()
        {
            string? lastError = null;
            while (!_cts.IsCancellationRequested)
            {
                SerialPort? sp = null;
                try
                {
                    sp = new SerialPort(Port, _baud) { WriteTimeout = 500, DtrEnable = true, NewLine = "\n", Encoding = Encoding.ASCII };
                    sp.Open();
                    _broken = false;
                    _sp = sp;
                    lastError = null;
                    _session.Send(new { ev = "state", id = _id, state = "open", msg = "" });
                    Console.WriteLine($"serial: {_id} open on {Port} @ {_baud}");
                    var rx = new StringBuilder();
                    while (!_cts.IsCancellationRequested && !_broken)
                    {
                        if (!SerialPort.GetPortNames().Contains(Port, StringComparer.OrdinalIgnoreCase)) throw new IOException("device unplugged");
                        while (sp.BytesToRead > 0)
                        {
                            char c = (char)sp.ReadByte();
                            if (c == '\n') { _session.Send(new { ev = "rx", id = _id, text = rx.ToString().Trim() }); rx.Clear(); }
                            else if (rx.Length < 256) rx.Append(c);
                        }
                        await Task.Delay(50, _cts.Token);
                    }
                    if (_broken) throw new IOException("write failed");
                }
                catch (OperationCanceledException) { }
                catch (Exception e)
                {
                    string msg = Describe(e);
                    if (msg != lastError) Console.WriteLine($"serial: {_id} {Port}: {msg}");
                    lastError = msg;
                    _session.Send(new { ev = "state", id = _id, state = "error", msg });
                }
                finally
                {
                    _sp = null;
                    try { sp?.Dispose(); } catch (Exception) { }
                }
                try { await Task.Delay(2000, _cts.Token); } catch (OperationCanceledException) { }
            }
        }

        public void Write(byte[] data)
        {
            var sp = _sp;
            if (sp == null) return;
            try { sp.Write(data, 0, data.Length); }
            catch (Exception) { _broken = true; }
        }

        public void Stop() => _cts.Cancel();
    }
}
