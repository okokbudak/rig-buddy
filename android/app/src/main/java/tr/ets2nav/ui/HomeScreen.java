package tr.ets2nav.ui;

import android.content.Context;
import android.graphics.Bitmap;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONObject;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.util.Objects;

import tr.ets2nav.R;

/**
 * CarPlay-style home: the live map in a big card on the left (it is the real
 * map view, moved and clipped by MainActivity into {@link #mapSlot()}), quick
 * actions and the music that is playing on the right.
 */
public final class HomeScreen {
  public interface ArtCallback {
    void onBitmap(Bitmap bmp);
  }

  public interface Actions {
    /** "map", "media", "jobs", ... or "search" (the map with the search panel open). */
    void open(String screen);

    /** Player buttons: foobar2000 (library) or the Windows media session, cmd = toggle | next | prev. */
    void transport(boolean library, String cmd);

    void loadArt(String path, ArtCallback cb);
  }

  private final Context c;
  private final Actions actions;
  private final LinearLayout root;
  private final FrameLayout mapSlot;
  private final TextView gameClock, subtitle;
  private final LinearLayout playerBox;
  private final TextView emptyNote;
  private final ImageView art, playButton;
  private final TextView npTitle, npArtist, npSource;
  private final ProgressBar progress;

  private JSONObject media, library;
  private boolean npLibrary, playing;
  private long posMs, durMs, posAt;
  private String artKey;

  public HomeScreen(Context c, Actions actions) {
    this.c = c;
    this.actions = actions;
    root = Ui.row(c);
    root.setBaselineAligned(false);
    int pad = Ui.dp(c, 14);
    root.setPadding(pad, pad, pad, pad);

    // --- the map card (the map view itself is placed here by MainActivity)
    mapSlot = new FrameLayout(c);
    View shield = new View(c); // the card only opens the full map: no panning here
    shield.setClickable(true);
    shield.setOnClickListener(v -> actions.open("map"));
    mapSlot.addView(shield, new FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    root.addView(mapSlot, Ui.weight(1.7f));

    LinearLayout right = Ui.column(c);
    root.addView(right, Ui.margins(Ui.weight(1f), c, 14, 0, 0, 0));

    // --- quick actions
    LinearLayout quick = card(c);
    LinearLayout status = Ui.column(c);
    gameClock = Ui.text(c, 20, Ui.TEXT, true);
    gameClock.setSingleLine(true);
    subtitle = Ui.text(c, 14, Ui.TEXT2, false);
    subtitle.setSingleLine(true);
    subtitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
    status.addView(gameClock, Ui.matchWrap());
    status.addView(subtitle, Ui.margins(Ui.matchWrap(), c, 0, 4, 0, 0));
    quick.addView(status, Ui.matchWrap());
    LinearLayout buttons = Ui.row(c);
    buttons.setGravity(Gravity.CENTER);
    buttons.addView(action(R.drawable.ic_search, Ui.s(R.string.home_go), Ui.ACCENT, "search"), Ui.weight(1f));
    buttons.addView(action(R.drawable.ic_work, Ui.s(R.string.rail_jobs), Ui.GREEN, "jobs"), Ui.weight(1f));
    quick.addView(buttons, Ui.margins(new LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f), c, 0, 10, 0, 0));
    right.addView(quick, Ui.hweight(0.8f));

    // --- now playing
    LinearLayout np = card(c);
    np.setOnClickListener(v -> actions.open("media"));
    emptyNote = Ui.text(c, Ui.s(R.string.home_np_empty), 17, Ui.TEXT2, false);
    emptyNote.setGravity(Gravity.CENTER);
    np.addView(emptyNote, Ui.hweight(1f));

    playerBox = Ui.column(c);
    playerBox.setVisibility(View.GONE);
    LinearLayout top = Ui.row(c);
    top.setGravity(Gravity.TOP);
    art = new ImageView(c);
    art.setScaleType(ImageView.ScaleType.CENTER_CROP);
    art.setBackground(Ui.rounded(Ui.TRACK, Ui.dp(c, 14)));
    art.setClipToOutline(true);
    top.addView(art, new LinearLayout.LayoutParams(Ui.dp(c, 120), Ui.dp(c, 120)));
    LinearLayout info = Ui.column(c);
    npSource = Ui.text(c, 13, Ui.ACCENT, true);
    npSource.setSingleLine(true);
    info.addView(npSource, Ui.matchWrap());
    top.addView(info, Ui.margins(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f), c, 14, 0, 0, 0));
    playerBox.addView(top, Ui.matchWrap());

    npTitle = Ui.text(c, 21, Ui.TEXT, true);
    npTitle.setSingleLine(true);
    npTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
    npArtist = Ui.text(c, 15, Ui.TEXT2, false);
    npArtist.setSingleLine(true);
    npArtist.setEllipsize(android.text.TextUtils.TruncateAt.END);
    playerBox.addView(npTitle, Ui.margins(Ui.matchWrap(), c, 2, 12, 2, 0));
    playerBox.addView(npArtist, Ui.margins(Ui.matchWrap(), c, 2, 4, 2, 0));
    progress = Ui.bar(c, Ui.ACCENT);
    playerBox.addView(progress, Ui.margins(Ui.matchWrap(), c, 2, 14, 2, 0));
    playerBox.addView(Ui.spacer(c), Ui.hweight(1f));

    LinearLayout controls = Ui.row(c);
    controls.setGravity(Gravity.CENTER);
    controls.addView(round(R.drawable.ic_prev, 52, Ui.TRACK, Ui.TEXT, v -> actions.transport(npLibrary, "prev")));
    playButton = round(R.drawable.ic_play, 64, Ui.ACCENT, Ui.ON_ACCENT, v -> {
      playing = !playing; // the state message from the PC corrects it a moment later
      updatePlayIcon();
      actions.transport(npLibrary, "toggle");
    });
    controls.addView(playButton, Ui.margins(new LinearLayout.LayoutParams(Ui.dp(c, 64), Ui.dp(c, 64)), c, 22, 0, 22, 0));
    controls.addView(round(R.drawable.ic_next, 52, Ui.TRACK, Ui.TEXT, v -> actions.transport(npLibrary, "next")));
    playerBox.addView(controls, Ui.matchWrap());
    np.addView(playerBox, Ui.hweight(1f));
    right.addView(np, Ui.margins(Ui.hweight(1.5f), c, 0, 14, 0, 0));

    onTelemetry(null);
    render();
  }

  public View view() {
    return root;
  }

  /** Where the map card goes; MainActivity moves the real map view over it. */
  public View mapSlot() {
    return mapSlot;
  }

  /** Called every second or so. */
  public void tick() {}

  /** Progress bar between the PC's once-a-second updates. */
  public void tickPlayback() {
    if (!playing || durMs <= 0) return;
    long now = posMs + (android.os.SystemClock.uptimeMillis() - posAt);
    Ui.setBar(progress, Math.min(now, durMs) / (double) durMs, Ui.ACCENT);
  }

  /** The route summary lives on the map card now (its maneuver and trip panels). */
  public void setNav(String title, String line, String eta, int direction) {}

  public void setProfile(JSONObject p, String error) {}

  public void onTelemetry(JSONObject t) {
    if (t == null) {
      gameClock.setText(Ui.s(R.string.home_game_off));
      subtitle.setText(Ui.s(R.string.home_game_off_hint));
      return;
    }
    JSONObject truck = t.optJSONObject("truck");
    gameClock.setText(Ui.s(R.string.home_game_clock, Ui.gameClock(t.optLong("gameTime"))) + (t.optBoolean("paused") ? Ui.s(R.string.home_paused) : ""));
    subtitle.setText(truck.optString("brand") + " " + truck.optString("model") + "  ·  " + truck.optString("plate"));
  }

  /** Windows media sessions (Spotify, browsers…); foobar2000's own state wins when it is playing. */
  public void setNowPlaying(JSONObject media) {
    this.media = media;
    render();
  }

  /** foobar2000 via Beefweb (see pc/agent/library.mjs). */
  public void setLibrary(JSONObject library) {
    this.library = library;
    render();
  }

  private void render() {
    boolean lib = library != null && library.optBoolean("available")
        && library.optString("playlistId", "").length() > 0 && library.optInt("index", -1) >= 0
        && !library.optString("title").isEmpty();
    JSONObject cur = media != null ? media.optJSONObject("current") : null;
    boolean pc = cur != null && !cur.optString("title").isEmpty();
    // foobar2000 idle/stopped: fall back to whatever else is playing
    if (lib && !"playing".equals(library.optString("playbackState")) && pc && "playing".equals(cur.optString("status"))) lib = false;

    playerBox.setVisibility(lib || pc ? View.VISIBLE : View.GONE);
    emptyNote.setVisibility(lib || pc ? View.GONE : View.VISIBLE);
    if (!lib && !pc) {
      playing = false;
      return;
    }
    npLibrary = lib;
    String key, path = null;
    if (lib) {
      npSource.setText("foobar2000");
      npTitle.setText(library.optString("title"));
      String artist = library.optString("artist");
      npArtist.setText(artist.isEmpty() ? library.optString("album") : artist);
      playing = "playing".equals(library.optString("playbackState"));
      durMs = library.optLong("durationMs");
      posMs = library.optLong("positionMs");
      String pl = library.optString("playlistId");
      int idx = library.optInt("index");
      key = "lib:" + pl + "#" + idx;
      path = "/library/art/" + encode(pl) + "/" + idx;
    } else {
      npSource.setText(cur.optString("app"));
      npTitle.setText(cur.optString("title"));
      String artist = cur.optString("artist");
      npArtist.setText(artist.isEmpty() ? cur.optString("album") : artist);
      playing = "playing".equals(cur.optString("status"));
      durMs = cur.optLong("durationMs");
      posMs = cur.optLong("positionMs");
      String ak = cur.isNull("artKey") ? null : cur.optString("artKey", null);
      key = "pc:" + ak;
      if (ak != null) path = "/media/art/" + ak;
    }
    posAt = android.os.SystemClock.uptimeMillis();
    npArtist.setVisibility(npArtist.getText().length() == 0 ? View.GONE : View.VISIBLE);
    updatePlayIcon();
    Ui.setBar(progress, durMs > 0 ? posMs / (double) durMs : 0, Ui.ACCENT);

    if (!Objects.equals(key, artKey)) {
      artKey = key;
      art.setImageResource(R.drawable.ic_music);
      art.setColorFilter(Ui.TEXT2);
      art.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
      if (path != null) {
        actions.loadArt(path, bmp -> {
          if (bmp == null || !key.equals(artKey)) return;
          art.clearColorFilter();
          art.setScaleType(ImageView.ScaleType.CENTER_CROP);
          art.setImageBitmap(bmp);
        });
      }
    }
  }

  private void updatePlayIcon() {
    playButton.setImageResource(playing ? R.drawable.ic_pause : R.drawable.ic_play);
  }

  private LinearLayout card(Context c) {
    LinearLayout l = Ui.column(c);
    int p = Ui.dp(c, 16);
    l.setPadding(p, p, p, p);
    l.setBackground(Ui.rounded(Ui.CARD, Ui.dp(c, 22)));
    l.setClickable(true);
    return l;
  }

  /** A big round button with a caption, like CarPlay's quick actions. */
  private View action(int icon, String label, int color, String screen) {
    LinearLayout col = Ui.column(c);
    col.setGravity(Gravity.CENTER);
    ImageView iv = new ImageView(c);
    iv.setImageResource(icon);
    iv.setColorFilter(Ui.ON_ACCENT);
    int p = Ui.dp(c, 16);
    iv.setPadding(p, p, p, p);
    iv.setBackground(Ui.rounded(color, Ui.dp(c, 36)));
    col.addView(iv, new LinearLayout.LayoutParams(Ui.dp(c, 72), Ui.dp(c, 72)));
    TextView t = Ui.text(c, label, 14, Ui.TEXT, true);
    t.setSingleLine(true);
    col.addView(t, Ui.margins(Ui.wrap(), c, 0, 8, 0, 0));
    col.setOnClickListener(v -> actions.open(screen));
    return col;
  }

  private ImageView round(int res, int sizeDp, int bg, int fg, View.OnClickListener l) {
    ImageView b = new ImageView(c);
    b.setImageResource(res);
    b.setColorFilter(fg);
    int p = Ui.dp(c, sizeDp / 4f);
    b.setPadding(p, p, p, p);
    b.setBackground(Ui.rounded(bg, Ui.dp(c, sizeDp / 2f)));
    b.setOnClickListener(l);
    b.setLayoutParams(new LinearLayout.LayoutParams(Ui.dp(c, sizeDp), Ui.dp(c, sizeDp)));
    return b;
  }

  private static String encode(String s) {
    try {
      return URLEncoder.encode(s, "UTF-8");
    } catch (UnsupportedEncodingException e) {
      return s;
    }
  }

  public static String gearText(int g) {
    return g > 0 ? String.valueOf(g) : g < 0 ? "R" + (-g) : "N";
  }

  public static String currency(JSONObject telemetry) {
    return telemetry != null && "ats".equals(telemetry.optString("game")) ? "$" : "€";
  }
}
