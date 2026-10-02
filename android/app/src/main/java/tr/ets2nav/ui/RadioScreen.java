package tr.ets2nav.ui;

import android.content.Context;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import tr.ets2nav.R;

/** The station and song of the in-game radio, as the PC agent detects them (pc/agent/radio.mjs). */
public final class RadioScreen {
  private final LinearLayout root;
  private final TextView station, meta, song, state;

  public RadioScreen(Context c) {
    root = Ui.column(c);
    int pad = Ui.dp(c, 18);
    root.setPadding(pad, pad, pad, pad);

    LinearLayout card = Ui.card(c, false);
    LinearLayout head = Ui.row(c);
    ImageView icon = new ImageView(c);
    icon.setImageResource(R.drawable.ic_radio);
    icon.setColorFilter(Ui.YELLOW);
    head.addView(icon, new LinearLayout.LayoutParams(Ui.dp(c, 26), Ui.dp(c, 26)));
    head.addView(Ui.text(c, Ui.s(R.string.media_radio), 15, Ui.TEXT2, true), Ui.margins(Ui.wrap(), c, 8, 0, 0, 0));
    card.addView(head);

    station = Ui.text(c, 40, Ui.TEXT, true);
    meta = Ui.text(c, 20, Ui.TEXT2, false);
    song = Ui.text(c, 28, Ui.TEXT, false);
    song.setMaxLines(4);
    state = Ui.text(c, 16, Ui.TEXT2, false);
    card.addView(station, Ui.margins(Ui.matchWrap(), c, 0, 28, 0, 0));
    card.addView(meta, Ui.margins(Ui.matchWrap(), c, 0, 10, 0, 0));
    card.addView(song, Ui.margins(Ui.matchWrap(), c, 0, 34, 0, 0));
    card.addView(Ui.spacer(c), Ui.hweight(1));
    card.addView(state);
    root.addView(card, Ui.hweight(1));

    onRadio(null, false);
  }

  public View view() {
    return root;
  }

  /**
   * The station playing in the game, or null: the radio is off, or the PC can't be
   * reached (agentUp tells which).
   */
  public void onRadio(JSONObject r, boolean agentUp) {
    if (r == null) {
      station.setText(Ui.s(R.string.media_radio_off));
      meta.setText("");
      song.setText("");
      state.setText(agentUp ? Ui.s(R.string.media_radio_off_hint) : Ui.s(R.string.media_pc_unreachable));
      return;
    }
    station.setText(r.optString("name"));
    String m = r.optString("genre");
    if (!r.optString("country").isEmpty()) m += (m.isEmpty() ? "" : "  ·  ") + r.optString("country");
    meta.setText(m);
    String s = r.optString("song");
    song.setText(s.isEmpty() ? Ui.s(R.string.media_no_song) : "♪  " + s);
    song.setTextColor(s.isEmpty() ? Ui.TEXT2 : Ui.TEXT);
    state.setText(Ui.s(R.string.media_radio_keys));
  }
}
