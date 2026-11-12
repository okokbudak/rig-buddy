package tr.rigbuddy.ui;

import tr.rigbuddy.R;

import android.content.Context;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

import tr.rigbuddy.agent.AgentClient;

/** Freight-market offers and bus lines (bus DLC) read from the latest save by the PC agent. */
public final class JobsScreen {
  public interface Actions {
    /** Route truck -> nodes[0] (-> nodes[1] -> ...) in the app: a job's pickup and delivery, or a bus line's stops. */
    void routeJob(List<String> nodes, String label);
  }

  private final Context c;
  private final AgentClient agent;
  private final Actions actions;
  private final LinearLayout root, detail;
  private final TextView status, currentJob;
  private final TextView detailTitle, detailLine1, detailLine2, detailLine3;
  private final List<JSONObject> jobs = new ArrayList<>();
  private final Adapter adapter = new Adapter();
  private final List<TextView> sortChips = new ArrayList<>();
  private final List<TextView> kindChips = new ArrayList<>();
  private static final String[] KINDS = {"all", "freight", "bus"};
  private String currency = "€";
  private int sort = 0; // 0 nearest pickup, 1 income, 2 distance
  private int kind = 0; // index into KINDS
  private JSONObject selected;
  private long lastLoad;

  public JobsScreen(Context c, AgentClient agent, Actions actions) {
    this.c = c;
    this.agent = agent;
    this.actions = actions;
    root = Ui.column(c);
    int pad = Ui.dp(c, 18);
    root.setPadding(pad, pad, pad, pad);

    LinearLayout header = Ui.row(c);
    LinearLayout hcol = Ui.column(c);
    hcol.addView(Ui.text(c, Ui.s(R.string.jobs_title), 26, Ui.TEXT, true));
    status = Ui.text(c, 15, Ui.TEXT2, false);
    status.setMaxLines(2);
    status.setEllipsize(TextUtils.TruncateAt.END);
    hcol.addView(status, Ui.margins(Ui.wrap(), c, 0, 6, 0, 0));
    // the column takes what is left: a long status (an error) must not push the
    // sort and refresh buttons off the screen
    header.addView(hcol, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
    header.addView(sortChip(Ui.s(R.string.jobs_sort_near), 0));
    header.addView(sortChip(Ui.s(R.string.jobs_sort_income), 1));
    header.addView(sortChip(Ui.s(R.string.jobs_sort_long), 2));
    TextView refresh = sortChipView(Ui.s(R.string.jobs_refresh));
    refresh.setOnClickListener(v -> load(true));
    header.addView(refresh, Ui.margins(Ui.wrap(), c, 10, 0, 0, 0));
    root.addView(header, Ui.margins(Ui.matchWrap(), c, 4, 0, 0, 10));

    // all / freight / bus lines (the bus DLC); each asks the PC for its own list, nearest first
    LinearLayout kinds = Ui.row(c);
    int[] kindLabels = {R.string.jobs_filter_all, R.string.jobs_filter_freight, R.string.jobs_filter_bus};
    for (int i = 0; i < KINDS.length; i++) {
      final int index = i;
      TextView t = sortChipView(Ui.s(kindLabels[i]));
      t.setOnClickListener(v -> {
        if (kind == index) return;
        kind = index;
        updateChips();
        selected = null;
        hideDetail(); // (a method: the final field can't be read here, in the constructor, before it is set)
        load(true);
      });
      kindChips.add(t);
      kinds.addView(t, Ui.margins(Ui.wrap(), c, i == 0 ? 0 : 10, 0, 0, 0));
    }
    root.addView(kinds, Ui.margins(Ui.matchWrap(), c, 4, 0, 0, 12));

    currentJob = Ui.text(c, 18, Ui.TEXT, false);
    int p = Ui.dp(c, 14);
    currentJob.setPadding(p, p, p, p);
    currentJob.setBackground(Ui.rounded(Ui.GREEN_BG, Ui.dp(c, 14)));
    currentJob.setVisibility(View.GONE);
    root.addView(currentJob, Ui.margins(Ui.matchWrap(), c, 0, 0, 0, 12));

    LinearLayout body = Ui.row(c);
    body.setBaselineAligned(false);
    ListView list = new ListView(c);
    list.setDivider(null);
    list.setDividerHeight(Ui.dp(c, 8));
    list.setAdapter(adapter);
    list.setOnItemClickListener((parent, view, pos, id) -> select(jobs.get(pos)));
    body.addView(list, Ui.weight(1.6f));

    detail = Ui.card(c, false);
    detailTitle = Ui.text(c, 22, Ui.TEXT, true);
    detailLine1 = Ui.text(c, 18, Ui.TEXT2, false);
    detailLine2 = Ui.text(c, 18, Ui.TEXT2, false);
    detailLine3 = Ui.text(c, 18, Ui.TEXT2, false);
    detail.addView(detailTitle);
    detail.addView(detailLine1, Ui.margins(Ui.matchWrap(), c, 0, 12, 0, 0));
    detail.addView(detailLine2, Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    detail.addView(detailLine3, Ui.margins(Ui.matchWrap(), c, 0, 8, 0, 0));
    detail.addView(Ui.spacer(c), Ui.hweight(1));
    TextView full = button(Ui.s(R.string.jobs_route_full), Ui.ACCENT, Ui.ON_ACCENT);
    full.setOnClickListener(v -> {
      if (selected == null) return;
      JSONObject s = selected.optJSONObject("source"), d = selected.optJSONObject("destination");
      List<String> nodes = new ArrayList<>();
      JSONArray via = selected.optJSONArray("waypoints"); // a bus line: its source and every stop, in order
      if (via != null && via.length() >= 2) {
        for (int i = 0; i < via.length(); i++) nodes.add(via.optString(i));
      } else {
        nodes.add(s.optString("nodeUid"));
        nodes.add(d.optString("nodeUid"));
      }
      actions.routeJob(nodes, (isBus(selected) ? lineLabel(selected) : selected.optString("cargo")) + " → " + d.optString("city"));
    });
    detail.addView(full, Ui.matchWrap());
    TextView pickup = button(Ui.s(R.string.jobs_route_pickup), Ui.TRACK, Ui.TEXT);
    pickup.setOnClickListener(v -> {
      if (selected == null) return;
      JSONObject s = selected.optJSONObject("source");
      actions.routeJob(Collections.singletonList(s.optString("nodeUid")), place(selected, s));
    });
    detail.addView(pickup, Ui.margins(Ui.matchWrap(), c, 0, 10, 0, 0));
    TextView delivery = button(Ui.s(R.string.jobs_route_delivery), Ui.TRACK, Ui.TEXT);
    delivery.setOnClickListener(v -> {
      if (selected == null) return;
      JSONObject d = selected.optJSONObject("destination");
      actions.routeJob(Collections.singletonList(d.optString("nodeUid")), place(selected, d));
    });
    detail.addView(delivery, Ui.margins(Ui.matchWrap(), c, 0, 10, 0, 0));
    detail.setVisibility(View.GONE);
    body.addView(detail, Ui.margins(Ui.weight(1), c, 14, 0, 0, 0));
    root.addView(body, Ui.hweight(1));
    updateChips();
  }

  public View view() {
    return root;
  }

  public void onShown() {
    if (System.currentTimeMillis() - lastLoad > 30_000 || jobs.isEmpty()) load(false);
  }

  public void onSaveChanged() {
    if (root.isShown()) load(false);
    else lastLoad = 0;
  }

  public void onTelemetry(JSONObject t) {
    JSONObject job = t != null ? t.optJSONObject("job") : null;
    if (job == null) {
      currentJob.setVisibility(View.GONE);
      return;
    }
    currentJob.setVisibility(View.VISIBLE);
    long left = job.optLong("deliveryTime") - t.optLong("gameTime");
    currentJob.setText(Ui.s(R.string.jobs_active, job.optString("cargo") + " (" + job.optDouble("massT") + " t)") + "  ·  "
        + job.optString("source") + "  →  " + job.optString("destination") + "   ·   "
        + Ui.money(job.optDouble("income"), HomeScreen.currency(t)) + "   ·   " + Ui.s(R.string.deliver_in, Ui.duration(left)));
  }

  private void load(boolean manual) {
    status.setText(Ui.s(R.string.loading));
    agent.get("/jobs?limit=300&kind=" + KINDS[kind], (json, error) -> {
      lastLoad = System.currentTimeMillis();
      if (error != null) {
        status.setText(error);
        return;
      }
      currency = json.optString("currency", "€");
      JSONArray arr = json.optJSONArray("jobs");
      jobs.clear();
      for (int i = 0; arr != null && i < arr.length(); i++) jobs.add(arr.optJSONObject(i));
      long ageMin = Math.max(0, (System.currentTimeMillis() - json.optLong("savedAt")) / 60000);
      status.setText(Ui.s(R.string.jobs_status, jobs.size(), ageMin == 0 ? Ui.s(R.string.ago_now) : Ui.s(R.string.ago_min, (int) ageMin)));
      applySort();
    });
  }

  private void applySort() {
    Comparator<JSONObject> cmp;
    if (sort == 1) cmp = (a, b) -> Double.compare(b.optDouble("estimatedIncome", 0), a.optDouble("estimatedIncome", 0));
    else if (sort == 2) cmp = (a, b) -> Double.compare(b.optDouble("distanceKm", 0), a.optDouble("distanceKm", 0));
    else cmp = (a, b) -> Double.compare(a.optDouble("pickupKm", 1e9), b.optDouble("pickupKm", 1e9));
    Collections.sort(jobs, cmp);
    adapter.notifyDataSetChanged();
  }

  private void hideDetail() {
    detail.setVisibility(View.GONE);
  }

  private static boolean isBus(JSONObject j) {
    return "bus".equals(j.optString("kind"));
  }

  /** "Bus line · Volvo 9700" / "Tour · MAN Lions". */
  private static String lineLabel(JSONObject j) {
    String line = Ui.s("tourist".equals(j.optString("line")) ? R.string.bus_line_tourist : R.string.bus_line_regular);
    String bus = j.optString("bus");
    return bus.isEmpty() ? line : line + "  ·  " + bus;
  }

  /** Where a route goes: a company in its city, or a city's bus stop (or, without one, its centre). */
  private static String place(JSONObject job, JSONObject end) {
    if (!isBus(job)) return end.optString("company") + ", " + end.optString("city");
    return end.optBoolean("approx") ? end.optString("city") + " " + Ui.s(R.string.bus_approx)
        : Ui.s(R.string.bus_station, end.optString("city"));
  }

  private static String clock(int minutes) {
    return String.format(java.util.Locale.US, "%02d:%02d", (minutes / 60) % 24, minutes % 60);
  }

  /** "Edirne (194 km) → Bucharest (426 km) → Hunedoara (445 km)". */
  private static String stops(JSONObject j, boolean withKm) {
    JSONArray arr = j.optJSONArray("stops");
    StringBuilder b = new StringBuilder();
    for (int i = 0; arr != null && i < arr.length(); i++) {
      JSONObject s = arr.optJSONObject(i);
      if (s == null) continue;
      if (b.length() > 0) b.append(" → ");
      b.append(s.optString("city"));
      if (withKm && !s.isNull("km")) b.append(" (").append(Ui.number(s.optInt("km"))).append(" km)");
    }
    return b.toString();
  }

  private void select(JSONObject j) {
    selected = j;
    JSONObject s = j.optJSONObject("source"), d = j.optJSONObject("destination");
    if (isBus(j)) {
      detailTitle.setText(lineLabel(j));
      detailLine1.setText(j.has("pickupKm") && !j.isNull("pickupKm")
          ? Ui.s(R.string.jobs_pickup, place(j, s), Ui.number(j.optInt("pickupKm")))
          : Ui.s(R.string.jobs_pickup_only, place(j, s)));
      detailLine2.setText(Ui.s(R.string.bus_stops, stops(j, true)));
      StringBuilder extra = new StringBuilder(Ui.s(R.string.bus_departs, clock(j.optInt("departureMin"))));
      if (!j.isNull("durationMin")) extra.append("  ·  ").append(Ui.s(R.string.bus_takes, Ui.duration(j.optLong("durationMin"))));
      extra.append("  ·  ").append(Ui.s(R.string.jobs_expires, Ui.duration(j.optLong("expiresInMin"))));
      detailLine3.setText(extra.toString());
      detail.setVisibility(View.VISIBLE);
      return;
    }
    detailTitle.setText(j.optString("cargo") + (j.isNull("cargoMassT") ? "" : "  ·  " + j.optDouble("cargoMassT") + " t"));
    String pickupPlace = s.optString("company") + ", " + s.optString("city");
    detailLine1.setText(j.has("pickupKm") && !j.isNull("pickupKm")
        ? Ui.s(R.string.jobs_pickup, pickupPlace, Ui.number(j.optInt("pickupKm")))
        : Ui.s(R.string.jobs_pickup_only, pickupPlace));
    detailLine2.setText(Ui.s(R.string.jobs_delivery, d.optString("company") + ", " + d.optString("city")
        + (d.optString("country").isEmpty() ? "" : " (" + d.optString("country") + ")")) + "  ·  " + Ui.number(j.optInt("distanceKm")) + " km");
    StringBuilder extra = new StringBuilder();
    if (!j.isNull("estimatedIncome")) extra.append("≈ ").append(Ui.money(j.optDouble("estimatedIncome"), currency)).append("  ·  ");
    extra.append(Ui.s(R.string.jobs_expires, Ui.duration(j.optLong("expiresInMin"))));
    if (j.optInt("urgency") > 0) extra.append("  ·  ").append(Ui.s(R.string.jobs_urgent));
    if (j.optInt("adr") > 0) extra.append("  ·  ").append(Ui.s(R.string.jobs_adr, String.valueOf(j.optInt("adr"))));
    if (j.optBoolean("fragile")) extra.append("  ·  ").append(Ui.s(R.string.jobs_fragile));
    if (!j.optString("trailer").isEmpty()) extra.append("  ·  ").append(j.optString("trailer"));
    detailLine3.setText(extra.toString());
    detail.setVisibility(View.VISIBLE);
  }

  private TextView sortChip(String label, int index) {
    TextView t = sortChipView(label);
    t.setOnClickListener(v -> {
      sort = index;
      updateChips();
      applySort();
    });
    sortChips.add(t);
    LinearLayout.LayoutParams lp = Ui.margins(Ui.wrap(), c, 10, 0, 0, 0);
    t.setLayoutParams(lp);
    return t;
  }

  private TextView sortChipView(String label) {
    TextView t = Ui.text(c, label, 17, Ui.TEXT, true);
    int ph = Ui.dp(c, 16), pv = Ui.dp(c, 10);
    t.setPadding(ph, pv, ph, pv);
    t.setBackground(Ui.rounded(Ui.TRACK, Ui.dp(c, 20)));
    return t;
  }

  private void updateChips() {
    for (int i = 0; i < sortChips.size(); i++) {
      boolean on = i == sort;
      sortChips.get(i).setBackground(Ui.rounded(on ? Ui.ACCENT : Ui.TRACK, Ui.dp(c, 20)));
      sortChips.get(i).setTextColor(on ? Ui.ON_ACCENT : Ui.TEXT);
    }
    for (int i = 0; i < kindChips.size(); i++) {
      boolean on = i == kind;
      kindChips.get(i).setBackground(Ui.rounded(on ? Ui.ACCENT : Ui.TRACK, Ui.dp(c, 20)));
      kindChips.get(i).setTextColor(on ? Ui.ON_ACCENT : Ui.TEXT);
    }
  }

  private TextView button(String label, int bg, int fg) {
    TextView b = Ui.text(c, label, 19, fg, true);
    b.setGravity(Gravity.CENTER);
    int p = Ui.dp(c, 16);
    b.setPadding(p, p, p, p);
    b.setBackground(Ui.rounded(bg, Ui.dp(c, 26)));
    return b;
  }

  private final class Adapter extends BaseAdapter {
    @Override public int getCount() { return jobs.size(); }
    @Override public Object getItem(int i) { return jobs.get(i); }
    @Override public long getItemId(int i) { return i; }

    @Override
    public View getView(int i, View convert, ViewGroup parent) {
      Holder h;
      if (convert == null) {
        LinearLayout row = Ui.row(c);
        int p = Ui.dp(c, 14);
        row.setPadding(p, p, p, p);
        row.setBackground(Ui.rounded(Ui.CARD, Ui.dp(c, 14)));
        h = new Holder();
        LinearLayout left = Ui.column(c);
        h.cargo = Ui.text(c, 19, Ui.TEXT, true);
        h.route = Ui.text(c, 16, Ui.TEXT2, false);
        h.route.setSingleLine(true);
        left.addView(h.cargo);
        left.addView(h.route, Ui.margins(Ui.wrap(), c, 0, 6, 0, 0));
        row.addView(left, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        LinearLayout right = Ui.column(c);
        right.setGravity(Gravity.END);
        // Fixed width: a wrap_content column measured while the text was
        // empty stayed too narrow on recycled rows and clipped the amount.
        right.setMinimumWidth(Ui.dp(c, 170));
        h.income = Ui.text(c, 19, Ui.GREEN, true);
        h.income.setSingleLine(true);
        h.meta = Ui.text(c, 15, Ui.TEXT2, false);
        h.meta.setSingleLine(true);
        right.addView(h.income, Ui.matchWrap());
        right.addView(h.meta, Ui.margins(Ui.matchWrap(), c, 0, 6, 0, 0));
        h.income.setGravity(Gravity.END);
        h.meta.setGravity(Gravity.END);
        row.addView(right, new LinearLayout.LayoutParams(Ui.dp(c, 190), ViewGroup.LayoutParams.WRAP_CONTENT));
        row.setTag(h);
        convert = row;
      } else {
        h = (Holder) convert.getTag();
      }
      JSONObject j = jobs.get(i);
      JSONObject s = j.optJSONObject("source"), d = j.optJSONObject("destination");
      if (isBus(j)) {
        h.cargo.setText(lineLabel(j));
        h.route.setText(s.optString("city") + "   →   " + stops(j, false));
        h.income.setText(Ui.s(R.string.bus_departs, clock(j.optInt("departureMin"))));
        h.meta.setText(j.isNull("pickupKm")
            ? Ui.s(R.string.km_trip, Ui.number(j.optInt("distanceKm")))
            : Ui.s(R.string.jobs_row_distance, Ui.number(j.optInt("pickupKm")), Ui.number(j.optInt("distanceKm"))));
        return convert;
      }
      h.cargo.setText(j.optString("cargo") + (j.isNull("cargoMassT") ? "" : "  ·  " + j.optDouble("cargoMassT") + " t")
          + (j.optInt("urgency") > 0 ? "  ·  " + Ui.s(R.string.jobs_urgent_lower) : ""));
      h.route.setText(s.optString("city") + " · " + s.optString("company") + "   →   " + d.optString("city") + " · " + d.optString("company"));
      h.income.setText(j.isNull("estimatedIncome") ? "" : "≈ " + Ui.money(j.optDouble("estimatedIncome"), currency));
      h.meta.setText(j.isNull("pickupKm")
          ? Ui.s(R.string.km_trip, Ui.number(j.optInt("distanceKm")))
          : Ui.s(R.string.jobs_row_distance, Ui.number(j.optInt("pickupKm")), Ui.number(j.optInt("distanceKm"))));
      return convert;
    }
  }

  private static final class Holder {
    TextView cargo, route, income, meta;
  }
}
