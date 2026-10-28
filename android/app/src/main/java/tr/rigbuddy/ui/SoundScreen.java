package tr.rigbuddy.ui;

import android.content.Context;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import tr.rigbuddy.R;
import tr.rigbuddy.agent.AgentClient;

/**
 * The sound mods of the PC's sound plugin: every mod in each game's plugin folder with an on/off switch. The PC agent
 * (pc/agent/sound.mjs) writes the list the plugin watches, so a switch takes effect in the running game within a second.
 */
public final class SoundScreen {
  private final Context c;
  private final AgentClient agent;
  private final LinearLayout root, list;
  private final TextView status;
  private long lastLoad;

  public SoundScreen(Context c, AgentClient agent) {
    this.c = c;
    this.agent = agent;
    root = Ui.column(c);
    int pad = Ui.dp(c, 18);
    root.setPadding(pad, pad, pad, pad);

    LinearLayout card = Ui.card(c, false);
    card.addView(Ui.text(c, Ui.s(R.string.sound_title), 24, Ui.TEXT, true));
    card.addView(Ui.text(c, Ui.s(R.string.sound_hint), 15, Ui.TEXT2, false), Ui.margins(Ui.matchWrap(), c, 0, 6, 0, 10));
    list = Ui.column(c);
    ScrollView scroll = new ScrollView(c);
    scroll.addView(list);
    card.addView(scroll, Ui.hweight(1));
    status = Ui.text(c, 14, Ui.TEXT2, false);
    card.addView(status, Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    root.addView(card, Ui.hweight(1));
  }

  public android.view.View view() {
    return root;
  }

  /** The screen was opened: refresh the list when it is not fresh. */
  public void onShown() {
    if (System.currentTimeMillis() - lastLoad > 10_000) load();
  }

  public void load() {
    agent.get("/sound", (json, error) -> {
      lastLoad = System.currentTimeMillis();
      render(json, error);
    });
  }

  private void render(JSONObject json, String error) {
    list.removeAllViews();
    if (json == null) {
      status.setText(error != null ? error : "");
      return;
    }
    JSONArray games = json.optJSONArray("games");
    if (games == null || games.length() == 0) {
      status.setText(Ui.s(R.string.sound_none));
      return;
    }
    status.setText("");
    for (int g = 0; g < games.length(); g++) {
      JSONObject game = games.optJSONObject(g);
      if (game == null) continue;
      list.addView(Ui.text(c, game.optString("name"), 17, Ui.ACCENT, true), Ui.margins(Ui.matchWrap(), c, 0, g == 0 ? 0 : 18, 0, 6));
      JSONArray mods = game.optJSONArray("mods");
      if (mods == null || mods.length() == 0) {
        list.addView(Ui.text(c, Ui.s(R.string.sound_no_mods), 15, Ui.TEXT2, false));
      } else {
        for (int m = 0; m < mods.length(); m++) {
          JSONObject mod = mods.optJSONObject(m);
          if (mod != null) list.addView(row(game.optString("id"), mod), Ui.matchWrap());
        }
      }
      JSONObject levels = game.optJSONObject("levels");
      if (levels != null) {
        list.addView(Ui.text(c, Ui.s(R.string.sound_levels), 15, Ui.TEXT2, true), Ui.margins(Ui.matchWrap(), c, 0, 14, 0, 2));
        for (int i = 0; i < LEVEL_KEYS.length; i++) {
          list.addView(level(game.optString("id"), LEVEL_KEYS[i], LEVEL_LABELS[i], levels.optDouble(LEVEL_KEYS[i], 0.5)), Ui.matchWrap());
        }
      }
    }
  }

  // the volumes of the sound plugin (sound_levels.txt), in the order they are shown
  private static final String[] LEVEL_KEYS = {"master", "engine", "exhaust", "turbo", "interior", "navigation", "exterior_when_windows_closed"};
  private static final int[] LEVEL_LABELS = {R.string.lv_master, R.string.lv_engine, R.string.lv_exhaust, R.string.lv_turbo,
      R.string.lv_interior, R.string.lv_navigation, R.string.lv_outside};

  /** One volume: a label with its percentage and a slider from 0 to 150 %. It is sent when the finger lets go. */
  private LinearLayout level(String gameId, String key, int labelRes, double value) {
    LinearLayout box = Ui.column(c);
    box.setPadding(0, Ui.dp(c, 6), 0, Ui.dp(c, 2));
    LinearLayout head = Ui.row(c);
    TextView label = Ui.text(c, Ui.s(labelRes), 17, Ui.TEXT, false);
    TextView percent = Ui.text(c, 17, Ui.TEXT2, false);
    head.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
    head.addView(percent);
    box.addView(head);
    SeekBar bar = new SeekBar(c);
    bar.setMax(150);
    bar.setProgress((int) Math.round(value * 100));
    percent.setText(bar.getProgress() + " %");
    bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
      @Override public void onProgressChanged(SeekBar s, int progress, boolean fromUser) {
        percent.setText(progress + " %");
      }

      @Override public void onStartTrackingTouch(SeekBar s) {}

      @Override public void onStopTrackingTouch(SeekBar s) {
        JSONObject body = new JSONObject();
        try {
          body.put("game", gameId).put("level", key).put("value", s.getProgress() / 100.0);
        } catch (JSONException e) {
          throw new IllegalStateException(e);
        }
        // no redraw with the answer: the slider already shows the value; only a failure is said
        agent.post("/sound", body, (json, error) -> status.setText(error != null ? error : ""));
      }
    });
    box.addView(bar, Ui.matchWrap());
    return box;
  }

  private LinearLayout row(String gameId, JSONObject mod) {
    String name = mod.optString("name");
    LinearLayout row = Ui.row(c);
    row.setGravity(Gravity.CENTER_VERTICAL);
    row.setMinimumHeight(Ui.dp(c, 56));
    LinearLayout texts = Ui.column(c);
    texts.addView(Ui.text(c, name, 20, Ui.TEXT, false));
    if (!mod.optBoolean("guids", true)) {
      texts.addView(Ui.text(c, Ui.s(R.string.sound_no_guids), 13, Ui.RED, false));
    }
    row.addView(texts, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)); // (Ui.hweight is for columns: it made the height 0)

    Switch sw = new Switch(c);
    sw.setChecked(mod.optBoolean("active"));
    sw.setOnCheckedChangeListener((button, on) -> {
      button.setEnabled(false);
      JSONObject body = new JSONObject();
      try {
        body.put("game", gameId).put("mod", name).put("active", on);
      } catch (JSONException e) {
        throw new IllegalStateException(e);
      }
      agent.post("/sound", body, (json, error) -> {
        if (json == null) status.setText(error != null ? error : "");
        // the answer is the new list (or, on an error, ask again): the switches show what the PC has
        if (json != null) render(json, null);
        else load();
      });
    });
    row.addView(sw);
    return row;
  }
}
