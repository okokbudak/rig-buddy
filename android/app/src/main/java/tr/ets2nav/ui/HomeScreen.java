package tr.ets2nav.ui;

import android.content.Context;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import tr.ets2nav.R;

/**
 * CarPlay-style home: the live map in a big card on the left (it is the real
 * map view, moved and clipped by MainActivity into {@link #mapSlot()}), quick
 * actions and the in-game radio on the right.
 */
public final class HomeScreen {
  public interface Actions {
    /** "map", "radio", "jobs", ... or "search" (the map with the search panel open). */
    void open(String screen);
  }

  private final Context c;
  private final Actions actions;
  private final LinearLayout root;
  private final FrameLayout mapSlot;
  private final TextView gameClock, subtitle;
  private final TextView radioStation, radioMeta, radioSong;

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
    subtitle.setEllipsize(TextUtils.TruncateAt.END);
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

    // --- the in-game radio
    LinearLayout radio = card(c);
    radio.setOnClickListener(v -> actions.open("radio"));
    LinearLayout head = Ui.row(c);
    ImageView icon = new ImageView(c);
    icon.setImageResource(R.drawable.ic_radio);
    icon.setColorFilter(Ui.YELLOW);
    head.addView(icon, new LinearLayout.LayoutParams(Ui.dp(c, 24), Ui.dp(c, 24)));
    head.addView(Ui.text(c, Ui.s(R.string.media_radio), 14, Ui.YELLOW, true), Ui.margins(Ui.wrap(), c, 8, 0, 0, 0));
    radio.addView(head);
    radioStation = Ui.text(c, 26, Ui.TEXT, true);
    radioStation.setMaxLines(2);
    radioStation.setEllipsize(TextUtils.TruncateAt.END);
    radioMeta = Ui.text(c, 15, Ui.TEXT2, false);
    radioMeta.setSingleLine(true);
    radioMeta.setEllipsize(TextUtils.TruncateAt.END);
    radioSong = Ui.text(c, 19, Ui.TEXT, false);
    radioSong.setMaxLines(4);
    radioSong.setEllipsize(TextUtils.TruncateAt.END);
    radio.addView(radioStation, Ui.margins(Ui.matchWrap(), c, 0, 18, 0, 0));
    radio.addView(radioMeta, Ui.margins(Ui.matchWrap(), c, 0, 6, 0, 0));
    radio.addView(radioSong, Ui.margins(Ui.matchWrap(), c, 0, 16, 0, 0));
    right.addView(radio, Ui.margins(Ui.hweight(1.5f), c, 0, 14, 0, 0));

    onTelemetry(null);
    setRadio(null, false);
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

  public View view() {
    return root;
  }

  /** Where the map card goes; MainActivity moves the real map view over it. */
  public View mapSlot() {
    return mapSlot;
  }

  /** Called every second or so. */
  public void tick() {}

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

  /**
   * The station and song the game is playing, as the PC agent detects them, or null
   * (the radio is off, or the PC can't be reached: agentUp tells which).
   */
  public void setRadio(JSONObject r, boolean agentUp) {
    if (r == null) {
      radioStation.setText(Ui.s(agentUp ? R.string.media_radio_off : R.string.media_pc_unreachable));
      radioMeta.setText(agentUp ? Ui.s(R.string.media_radio_off_hint) : "");
      radioMeta.setSingleLine(false);
      radioMeta.setMaxLines(3);
      radioSong.setText("");
      return;
    }
    radioStation.setText(r.optString("name"));
    radioMeta.setSingleLine(true);
    String meta = r.optString("genre");
    if (!r.optString("country").isEmpty()) meta += (meta.isEmpty() ? "" : "  ·  ") + r.optString("country");
    radioMeta.setText(meta);
    String song = r.optString("song");
    radioSong.setText(song.isEmpty() ? Ui.s(R.string.media_no_song) : "♪  " + song);
    radioSong.setTextColor(song.isEmpty() ? Ui.TEXT2 : Ui.TEXT);
  }

  public static String gearText(int g) {
    return g > 0 ? String.valueOf(g) : g < 0 ? "R" + (-g) : "N";
  }

  public static String currency(JSONObject telemetry) {
    return telemetry != null && "ats".equals(telemetry.optString("game")) ? "$" : "€";
  }
}
