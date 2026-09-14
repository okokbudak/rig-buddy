// Reads the scs-sdk-plugin shared memory (Local\SCSTelemetry) and streams the
// raw 32 KiB buffer to local TCP clients, so the Node telemetry client can run
// without the trucksim-telemetry native addon (which needs MSVC to build).
//
// Frame format: int32 little-endian length, followed by `length` bytes.
// length == 0 means "no telemetry available" (game not running / plugin missing).

using System.IO.MemoryMappedFiles;
using System.Net;
using System.Net.Sockets;

sealed class TelemetryBridge
{
    const string MmfName = "Local\\SCSTelemetry";
    const int MmfSize = 32 * 1024;
    const int Port = 62841;
    const int IntervalMs = 50; // 20 Hz

    readonly SharedState _state = new();

    /** true while the game (with the telemetry plugin) is running. */
    public bool GameConnected { get; private set; }

    public void Start()
    {
        var listener = new TcpListener(IPAddress.Loopback, Port);
        listener.Start();
        Console.WriteLine($"bridge: listening on 127.0.0.1:{Port} ({MmfName})");
        _ = Task.Run(PollLoop);
        _ = Task.Run(async () =>
        {
            while (true)
            {
                var client = await listener.AcceptTcpClientAsync();
                client.NoDelay = true;
                Console.WriteLine($"bridge: client connected: {client.Client.RemoteEndPoint}");
                _ = Task.Run(() => ServeClient(client));
            }
        });
    }

    async Task PollLoop()
    {
        MemoryMappedFile? mmf = null;
        MemoryMappedViewAccessor? view = null;
        bool? lastAvailable = null;
        var scratch = new byte[MmfSize];

        while (true)
        {
            try
            {
                if (view == null)
                {
                    mmf = MemoryMappedFile.OpenExisting(MmfName, MemoryMappedFileRights.Read);
                    view = mmf.CreateViewAccessor(0, MmfSize, MemoryMappedFileAccess.Read);
                }
                view.ReadArray(0, scratch, 0, MmfSize);
                _state.Publish(scratch);
                if (lastAvailable != true) Console.WriteLine("bridge: game detected");
                lastAvailable = true;
            }
            catch (FileNotFoundException)
            {
                _state.Publish(null);
                if (lastAvailable != false) Console.WriteLine("bridge: waiting for game (plugin shared memory not found)");
                lastAvailable = false;
            }
            catch (Exception e)
            {
                Console.WriteLine($"bridge: {e.GetType().Name}: {e.Message}");
                view?.Dispose(); view = null;
                mmf?.Dispose(); mmf = null;
                _state.Publish(null);
                lastAvailable = false;
            }
            GameConnected = lastAvailable == true;
            await Task.Delay(IntervalMs);
        }
    }

    async Task ServeClient(TcpClient client)
    {
        try
        {
            using (client)
            await using (var stream = client.GetStream())
            {
                long lastVersion = -1;
                var header = new byte[4];
                while (true)
                {
                    var (version, data) = await _state.WaitForNewer(lastVersion);
                    lastVersion = version;
                    BitConverter.TryWriteBytes(header, data?.Length ?? 0);
                    await stream.WriteAsync(header);
                    if (data != null) await stream.WriteAsync(data);
                }
            }
        }
        catch (Exception e) when (e is IOException or SocketException or ObjectDisposedException)
        {
            Console.WriteLine("bridge: client disconnected");
        }
    }

    sealed class SharedState
    {
        private readonly object _lock = new();
        private byte[]? _data;
        private long _version;
        private TaskCompletionSource _changed = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public void Publish(byte[]? src)
        {
            TaskCompletionSource toSignal;
            lock (_lock)
            {
                _data = src == null ? null : (byte[])src.Clone();
                _version++;
                toSignal = _changed;
                _changed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            }
            toSignal.TrySetResult();
        }

        public async Task<(long, byte[]?)> WaitForNewer(long seen)
        {
            while (true)
            {
                Task wait;
                lock (_lock)
                {
                    if (_version != seen) return (_version, _data);
                    wait = _changed.Task;
                }
                await wait;
            }
        }
    }
}
