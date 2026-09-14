package tr.ets2nav.ui;

import android.content.Context;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;

import tr.ets2nav.R;

/** Launcher-style home: four big tiles with live summaries. */
public final class HomeScreen {
  public interface Actions {
    void open(String screen);
  }

  private final LinearLayout root;
  private final TextView clock, gameClock, subtitle;
  private final TextView navTitle, navLine, navEta;
  private final ManeuverIconView navIcon;
  private final TextView speed, gear, fuelText, rangeText;
  private final ProgressBar fuelBar;
  private final TextView jobTitle, jobLine, jobLine2;
  private final TextView company, money, xp;
  private final LinearLayout nowPlaying;
  private final TextView npTitle, npArtist;
  private final ImageView npButton;

  public HomeScreen(Context c, Actions actions) {
    root = Ui.column(c);
    int pad = Ui.dp(c, 22);
    root.setPadding(pad, pad, pad, pad);

    // header
    LinearLayout header = Ui.row(c);
    clock = Ui.text(c, 46, Ui.TEXT, false);
    header.addView(clock);
    LinearLayout hcol = Ui.column(c);
    gameClock = Ui.text(c, 20, Ui.TEXT, true);
    gameClock.setSingleLine(true);
    subtitle = Ui.text(c, 16, Ui.TEXT2, false);
    subtitle.setSingleLine(true);
    hcol.addView(gameClock, Ui.matchWrap());
    hcol.addView(subtitle, Ui.margins(Ui.matchWrap(), c, 0, 6, 0, 0));
    // take the remaining width so longer texts set later aren't clipped
    LinearLayout.LayoutParams hlp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
    hlp.setMarginStart(Ui.dp(c, 24));
    header.addView(hcol, hlp);

    // now playing (PC music, or the in-game radio)
    nowPlaying = Ui.row(c);
    int np = Ui.dp(c, 10);
    nowPlaying.setPadding(Ui.dp(c, 14), np, np, np);
    nowPlaying.setBackground(Ui.rounded(Ui.CARD, Ui.dp(c, 28)));
    ImageView note = new ImageView(c);
    note.setImageResource(R.drawable.ic_music);
    note.setColorFilter(Ui.ACCENT);
    nowPlaying.addView(note, new LinearLayout.LayoutParams(Ui.dp(c, 26), Ui.dp(c, 26)));
    LinearLayout ncol = Ui.column(c);
    npTitle = Ui.text(c, 17, Ui.TEXT, true);
    npTitle.setSingleLine(true);
    npTitle.setEllipsize(android.text.TextUtils.TruncateAt.END);
    npArtist = Ui.text(c, 14, Ui.TEXT2, false);
    npArtist.setSingleLine(true);
    npArtist.setEllipsize(android.text.TextUtils.TruncateAt.END);
    ncol.addView(npTitle, Ui.matchWrap());
    ncol.addView(npArtist, Ui.margins(Ui.matchWrap(), c, 0, 4, 0, 0));
    nowPlaying.addView(ncol, Ui.margins(new LinearLayout.LayoutParams(Ui.dp(c, 260), LinearLayout.LayoutParams.WRAP_CONTENT), c, 10, 0, 10, 0));
    npButton = new ImageView(c);
    npButton.setImageResource(R.drawable.ic_play);
    npButton.setColorFilter(0xff101316);
    int bp = Ui.dp(c, 8);
    npButton.setPadding(bp, bp, bp, bp);
    npButton.setBackground(Ui.rounded(Ui.ACCENT, Ui.dp(c, 22)));
    nowPlaying.addView(npButton, new LinearLayout.LayoutParams(Ui.dp(c, 44), Ui.dp(c, 44)));
    nowPlaying.setOnClickListener(v -> actions.open("media"));
    nowPlaying.setVisibility(View.GONE);
    header.addView(nowPlaying);
    root.addView(header, Ui.margins(Ui.matchWrap(), c, 4, 0, 0, 18));

    LinearLayout top = Ui.row(c), bottom = Ui.row(c);
    top.setBaselineAligned(false);
    bottom.setBaselineAligned(false);
    root.addView(top, Ui.hweight(1));
    root.addView(bottom, Ui.margins(Ui.hweight(1), c, 0, 16, 0, 0));

    // navigation tile
    LinearLayout nav = tile(c, R.drawable.ic_map, "Navigasyon", Ui.ACCENT);
    LinearLayout navRow = Ui.row(c);
    navIcon = new ManeuverIconView(c, null);
    navIcon.setColor(Ui.TEXT);
    navRow.addView(navIcon, new LinearLayout.LayoutParams(Ui.dp(c, 64), Ui.dp(c, 64)));
    LinearLayout navCol = Ui.column(c);
    navTitle = Ui.text(c, 30, Ui.TEXT, true);
    navLine = Ui.text(c, 18, Ui.TEXT2, false);
    navCol.addView(navTitle);
    navCol.addView(navLine, Ui.margins(Ui.wrap(), c, 0, 6, 0, 0));
    navRow.addView(navCol, Ui.margins(Ui.wrap(), c, 14, 0, 0, 0));
    nav.addView(navRow, Ui.margins(Ui.matchWrap(), c, 0, 14, 0, 0));
    nav.addView(Ui.spacer(c), Ui.hweight(1));
    navEta = Ui.text(c, 20, Ui.GREEN, true);
    nav.addView(navEta);
    nav.setOnClickListener(v -> actions.open("map"));
    top.addView(nav, Ui.weight(1.25f));

    // vehicle tile
    LinearLayout veh = tile(c, R.drawable.ic_truck, "Araç", Ui.YELLOW);
    LinearLayout vrow = Ui.row(c);
    speed = Ui.text(c, 56, Ui.TEXT, false);
    vrow.addView(speed);
    TextView unit = Ui.text(c, "km/s", 18, Ui.TEXT2, false);
    vrow.addView(unit, Ui.margins(Ui.wrap(), c, 8, 0, 0, 0));
    vrow.addView(Ui.spacer(c));
    gear = Ui.text(c, 40, Ui.ACCENT, true);
    vrow.addView(gear);
    veh.addView(vrow, Ui.margins(Ui.matchWrap(), c, 0, 10, 0, 0));
    veh.addView(Ui.spacer(c), Ui.hweight(1));
    LinearLayout frow = Ui.row(c);
    fuelText = Ui.text(c, 17, Ui.TEXT, false);
    rangeText = Ui.text(c, 17, Ui.TEXT2, false);
    frow.addView(fuelText);
    frow.addView(Ui.spacer(c));
    frow.addView(rangeText);
    veh.addView(frow);
    fuelBar = Ui.bar(c, Ui.GREEN);
    veh.addView(fuelBar, Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    veh.setOnClickListener(v -> actions.open("vehicle"));
    top.addView(veh, Ui.margins(Ui.weight(1), c, 16, 0, 0, 0));

    // job tile
    LinearLayout job = tile(c, R.drawable.ic_work, "İş", Ui.GREEN);
    jobTitle = Ui.text(c, 24, Ui.TEXT, true);
    jobLine = Ui.text(c, 18, Ui.TEXT2, false);
    jobLine2 = Ui.text(c, 18, Ui.TEXT2, false);
    job.addView(jobTitle, Ui.margins(Ui.matchWrap(), c, 0, 14, 0, 0));
    job.addView(jobLine, Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    job.addView(jobLine2, Ui.margins(Ui.matchWrap(), c, 0, 6, 0, 0));
    job.setOnClickListener(v -> actions.open("jobs"));
    bottom.addView(job, Ui.weight(1.25f));

    // profile tile
    LinearLayout prof = tile(c, R.drawable.ic_person, "Profil", 0xffc58af9);
    company = Ui.text(c, 22, Ui.TEXT, true);
    money = Ui.text(c, 32, Ui.GREEN, false);
    xp = Ui.text(c, 16, Ui.TEXT2, false);
    prof.addView(company, Ui.margins(Ui.matchWrap(), c, 0, 14, 0, 0));
    prof.addView(money, Ui.margins(Ui.matchWrap(), c, 0, 10, 0, 0));
    prof.addView(xp, Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    prof.setOnClickListener(v -> actions.open("profile"));
    bottom.addView(prof, Ui.margins(Ui.weight(1), c, 16, 0, 0, 0));

    setNav(null, null, null, Integer.MIN_VALUE);
    onTelemetry(null);
    setProfile(null, null);
    tick();
  }

  private static LinearLayout tile(Context c, int icon, String title, int color) {
    LinearLayout t = Ui.card(c, true);
    LinearLayout head = Ui.row(c);
    ImageView iv = new ImageView(c);
    iv.setImageResource(icon);
    iv.setColorFilter(color);
    head.addView(iv, new LinearLayout.LayoutParams(Ui.dp(c, 28), Ui.dp(c, 28)));
    TextView tv = Ui.text(c, title, 18, color, true);
    head.addView(tv, Ui.margins(Ui.wrap(), c, 10, 0, 0, 0));
    t.addView(head);
    return t;
  }

  public View view() {
    return root;
  }

  /** Called every second or so. */
  public void tick() {
    clock.setText(new SimpleDateFormat("HH:mm", Ui.TR).format(new Date()));
  }

  public void setNav(String title, String line, String eta, int direction) {
    if (title == null) {
      navTitle.setText("Rota yok");
      navLine.setText("Harita · uzun bas: hedef seç");
      navEta.setText("");
      navIcon.setVisibility(View.GONE);
      return;
    }
    navIcon.setVisibility(View.VISIBLE);
    navIcon.setDirection(direction);
    navTitle.setText(title);
    navLine.setText(line);
    navEta.setText(eta);
  }

  public void onTelemetry(JSONObject t) {
    if (t == null) {
      gameClock.setText("Oyun bağlı değil");
      subtitle.setText("PC'de ETS2 Nav'ı ve oyunu başlatın");
      speed.setText("–");
      gear.setText("");
      fuelText.setText("Yakıt –");
      rangeText.setText("");
      Ui.setBar(fuelBar, 0, Ui.GREEN);
      jobTitle.setText("Aktif iş yok");
      jobLine.setText("İş ilanlarını görmek için dokunun");
      jobLine2.setText("");
      return;
    }
    JSONObject truck = t.optJSONObject("truck");
    gameClock.setText("Oyun saati  " + Ui.gameClock(t.optLong("gameTime")) + (t.optBoolean("paused") ? "  · duraklatıldı" : ""));
    subtitle.setText(truck.optString("brand") + " " + truck.optString("model") + "  ·  " + truck.optString("plate"));
    speed.setText(String.valueOf(Math.round(Math.abs(truck.optDouble("speedKph")))));
    gear.setText(gearText(truck.optInt("gear")));
    JSONObject fuel = truck.optJSONObject("fuel");
    double frac = fuel.optDouble("liters") / Math.max(1, fuel.optDouble("capacity"));
    fuelText.setText("Yakıt " + Math.round(frac * 100) + "%");
    rangeText.setText(Ui.number(fuel.optDouble("rangeKm")) + " km menzil");
    Ui.setBar(fuelBar, frac, frac < 0.15 ? Ui.RED : frac < 0.3 ? Ui.YELLOW : Ui.GREEN);

    JSONObject job = t.optJSONObject("job");
    if (job == null) {
      jobTitle.setText("Aktif iş yok");
      jobLine.setText("İş ilanlarını görmek için dokunun");
      jobLine2.setText("");
    } else {
      jobTitle.setText(job.optString("cargo") + " · " + job.optDouble("massT") + " t");
      jobLine.setText("→ " + job.optString("destination"));
      long left = job.optLong("deliveryTime") - t.optLong("gameTime");
      jobLine2.setText(Ui.money(job.optDouble("income"), currency(t)) + "  ·  teslime " + Ui.duration(left));
    }
  }

  public void setProfile(JSONObject p, String error) {
    if (p == null) {
      company.setText("Profil");
      money.setText("–");
      xp.setText(error != null ? error : "Kayıt dosyası bekleniyor");
      return;
    }
    company.setText(p.optString("company", p.optString("name")));
    money.setText(Ui.money(p.optDouble("money"), p.optString("currency", "€")));
    xp.setText(Ui.number(p.optDouble("experience")) + " XP  ·  " + p.optInt("trucks") + " kamyon");
  }

  /**
   * PC music takes priority; otherwise the in-game radio. The button toggles
   * PC playback (radio control needs key emulation, not built yet).
   */
  public void setNowPlaying(JSONObject media, Runnable toggle) {
    JSONObject cur = media != null ? media.optJSONObject("current") : null;
    JSONObject radio = media != null ? media.optJSONObject("radio") : null;
    if (cur != null && !cur.optString("title").isEmpty()) {
      nowPlaying.setVisibility(View.VISIBLE);
      npTitle.setText(cur.optString("title"));
      String a = cur.optString("artist");
      npArtist.setText(a.isEmpty() ? cur.optString("app") : a);
      boolean playing = "playing".equals(cur.optString("status"));
      npButton.setImageResource(playing ? R.drawable.ic_pause : R.drawable.ic_play);
      npButton.setVisibility(View.VISIBLE);
      npButton.setOnClickListener(v -> toggle.run());
    } else if (radio != null) {
      nowPlaying.setVisibility(View.VISIBLE);
      String song = radio.optString("song");
      npTitle.setText(song.isEmpty() ? radio.optString("name") : song);
      npArtist.setText(song.isEmpty() ? "Oyun radyosu" : radio.optString("name"));
      npButton.setVisibility(View.GONE);
    } else {
      nowPlaying.setVisibility(View.GONE);
    }
  }

  public static String gearText(int g) {
    return g > 0 ? String.valueOf(g) : g < 0 ? "R" + (-g) : "N";
  }

  public static String currency(JSONObject telemetry) {
    return telemetry != null && "ats".equals(telemetry.optString("game")) ? "$" : "€";
  }
}
