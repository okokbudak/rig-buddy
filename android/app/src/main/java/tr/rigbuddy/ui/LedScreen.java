package tr.rigbuddy.ui;

import tr.rigbuddy.R;

import android.content.Context;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import tr.rigbuddy.agent.AgentClient;

/**
 * The LED menu: for each Octopus board that Studio on the PC knows, switch "Studio drives the LEDs" (the game sync),
 * brightness, "dark without a game" and the presets saved in Studio's LED tab. The PC agent does the work
 * (GET / POST /leds); everything here is saved on the PC like an edit in Studio.
 */
public final class LedScreen {
  private final Context c;
  private final AgentClient agent;
  private final LinearLayout root, boards;
  private final TextView status;

  public LedScreen(Context c, AgentClient agent) {
    this.c = c;
    this.agent = agent;
    root = Ui.column(c);
    int pad = Ui.dp(c, 18);
    root.setPadding(pad, pad, pad, pad);
    root.addView(Ui.text(c, Ui.s(R.string.led_title), 22, Ui.TEXT, true), Ui.margins(Ui.matchWrap(), c, 4, 0, 0, 12));
    status = Ui.text(c, 18, Ui.TEXT2, false);
    root.addView(status, Ui.margins(Ui.matchWrap(), c, 4, 0, 0, 12));
    boards = Ui.column(c);
    ScrollView sv = new ScrollView(c);
    sv.addView(boards);
    root.addView(sv, Ui.hweight(1));
    status.setText(Ui.s(R.string.loading));
  }

  public View view() {
    return root;
  }

  /** The screen came up: ask the PC. */
  public void onShown() {
    agent.get("/leds", (json, error) -> show(json, error));
  }

  private void show(JSONObject json, String error) {
    boards.removeAllViews();
    if (json == null) {
      status.setText(error);
      return;
    }
    JSONArray list = json.optJSONArray("boards");
    if (list == null || list.length() == 0) {
      status.setText(Ui.s(R.string.led_none));
      return;
    }
    status.setText("");
    for (int i = 0; i < list.length(); i++) boards.addView(card(list.optJSONObject(i)), Ui.margins(Ui.matchWrap(), c, 0, 0, 0, 14));
  }

  private void send(JSONObject body) {
    agent.post("/leds", body, (json, error) -> show(json, error));
  }

  private JSONObject body(String id, String key, Object value) {
    try {
      return new JSONObject().put("id", id).put(key, value);
    } catch (org.json.JSONException e) {
      return new JSONObject();
    }
  }

  private LinearLayout card(JSONObject b) {
    final String id = b.optString("id");
    LinearLayout card = Ui.card(c, false);
    LinearLayout head = Ui.row(c);
    head.addView(Ui.text(c, b.optString("name"), 22, Ui.TEXT, true));
    head.addView(Ui.spacer(c));
    boolean connected = b.optBoolean("connected");
    head.addView(Ui.text(c, connected ? Ui.s(b.optBoolean("lit") ? R.string.led_lit : R.string.led_dark) : Ui.s(R.string.led_offline), 16,
        connected && b.optBoolean("lit") ? Ui.GREEN : Ui.TEXT2, false));
    card.addView(head);

    Switch sync = new Switch(c);
    sync.setText(Ui.s(R.string.led_sync));
    sync.setTextColor(Ui.TEXT);
    sync.setTextSize(18);
    sync.setChecked(b.optBoolean("enabled"));
    sync.setOnCheckedChangeListener((v, on) -> { if (v.isPressed()) send(body(id, "enabled", on)); });
    card.addView(sync, Ui.margins(Ui.matchWrap(), c, 0, 16, 0, 0));

    card.addView(Ui.text(c, Ui.s(R.string.led_brightness), 15, Ui.TEXT2, true), Ui.margins(Ui.matchWrap(), c, 0, 18, 0, 0));
    SeekBar bri = new SeekBar(c);
    bri.setMax(255);
    bri.setProgress(b.optInt("bri", 255));
    bri.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
      @Override public void onProgressChanged(SeekBar s, int p, boolean user) {}
      @Override public void onStartTrackingTouch(SeekBar s) {}
      @Override public void onStopTrackingTouch(SeekBar s) { send(body(id, "bri", s.getProgress())); }
    });
    card.addView(bri, Ui.margins(Ui.matchWrap(), c, 0, 6, 0, 0));

    Switch sleep = new Switch(c);
    sleep.setText(Ui.s(R.string.led_sleep));
    sleep.setTextColor(Ui.TEXT);
    sleep.setTextSize(18);
    sleep.setChecked(b.optBoolean("sleep"));
    sleep.setOnCheckedChangeListener((v, on) -> { if (v.isPressed()) send(body(id, "sleep", on)); });
    card.addView(sleep, Ui.margins(Ui.matchWrap(), c, 0, 18, 0, 0));

    card.addView(Ui.text(c, Ui.s(R.string.led_presets), 15, Ui.TEXT2, true), Ui.margins(Ui.matchWrap(), c, 0, 22, 0, 0));
    JSONArray presets = b.optJSONArray("presets");
    String active = b.optString("active");
    if (presets == null || presets.length() == 0) {
      card.addView(Ui.text(c, Ui.s(R.string.led_no_presets), 16, Ui.TEXT2, false), Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    } else {
      for (int i = 0; i < presets.length(); i++) {
        final String name = presets.optString(i);
        boolean on = name.equals(active);
        TextView chip = Ui.text(c, name, 18, on ? Ui.ON_ACCENT : Ui.TEXT, true);
        chip.setGravity(Gravity.CENTER_VERTICAL);
        int px = Ui.dp(c, 16), py = Ui.dp(c, 12);
        chip.setPadding(px, py, px, py);
        chip.setBackground(Ui.rounded(on ? Ui.ACCENT : Ui.CARD_PRESSED, Ui.dp(c, 12)));
        chip.setClickable(true);
        chip.setOnClickListener(v -> send(body(id, "preset", name)));
        card.addView(chip, Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
      }
    }
    return card;
  }
}
