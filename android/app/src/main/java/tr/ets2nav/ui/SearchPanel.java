package tr.ets2nav.ui;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.widget.BaseAdapter;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import tr.ets2nav.nav.NavClient;

/**
 * Destination search: free-text autocomplete (app.getAutocompleteOptions) and
 * one-tap "nearest X" chips (app.search with ScopeType.NEARBY).
 */
public final class SearchPanel {
  /** A pickable destination (SearchResultWithRelativeTruckInfo). */
  public static final class Result {
    public String nodeUid, title, subtitle;
    public double lon, lat;

    public static Result from(JSONObject o) {
      Result r = new Result();
      r.nodeUid = o.optString("nodeUid");
      JSONArray ll = o.optJSONArray("lonLat");
      if (ll != null) {
        r.lon = ll.optDouble(0);
        r.lat = ll.optDouble(1);
      }
      String label = o.optString("label", "?");
      r.type = o.optString("type");
      boolean synthesized = "Waypoint".equals(label);
      r.title = synthesized ? "Seçilen nokta" : translate(label);
      StringBuilder sub = new StringBuilder(synthesized ? "Haritadan" : typeName(r.type));
      JSONObject city = o.optJSONObject("city");
      String cityName = city != null ? city.optString("name", "") : "";
      String state = o.optString("stateName", "");
      String place = !cityName.isEmpty() ? cityName : state;
      if (!place.isEmpty() && !place.equals(r.title)) sub.append(" · ").append(place);
      if (o.has("distance")) sub.append(" · ").append(formatKm(o.optDouble("distance") * distanceScale));
      r.subtitle = sub.toString();
      return r;
    }

    public String type;
  }

  public interface Listener {
    void onPicked(Result result);
  }

  /** World meters -> distance as the game's UI shows it (map scale, e.g. 19 for ETS2). */
  public static double distanceScale = 19;

  private static String translate(String label) {
    switch (label) {
      case "Gas Station": return "Benzinlik";
      case "Service Area": return "Dinlenme tesisi";
      case "Rest Area": return "Dinlenme alanı";
      case "Parking": return "Park yeri";
      case "Garage": return "Garaj";
      case "Truck Dealer": return "Kamyon bayisi";
      case "Recruitment Agency": return "İş bulma ajansı";
      case "Weigh Station": return "Kantar";
      case "Truck Stop": return "Tır parkı";
      default: return label;
    }
  }

  // PoiType / ScopeType from apis/navigation/constants.ts
  private static final int POI_COMPANY = 0, POI_FUEL = 1, POI_REST = 2, POI_SERVICE = 3, POI_DEALER = 4;
  private static final int SCOPE_NEARBY = 0;

  private final View panel;
  private final EditText input;
  private final TextView status;
  private final NavClient nav;
  private final Listener listener;
  private final Handler handler = new Handler(Looper.getMainLooper());
  private final List<Result> results = new ArrayList<>();
  private final Adapter adapter = new Adapter();
  private int querySeq;
  private double[] center; // lon, lat of the truck, for NEARBY searches

  public SearchPanel(View panel, NavClient nav, Listener listener) {
    this.panel = panel;
    this.nav = nav;
    this.listener = listener;
    Context ctx = panel.getContext();
    input = panel.findViewById(tr.ets2nav.R.id.searchInput);
    status = panel.findViewById(tr.ets2nav.R.id.searchStatus);
    ListView list = panel.findViewById(tr.ets2nav.R.id.searchResults);
    list.setAdapter(adapter);
    list.setOnItemClickListener((parent, view, position, id) -> {
      Result r = results.get(position);
      hide();
      listener.onPicked(r);
    });
    panel.findViewById(tr.ets2nav.R.id.searchClose).setOnClickListener(v -> hide());

    LinearLayout chips = panel.findViewById(tr.ets2nav.R.id.searchChips);
    addChip(ctx, chips, "⛽ Yakıt", POI_FUEL);
    addChip(ctx, chips, "🅿 Dinlenme", POI_REST);
    addChip(ctx, chips, "🔧 Servis", POI_SERVICE);
    addChip(ctx, chips, "🏭 Firma", POI_COMPANY);
    addChip(ctx, chips, "🚚 Bayi", POI_DEALER);

    input.addTextChangedListener(new TextWatcher() {
      @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
      @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
      @Override
      public void afterTextChanged(Editable s) {
        handler.removeCallbacksAndMessages(null);
        String q = s.toString().trim();
        if (q.length() >= 2) handler.postDelayed(() -> autocomplete(q), 350);
      }
    });
    input.setOnEditorActionListener((v, actionId, event) -> {
      if (actionId == EditorInfo.IME_ACTION_SEARCH) {
        String q = input.getText().toString().trim();
        if (!q.isEmpty()) autocomplete(q);
        hideKeyboard();
        return true;
      }
      return false;
    });
  }

  public boolean isShown() {
    return panel.getVisibility() == View.VISIBLE;
  }

  public void show(double lon, double lat) {
    center = new double[] {lon, lat};
    panel.setVisibility(View.VISIBLE);
    input.requestFocus();
    InputMethodManager imm = (InputMethodManager) panel.getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
    imm.showSoftInput(input, InputMethodManager.SHOW_IMPLICIT);
  }

  public void hide() {
    hideKeyboard();
    panel.setVisibility(View.GONE);
  }

  private void hideKeyboard() {
    InputMethodManager imm = (InputMethodManager) panel.getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
    imm.hideSoftInputFromWindow(input.getWindowToken(), 0);
  }

  private void autocomplete(String q) {
    int seq = ++querySeq;
    status.setText("Aranıyor…");
    nav.query("app.getAutocompleteOptions", q, (data, error) -> {
      if (seq != querySeq) return; // a newer query is in flight
      show(data, error, "Sonuç yok");
    });
  }

  private void nearby(int poiType, String label) {
    int seq = ++querySeq;
    hideKeyboard();
    status.setText(label + " aranıyor…");
    JSONObject in = new JSONObject();
    try {
      in.put("type", poiType).put("scope", SCOPE_NEARBY);
      if (center != null) in.put("center", new JSONArray().put(center[0]).put(center[1]));
    } catch (JSONException e) {
      throw new IllegalStateException(e);
    }
    nav.query("app.search", in, (data, error) -> {
      if (seq != querySeq) return;
      show(data, error, "Yakında bulunamadı");
    });
  }

  private void show(Object data, String error, String emptyText) {
    results.clear();
    if (error != null) {
      status.setText("Hata: " + error);
    } else {
      JSONArray arr = NavClient.asArray(data);
      for (int i = 0; i < arr.length(); i++) {
        JSONObject o = arr.optJSONObject(i);
        if (o != null && !o.optString("nodeUid").isEmpty()) results.add(Result.from(o));
      }
      // Typing a city name should list the city before its gas stations.
      String q = input.getText().toString().trim().toLowerCase(Locale.ROOT);
      if (!q.isEmpty()) {
        java.util.Collections.sort(results, (a, b) -> rank(a, q) - rank(b, q)); // stable
      }
      status.setText(results.isEmpty() ? emptyText : results.size() + " sonuç");
    }
    adapter.notifyDataSetChanged();
  }

  private void addChip(Context ctx, LinearLayout parent, String text, int poiType) {
    TextView chip = new TextView(ctx);
    chip.setText(text);
    chip.setTextSize(17);
    chip.setTextColor(0xff202124);
    chip.setBackgroundResource(tr.ets2nav.R.drawable.bg_chip_button);
    chip.setGravity(Gravity.CENTER);
    int padH = dp(ctx, 16), padV = dp(ctx, 9);
    chip.setPadding(padH, padV, padH, padV);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    lp.setMarginEnd(dp(ctx, 8));
    chip.setOnClickListener(v -> nearby(poiType, text.substring(text.indexOf(' ') + 1)));
    parent.addView(chip, lp);
  }

  private static int rank(Result r, String q) {
    boolean prefix = r.title.toLowerCase(Locale.ROOT).startsWith(q);
    if ("city".equals(r.type)) return prefix ? 0 : 2;
    if ("company".equals(r.type) || "scenery".equals(r.type)) return prefix ? 1 : 3;
    return 4;
  }

  private static String typeName(String type) {
    switch (type) {
      case "city": return "Şehir";
      case "scenery": return "Köy / yer";
      case "company": return "Firma";
      case "serviceArea": return "Servis alanı";
      case "dealer": return "Bayi";
      case "ferry": return "Feribot";
      case "train": return "Tren";
      case "landmark": return "Simge yapı";
      case "viewpoint": return "Manzara";
      default: return type;
    }
  }

  private static String formatKm(double meters) {
    return meters < 1000 ? Math.round(meters) + " m" : String.format(Locale.getDefault(), "%.1f km", meters / 1000);
  }

  private static int dp(Context ctx, int v) {
    return Math.round(v * ctx.getResources().getDisplayMetrics().density);
  }

  private final class Adapter extends BaseAdapter {
    @Override public int getCount() { return results.size(); }
    @Override public Object getItem(int i) { return results.get(i); }
    @Override public long getItemId(int i) { return i; }

    @Override
    public View getView(int i, View convert, ViewGroup parent) {
      Context ctx = parent.getContext();
      LinearLayout row;
      TextView title, sub;
      if (convert instanceof LinearLayout) {
        row = (LinearLayout) convert;
        title = (TextView) row.getChildAt(0);
        sub = (TextView) row.getChildAt(1);
      } else {
        row = new LinearLayout(ctx);
        row.setOrientation(LinearLayout.VERTICAL);
        int p = dp(ctx, 12);
        row.setPadding(p, p, p, p);
        title = new TextView(ctx);
        title.setTextSize(20);
        title.setTextColor(0xff202124);
        title.setSingleLine(true);
        sub = new TextView(ctx);
        sub.setTextSize(16);
        sub.setTextColor(0xff5f6368);
        sub.setSingleLine(true);
        row.addView(title);
        row.addView(sub);
      }
      Result r = results.get(i);
      title.setText(r.title);
      sub.setText(r.subtitle);
      return row;
    }
  }
}
