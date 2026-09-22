package tr.ets2nav.ui;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.SeekBar;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import tr.ets2nav.R;
import tr.ets2nav.agent.AgentClient;

/**
 * Two tabs: PC media (Spotify, Apple Music, browsers… via Windows, plus the
 * in-game radio) and a foobar2000 library (playlists and tracks, via the
 * agent's Beefweb bridge — pc/agent/library.mjs) with its own controls, so
 * nothing here opens Beefweb's own web page.
 */
public final class MediaScreen {
  private final Context c;
  private final AgentClient agent;
  private final LinearLayout root, playerRow, sessionChips;
  private final TextView tabPlayer, tabLibrary;
  private final ImageView art, playButton;
  private final TextView app, title, artist, album, position, duration, empty;
  private final SeekBar seek, appVolume, masterVolume;
  private final TextView appVolumeLabel;
  private final View player;
  private final TextView radioStation, radioMeta, radioSong, radioState;
  private String artKey, sessionId;
  private boolean playing, userSeeking, userVolume;
  private long posMs, durMs, posAt;
  private boolean showingLibrary;

  // --- library (foobar2000 via Beefweb) ---
  private final LinearLayout libraryRoot;
  private final LinearLayout libBody;
  private final TextView libEmpty;
  private final View libPlayer;
  private final ImageView libArt, libPlayButton;
  private final TextView libTitle, libArtist, libPosition, libDuration;
  private final SeekBar libSeek;
  private final ListView playlistList, trackList;
  private final List<JSONObject> playlists = new ArrayList<>();
  private final List<Track> tracks = new ArrayList<>();
  private final PlaylistAdapter playlistAdapter = new PlaylistAdapter();
  private final TrackAdapter trackAdapter = new TrackAdapter();
  private String selectedPlaylistId, playingPlaylistId, libArtKey;
  private int playingIndex = -1;
  private boolean libAvailable, libPlaying, libUserSeeking;
  private long libPosMs, libDurMs, libPosAt;

  public MediaScreen(Context c, AgentClient agent) {
    this.c = c;
    this.agent = agent;
    root = Ui.column(c);

    // --- tabs
    LinearLayout tabs = Ui.row(c);
    int tp = Ui.dp(c, 18);
    tabs.setPadding(tp, tp, tp, 0);
    tabPlayer = tabChip(Ui.s(R.string.media_tab_player));
    tabLibrary = tabChip(Ui.s(R.string.media_tab_library));
    tabPlayer.setOnClickListener(v -> setTab(false));
    tabLibrary.setOnClickListener(v -> setTab(true));
    tabs.addView(tabPlayer);
    tabs.addView(tabLibrary, Ui.margins(Ui.wrap(), c, 10, 0, 0, 0));
    root.addView(tabs, Ui.margins(Ui.matchWrap(), c, 0, 0, 0, 4));

    FrameLayout content = new FrameLayout(c);
    root.addView(content, Ui.hweight(1));

    // === Tab 1: PC player + in-game radio ===================================
    playerRow = Ui.row(c);
    playerRow.setBaselineAligned(false);
    int pad = Ui.dp(c, 18);
    playerRow.setPadding(pad, pad, pad, pad);

    LinearLayout left = Ui.card(c, false);
    LinearLayout head = Ui.row(c);
    head.addView(icon(R.drawable.ic_music, Ui.ACCENT, 26));
    head.addView(Ui.text(c, Ui.s(R.string.media_music_pc), 15, Ui.TEXT2, true), Ui.margins(Ui.wrap(), c, 8, 0, 0, 0));
    HorizontalScrollView hs = new HorizontalScrollView(c);
    hs.setHorizontalScrollBarEnabled(false);
    sessionChips = Ui.row(c);
    hs.addView(sessionChips);
    head.addView(hs, Ui.margins(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1), c, 16, 0, 0, 0));
    left.addView(head);

    empty = Ui.text(c, Ui.s(R.string.media_nothing), 20, Ui.TEXT2, false);
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
    playButton = roundButton(R.drawable.ic_play, 84, Ui.ACCENT, Ui.ON_ACCENT, v -> {
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
    mvol.addView(Ui.text(c, Ui.s(R.string.media_pc_volume), 16, Ui.TEXT2, false),
        Ui.margins(new LinearLayout.LayoutParams(Ui.dp(c, 110), LinearLayout.LayoutParams.WRAP_CONTENT), c, 8, 0, 0, 0));
    masterVolume = seekBar(Ui.YELLOW);
    masterVolume.setMax(100);
    masterVolume.setOnSeekBarChangeListener(volumeListener("master"));
    mvol.addView(masterVolume, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1));
    p.addView(mvol, Ui.margins(Ui.matchWrap(), c, 0, 10, 0, 0));
    left.addView(p, Ui.hweight(1));
    playerRow.addView(left, Ui.weight(1.55f));

    // --- in-game radio
    LinearLayout right = Ui.card(c, false);
    LinearLayout rh = Ui.row(c);
    rh.addView(icon(R.drawable.ic_radio, Ui.YELLOW, 26));
    rh.addView(Ui.text(c, Ui.s(R.string.media_radio), 15, Ui.TEXT2, true), Ui.margins(Ui.wrap(), c, 8, 0, 0, 0));
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
    playerRow.addView(right, Ui.margins(Ui.weight(1), c, 14, 0, 0, 0));

    content.addView(playerRow, matchParent());

    // === Tab 2: foobar2000 library (Beefweb) =================================
    libraryRoot = Ui.column(c);
    libraryRoot.setPadding(pad, pad, pad, pad);
    libraryRoot.setVisibility(View.GONE);

    libEmpty = Ui.text(c, "", 20, Ui.TEXT2, false);
    libEmpty.setGravity(Gravity.CENTER);
    libraryRoot.addView(libEmpty, Ui.hweight(1));

    libBody = Ui.column(c);
    libBody.setVisibility(View.GONE);

    // mini now-playing bar
    LinearLayout bar = Ui.card(c, false);
    LinearLayout barRow = Ui.row(c);
    libArt = new ImageView(c);
    libArt.setScaleType(ImageView.ScaleType.CENTER_CROP);
    libArt.setBackground(Ui.rounded(Ui.TRACK, Ui.dp(c, 10)));
    libArt.setClipToOutline(true);
    barRow.addView(libArt, new LinearLayout.LayoutParams(Ui.dp(c, 64), Ui.dp(c, 64)));
    LinearLayout barInfo = Ui.column(c);
    libTitle = Ui.text(c, 19, Ui.TEXT, true);
    libTitle.setSingleLine(true);
    libArtist = Ui.text(c, 15, Ui.TEXT2, false);
    libArtist.setSingleLine(true);
    barInfo.addView(libTitle);
    barInfo.addView(libArtist, Ui.margins(Ui.wrap(), c, 0, 4, 0, 0));
    barRow.addView(barInfo, Ui.margins(new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1), c, 16, 0, 12, 0));
    barRow.addView(roundButton(R.drawable.ic_prev, 44, Ui.TRACK, Ui.TEXT, v -> libSend(libCmd("prev"))));
    libPlayButton = roundButton(R.drawable.ic_play, 56, Ui.ACCENT, Ui.ON_ACCENT, v -> {
      libPlaying = !libPlaying;
      updateLibPlayIcon();
      libSend(libCmd("toggle"));
    });
    barRow.addView(libPlayButton, Ui.margins(new LinearLayout.LayoutParams(Ui.dp(c, 56), Ui.dp(c, 56)), c, 10, 0, 10, 0));
    barRow.addView(roundButton(R.drawable.ic_next, 44, Ui.TRACK, Ui.TEXT, v -> libSend(libCmd("next"))));
    bar.addView(barRow);
    libSeek = seekBar(Ui.ACCENT);
    libSeek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
      @Override public void onProgressChanged(SeekBar s, int v, boolean fromUser) {
        if (fromUser) libPosition.setText(time((long) v * 1000));
      }
      @Override public void onStartTrackingTouch(SeekBar s) { libUserSeeking = true; }
      @Override public void onStopTrackingTouch(SeekBar s) {
        libUserSeeking = false;
        libPosMs = (long) s.getProgress() * 1000;
        libPosAt = SystemClock.uptimeMillis();
        libSend(libCmd("seek").put2("positionMs", libPosMs));
      }
    });
    bar.addView(libSeek, Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    LinearLayout libTimes = Ui.row(c);
    libPosition = Ui.text(c, 13, Ui.TEXT2, false);
    libDuration = Ui.text(c, 13, Ui.TEXT2, false);
    libTimes.addView(libPosition);
    libTimes.addView(Ui.spacer(c));
    libTimes.addView(libDuration);
    bar.addView(libTimes, Ui.margins(Ui.matchWrap(), c, 8, 0, 8, 0));
    libPlayer = bar;
    libBody.addView(bar, Ui.margins(Ui.matchWrap(), c, 0, 0, 0, 14));

    // playlists (left) + tracks (right)
    LinearLayout browser = Ui.row(c);
    browser.setBaselineAligned(false);
    LinearLayout plCol = Ui.column(c);
    plCol.addView(Ui.text(c, Ui.s(R.string.media_playlists), 13, Ui.TEXT2, true), Ui.margins(Ui.wrap(), c, 6, 0, 0, 10));
    playlistList = new ListView(c);
    playlistList.setDivider(null);
    playlistList.setDividerHeight(Ui.dp(c, 6));
    playlistList.setAdapter(playlistAdapter);
    playlistList.setOnItemClickListener((parent, v, pos, id) -> selectPlaylist(playlists.get(pos).optString("id")));
    plCol.addView(playlistList, Ui.hweight(1));
    browser.addView(plCol, Ui.weight(1));

    trackList = new ListView(c);
    trackList.setDivider(null);
    trackList.setDividerHeight(Ui.dp(c, 4));
    trackList.setAdapter(trackAdapter);
    trackList.setOnItemClickListener((parent, v, pos, id) -> playTrack(tracks.get(pos).index));
    browser.addView(trackList, Ui.margins(Ui.weight(2f), c, 18, 0, 0, 0));

    libBody.addView(browser, Ui.hweight(1));
    libraryRoot.addView(libBody, Ui.hweight(1));
    content.addView(libraryRoot, matchParent());

    setTab(false);
    onMedia(null);
    onLibrary(null);
  }

  public View view() {
    return root;
  }

  /** Advances the progress bars between the agent's once-a-second updates. */
  public void tick() {
    if (playing && !userSeeking && durMs > 0) {
      long now = posMs + (SystemClock.uptimeMillis() - posAt);
      seek.setProgress((int) (Math.min(now, durMs) / 1000));
      position.setText(time(Math.min(now, durMs)));
    }
    if (libPlaying && !libUserSeeking && libDurMs > 0) {
      long now = libPosMs + (SystemClock.uptimeMillis() - libPosAt);
      libSeek.setProgress((int) (Math.min(now, libDurMs) / 1000));
      libPosition.setText(time(Math.min(now, libDurMs)));
    }
  }

  private void setTab(boolean library) {
    showingLibrary = library;
    playerRow.setVisibility(library ? View.GONE : View.VISIBLE);
    libraryRoot.setVisibility(library ? View.VISIBLE : View.GONE);
    tabPlayer.setBackground(Ui.rounded(library ? Ui.TRACK : Ui.ACCENT, Ui.dp(c, 18)));
    tabPlayer.setTextColor(library ? Ui.TEXT : Ui.ON_ACCENT);
    tabLibrary.setBackground(Ui.rounded(library ? Ui.ACCENT : Ui.TRACK, Ui.dp(c, 18)));
    tabLibrary.setTextColor(library ? Ui.ON_ACCENT : Ui.TEXT);
    if (library && libAvailable && playlists.isEmpty()) loadPlaylists();
  }

  // --- PC player + radio (unchanged behaviour) --------------------------------------

  public void onMedia(JSONObject m) {
    JSONObject cur = m != null ? m.optJSONObject("current") : null;
    renderSessions(m != null ? m.optJSONArray("sessions") : null, cur);
    renderRadio(m != null ? m.optJSONObject("radio") : null, m != null);
    boolean has = cur != null && !cur.optString("title").isEmpty();
    empty.setVisibility(has ? View.GONE : View.VISIBLE);
    player.setVisibility(has ? View.VISIBLE : View.GONE);
    if (m == null) empty.setText(Ui.s(R.string.media_pc_unreachable));
    else empty.setText(Ui.s(R.string.media_nothing));
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
    appVolumeLabel.setText(Ui.s(R.string.media_app_volume, cur.optString("app")));

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
        showArt(art, bmp);
      });
    }
  }

  private void showArt(ImageView iv, Bitmap bmp) {
    if (bmp == null) return;
    iv.clearColorFilter();
    iv.setScaleType(ImageView.ScaleType.CENTER_CROP);
    iv.setImageBitmap(bmp);
  }

  private void renderSessions(JSONArray sessions, JSONObject cur) {
    sessionChips.removeAllViews();
    if (sessions == null || sessions.length() < 2) return; // only worth showing with a choice
    String curId = cur != null ? cur.optString("id") : "";
    for (int i = 0; i < sessions.length(); i++) {
      JSONObject s = sessions.optJSONObject(i);
      boolean on = s.optString("id").equals(curId);
      TextView chip = Ui.text(c, s.optString("app"), 15, on ? Ui.ON_ACCENT : Ui.TEXT, true);
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
      radioStation.setText(Ui.s(R.string.media_radio_off));
      radioMeta.setText("");
      radioSong.setText("");
      radioState.setText(agentUp
          ? Ui.s(R.string.media_radio_off_hint)
          : Ui.s(R.string.media_pc_unreachable));
      return;
    }
    radioStation.setText(r.optString("name"));
    String meta = r.optString("genre");
    if (!r.optString("country").isEmpty()) meta += (meta.isEmpty() ? "" : "  ·  ") + r.optString("country");
    radioMeta.setText(meta);
    String song = r.optString("song");
    radioSong.setText(song.isEmpty() ? Ui.s(R.string.media_no_song) : "♪  " + song);
    radioSong.setTextColor(song.isEmpty() ? Ui.TEXT2 : Ui.TEXT);
    radioState.setText(Ui.s(R.string.media_radio_keys));
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

  // --- library (foobar2000 via Beefweb) ----------------------------------------------

  /** Now-playing state from pc/agent/library.mjs, pushed on every change. */
  public void onLibrary(JSONObject lib) {
    libAvailable = lib != null && lib.optBoolean("available", false);
    libEmpty.setVisibility(libAvailable ? View.GONE : View.VISIBLE);
    libBody.setVisibility(libAvailable ? View.VISIBLE : View.GONE);
    if (!libAvailable) {
      libEmpty.setText(Ui.s(R.string.media_library_unavailable) + "\n" + Ui.s(R.string.media_library_hint));
      libPlaying = false;
      playingPlaylistId = null;
      playingIndex = -1;
      return;
    }
    if (playlists.isEmpty()) loadPlaylists();

    String plId = lib.optString("playlistId", null);
    int idx = lib.optInt("index", -1);
    boolean changed = !java.util.Objects.equals(plId, playingPlaylistId) || idx != playingIndex;
    playingPlaylistId = plId;
    playingIndex = idx;
    if (changed) trackAdapter.notifyDataSetChanged();

    boolean has = plId != null && idx >= 0;
    libPlayer.setVisibility(has ? View.VISIBLE : View.GONE);
    if (!has) {
      libPlaying = false;
      return;
    }
    libTitle.setText(lib.optString("title"));
    String artistOf = lib.optString("artist");
    libArtist.setText(artistOf.isEmpty() ? lib.optString("album") : artistOf);
    libPlaying = "playing".equals(lib.optString("playbackState"));
    updateLibPlayIcon();
    libDurMs = lib.optLong("durationMs");
    libPosMs = lib.optLong("positionMs");
    libPosAt = SystemClock.uptimeMillis();
    if (!libUserSeeking) {
      libSeek.setMax((int) Math.max(1, libDurMs / 1000));
      libSeek.setProgress((int) (libPosMs / 1000));
      libPosition.setText(time(libPosMs));
    }
    libDuration.setText(libDurMs > 0 ? time(libDurMs) : "");

    String key = plId + "#" + idx;
    if (!key.equals(libArtKey)) {
      libArtKey = key;
      libArt.setImageResource(R.drawable.ic_music);
      libArt.setColorFilter(Ui.TEXT2);
      libArt.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
      agent.loadArtPath("/library/art/" + encode(plId) + "/" + idx, bmp -> {
        if (!key.equals(libArtKey)) return;
        showArt(libArt, bmp);
      });
    }
  }

  private void loadPlaylists() {
    agent.get("/library/playlists", (json, error) -> {
      if (error != null || json == null) return;
      JSONArray arr = json.optJSONArray("playlists");
      playlists.clear();
      String pick = null;
      for (int i = 0; arr != null && i < arr.length(); i++) {
        JSONObject pl = arr.optJSONObject(i);
        playlists.add(pl);
        if (pl.optBoolean("current") || pick == null) pick = pl.optString("id");
      }
      playlistAdapter.notifyDataSetChanged();
      if (pick != null && selectedPlaylistId == null) selectPlaylist(pick);
    });
  }

  private void selectPlaylist(String id) {
    selectedPlaylistId = id;
    playlistAdapter.notifyDataSetChanged();
    tracks.clear();
    trackAdapter.notifyDataSetChanged();
    agent.get("/library/playlists/" + encode(id) + "/items?count=300", (json, error) -> {
      if (error != null || json == null || !id.equals(selectedPlaylistId)) return;
      JSONArray arr = json.optJSONArray("items");
      tracks.clear();
      for (int i = 0; arr != null && i < arr.length(); i++) {
        JSONObject it = arr.optJSONObject(i);
        tracks.add(new Track(it.optInt("index"), it.optString("title"), it.optString("artist"), it.optString("length")));
      }
      trackAdapter.notifyDataSetChanged();
    });
  }

  private void playTrack(int index) {
    if (selectedPlaylistId == null) return;
    libSend(libCmd("play").put2("playlistId", selectedPlaylistId).put2("index", index));
  }

  private void libSend(Cmd cmd) {
    agent.libraryCommand(cmd);
  }

  private static Cmd libCmd(String name) {
    return new Cmd().put2("cmd", name);
  }

  private void updateLibPlayIcon() {
    libPlayButton.setImageResource(libPlaying ? R.drawable.ic_pause : R.drawable.ic_play);
  }

  private static String encode(String s) {
    try {
      return URLEncoder.encode(s, "UTF-8");
    } catch (UnsupportedEncodingException e) {
      return s;
    }
  }

  private static final class Track {
    final int index;
    final String title, artist, length;
    Track(int index, String title, String artist, String length) {
      this.index = index;
      this.title = title;
      this.artist = artist;
      this.length = length;
    }
  }

  private final class PlaylistAdapter extends BaseAdapter {
    @Override public int getCount() { return playlists.size(); }
    @Override public Object getItem(int i) { return playlists.get(i); }
    @Override public long getItemId(int i) { return i; }

    @Override
    public View getView(int i, View convert, ViewGroup parent) {
      TextView t;
      if (convert instanceof TextView) {
        t = (TextView) convert;
      } else {
        t = Ui.text(c, 17, Ui.TEXT, true);
        int p = Ui.dp(c, 14);
        t.setPadding(p, p, p, p);
        t.setMaxLines(2);
        convert = t;
      }
      JSONObject pl = playlists.get(i);
      boolean on = pl.optString("id").equals(selectedPlaylistId);
      t.setText(pl.optString("title") + "\n" + Ui.s(R.string.media_tracks_count, pl.optInt("count")));
      t.setTextColor(on ? Ui.ON_ACCENT : Ui.TEXT);
      t.setBackground(Ui.rounded(on ? Ui.ACCENT : Ui.CARD, Ui.dp(c, 14)));
      return t;
    }
  }

  private final class TrackAdapter extends BaseAdapter {
    @Override public int getCount() { return tracks.size(); }
    @Override public Object getItem(int i) { return tracks.get(i); }
    @Override public long getItemId(int i) { return i; }

    @Override
    public View getView(int i, View convert, ViewGroup parent) {
      Holder h;
      if (convert == null) {
        LinearLayout row = Ui.row(c);
        int ph = Ui.dp(c, 14), pv = Ui.dp(c, 10);
        row.setPadding(ph, pv, ph, pv);
        h = new Holder();
        h.icon = new ImageView(c);
        row.addView(h.icon, new LinearLayout.LayoutParams(Ui.dp(c, 20), Ui.dp(c, 20)));
        LinearLayout col = Ui.column(c);
        h.title = Ui.text(c, 17, Ui.TEXT, false);
        h.title.setSingleLine(true);
        h.artist = Ui.text(c, 14, Ui.TEXT2, false);
        h.artist.setSingleLine(true);
        col.addView(h.title);
        col.addView(h.artist, Ui.margins(Ui.wrap(), c, 0, 2, 0, 0));
        row.addView(col, Ui.margins(new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1), c, 12, 0, 8, 0));
        h.length = Ui.text(c, 14, Ui.TEXT2, false);
        row.addView(h.length);
        row.setTag(h);
        convert = row;
      } else {
        h = (Holder) convert.getTag();
      }
      Track t = tracks.get(i);
      boolean current = t.index == playingIndex && selectedPlaylistId != null && selectedPlaylistId.equals(playingPlaylistId);
      h.icon.setVisibility(current ? View.VISIBLE : View.INVISIBLE);
      h.icon.setImageResource(current && libPlaying ? R.drawable.ic_play : R.drawable.ic_pause);
      h.icon.setColorFilter(Ui.ACCENT);
      h.title.setText(t.title);
      h.title.setTextColor(current ? Ui.ACCENT : Ui.TEXT);
      h.artist.setText(t.artist);
      h.length.setText(t.length);
      convert.setBackground(current ? Ui.rounded(Ui.TRACK, Ui.dp(c, 12)) : null);
      return convert;
    }
  }

  private static final class Holder {
    ImageView icon;
    TextView title, artist, length;
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

  private TextView tabChip(String label) {
    TextView t = Ui.text(c, label, 16, Ui.TEXT, true);
    int ph = Ui.dp(c, 20), pv = Ui.dp(c, 10);
    t.setPadding(ph, pv, ph, pv);
    return t;
  }

  private static FrameLayout.LayoutParams matchParent() {
    return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
  }

  private static String time(long ms) {
    long s = ms / 1000;
    return s >= 3600
        ? String.format(Locale.US, "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
        : String.format(Locale.US, "%d:%02d", s / 60, s % 60);
  }
}
