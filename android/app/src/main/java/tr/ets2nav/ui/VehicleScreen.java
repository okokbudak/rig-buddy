package tr.ets2nav.ui;

import android.content.Context;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

/** "Trip computer": everything the telemetry SDK tells us about the truck, OBD-style. */
public final class VehicleScreen {
  private final LinearLayout root;
  private final TextView title, speed, limit, cruise, gear, rpm;
  private final ProgressBar rpmBar;
  private final Map<String, TextView> chips = new LinkedHashMap<>();
  private final Map<String, TextView> values = new LinkedHashMap<>();
  private final Map<String, ProgressBar> bars = new LinkedHashMap<>();
  private final TextView empty;
  private final LinearLayout content;

  public VehicleScreen(Context c) {
    root = Ui.column(c);
    int pad = Ui.dp(c, 18);
    root.setPadding(pad, pad, pad, pad);
    title = Ui.text(c, 22, Ui.TEXT, true);
    root.addView(title, Ui.margins(Ui.matchWrap(), c, 4, 0, 0, 14));
    empty = Ui.text(c, "Oyundan veri gelmiyor.\nPC'de Rig Buddy'yi başlatıp oyuna girin.", 22, Ui.TEXT2, false);
    empty.setGravity(Gravity.CENTER);
    root.addView(empty, Ui.hweight(1));

    content = Ui.row(c);
    content.setBaselineAligned(false);
    root.addView(content, Ui.hweight(1));

    // --- driving
    LinearLayout drive = Ui.card(c, false);
    drive.addView(Ui.text(c, "SÜRÜŞ", 15, Ui.TEXT2, true));
    LinearLayout srow = Ui.row(c);
    speed = Ui.text(c, 84, Ui.TEXT, false);
    srow.addView(speed);
    LinearLayout scol = Ui.column(c);
    scol.addView(Ui.text(c, "km/s", 18, Ui.TEXT2, false));
    limit = Ui.text(c, 18, Ui.RED, true);
    scol.addView(limit, Ui.margins(Ui.wrap(), c, 0, 8, 0, 0));
    srow.addView(scol, Ui.margins(Ui.wrap(), c, 10, 0, 0, 0));
    srow.addView(Ui.spacer(c));
    gear = Ui.text(c, 64, Ui.ACCENT, true);
    srow.addView(gear);
    drive.addView(srow, Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    cruise = Ui.text(c, 18, Ui.TEXT2, false);
    drive.addView(cruise, Ui.margins(Ui.matchWrap(), c, 0, 6, 0, 0));
    rpm = Ui.text(c, 18, Ui.TEXT, false);
    drive.addView(rpm, Ui.margins(Ui.matchWrap(), c, 0, 18, 0, 6));
    rpmBar = Ui.bar(c, Ui.ACCENT);
    drive.addView(rpmBar);
    drive.addView(Ui.spacer(c), Ui.hweight(1));
    drive.addView(chipRow(c, "engine", "Motor", "electric", "Kontak", "parking", "El freni"));
    drive.addView(chipRow(c, "motorBrake", "Motor freni", "retarder", "Retarder", "diff", "Dif. kilit"), Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    content.addView(drive, Ui.weight(1.1f));

    // --- engine & fuel
    LinearLayout eng = Ui.card(c, false);
    eng.addView(Ui.text(c, "MOTOR VE YAKIT", 15, Ui.TEXT2, true));
    barRow(c, eng, "fuel", "Yakıt");
    valueRow(c, eng, "range", "Menzil");
    valueRow(c, eng, "consumption", "Ortalama tüketim");
    barRow(c, eng, "adblue", "AdBlue");
    valueRow(c, eng, "water", "Soğutma suyu");
    valueRow(c, eng, "oilTemp", "Yağ sıcaklığı");
    valueRow(c, eng, "oilPressure", "Yağ basıncı");
    valueRow(c, eng, "battery", "Akü");
    valueRow(c, eng, "air", "Fren hava basıncı");
    valueRow(c, eng, "brakeTemp", "Fren sıcaklığı");
    content.addView(eng, Ui.margins(Ui.weight(1), c, 14, 0, 0, 0));

    // --- condition
    LinearLayout cond = Ui.card(c, false);
    cond.addView(Ui.text(c, "DURUM", 15, Ui.TEXT2, true));
    barRow(c, cond, "dmgEngine", "Motor hasarı");
    barRow(c, cond, "dmgTransmission", "Şanzıman");
    barRow(c, cond, "dmgCabin", "Kabin");
    barRow(c, cond, "dmgChassis", "Şasi");
    barRow(c, cond, "dmgWheels", "Tekerler");
    barRow(c, cond, "dmgTrailer", "Dorse");
    barRow(c, cond, "dmgCargo", "Yük");
    valueRow(c, cond, "odometer", "Kilometre");
    cond.addView(Ui.spacer(c), Ui.hweight(1));
    cond.addView(chipRow(c, "low", "Kısa far", "high", "Uzun far", "beacon", "Tepe lambası"));
    cond.addView(chipRow(c, "hazard", "Dörtlü", "wipers", "Silecek", "trailer", "Dorse bağlı"), Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    content.addView(cond, Ui.margins(Ui.weight(1), c, 14, 0, 0, 0));

    onTelemetry(null);
  }

  public View view() {
    return root;
  }

  private LinearLayout chipRow(Context c, String... keysAndLabels) {
    LinearLayout r = Ui.row(c);
    for (int i = 0; i < keysAndLabels.length; i += 2) {
      TextView chip = Ui.text(c, keysAndLabels[i + 1], 15, Ui.TEXT2, true);
      chip.setGravity(Gravity.CENTER);
      int p = Ui.dp(c, 8);
      chip.setPadding(p, p, p, p);
      chip.setBackground(Ui.rounded(Ui.TRACK, Ui.dp(c, 10)));
      LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1);
      if (i > 0) lp.setMarginStart(Ui.dp(c, 8));
      r.addView(chip, lp);
      chips.put(keysAndLabels[i], chip);
    }
    return r;
  }

  private void valueRow(Context c, LinearLayout parent, String key, String label) {
    LinearLayout r = Ui.row(c);
    r.addView(Ui.text(c, label, 17, Ui.TEXT2, false));
    r.addView(Ui.spacer(c));
    TextView v = Ui.text(c, 19, Ui.TEXT, true);
    r.addView(v);
    values.put(key, v);
    parent.addView(r, Ui.margins(Ui.matchWrap(), c, 0, 11, 0, 0));
  }

  private void barRow(Context c, LinearLayout parent, String key, String label) {
    valueRow(c, parent, key, label);
    ProgressBar b = Ui.bar(c, Ui.GREEN);
    bars.put(key, b);
    parent.addView(b, Ui.margins(Ui.matchWrap(), c, 0, 5, 0, 0));
  }

  private void chip(String key, boolean on, int color) {
    TextView t = chips.get(key);
    t.setTextColor(on ? 0xff101316 : Ui.TEXT2);
    t.setBackground(Ui.rounded(on ? color : Ui.TRACK, Ui.dp(t.getContext(), 10)));
  }

  private void value(String key, String text, boolean warn) {
    TextView v = values.get(key);
    v.setText(text);
    v.setTextColor(warn ? Ui.RED : Ui.TEXT);
  }

  /** Fill bar (0..1 = more is better) or damage bar (percent, more is worse). */
  private void level(String key, double fraction, String text) {
    Ui.setBar(bars.get(key), fraction, fraction < 0.15 ? Ui.RED : fraction < 0.3 ? Ui.YELLOW : Ui.GREEN);
    value(key, text, fraction < 0.15);
  }

  private void damage(String key, double percent) {
    Ui.setBar(bars.get(key), percent / 100, percent > 30 ? Ui.RED : percent > 10 ? Ui.YELLOW : Ui.GREEN);
    value(key, String.format(Locale.US, "%.1f%%", percent), percent > 30);
  }

  public void onTelemetry(JSONObject t) {
    boolean has = t != null;
    empty.setVisibility(has ? View.GONE : View.VISIBLE);
    content.setVisibility(has ? View.VISIBLE : View.GONE);
    if (!has) {
      title.setText("Araç bilgisayarı");
      return;
    }
    JSONObject tr = t.optJSONObject("truck");
    title.setText(tr.optString("brand") + " " + tr.optString("model") + "   ·   " + tr.optString("plate"));
    speed.setText(String.valueOf(Math.round(Math.abs(tr.optDouble("speedKph")))));
    JSONObject nav = t.optJSONObject("navigation");
    double lim = nav != null ? nav.optDouble("speedLimitKph") : 0;
    limit.setText(lim > 0 ? "Limit " + Math.round(lim) : "");
    JSONObject cc = tr.optJSONObject("cruise");
    cruise.setText(cc != null && cc.optBoolean("enabled") ? "Hız sabitleyici  " + Math.round(cc.optDouble("kph")) + " km/s" : "Hız sabitleyici kapalı");
    cruise.setTextColor(cc != null && cc.optBoolean("enabled") ? Ui.GREEN : Ui.TEXT2);
    gear.setText(HomeScreen.gearText(tr.optInt("gear")));
    double r = tr.optDouble("rpm"), rmax = Math.max(1, tr.optDouble("rpmMax", 2500));
    rpm.setText(Ui.number(r) + " dev/dk");
    Ui.setBar(rpmBar, r / rmax, r / rmax > 0.85 ? Ui.RED : Ui.ACCENT);

    chip("engine", tr.optBoolean("engineOn"), Ui.GREEN);
    chip("electric", tr.optBoolean("electricOn"), Ui.GREEN);
    chip("parking", tr.optBoolean("parkingBrake"), Ui.RED);
    chip("motorBrake", tr.optBoolean("motorBrake"), Ui.ACCENT);
    JSONObject ret = tr.optJSONObject("retarder");
    int retLevel = ret != null ? ret.optInt("level") : 0;
    chip("retarder", retLevel > 0, Ui.ACCENT);
    chips.get("retarder").setText(retLevel > 0 ? "Retarder " + retLevel : "Retarder");
    chip("diff", tr.optBoolean("diffLock"), Ui.YELLOW);

    JSONObject fuel = tr.optJSONObject("fuel");
    double ff = fuel.optDouble("liters") / Math.max(1, fuel.optDouble("capacity"));
    level("fuel", ff, Math.round(fuel.optDouble("liters")) + " / " + Math.round(fuel.optDouble("capacity")) + " L");
    value("range", Ui.number(fuel.optDouble("rangeKm")) + " km", ff < 0.15);
    value("consumption", String.format(Locale.US, "%.1f L/100 km", fuel.optDouble("avgLPer100")), false);
    JSONObject ad = tr.optJSONObject("adBlue");
    double af = ad.optDouble("liters") / Math.max(1, ad.optDouble("capacity"));
    level("adblue", af, Math.round(ad.optDouble("liters")) + " / " + Math.round(ad.optDouble("capacity")) + " L");
    JSONObject water = tr.optJSONObject("waterTemp");
    value("water", Math.round(water.optDouble("value")) + " °C", water.optBoolean("warning"));
    value("oilTemp", Math.round(tr.optDouble("oilTemp")) + " °C", false);
    JSONObject oil = tr.optJSONObject("oilPressure");
    value("oilPressure", String.format(Locale.US, "%.1f psi", oil.optDouble("value")), oil.optBoolean("warning"));
    JSONObject bat = tr.optJSONObject("battery");
    value("battery", String.format(Locale.US, "%.1f V", bat.optDouble("volts")), bat.optBoolean("warning"));
    JSONObject air = tr.optJSONObject("airPressure");
    value("air", String.format(Locale.US, "%.0f psi", air.optDouble("value")), air.optBoolean("warning") || air.optBoolean("emergency"));
    value("brakeTemp", Math.round(tr.optDouble("brakeTemp")) + " °C", tr.optDouble("brakeTemp") > 300);

    JSONObject dmg = tr.optJSONObject("damage");
    damage("dmgEngine", dmg.optDouble("engine"));
    damage("dmgTransmission", dmg.optDouble("transmission"));
    damage("dmgCabin", dmg.optDouble("cabin"));
    damage("dmgChassis", dmg.optDouble("chassis"));
    damage("dmgWheels", dmg.optDouble("wheels"));
    JSONObject trailer = t.optJSONObject("trailer");
    JSONObject tdmg = trailer != null ? trailer.optJSONObject("damage") : null;
    damage("dmgTrailer", trailer != null && trailer.optBoolean("attached") && tdmg != null ? tdmg.optDouble("total") : 0);
    JSONObject job = t.optJSONObject("job");
    damage("dmgCargo", job != null ? job.optDouble("cargoDamage") : 0);
    value("odometer", Ui.number(tr.optDouble("odometerKm")) + " km", false);

    JSONObject lights = tr.optJSONObject("lights");
    chip("low", lights.optBoolean("low"), Ui.GREEN);
    chip("high", lights.optBoolean("high"), Ui.ACCENT);
    chip("beacon", lights.optBoolean("beacon"), Ui.YELLOW);
    chip("hazard", lights.optBoolean("hazard"), Ui.YELLOW);
    chip("wipers", tr.optBoolean("wipers"), Ui.ACCENT);
    chip("trailer", trailer != null && trailer.optBoolean("attached"), Ui.GREEN);
  }
}
