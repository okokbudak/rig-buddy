package tr.ets2nav.map;

import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

import tr.ets2nav.R;
import tr.ets2nav.ui.Ui;

/**
 * Fetches the map (data/&lt;game&gt;.mbtiles) from the PC agent over Wi-Fi, so
 * phones and tablets need no adb: on connect the app asks GET /tiles for the
 * current version and downloads the file when it is missing or has changed.
 * Callbacks run on the main thread.
 */
public final class TileDownloader {
  private static final String TAG = "TileDownloader";

  public interface Listener {
    /** Download progress, 0..1; total is the file size in bytes. */
    void onProgress(String game, double fraction, long total);

    /** The file for `game` was replaced and can be (re)opened. */
    void onUpdated(String game, File file);

    void onFailed(String game, String error);
  }

  private final OkHttpClient http = new OkHttpClient.Builder()
      .connectTimeout(4, TimeUnit.SECONDS)
      .readTimeout(30, TimeUnit.SECONDS)
      .build();
  private final Handler main = new Handler(Looper.getMainLooper());
  private final SharedPreferences prefs;
  private final File dir;
  private final Listener listener;
  private Thread worker;

  public TileDownloader(SharedPreferences prefs, File dir, Listener listener) {
    this.prefs = prefs;
    this.dir = dir;
    this.listener = listener;
  }

  public static File fileFor(File dir, String game) {
    return new File(dir, game + ".mbtiles");
  }

  public boolean isRunning() {
    return worker != null && worker.isAlive();
  }

  /** Checks the PC's version of `game`'s map and downloads it if needed. */
  public synchronized void sync(String host, int port, String game) {
    if (isRunning()) return;
    worker = new Thread(() -> run(host, port, game), "tiles-" + game);
    worker.start();
  }

  private void run(String host, int port, String game) {
    String base = "http://" + host + ":" + port;
    File target = fileFor(dir, game);
    try {
      JSONObject index;
      try (Response r = http.newCall(new Request.Builder().url(base + "/tiles").build()).execute()) {
        if (!r.isSuccessful() || r.body() == null) return; // older agent: keep what we have
        index = new JSONObject(r.body().string());
      }
      JSONObject info = index.optJSONObject(game);
      if (info == null) return; // the PC has no map for this game
      String version = info.optString("version");
      String key = "tiles." + game + ".version";
      if (target.exists() && version.equals(prefs.getString(key, ""))) return;
      // an adb-pushed file of the right size is taken as current
      if (target.exists() && prefs.getString(key, "").isEmpty() && target.length() == info.optLong("size")) {
        prefs.edit().putString(key, version).apply();
        return;
      }

      long total = info.optLong("size");
      File part = new File(dir, game + ".mbtiles.part");
      Call call = http.newCall(new Request.Builder().url(base + "/tiles/" + game + ".mbtiles").build());
      try (Response r = call.execute()) {
        if (!r.isSuccessful() || r.body() == null) throw new IOException("HTTP " + r.code());
        if (r.body().contentLength() > 0) total = r.body().contentLength();
        try (InputStream in = r.body().byteStream(); OutputStream out = new FileOutputStream(part)) {
          byte[] buf = new byte[256 * 1024];
          long done = 0, lastReport = 0;
          int n;
          while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            done += n;
            if (done - lastReport > 1_000_000 || done == total) {
              lastReport = done;
              final double f = total > 0 ? (double) done / total : 0;
              final long t = total;
              main.post(() -> listener.onProgress(game, f, t));
            }
          }
        }
      }
      if (total > 0 && part.length() != total) throw new IOException(Ui.s(R.string.download_incomplete, part.length(), total));
      // swap on the main thread: the tile server may have the old file open
      main.post(() -> {
        if (target.exists() && !target.delete()) Log.w(TAG, "could not delete old " + target);
        if (!part.renameTo(target)) {
          listener.onFailed(game, Ui.s(R.string.download_move_failed));
          return;
        }
        prefs.edit().putString(key, version).apply();
        listener.onUpdated(game, target);
      });
    } catch (Exception e) {
      Log.w(TAG, "tile sync failed", e);
      final String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
      main.post(() -> listener.onFailed(game, msg));
    }
  }
}
