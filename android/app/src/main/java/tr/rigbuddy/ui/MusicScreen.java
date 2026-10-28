package tr.rigbuddy.ui;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONException;
import org.json.JSONObject;

import tr.rigbuddy.R;
import tr.rigbuddy.agent.AgentClient;

/**
 * The PC's music player: what plays (Spotify, YouTube in a browser, Apple Music, VLC, ... anything Windows shows as a
 * media session) with previous / play-pause / next / shuffle / repeat. The PC agent (pc/agent/media.mjs) talks to
 * Windows; while this screen is open the state is asked for once a second.
 */
public final class MusicScreen {
  private static final long POLL_MS = 1000;

  private final Context c;
  private final AgentClient agent;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final LinearLayout root;
  private final TextView app, title, artist, elapsed, total, status;
  private final ProgressBar progress;
  private final ImageView shuffle, prev, play, next, repeat;
  private boolean active; // the screen is showing
  private boolean busy;   // a command is on its way: do not let a poll answer paint over it

  public MusicScreen(Context c, AgentClient agent) {
    this.c = c;
    this.agent = agent;
    root = Ui.column(c);
    int pad = Ui.dp(c, 18);
    root.setPadding(pad, pad, pad, pad);

    LinearLayout card = Ui.card(c, false);
    LinearLayout head = Ui.row(c);
    head.setGravity(Gravity.CENTER_VERTICAL);
    ImageView icon = new ImageView(c);
    icon.setImageResource(R.drawable.ic_music);
    icon.setColorFilter(Ui.ACCENT);
    head.addView(icon, new LinearLayout.LayoutParams(Ui.dp(c, 26), Ui.dp(c, 26)));
    head.addView(Ui.text(c, Ui.s(R.string.music_title), 15, Ui.TEXT2, true), Ui.margins(Ui.wrap(), c, 8, 0, 0, 0));
    app = Ui.text(c, 15, Ui.TEXT2, false);
    head.addView(Ui.spacer(c), new LinearLayout.LayoutParams(0, 1, 1f));
    head.addView(app);
    card.addView(head);

    title = Ui.text(c, 38, Ui.TEXT, true);
    title.setMaxLines(3);
    artist = Ui.text(c, 24, Ui.TEXT2, false);
    artist.setMaxLines(2);
    card.addView(title, Ui.margins(Ui.matchWrap(), c, 0, 26, 0, 0));
    card.addView(artist, Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    card.addView(Ui.spacer(c), Ui.hweight(1));

    progress = Ui.bar(c, Ui.ACCENT);
    card.addView(progress, Ui.margins(Ui.matchWrap(), c, 0, 0, 0, 6));
    LinearLayout times = Ui.row(c);
    elapsed = Ui.text(c, 15, Ui.TEXT2, false);
    total = Ui.text(c, 15, Ui.TEXT2, false);
    times.addView(elapsed, new LinearLayout.LayoutParams(0, ViewGroupWrap(), 1f));
    times.addView(total);
    card.addView(times);

    LinearLayout controls = Ui.row(c);
    controls.setGravity(Gravity.CENTER);
    shuffle = button(R.drawable.ic_shuffle, 56, "shuffle");
    prev = button(R.drawable.ic_prev, 72, "previous");
    play = button(R.drawable.ic_play, 96, "playpause");
    next = button(R.drawable.ic_next, 72, "next");
    repeat = button(R.drawable.ic_repeat, 56, "repeat");
    for (ImageView b : new ImageView[] {shuffle, prev, play, next, repeat}) {
      controls.addView(b, Ui.margins(new LinearLayout.LayoutParams(Ui.dp(c, size(b)), Ui.dp(c, size(b))), c, 10, 0, 10, 0));
    }
    card.addView(controls, Ui.margins(Ui.matchWrap(), c, 0, 18, 0, 6));
    status = Ui.text(c, 14, Ui.TEXT2, false);
    status.setGravity(Gravity.CENTER);
    card.addView(status, Ui.matchWrap());
    root.addView(card, Ui.hweight(1));

    render(null);
  }

  private static int ViewGroupWrap() {
    return android.view.ViewGroup.LayoutParams.WRAP_CONTENT;
  }

  private int size(ImageView b) {
    return (Integer) b.getTag();
  }

  private ImageView button(int drawable, int sizeDp, String action) {
    ImageView b = new ImageView(c);
    b.setImageResource(drawable);
    b.setScaleType(ImageView.ScaleType.CENTER);
    b.setTag(sizeDp); // read back by size()
    b.setBackground(Ui.rounded(Ui.CARD_PRESSED, Ui.dp(c, sizeDp) / 2f));
    b.setColorFilter(Ui.TEXT);
    b.setOnClickListener(v -> command(action));
    return b;
  }

  public View view() {
    return root;
  }

  /** The screen is shown (true) or left (false): the state is polled only while it is shown. */
  public void setActive(boolean on) {
    if (on == active) return;
    active = on;
    handler.removeCallbacksAndMessages(null);
    if (on) poll();
  }

  private void poll() {
    if (!active) return;
    agent.get("/media", (json, error) -> {
      if (!busy) render(json, error);
      if (active) handler.postDelayed(this::poll, POLL_MS);
    });
  }

  private void command(String action) {
    busy = true;
    JSONObject body = new JSONObject();
    try {
      body.put("action", action);
    } catch (JSONException e) {
      throw new IllegalStateException(e);
    }
    agent.post("/media", body, (json, error) -> {
      busy = false;
      render(json, error);
    });
  }

  private void render(JSONObject s, String error) {
    if (s == null) {
      render(null);
      status.setText(error != null ? error : "");
      return;
    }
    render(s);
  }

  private void render(JSONObject s) {
    boolean on = s != null && s.optBoolean("active");
    status.setText("");
    if (!on) {
      app.setText("");
      title.setText(Ui.s(R.string.music_nothing));
      title.setTextSize(26);
      artist.setText(Ui.s(R.string.music_nothing_hint));
      progress.setProgress(0);
      elapsed.setText("");
      total.setText("");
      enable(shuffle, false);
      enable(prev, false);
      enable(play, false);
      enable(next, false);
      enable(repeat, false);
      play.setImageResource(R.drawable.ic_play);
      return;
    }
    title.setTextSize(38);
    app.setText(s.optString("app"));
    String t = s.optString("title");
    title.setText(t.isEmpty() ? Ui.s(R.string.music_unknown) : t);
    String a = s.optString("artist"), al = s.optString("album");
    artist.setText(a.isEmpty() ? al : al.isEmpty() ? a : a + "  ·  " + al);
    double pos = s.optDouble("position"), dur = s.optDouble("duration");
    progress.setMax(1000);
    progress.setProgress(dur > 0 ? (int) Math.min(1000, pos / dur * 1000) : 0);
    elapsed.setText(dur > 0 ? time(pos) : "");
    total.setText(dur > 0 ? time(dur) : "");

    boolean playing = "playing".equals(s.optString("status"));
    play.setImageResource(playing ? R.drawable.ic_pause : R.drawable.ic_play);
    enable(play, playing ? s.optBoolean("canPause", true) : s.optBoolean("canPlay", true));
    enable(prev, s.optBoolean("canPrevious", true));
    enable(next, s.optBoolean("canNext", true));
    enable(shuffle, s.optBoolean("canShuffle"));
    enable(repeat, s.optBoolean("canRepeat"));
    boolean shuffleOn = s.optBoolean("shuffle");
    shuffle.setColorFilter(shuffleOn ? Ui.ACCENT : Ui.TEXT);
    String rep = s.optString("repeat", "none");
    repeat.setImageResource("track".equals(rep) ? R.drawable.ic_repeat_one : R.drawable.ic_repeat);
    repeat.setColorFilter("none".equals(rep) ? Ui.TEXT : Ui.ACCENT);
  }

  private static void enable(ImageView b, boolean on) {
    b.setEnabled(on);
    b.setAlpha(on ? 1f : 0.35f);
  }

  private static String time(double seconds) {
    long s = Math.max(0, Math.round(seconds));
    return String.format(java.util.Locale.US, "%d:%02d", s / 60, s % 60);
  }
}
