package tr.rigbuddy.ui;

import android.content.Context;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ScrollView;
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
        continue;
      }
      for (int m = 0; m < mods.length(); m++) {
        JSONObject mod = mods.optJSONObject(m);
        if (mod != null) list.addView(row(game.optString("id"), mod), Ui.matchWrap());
      }
    }
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
