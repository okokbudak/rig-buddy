package tr.ets2nav.ui;

import android.content.Context;
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

import tr.ets2nav.agent.AgentClient;

/** Freight-market offers read from the latest save by the PC agent. */
public final class JobsScreen {
  public interface Actions {
    /** Route truck -> pickup (-> destination when destNode != null) in the app. */
    void routeJob(String pickupNode, String destNode, String label);
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
  private String currency = "€";
  private int sort = 0; // 0 nearest pickup, 1 income, 2 distance
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
    hcol.addView(Ui.text(c, "İş ilanları", 26, Ui.TEXT, true));
    status = Ui.text(c, 15, Ui.TEXT2, false);
    hcol.addView(status, Ui.margins(Ui.wrap(), c, 0, 6, 0, 0));
    header.addView(hcol);
    header.addView(Ui.spacer(c));
    header.addView(sortChip("En yakın", 0));
    header.addView(sortChip("En kazançlı", 1));
    header.addView(sortChip("Uzun yol", 2));
    TextView refresh = sortChipView("↻ Yenile");
    refresh.setOnClickListener(v -> load(true));
    header.addView(refresh, Ui.margins(Ui.wrap(), c, 10, 0, 0, 0));
    root.addView(header, Ui.margins(Ui.matchWrap(), c, 4, 0, 0, 12));

    currentJob = Ui.text(c, 18, Ui.TEXT, false);
    int p = Ui.dp(c, 14);
    currentJob.setPadding(p, p, p, p);
    currentJob.setBackground(Ui.rounded(0xff1e3a2b, Ui.dp(c, 14)));
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
    TextView full = button("Yükle ve teslim et: rotayı çiz", Ui.ACCENT, 0xff101316);
    full.setOnClickListener(v -> {
      if (selected == null) return;
      JSONObject s = selected.optJSONObject("source"), d = selected.optJSONObject("destination");
      actions.routeJob(s.optString("nodeUid"), d.optString("nodeUid"),
          selected.optString("cargo") + " → " + d.optString("city"));
    });
    detail.addView(full, Ui.matchWrap());
    TextView pickup = button("Sadece yükleme noktasına git", Ui.TRACK, Ui.TEXT);
    pickup.setOnClickListener(v -> {
      if (selected == null) return;
      JSONObject s = selected.optJSONObject("source");
      actions.routeJob(s.optString("nodeUid"), null, s.optString("company") + ", " + s.optString("city"));
    });
    detail.addView(pickup, Ui.margins(Ui.matchWrap(), c, 0, 10, 0, 0));
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
    currentJob.setText("Aktif iş:  " + job.optString("cargo") + " (" + job.optDouble("massT") + " t)  ·  "
        + job.optString("source") + "  →  " + job.optString("destination") + "   ·   "
        + Ui.money(job.optDouble("income"), HomeScreen.currency(t)) + "   ·   teslime " + Ui.duration(left));
  }

  private void load(boolean manual) {
    status.setText("Yükleniyor…");
    agent.get("/jobs?limit=300", (json, error) -> {
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
      status.setText(jobs.size() + " ilan  ·  son kayıt " + (ageMin == 0 ? "az önce" : ageMin + " dk önce")
          + "  ·  oyun her ~3 dk otomatik kaydeder");
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

  private void select(JSONObject j) {
    selected = j;
    JSONObject s = j.optJSONObject("source"), d = j.optJSONObject("destination");
    detailTitle.setText(j.optString("cargo") + (j.isNull("cargoMassT") ? "" : "  ·  " + j.optDouble("cargoMassT") + " t"));
    detailLine1.setText("Yükleme:  " + s.optString("company") + ", " + s.optString("city")
        + (j.has("pickupKm") && !j.isNull("pickupKm") ? "  (" + j.optInt("pickupKm") + " km uzakta)" : ""));
    detailLine2.setText("Teslim:  " + d.optString("company") + ", " + d.optString("city")
        + (d.optString("country").isEmpty() ? "" : " (" + d.optString("country") + ")") + "  ·  " + j.optInt("distanceKm") + " km");
    StringBuilder extra = new StringBuilder();
    if (!j.isNull("estimatedIncome")) extra.append("≈ ").append(Ui.money(j.optDouble("estimatedIncome"), currency)).append("  ·  ");
    extra.append("Son ").append(Ui.duration(j.optLong("expiresInMin")));
    if (j.optInt("urgency") > 0) extra.append("  ·  Acil");
    if (j.optInt("adr") > 0) extra.append("  ·  ADR ").append(j.optInt("adr"));
    if (j.optBoolean("fragile")) extra.append("  ·  Kırılgan");
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
      sortChips.get(i).setTextColor(on ? 0xff101316 : Ui.TEXT);
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
      h.cargo.setText(j.optString("cargo") + (j.isNull("cargoMassT") ? "" : "  ·  " + j.optDouble("cargoMassT") + " t")
          + (j.optInt("urgency") > 0 ? "  ·  acil" : ""));
      h.route.setText(s.optString("city") + " · " + s.optString("company") + "   →   " + d.optString("city") + " · " + d.optString("company"));
      h.income.setText(j.isNull("estimatedIncome") ? "" : "≈ " + Ui.money(j.optDouble("estimatedIncome"), currency));
      h.meta.setText((j.isNull("pickupKm") ? "" : j.optInt("pickupKm") + " km uzakta  ·  ") + j.optInt("distanceKm") + " km yol");
      return convert;
    }
  }

  private static final class Holder {
    TextView cargo, route, income, meta;
  }
}
