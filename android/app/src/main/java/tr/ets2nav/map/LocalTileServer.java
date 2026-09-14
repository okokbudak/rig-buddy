package tr.ets2nav.map;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Serves vector tiles out of an MBTiles (SQLite) file on 127.0.0.1, because
 * MapLibre 10 can only load tiles over HTTP. Tiles stay gzip-compressed, as
 * tippecanoe wrote them; MapLibre inflates them itself.
 *
 * URL scheme: /{name}/{z}/{x}/{y}.pbf (XYZ; MBTiles rows are TMS-flipped).
 */
public final class LocalTileServer {
  private static final String TAG = "TileServer";
  private static final Pattern PATH = Pattern.compile("^GET /(\\w+)/(\\d+)/(\\d+)/(\\d+)\\.pbf");

  private final File mbtiles;
  private final String name;
  private ServerSocket socket;
  private SQLiteDatabase db;
  // MapLibre fetches several tiles at once; SQLite reads are cheap, 3 threads is plenty.
  private final ExecutorService pool = Executors.newFixedThreadPool(3);
  private final AtomicInteger requests = new AtomicInteger(), misses = new AtomicInteger();

  public LocalTileServer(File mbtiles, String name) {
    this.mbtiles = mbtiles;
    this.name = name;
  }

  /** Starts the server and returns the tile URL template for the style. */
  public synchronized String start() throws IOException {
    db = SQLiteDatabase.openDatabase(mbtiles.getPath(), null,
        SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS);
    socket = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
    Thread acceptor = new Thread(this::acceptLoop, "tile-accept");
    acceptor.setDaemon(true);
    acceptor.start();
    return "http://127.0.0.1:" + socket.getLocalPort() + "/" + name + "/{z}/{x}/{y}.pbf";
  }

  public synchronized void stop() {
    try {
      if (socket != null) socket.close();
    } catch (IOException ignored) {
    }
    pool.shutdownNow();
    if (db != null) db.close();
  }

  private void acceptLoop() {
    while (!socket.isClosed()) {
      try {
        Socket client = socket.accept();
        pool.execute(() -> handle(client));
      } catch (IOException e) {
        if (!socket.isClosed()) Log.w(TAG, "accept failed", e);
      }
    }
  }

  private void handle(Socket client) {
    try (Socket c = client) {
      c.setSoTimeout(5000);
      BufferedReader in = new BufferedReader(
          new InputStreamReader(c.getInputStream(), StandardCharsets.ISO_8859_1));
      String requestLine = in.readLine();
      // drain headers
      String h;
      while ((h = in.readLine()) != null && !h.isEmpty()) { /* ignore */ }
      OutputStream out = c.getOutputStream();
      Matcher m = requestLine == null ? null : PATH.matcher(requestLine);
      if (m == null || !m.find() || !name.equals(m.group(1))) {
        write(out, "404 Not Found", null);
        return;
      }
      int z = Integer.parseInt(m.group(2));
      int x = Integer.parseInt(m.group(3));
      int y = Integer.parseInt(m.group(4));
      byte[] tile = readTile(z, x, (1 << z) - 1 - y);
      int n = requests.incrementAndGet();
      if (tile == null) misses.incrementAndGet();
      if (n <= 40 || n % 100 == 0) {
        Log.i(TAG, "tile " + z + "/" + x + "/" + y + " -> " + (tile == null ? "empty" : tile.length + " B")
            + " (requests=" + n + ", empty=" + misses.get() + ")");
      }
      write(out, "200 OK", tile);
    } catch (IOException | RuntimeException e) {
      Log.w(TAG, "request failed: " + e);
    }
  }

  private byte[] readTile(int z, int x, int tmsY) {
    try (Cursor cur = db.rawQuery(
        "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",
        new String[] {Integer.toString(z), Integer.toString(x), Integer.toString(tmsY)})) {
      return cur.moveToFirst() ? cur.getBlob(0) : null;
    }
  }

  private static void write(OutputStream out, String status, byte[] body) throws IOException {
    // An empty 200 means "no data here"; MapLibre treats it as a blank tile
    // instead of retrying, which is what we want outside the game map.
    int len = body == null ? 0 : body.length;
    boolean gzip = len > 2 && (body[0] & 0xff) == 0x1f && (body[1] & 0xff) == 0x8b;
    String headers = "HTTP/1.1 " + status + "\r\n"
        + "Content-Type: application/x-protobuf\r\n"
        + (gzip ? "Content-Encoding: gzip\r\n" : "")
        + "Content-Length: " + len + "\r\n"
        + "Cache-Control: no-store\r\n"
        + "Connection: close\r\n\r\n";
    out.write(headers.getBytes(StandardCharsets.ISO_8859_1));
    if (len > 0) out.write(body);
    out.flush();
  }
}
