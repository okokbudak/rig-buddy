// The app has no console: Console.Out/Error go to logs\ets2nav.log with
// timestamps. The Node services log to their own files (see Supervisor).

using System.Text;

static class Log
{
    public static string Dir { get; private set; } = "";

    public static void Init(string dir)
    {
        Dir = dir;
        Directory.CreateDirectory(dir);
        var writer = TextWriter.Synchronized(new TimestampWriter(Open(Path.Combine(dir, "ets2nav.log"))));
        Console.SetOut(writer);
        Console.SetError(writer);
    }

    /** Truncates and opens a log file other programs may read while we write it. */
    public static StreamWriter Open(string path) =>
        new(new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete),
            new UTF8Encoding(false)) { AutoFlush = true };

    sealed class TimestampWriter(TextWriter inner) : TextWriter
    {
        readonly StringBuilder _line = new();
        public override Encoding Encoding => inner.Encoding;

        public override void Write(char c)
        {
            if (c == '\n')
            {
                inner.WriteLine($"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {_line.ToString().TrimEnd('\r')}");
                _line.Clear();
            }
            else _line.Append(c);
        }
    }
}
