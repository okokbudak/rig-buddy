package tr.rigbuddy.update;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

import tr.rigbuddy.R;
import tr.rigbuddy.ui.Ui;

/**
 * "A new Rig Buddy is out": at the app's start (its first minutes) a window offering Download and install / Skip this
 * version / Later, like the PC program's. The APK comes from the PC (GET /update/apk: the PC fetches it from GitHub;
 * the tablet in the truck is often offline), is checked against the SHA-256 GitHub published, and is handed to Android's
 * installer, where the user confirms with one tap. Android asks once whether Rig Buddy may install apps.
 */
public final class AppUpdater {
  /** Where the PC is (host name or address); empty while unknown. */
  public interface PcAddress {
    String host();
  }

  private static final long ASK_WINDOW_MS = 5 * 60_000; // only right after the start: not in the middle of a drive
  private final Activity activity;
  private final SharedPreferences prefs;
  private final PcAddress pc;
  private final int port;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final long startedMs = SystemClock.uptimeMillis();
  private final OkHttpClient http = new OkHttpClient.Builder()
      .connectTimeout(4, TimeUnit.SECONDS)
      .readTimeout(5, TimeUnit.MINUTES) // the PC may first have to fetch the APK from GitHub
      .build();
  private boolean asked;
  private boolean busy;
  private File pendingInstall; // downloaded, waiting for the "install apps" permission

  public AppUpdater(Activity activity, SharedPreferences prefs, PcAddress pc, int port) {
    this.activity = activity;
    this.prefs = prefs;
    this.pc = pc;
    this.port = port;
  }

  /**
   * The PC's /update answer (newer than this app). Asks at most once per start, in the first minutes, not for a version
   * the user skipped; otherwise nothing (the settings entry stays).
   */
  public void offer(String version, String sha256, long size) {
    if (asked || sha256 == null || sha256.isEmpty()) return;
    if (version.equals(prefs.getString("updateSkipped", ""))) return;
    if (SystemClock.uptimeMillis() - startedMs > ASK_WINDOW_MS) return;
    asked = true;
    show(version, sha256, size);
  }

  /** The window itself (also from the settings entry). */
  public void show(String version, String sha256, long size) {
    if (busy || activity.isFinishing()) return;
    new AlertDialog.Builder(activity)
        .setTitle(Ui.s(R.string.update_title))
        .setMessage(Ui.s(R.string.update_prompt, version, currentVersion()))
        .setPositiveButton(Ui.s(R.string.update_install), (d, w) -> download(version, sha256, size))
        .setNeutralButton(Ui.s(R.string.update_skip), (d, w) -> prefs.edit().putString("updateSkipped", version).apply())
        .setNegativeButton(Ui.s(R.string.update_later), null)
        .show();
  }

  /** Back from Android's settings: if the permission was given there, go on with the install. */
  public void onResume() {
    if (pendingInstall != null && canInstall()) {
      File f = pendingInstall;
      pendingInstall = null;
      install(f);
    }
  }

  private String currentVersion() {
    try {
      return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName;
    } catch (Exception e) {
      return "?";
    }
  }

  private boolean canInstall() {
    if (Build.VERSION.SDK_INT >= 26) return activity.getPackageManager().canRequestPackageInstalls();
    return true; // before Android 8 the system-wide "unknown sources" setting decides, in the installer itself
  }

  /** Android 7+: the app's cache through ApkProvider; older ones read a file:// in the app's external cache. */
  private File updatesDir() {
    if (Build.VERSION.SDK_INT >= 24) return ApkProvider.dir(activity);
    File ext = activity.getExternalCacheDir();
    return ext == null ? null : new File(ext, "updates");
  }

  private void download(String version, String sha256, long size) {
    String host = pc.host();
    File dir = updatesDir();
    if (host.isEmpty() || dir == null) {
      fail(Ui.s(R.string.update_no_pc));
      return;
    }
    busy = true;
    TextView text = new TextView(activity);
    text.setText(Ui.s(R.string.update_waiting_pc));
    ProgressBar bar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
    bar.setMax(1000);
    bar.setIndeterminate(true);
    LinearLayout box = new LinearLayout(activity);
    box.setOrientation(LinearLayout.VERTICAL);
    int pad = Ui.dp(activity, 20);
    box.setPadding(pad, pad, pad, pad);
    box.addView(text);
    box.addView(bar);
    AlertDialog progress = new AlertDialog.Builder(activity)
        .setTitle(Ui.s(R.string.update_title))
        .setView(box)
        .setCancelable(false)
        .show();

    new Thread(() -> {
      File file = new File(dir, "RigBuddy-" + version + ".apk");
      File part = new File(dir, file.getName() + ".part");
      try {
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("mkdir " + dir);
        Request req = new Request.Builder().url("http://" + host + ":" + port + "/update/apk").build();
        try (Response r = http.newCall(req).execute()) {
          if (!r.isSuccessful() || r.body() == null) throw new IOException("PC: HTTP " + r.code());
          // the PC must hand out exactly the version and file this window offered
          if (!version.equals(r.header("X-RigBuddy-Version")) || !sha256.equalsIgnoreCase(r.header("X-RigBuddy-Sha256", ""))) {
            throw new IOException(Ui.s(R.string.update_bad_hash));
          }
          long total = r.body().contentLength() > 0 ? r.body().contentLength() : size;
          MessageDigest md = MessageDigest.getInstance("SHA-256");
          try (InputStream in = r.body().byteStream(); OutputStream out = new FileOutputStream(part)) {
            byte[] buf = new byte[64 * 1024];
            long done = 0, shown = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
              out.write(buf, 0, n);
              md.update(buf, 0, n);
              done += n;
              if (done - shown > 256 * 1024 || done == total) {
                shown = done;
                final long d = done, t = total;
                main.post(() -> {
                  bar.setIndeterminate(t <= 0);
                  if (t > 0) bar.setProgress((int) Math.min(1000, d * 1000 / t));
                  text.setText(Ui.s(R.string.update_downloading, (int) (d / 1_000_000), (int) (Math.max(t, d) / 1_000_000)));
                });
              }
            }
          }
          if (!hex(md.digest()).equalsIgnoreCase(sha256)) throw new IOException(Ui.s(R.string.update_bad_hash));
        }
        if (file.exists() && !file.delete()) throw new IOException("delete " + file);
        if (!part.renameTo(file)) throw new IOException("rename " + part);
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) if (!f.equals(file)) f.delete();
        main.post(() -> {
          busy = false;
          progress.dismiss();
          install(file);
        });
      } catch (Exception e) {
        part.delete();
        String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
        main.post(() -> {
          busy = false;
          progress.dismiss();
          fail(Ui.s(R.string.update_failed, msg));
        });
      }
    }, "app-update").start();
  }

  private void install(File file) {
    if (!canInstall()) {
      // Android 8+: Rig Buddy must be allowed to install apps, once; after that the install goes on by itself (onResume)
      pendingInstall = file;
      new AlertDialog.Builder(activity)
          .setTitle(Ui.s(R.string.update_title))
          .setMessage(Ui.s(R.string.update_need_permission))
          .setPositiveButton(Ui.s(R.string.update_open_settings), (d, w) -> {
            try {
              activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                  Uri.parse("package:" + activity.getPackageName())));
            } catch (RuntimeException e) {
              fail(Ui.s(R.string.update_failed, e.getMessage()));
            }
          })
          .setNegativeButton(Ui.s(R.string.update_later), (d, w) -> pendingInstall = null)
          .show();
      return;
    }
    try {
      Intent i = new Intent(Intent.ACTION_VIEW);
      if (Build.VERSION.SDK_INT >= 24) {
        i.setDataAndType(ApkProvider.uriFor(file), ApkProvider.MIME);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      } else {
        i.setDataAndType(Uri.fromFile(file), ApkProvider.MIME);
      }
      i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      activity.startActivity(i);
    } catch (RuntimeException e) {
      fail(Ui.s(R.string.update_failed, e.getMessage()));
    }
  }

  private void fail(String message) {
    if (activity.isFinishing()) return;
    new AlertDialog.Builder(activity)
        .setTitle(Ui.s(R.string.update_title))
        .setMessage(message)
        .setPositiveButton(android.R.string.ok, null)
        .show();
  }

  private static String hex(byte[] b) {
    StringBuilder s = new StringBuilder(b.length * 2);
    for (byte x : b) s.append(String.format("%02x", x));
    return s.toString();
  }
}
