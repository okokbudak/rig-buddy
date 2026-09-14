package tr.ets2nav.ui;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

import tr.ets2nav.R;
import tr.ets2nav.agent.AgentClient;

/** PC media (Spotify, Apple Music, browsers… via the agent) and the in-game radio. */
public final class MediaScreen {
  private final Context c;
  private final AgentClient agent;
  private final LinearLayout root, sessionChips;
  private final ImageView art, playButton;
  private final TextView app, title, artist, album, position, duration, empty;
  private final SeekBar seek, appVolume, masterVolume;
  private final TextView appVolumeLabel;
  private final View player;
  private final TextView radioStation, radioMeta, radioSong, radioState;
  private String artKey, sessionId;
  private boolean playing, userSeeking, userVolume;
  private long posMs, durMs, posAt;

  public MediaScreen(Context c, AgentClient agent) {
    this.c = c;
    this.agent = agent;
    root = Ui.row(c);
    root.setBaselineAligned(false);
    int pad = Ui.dp(c, 18);
    root.setPadding(pad, pad, pad, pad);

    // --- PC player
    LinearLayout left = Ui.card(c, false);
    LinearLayout head = Ui.row(c);
    head.addView(icon(R.drawable.ic_music, Ui.ACCENT, 26));
    head.addView(Ui.text(c, "MÜZİK (PC)", 15, Ui.TEXT2, true), Ui.margins(Ui.wrap(), c, 8, 0, 0, 0));
    HorizontalScrollView hs = new HorizontalScrollView(c);
    hs.setHorizontalScrollBarEnabled(false);
    sessionChips = Ui.row(c);
    hs.addView(sessionChips);
    head.addView(hs, Ui.margins(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1), c, 16, 0, 0, 0));
    left.addView(head);

    empty = Ui.text(c, "PC'de çalan bir şey yok.\nSpotify, Apple Music ya da tarayıcıda müzik açın.", 20, Ui.TEXT2, false);
    empty.setGravity(Gravity.CENTER);
    left.addView(empty, Ui.hweight(1));

    LinearLayout p = Ui.column(c);
    player = p;
    LinearLayout top = Ui.row(c);
    top.setGravity(Gravity.TOP);
    art = new ImageView(c);
    art.setScaleType(ImageView.ScaleType.CENTER_CROP);
    art.setBackground(Ui.rounded(Ui.TRACK, Ui.dp(c, 14)));
    art.setClipToOutline(true);
    top.addView(art, new LinearLayout.LayoutParams(Ui.dp(c, 250), Ui.dp(c, 250)));
    LinearLayout info = Ui.column(c);
    app = Ui.text(c, 16, Ui.ACCENT, true);
    title = Ui.text(c, 30, Ui.TEXT, true);
    title.setMaxLines(3);
    artist = Ui.text(c, 22, Ui.TEXT, false);
    artist.setMaxLines(2);
    album = Ui.text(c, 18, Ui.TEXT2, false);
    album.setMaxLines(2);
    info.addView(app);
    info.addView(title, Ui.margins(Ui.matchWrap(), c, 0, 12, 0, 0));
    info.addView(artist, Ui.margins(Ui.matchWrap(), c, 0, 10, 0, 0));
    info.addView(album, Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    top.addView(info, Ui.margins(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1), c, 22, 0, 0, 0));
    p.addView(top, Ui.margins(Ui.matchWrap(), c, 0, 16, 0, 0));

    seek = seekBar(Ui.ACCENT);
    seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
      @Override public void onProgressChanged(SeekBar s, int v, boolean fromUser) {
        if (fromUser) position.setText(time((long) v * 1000));
      }
      @Override public void onStartTrackingTouch(SeekBar s) { userSeeking = true; }
      @Override public void onStopTrackingTouch(SeekBar s) {
        userSeeking = false;
        posMs = (long) s.getProgress() * 1000;
        posAt = SystemClock.uptimeMillis();
        send(cmd("seek").put2("positionMs", posMs));
      }
    });
    p.addView(seek, Ui.margins(Ui.matchWrap(), c, 0, 18, 0, 0));
    LinearLayout times = Ui.row(c);
    position = Ui.text(c, 15, Ui.TEXT2, false);
    duration = Ui.text(c, 15, Ui.TEXT2, false);
    times.addView(position);
    times.addView(Ui.spacer(c));
    times.addView(duration);
    p.addView(times, Ui.margins(Ui.matchWrap(), c, 12, 2, 12, 0));

    LinearLayout controls = Ui.row(c);
    controls.setGravity(Gravity.CENTER);
    controls.addView(roundButton(R.drawable.ic_prev, 64, Ui.TRACK, Ui.TEXT, v -> send(cmd("prev"))));
    playButton = roundButton(R.drawable.ic_play, 84, Ui.ACCENT, 0xff101316, v -> {
      playing = !playing;
      updatePlayIcon();
      send(cmd("toggle"));
    });
    controls.addView(playButton, Ui.margins(new LinearLayout.LayoutParams(Ui.dp(c, 84), Ui.dp(c, 84)), c, 36, 0, 36, 0));
    controls.addView(roundButton(R.drawable.ic_next, 64, Ui.TRACK, Ui.TEXT, v -> send(cmd("next"))));
    p.addView(controls, Ui.margins(Ui.matchWrap(), c, 0, 10, 0, 0));

    p.addView(Ui.spacer(c), Ui.hweight(1));
    LinearLayout vol = Ui.row(c);
    vol.addView(icon(R.drawable.ic_volume, Ui.TEXT2, 24));
    appVolumeLabel = Ui.text(c, 16, Ui.TEXT2, false);
    vol.addView(appVolumeLabel, Ui.margins(new LinearLayout.LayoutParams(Ui.dp(c, 110), LinearLayout.LayoutParams.WRAP_CONTENT), c, 8, 0, 0, 0));
    appVolume = seekBar(Ui.GREEN);
    appVolume.setMax(100);
    appVolume.setOnSeekBarChangeListener(volumeListener("app"));
    vol.addView(appVolume, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
    p.addView(vol);
    LinearLayout mvol = Ui.row(c);
    mvol.addView(icon(R.drawable.ic_volume, Ui.TEXT2, 24));
    mvol.addView(Ui.text(c, "PC sesi", 16, Ui.TEXT2, false),
        Ui.margins(new LinearLayout.LayoutParams(Ui.dp(c, 110), LinearLayout.LayoutParams.WRAP_CONTENT), c, 8, 0, 0, 0));
    masterVolume = seekBar(Ui.YELLOW);
    masterVolume.setMax(100);
    masterVolume.setOnSeekBarChangeListener(volumeListener("master"));
    mvol.addView(masterVolume, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
    p.addView(mvol, Ui.margins(Ui.matchWrap(), c, 0, 10, 0, 0));
    left.addView(p, Ui.hweight(1));
    root.addView(left, Ui.weight(1.55f));

    // --- in-game radio
    LinearLayout right = Ui.card(c, false);
    LinearLayout rh = Ui.row(c);
    rh.addView(icon(R.drawable.ic_radio, Ui.YELLOW, 26));
    rh.addView(Ui.text(c, "OYUN RADYOSU", 15, Ui.TEXT2, true), Ui.margins(Ui.wrap(), c, 8, 0, 0, 0));
    right.addView(rh);
    radioStation = Ui.text(c, 28, Ui.TEXT, true);
    radioMeta = Ui.text(c, 17, Ui.TEXT2, false);
    radioSong = Ui.text(c, 22, Ui.TEXT, false);
    radioSong.setMaxLines(4);
    radioState = Ui.text(c, 15, Ui.TEXT2, false);
    right.addView(radioStation, Ui.margins(Ui.matchWrap(), c, 0, 22, 0, 0));
    right.addView(radioMeta, Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    right.addView(radioSong, Ui.margins(Ui.matchWrap(), c, 0, 26, 0, 0));
    right.addView(Ui.spacer(c), Ui.hweight(1));
    right.addView(radioState);
    root.addView(right, Ui.margins(Ui.weight(1), c, 14, 0, 0, 0));

    onMedia(null);
  }

  public View view() {
    return root;
  }

  /** Advances the progress bar between the agent's once-a-second updates. */
  public void tick() {
    if (!playing || userSeeking || durMs <= 0) return;
    long now = posMs + (SystemClock.uptimeMillis() - posAt);
    seek.setProgress((int) (Math.min(now, durMs) / 1000));
    position.setText(time(Math.min(now, durMs)));
  }

  public void onMedia(JSONObject m) {
    JSONObject cur = m != null ? m.optJSONObject("current") : null;
    renderSessions(m != null ? m.optJSONArray("sessions") : null, cur);
    renderRadio(m != null ? m.optJSONObject("radio") : null, m != null);
    boolean has = cur != null && !cur.optString("title").isEmpty();
    empty.setVisibility(has ? View.GONE : View.VISIBLE);
    player.setVisibility(has ? View.VISIBLE : View.GONE);
    if (m == null) empty.setText("PC'deki ETS2 Nav'a bağlanılamadı.");
    else empty.setText("PC'de çalan bir şey yok.\nSpotify, Apple Music ya da tarayıcıda müzik açın.");
    if (!has) {
      playing = false;
      return;
    }
    sessionId = cur.optString("id");
    app.setText(cur.optString("app"));
    title.setText(cur.optString("title"));
    artist.setText(cur.optString("artist"));
    album.setText(cur.optString("album"));
    artist.setVisibility(cur.optString("artist").isEmpty() ? View.GONE : View.VISIBLE);
    album.setVisibility(cur.optString("album").isEmpty() ? View.GONE : View.VISIBLE);
    playing = "playing".equals(cur.optString("status"));
    updatePlayIcon();
    durMs = cur.optLong("durationMs");
    posMs = cur.optLong("positionMs");
    posAt = SystemClock.uptimeMillis();
    seek.setEnabled(cur.optBoolean("canSeek") && durMs > 0);
    if (!userSeeking) {
      seek.setMax((int) Math.max(1, durMs / 1000));
      seek.setProgress((int) (posMs / 1000));
      position.setText(time(posMs));
    }
    duration.setText(durMs > 0 ? time(durMs) : "");
    if (!userVolume) {
      double av = m.optDouble("appVolume", Double.NaN);
      appVolume.setEnabled(!Double.isNaN(av));
      if (!Double.isNaN(av)) appVolume.setProgress((int) Math.round(av * 100));
      masterVolume.setProgress((int) Math.round(m.optDouble("masterVolume", 1) * 100));
    }
    appVolumeLabel.setText(cur.optString("app") + " sesi");

    String key = cur.isNull("artKey") ? null : cur.optString("artKey", null);
    if (key == null) {
      artKey = null;
      art.setImageResource(R.drawable.ic_music);
      art.setColorFilter(Ui.TEXT2);
      art.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
    } else if (!key.equals(artKey)) {
      artKey = key;
      agent.loadArt(key, bmp -> {
        if (!key.equals(artKey)) return;
        showArt(bmp);
      });
    }
  }

  private void showArt(Bitmap bmp) {
    if (bmp == null) return;
    art.clearColorFilter();
    art.setScaleType(ImageView.ScaleType.CENTER_CROP);
    art.setImageBitmap(bmp);
  }

  private void renderSessions(JSONArray sessions, JSONObject cur) {
    sessionChips.removeAllViews();
    if (sessions == null || sessions.length() < 2) return; // only worth showing with a choice
    String curId = cur != null ? cur.optString("id") : "";
    for (int i = 0; i < sessions.length(); i++) {
      JSONObject s = sessions.optJSONObject(i);
      boolean on = s.optString("id").equals(curId);
      TextView chip = Ui.text(c, s.optString("app"), 15, on ? 0xff101316 : Ui.TEXT, true);
      int ph = Ui.dp(c, 14), pv = Ui.dp(c, 8);
      chip.setPadding(ph, pv, ph, pv);
      chip.setBackground(Ui.rounded(on ? Ui.ACCENT : Ui.TRACK, Ui.dp(c, 18)));
      String id = s.optString("id");
      chip.setOnClickListener(v -> send(cmd("select").put2("session", id)));
      sessionChips.addView(chip, Ui.margins(Ui.wrap(), c, 0, 0, 8, 0));
    }
  }

  private void renderRadio(JSONObject r, boolean agentUp) {
    if (r == null) {
      radioStation.setText("Radyo kapalı");
      radioMeta.setText("");
      radioSong.setText("");
      radioState.setText(agentUp
          ? "Oyunda radyo açıldığında istasyon ve çalan şarkı burada görünür."
          : "PC'deki ETS2 Nav'a bağlanılamadı.");
      return;
    }
    radioStation.setText(r.optString("name"));
    String meta = r.optString("genre");
    if (!r.optString("country").isEmpty()) meta += (meta.isEmpty() ? "" : "  ·  ") + r.optString("country");
    radioMeta.setText(meta);
    String song = r.optString("song");
    radioSong.setText(song.isEmpty() ? "Şarkı bilgisi yayınlanmıyor" : "♪  " + song);
    radioSong.setTextColor(song.isEmpty() ? Ui.TEXT2 : Ui.TEXT);
    radioState.setText("İstasyonu değiştirmek için oyundaki radyo tuşlarını kullanın.");
  }

  private void updatePlayIcon() {
    playButton.setImageResource(playing ? R.drawable.ic_pause : R.drawable.ic_play);
  }

  private SeekBar.OnSeekBarChangeListener volumeListener(String target) {
    return new SeekBar.OnSeekBarChangeListener() {
      long lastSent;
      @Override public void onProgressChanged(SeekBar s, int v, boolean fromUser) {
        if (!fromUser) return;
        long now = SystemClock.uptimeMillis();
        if (now - lastSent > 150) {
          lastSent = now;
          sendVolume(target, v);
        }
      }
      @Override public void onStartTrackingTouch(SeekBar s) { userVolume = true; }
      @Override public void onStopTrackingTouch(SeekBar s) {
        sendVolume(target, s.getProgress());
        s.postDelayed(() -> userVolume = false, 1500); // let the PC catch up before we accept its value again
      }
    };
  }

  private void sendVolume(String target, int percent) {
    send(cmd("volume").put2("target", target).put2("value", percent / 100.0));
  }

  private void send(Cmd cmd) {
    if (sessionId != null && !cmd.has("session")) cmd.put2("session", sessionId);
    agent.mediaCommand(cmd);
  }

  private static Cmd cmd(String name) {
    return new Cmd().put2("cmd", name);
  }

  /** JSONObject with a non-throwing put. */
  private static final class Cmd extends JSONObject {
    Cmd put2(String k, Object v) {
      try {
        put(k, v);
      } catch (JSONException e) {
        throw new IllegalStateException(e);
      }
      return this;
    }
  }

  private SeekBar seekBar(int color) {
    SeekBar s = new SeekBar(c);
    s.setProgressTintList(ColorStateList.valueOf(color));
    s.setThumbTintList(ColorStateList.valueOf(color));
    s.setProgressBackgroundTintList(ColorStateList.valueOf(Ui.TRACK));
    int p = Ui.dp(c, 12);
    s.setPadding(p, p, p, p);
    return s;
  }

  private ImageView icon(int res, int color, int sizeDp) {
    ImageView iv = new ImageView(c);
    iv.setImageResource(res);
    iv.setColorFilter(color);
    iv.setLayoutParams(new LinearLayout.LayoutParams(Ui.dp(c, sizeDp), Ui.dp(c, sizeDp)));
    return iv;
  }

  private ImageView roundButton(int res, int sizeDp, int bg, int fg, View.OnClickListener l) {
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

  private static String time(long ms) {
    long s = ms / 1000;
    return s >= 3600
        ? String.format(Locale.US, "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
        : String.format(Locale.US, "%d:%02d", s / 60, s % 60);
  }
}
