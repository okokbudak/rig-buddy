package tr.ets2nav.ui;

import tr.ets2nav.R;

import android.content.Context;
import android.view.Gravity;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import tr.ets2nav.agent.AgentClient;

/** Player profile and company summary from the latest save. */
public final class ProfileScreen {
  public interface ProfileListener {
    void onProfile(JSONObject profile, String error);
  }

  private final Context c;
  private final AgentClient agent;
  private final ProfileListener listener;
  private final LinearLayout root, garages;
  private final TextView company, driver, money, xp, status;
  private final TextView hq, trucks, trailers, drivers, cities, distance;
  private final ProgressBar citiesBar;
  private long lastLoad;

  public ProfileScreen(Context c, AgentClient agent, ProfileListener listener) {
    this.c = c;
    this.agent = agent;
    this.listener = listener;
    root = Ui.column(c);
    int pad = Ui.dp(c, 18);
    root.setPadding(pad, pad, pad, pad);

    LinearLayout top = Ui.row(c);
    top.setBaselineAligned(false);
    LinearLayout head = Ui.card(c, false);
    company = Ui.text(c, 30, Ui.TEXT, true);
    driver = Ui.text(c, 19, Ui.TEXT2, false);
    money = Ui.text(c, 44, Ui.GREEN, false);
    xp = Ui.text(c, 18, Ui.TEXT2, false);
    status = Ui.text(c, 14, Ui.TEXT2, false);
    head.addView(company);
    head.addView(driver, Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    head.addView(money, Ui.margins(Ui.matchWrap(), c, 0, 22, 0, 0));
    head.addView(xp, Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    head.addView(Ui.spacer(c), Ui.hweight(1));
    head.addView(status);
    top.addView(head, Ui.weight(1.2f));

    LinearLayout stats = Ui.card(c, false);
    stats.addView(Ui.text(c, Ui.s(R.string.prof_company_hdr), 15, Ui.TEXT2, true));
    hq = stat(stats, Ui.s(R.string.prof_hq));
    trucks = stat(stats, Ui.s(R.string.prof_trucks));
    trailers = stat(stats, Ui.s(R.string.prof_trailers));
    drivers = stat(stats, Ui.s(R.string.prof_drivers));
    distance = stat(stats, Ui.s(R.string.prof_distance));
    cities = stat(stats, Ui.s(R.string.prof_cities));
    citiesBar = Ui.bar(c, Ui.ACCENT);
    stats.addView(citiesBar, Ui.margins(Ui.matchWrap(), c, 0, 6, 0, 0));
    top.addView(stats, Ui.margins(Ui.weight(1), c, 14, 0, 0, 0));
    root.addView(top, Ui.hweight(1.15f));

    LinearLayout gcard = Ui.card(c, false);
    gcard.addView(Ui.text(c, Ui.s(R.string.prof_garages_hdr), 15, Ui.TEXT2, true));
    ScrollView sv = new ScrollView(c);
    garages = Ui.row(c);
    garages.setGravity(Gravity.TOP);
    android.widget.HorizontalScrollView hs = new android.widget.HorizontalScrollView(c);
    hs.addView(garages);
    sv.addView(hs);
    gcard.addView(sv, Ui.margins(Ui.matchWrap(), c, 0, 10, 0, 0));
    root.addView(gcard, Ui.margins(Ui.hweight(0.85f), c, 0, 14, 0, 0));
    render(null, Ui.s(R.string.loading));
  }

  private TextView stat(LinearLayout parent, String label) {
    LinearLayout r = Ui.row(c);
    r.addView(Ui.text(c, label, 18, Ui.TEXT2, false));
    r.addView(Ui.spacer(c));
    TextView v = Ui.text(c, 20, Ui.TEXT, true);
    r.addView(v);
    parent.addView(r, Ui.margins(Ui.matchWrap(), c, 0, 12, 0, 0));
    return v;
  }

  public View view() {
    return root;
  }

  public void onShown() {
    if (System.currentTimeMillis() - lastLoad > 30_000) load();
  }

  public void onSaveChanged() {
    load();
  }

  public void load() {
    agent.get("/profile", (json, error) -> {
      lastLoad = System.currentTimeMillis();
      render(json, error);
      listener.onProfile(json, error);
    });
  }

  private void render(JSONObject p, String error) {
    if (p == null) {
      company.setText(Ui.s(R.string.home_profile));
      driver.setText("");
      money.setText("–");
      xp.setText(error != null ? error : "");
      status.setText("");
      return;
    }
    String cur = p.optString("currency", "€");
    company.setText(p.optString("company", Ui.s(R.string.prof_company_default)));
    driver.setText(p.optString("name") + (p.optString("brand").isEmpty() ? "" : "  ·  " + prettyBrand(p.optString("brand"))));
    money.setText(Ui.money(p.optDouble("money"), cur));
    xp.setText(Ui.s(R.string.prof_xp_line, Ui.number(p.optDouble("experience")), Ui.gameClock(p.optLong("gameTime"))));
    long age = Math.max(0, (System.currentTimeMillis() - p.optLong("savedAt")) / 60000);
    status.setText(Ui.s(R.string.prof_read_from_save, age == 0 ? Ui.s(R.string.ago_now) : Ui.s(R.string.ago_min, (int) age)));
    hq.setText(p.optString("hqCity", "–"));
    trucks.setText(String.valueOf(p.optInt("trucks")));
    trailers.setText(String.valueOf(p.optInt("trailers")));
    drivers.setText(String.valueOf(p.optInt("drivers")));
    distance.setText(Ui.number(p.optDouble("distanceKm")) + " km");
    int visited = p.optInt("visitedCities"), total = Math.max(1, p.optInt("totalCities"));
    cities.setText(visited + " / " + total);
    Ui.setBar(citiesBar, visited / (double) total, Ui.ACCENT);

    garages.removeAllViews();
    JSONArray gs = p.optJSONArray("garages");
    for (int i = 0; gs != null && i < gs.length(); i++) {
      JSONObject g = gs.optJSONObject(i);
      LinearLayout gv = Ui.column(c);
      int pp = Ui.dp(c, 14);
      gv.setPadding(pp, pp, pp, pp);
      gv.setBackground(Ui.rounded(Ui.TRACK, Ui.dp(c, 14)));
      gv.addView(Ui.text(c, g.optString("cityName"), 20, Ui.TEXT, true));
      gv.addView(Ui.text(c, Ui.s(R.string.prof_garage_line, g.optInt("vehicles"), g.optInt("drivers")), 16, Ui.TEXT2, false),
          Ui.margins(Ui.wrap(), c, 0, 8, 0, 0));
      garages.addView(gv, Ui.margins(new LinearLayout.LayoutParams(Ui.dp(c, 220), LinearLayout.LayoutParams.WRAP_CONTENT), c, 0, 0, 12, 0));
    }
    if (gs == null || gs.length() == 0) garages.addView(Ui.text(c, Ui.s(R.string.prof_no_garage), 18, Ui.TEXT2, false));
  }

  private static String prettyBrand(String token) {
    String s = token.replace('_', ' ');
    return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
  }
}
