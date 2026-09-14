package tr.ets2nav;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.os.Bundle;
import android.os.SystemClock;
import android.text.InputType;
import android.util.Log;
import android.view.Choreographer;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.mapbox.geojson.Feature;
import com.mapbox.geojson.FeatureCollection;
import com.mapbox.geojson.LineString;
import com.mapbox.geojson.Point;
import com.mapbox.mapboxsdk.Mapbox;
import com.mapbox.mapboxsdk.camera.CameraPosition;
import com.mapbox.mapboxsdk.camera.CameraUpdateFactory;
import com.mapbox.mapboxsdk.geometry.LatLng;
import com.mapbox.mapboxsdk.maps.MapView;
import com.mapbox.mapboxsdk.maps.MapboxMap;
import com.mapbox.mapboxsdk.maps.Style;
import com.mapbox.mapboxsdk.offline.OfflineManager;
import com.mapbox.mapboxsdk.style.expressions.Expression;
import com.mapbox.mapboxsdk.style.layers.LineLayer;
import com.mapbox.mapboxsdk.style.layers.Property;
import com.mapbox.mapboxsdk.style.layers.PropertyFactory;
import com.mapbox.mapboxsdk.style.layers.SymbolLayer;
import com.mapbox.mapboxsdk.style.sources.GeoJsonSource;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import tr.ets2nav.agent.AgentClient;
import tr.ets2nav.agent.PcFinder;
import tr.ets2nav.map.LocalTileServer;
import tr.ets2nav.map.MapStyle;
import tr.ets2nav.map.TileDownloader;
import tr.ets2nav.nav.NavClient;
import tr.ets2nav.nav.Route;
import tr.ets2nav.nav.TruckTracker;
import tr.ets2nav.ui.HomeScreen;
import tr.ets2nav.ui.JobsScreen;
import tr.ets2nav.ui.ManeuverIconView;
import tr.ets2nav.ui.MediaScreen;
import tr.ets2nav.ui.ProfileScreen;
import tr.ets2nav.ui.SearchPanel;
import tr.ets2nav.ui.TruckArrowView;
import tr.ets2nav.ui.Ui;
import tr.ets2nav.ui.VehicleScreen;

public final class MainActivity extends Activity implements NavClient.Listener, Choreographer.FrameCallback {
  private static final String TAG = "ETS2Nav";
  private static final long FRAME_INTERVAL_MS = 33;   // ~30 fps is plenty and saves the CPU
  private static final long GUIDANCE_INTERVAL_MS = 250;
  private static final double FOCUS_FROM_TOP = 0.70;   // chevron position, fraction of height
  private static final double FOLLOW_TILT = 45;

  private MapView mapView;
  private MapboxMap map;
  private Style style;
  private GeoJsonSource routeSource, destSource, truckSource, pickSource;
  private SearchPanel searchPanel;
  private View destCard;
  private TextView destTitle, destSubtitle;
  private SearchPanel.Result pendingDest;

  private TruckArrowView truckArrow;
  private View maneuverPanel, thenPanel, tripPanel, recenter;
  private ManeuverIconView maneuverIcon, thenIcon;
  private TextView maneuverDistance, maneuverText, tripTime, tripDetail, speedView, speedLimitView, statusView, messageView;

  private SharedPreferences prefs;
  private NavClient nav;
  private final TruckTracker tracker = new TruckTracker();
  private final TruckTracker.Pose pose = new TruckTracker.Pose();
  private final Route.Progress progress = new Route.Progress();
  private final Map<String, LocalTileServer> tileServers = new HashMap<>();
  private TileDownloader tiles;

  private String game = "ets2";
  private boolean darkMode;
  private boolean following = true;
  private boolean frameLoopRunning;
  private long lastFrameMs, lastGuidanceMs, lastTruckSourceMs, lastHudMs, lastDebugLogMs, lastMediaTickMs;
  private double smoothedZoom = 13.2;

  // head-unit shell
  private AgentClient agent;
  private HomeScreen home;
  private VehicleScreen vehicle;
  private JobsScreen jobs;
  private ProfileScreen profile;
  private MediaScreen mediaScreen;
  private FrameLayout screenHost;
  private String screen = "home";
  private final Map<String, View> screenViews = new HashMap<>();
  private final Map<String, ImageView> railIcons = new HashMap<>();
  private TextView railClock;
  private View railAgentDot, railNavDot;
  private JSONObject lastTelemetry;

  private Route route;
  private int routeStep = -1;       // step currently being driven (flat index)
  private int serverStepHint = 0;   // from routeProgress events
  private String requestedDestNode;
  private boolean pickingRoute;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    Mapbox.getInstance(getApplicationContext());
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    setContentView(R.layout.activity_main);
    hideSystemUi();

    prefs = getSharedPreferences("ets2nav", MODE_PRIVATE);
    applyIntent(getIntent());

    mapView = findViewById(R.id.map);
    truckArrow = findViewById(R.id.truckArrow);
    maneuverPanel = findViewById(R.id.maneuverPanel);
    thenPanel = findViewById(R.id.thenPanel);
    tripPanel = findViewById(R.id.tripPanel);
    recenter = findViewById(R.id.recenter);
    maneuverIcon = findViewById(R.id.maneuverIcon);
    thenIcon = findViewById(R.id.thenIcon);
    maneuverDistance = findViewById(R.id.maneuverDistance);
    maneuverText = findViewById(R.id.maneuverText);
    tripTime = findViewById(R.id.tripTime);
    tripDetail = findViewById(R.id.tripDetail);
    speedView = findViewById(R.id.speed);
    speedLimitView = findViewById(R.id.speedLimit);
    statusView = findViewById(R.id.status);
    messageView = findViewById(R.id.message);

    destCard = findViewById(R.id.destCard);
    destTitle = findViewById(R.id.destTitle);
    destSubtitle = findViewById(R.id.destSubtitle);

    recenter.setOnClickListener(v -> setFollowing(true));
    findViewById(R.id.settings).setOnClickListener(v -> showSettings());
    findViewById(R.id.searchButton).setOnClickListener(v -> {
      hideDestCard();
      searchPanel.show(pose.valid ? pose.lon : 0, pose.valid ? pose.lat : 0);
    });
    findViewById(R.id.cancelRoute).setOnClickListener(v -> cancelRoute());
    findViewById(R.id.destGo).setOnClickListener(v -> {
      SearchPanel.Result r = pendingDest;
      hideDestCard();
      if (r != null) {
        routeTo(r.nodeUid);
        setFollowing(true);
      }
    });
    findViewById(R.id.destClose).setOnClickListener(v -> hideDestCard());
    findViewById(R.id.root).addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> placeTruckArrow());

    mapView.setMaximumFps(30);
    mapView.addOnDidFailLoadingMapListener(msg -> {
      Log.e(TAG, "map failed to load: " + msg);
      showMessage("Harita yüklenemedi:\n" + msg);
    });
    mapView.onCreate(savedInstanceState);
    mapView.getMapAsync(this::onMapReady);

    // Don't write tiles/styles to the eMMC cache; everything is local anyway.
    OfflineManager.getInstance(getApplicationContext()).setMaximumAmbientCacheSize(0, null);

    nav = new NavClient(prefs, this);
    searchPanel = new SearchPanel(findViewById(R.id.searchPanel), nav, this::showDestCard);
    tiles = new TileDownloader(prefs, mapDir(), new TileDownloader.Listener() {
      @Override
      public void onProgress(String g, double fraction, long total) {
        showMessage(String.format(Ui.TR, "Harita PC'den indiriliyor… %%%d\n%d MB", Math.round(fraction * 100), total / 1_000_000));
      }

      @Override
      public void onUpdated(String g, File file) {
        LocalTileServer old = tileServers.remove(g);
        if (old != null) old.stop();
        tileUrlCache.remove(g);
        if (g.equals(game)) loadStyle();
        flashMessage("Harita güncellendi");
      }

      @Override
      public void onFailed(String g, String error) {
        if (!TileDownloader.fileFor(mapDir(), g).exists()) {
          showMessage("Harita indirilemedi: " + error + "\nPC bağlantısı kurulunca yeniden denenecek.");
        }
      }
    });
    setupShell();
  }

  /** Where the map files live: app-specific external storage, or internal if there is none. */
  private File mapDir() {
    File d = getExternalFilesDir(null);
    return d != null ? d : getFilesDir();
  }

  private void syncTiles() {
    if (!host().isEmpty()) tiles.sync(host(), AgentClient.PORT, game);
  }

  // --- head-unit shell: rail + screens ---------------------------------------------

  private void setupShell() {
    agent = new AgentClient(new AgentClient.Listener() {
      @Override
      public void onTelemetry(JSONObject t) {
        lastTelemetry = t;
        home.onTelemetry(t);
        if ("vehicle".equals(screen)) vehicle.onTelemetry(t);
        if ("jobs".equals(screen)) jobs.onTelemetry(t);
      }

      @Override
      public void onSaveChanged() {
        jobs.onSaveChanged();
        profile.onSaveChanged();
      }

      @Override
      public void onMedia(JSONObject media) {
        mediaScreen.onMedia(media);
        home.setNowPlaying(media, () -> {
          try {
            agent.mediaCommand(new JSONObject().put("cmd", "toggle"));
          } catch (org.json.JSONException ignored) {
          }
        });
      }

      @Override
      public void onAgentConnected(boolean connected) {
        railAgentDot.setBackground(Ui.rounded(connected ? Ui.GREEN : Ui.RED, Ui.dp(MainActivity.this, 5)));
        if (connected) {
          profile.load();
          syncTiles();
        } else {
          scheduleRediscovery();
        }
      }
    });

    screenHost = findViewById(R.id.screenHost);
    home = new HomeScreen(this, this::showScreen);
    vehicle = new VehicleScreen(this);
    jobs = new JobsScreen(this, agent, this::routeJob);
    profile = new ProfileScreen(this, agent, (p, err) -> home.setProfile(p, err));
    mediaScreen = new MediaScreen(this, agent);
    addScreen("home", home.view());
    addScreen("media", mediaScreen.view());
    addScreen("vehicle", vehicle.view());
    addScreen("jobs", jobs.view());
    addScreen("profile", profile.view());
    screenViews.put("map", findViewById(R.id.root));

    LinearLayout rail = findViewById(R.id.rail);
    addRailButton(rail, "home", R.drawable.ic_home, "Ana ekran");
    addRailButton(rail, "map", R.drawable.ic_map, "Harita");
    addRailButton(rail, "media", R.drawable.ic_music, "Medya");
    addRailButton(rail, "vehicle", R.drawable.ic_truck, "Araç");
    addRailButton(rail, "jobs", R.drawable.ic_work, "İşler");
    addRailButton(rail, "profile", R.drawable.ic_person, "Profil");
    addRailAction(rail, R.drawable.ic_settings, "Ayarlar", this::showSettings);
    rail.addView(Ui.spacer(this), Ui.hweight(1));
    railClock = Ui.text(this, compactRail() ? 16 : 22, Ui.TEXT, true);
    railClock.setGravity(Gravity.CENTER);
    rail.addView(railClock, Ui.matchWrap());
    LinearLayout dots = Ui.row(this);
    dots.setGravity(Gravity.CENTER);
    railNavDot = dot(dots, "NAV");
    railAgentDot = dot(dots, "PC");
    rail.addView(dots, Ui.margins(Ui.matchWrap(), this, 0, 10, 0, 0));
    tickClock();
    showScreen("home");
  }

  private View dot(LinearLayout parent, String label) {
    LinearLayout col = Ui.column(this);
    col.setGravity(Gravity.CENTER_HORIZONTAL);
    View d = new View(this);
    d.setBackground(Ui.rounded(Ui.RED, Ui.dp(this, 5)));
    col.addView(d, new LinearLayout.LayoutParams(Ui.dp(this, 10), Ui.dp(this, 10)));
    col.addView(Ui.text(this, label, 11, Ui.TEXT2, false), Ui.margins(Ui.wrap(), this, 0, 4, 0, 0));
    parent.addView(col, Ui.margins(Ui.wrap(), this, 8, 0, 8, 0));
    return d;
  }

  private final Runnable clockTicker = this::tickClock;

  private void tickClock() {
    railClock.setText(new SimpleDateFormat("HH:mm", Ui.TR).format(new Date()));
    home.tick();
    railClock.removeCallbacks(clockTicker);
    railClock.postDelayed(clockTicker, 15_000);
  }

  private void addScreen(String name, View v) {
    v.setVisibility(View.GONE);
    screenHost.addView(v, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    screenViews.put(name, v);
  }

  private void addRailButton(LinearLayout rail, String name, int icon, String label) {
    railIcons.put(name, addRailAction(rail, icon, label, () -> showScreen(name)));
  }

  /** Phones in landscape (~400 dp tall): icons only, so the rail fits without scrolling. */
  private boolean compactRail() {
    return getResources().getConfiguration().screenHeightDp < 560;
  }

  private ImageView addRailAction(LinearLayout rail, int icon, String label, Runnable action) {
    LinearLayout b = Ui.column(this);
    b.setGravity(Gravity.CENTER);
    // 7 entries must fit a 720 px tall head unit with the clock: keep them compact
    boolean compact = compactRail();
    int p = Ui.dp(this, compact ? 3 : 5);
    b.setPadding(0, p, 0, p);
    ImageView iv = new ImageView(this);
    iv.setImageResource(icon);
    int ip = Ui.dp(this, 7);
    iv.setPadding(Ui.dp(this, 18), ip, Ui.dp(this, 18), ip);
    iv.setContentDescription(label);
    b.addView(iv, new LinearLayout.LayoutParams(Ui.dp(this, 72), Ui.dp(this, compact ? 40 : 42)));
    if (!compact) b.addView(Ui.text(this, label, 13, Ui.TEXT2, false), Ui.margins(Ui.wrap(), this, 0, 3, 0, 0));
    b.setOnClickListener(v -> action.run());
    rail.addView(b, Ui.margins(Ui.matchWrap(), this, 0, 2, 0, 2));
    iv.setColorFilter(Ui.TEXT2);
    return iv;
  }

  /** Map stays underneath (its GL surface survives); other screens cover it. */
  private void showScreen(String name) {
    screen = name;
    boolean isMap = "map".equals(name);
    screenHost.setVisibility(isMap ? View.GONE : View.VISIBLE);
    for (Map.Entry<String, View> e : screenViews.entrySet()) {
      if (!"map".equals(e.getKey())) e.getValue().setVisibility(e.getKey().equals(name) ? View.VISIBLE : View.GONE);
    }
    for (Map.Entry<String, ImageView> e : railIcons.entrySet()) {
      boolean on = e.getKey().equals(name);
      e.getValue().setColorFilter(on ? 0xff101316 : Ui.TEXT2);
      e.getValue().setBackground(on ? Ui.rounded(Ui.ACCENT, Ui.dp(this, 23)) : null);
    }
    if ("vehicle".equals(name)) vehicle.onTelemetry(lastTelemetry);
    if ("jobs".equals(name)) {
      jobs.onTelemetry(lastTelemetry);
      jobs.onShown();
    }
    if ("profile".equals(name)) profile.onShown();
    if (isMap) hideSystemUi();
  }

  /** From the jobs screen: truck -> pickup (-> destination) as a multi-segment route. */
  private void routeJob(String pickupNode, String destNode, String label) {
    if (pickupNode == null || pickupNode.isEmpty()) {
      flashMessage("Bu firmanın konumu haritada bulunamadı");
      return;
    }
    showScreen("map");
    setFollowing(true);
    if (destNode == null || destNode.isEmpty()) {
      routeTo(pickupNode);
      return;
    }
    JSONArray waypoints = new JSONArray().put(pickupNode).put(destNode);
    flashMessage("Rota hesaplanıyor…\n" + label);
    nav.query("app.generateRouteFromNodeUids", waypoints, (data, error) -> {
      if (!(data instanceof JSONObject)) {
        flashMessage("Rota bulunamadı" + (error != null ? "\n" + error : ""));
        return;
      }
      JSONObject r = (JSONObject) data;
      JSONArray keys = new JSONArray();
      JSONArray segments = r.optJSONArray("segments");
      for (int i = 0; segments != null && i < segments.length(); i++) keys.put(segments.optJSONObject(i).optString("key"));
      requestedDestNode = destNode;
      setRoute(Route.parse(r));
      nav.mutate("app.setActiveRoute", keys, null);
      hideMessage();
    });
  }

  @Override
  public void onBackPressed() {
    if (searchPanel.isShown()) searchPanel.hide();
    else if (destCard.getVisibility() == View.VISIBLE) hideDestCard();
    else if ("map".equals(screen) && !following) setFollowing(true);
    else if (!"home".equals(screen)) showScreen("home");
    else moveTaskToBack(true); // keep the connections warm instead of finishing
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    if (applyIntent(intent)) {
      restartClients();
    }
  }

  /** adb shell am start -n tr.ets2nav/.MainActivity --es host <PC LAN IP> */
  private boolean applyIntent(Intent intent) {
    String host = intent != null ? intent.getStringExtra("host") : null;
    if (host == null || host.isEmpty()) return false;
    prefs.edit().putString("host", host.trim()).apply();
    return true;
  }

  /** The gaming PC's address; empty until the user enters it (first run). */
  private String host() {
    return prefs.getString("host", "");
  }

  private void restartClients() {
    nav.stop();
    agent.stop();
    startClients();
  }

  private void startClients() {
    if (host().isEmpty()) {
      // first run: look for the PC on the LAN before asking for its address
      showMessage("PC aranıyor…\nPC'de Rig Buddy açık olmalı.");
      PcFinder.find((found, name) -> {
        if (found != null) {
          useHost(found, name);
        } else {
          hideMessage();
          showHostDialog();
        }
      });
      return;
    }
    nav.start(host());
    agent.start(host());
    scheduleRediscovery();
  }

  private void useHost(String found, String name) {
    prefs.edit().putString("host", found).apply();
    hideMessage();
    flashMessage("PC bulundu: " + (name != null ? name + " (" + found + ")" : found));
    restartClients();
  }

  /**
   * The PC's IP can change (DHCP). While the agent stays unreachable, look for
   * the PC again every 30 s and switch to it if it moved.
   */
  private final Runnable rediscover = () -> {
    if (agent.isConnected() || isFinishing()) return;
    PcFinder.find((found, name) -> {
      if (found != null && !found.equals(host())) useHost(found, name);
      else scheduleRediscovery();
    });
  };

  private void scheduleRediscovery() {
    screenHost.removeCallbacks(rediscover);
    screenHost.postDelayed(rediscover, 30_000);
  }

  // --- map setup -------------------------------------------------------------

  private void onMapReady(MapboxMap m) {
    map = m;
    map.setMinZoomPreference(4);
    map.setMaxZoomPreference(17);
    map.setPrefetchesTiles(false);
    map.getUiSettings().setAttributionEnabled(false);
    map.getUiSettings().setLogoEnabled(false);
    map.getUiSettings().setCompassEnabled(false);
    map.addOnCameraMoveStartedListener(reason -> {
      if (reason == MapboxMap.OnCameraMoveStartedListener.REASON_API_GESTURE) setFollowing(false);
    });
    // Long-press anywhere = "go here", like clicking a point on the in-game map.
    map.addOnMapLongClickListener(point -> {
      onMapLongPress(point.getLongitude(), point.getLatitude());
      return true;
    });
    map.moveCamera(CameraUpdateFactory.newCameraPosition(
        new CameraPosition.Builder().target(new LatLng(50.6, 10.3)).zoom(5).build()));
    loadStyle();
  }

  private void loadStyle() {
    if (map == null) return;
    File mbtiles = TileDownloader.fileFor(mapDir(), game);
    String tileUrl = "http://127.0.0.1:1/none/{z}/{x}/{y}.pbf";
    if (mbtiles.exists()) {
      try {
        LocalTileServer server = tileServers.get(game);
        if (server == null) {
          server = new LocalTileServer(mbtiles, game);
          tileServers.put(game, server);
          tileUrlCache.put(game, server.start());
        }
        tileUrl = tileUrlCache.get(game);
        hideMessage();
      } catch (IOException e) {
        showMessage("Harita dosyası açılamadı:\n" + e.getMessage());
      }
    } else if (!tiles.isRunning()) {
      showMessage(host().isEmpty()
          ? "Harita, PC'ye bağlanınca otomatik indirilecek."
          : "Harita PC'den indirilecek…\nPC'de Rig Buddy'nin açık olduğundan emin olun.");
    }
    style = null;
    map.setStyle(new Style.Builder().fromJson(MapStyle.build(game, tileUrl, darkMode)), this::onStyleLoaded);
  }

  private final Map<String, String> tileUrlCache = new HashMap<>();

  private void onStyleLoaded(Style s) {
    Log.i(TAG, "style loaded: " + game + (darkMode ? " dark" : " light"));
    style = s;
    s.addImage("truck-arrow", TruckArrowView.bitmap(64));
    s.addImage("dest-pin", destinationPin());

    routeSource = new GeoJsonSource("route");
    destSource = new GeoJsonSource("dest");
    truckSource = new GeoJsonSource("truck");
    pickSource = new GeoJsonSource("pick");
    s.addSource(routeSource);
    s.addSource(destSource);
    s.addSource(truckSource);
    s.addSource(pickSource);

    // "zoom" must be the input of a top-level interpolate, so the casing gets its own curve.
    Expression routeWidth = routeWidth(0);
    s.addLayerBelow(new LineLayer("route-casing", "route").withProperties(
        PropertyFactory.lineColor(darkMode ? "#0b3d91" : "#1558c0"),
        PropertyFactory.lineWidth(routeWidth(4)),
        PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
        PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND)), MapStyle.LAYER_ROUTE_ANCHOR);
    s.addLayerBelow(new LineLayer("route-line", "route").withProperties(
        PropertyFactory.lineColor(darkMode ? "#4c8df6" : "#4285f4"),
        PropertyFactory.lineWidth(routeWidth),
        PropertyFactory.lineCap(Property.LINE_CAP_ROUND),
        PropertyFactory.lineJoin(Property.LINE_JOIN_ROUND)), MapStyle.LAYER_ROUTE_ANCHOR);
    s.addLayer(new SymbolLayer("dest", "dest").withProperties(
        PropertyFactory.iconImage("dest-pin"),
        PropertyFactory.iconAnchor(Property.ICON_ANCHOR_BOTTOM),
        PropertyFactory.iconAllowOverlap(true),
        PropertyFactory.iconIgnorePlacement(true)));
    s.addLayer(new SymbolLayer("pick", "pick").withProperties(
        PropertyFactory.iconImage("dest-pin"),
        PropertyFactory.iconAnchor(Property.ICON_ANCHOR_BOTTOM),
        PropertyFactory.iconOpacity(0.75f),
        PropertyFactory.iconAllowOverlap(true),
        PropertyFactory.iconIgnorePlacement(true)));
    s.addLayer(new SymbolLayer("truck", "truck").withProperties(
        PropertyFactory.iconImage("truck-arrow"),
        PropertyFactory.iconRotate(Expression.get("bearing")),
        PropertyFactory.iconRotationAlignment(Property.ICON_ROTATION_ALIGNMENT_MAP),
        PropertyFactory.iconPitchAlignment(Property.ICON_PITCH_ALIGNMENT_MAP),
        PropertyFactory.iconAllowOverlap(true),
        PropertyFactory.iconIgnorePlacement(true),
        PropertyFactory.visibility(following ? Property.NONE : Property.VISIBLE)));
    renderRoute();
  }

  private static Expression routeWidth(float extra) {
    return Expression.interpolate(Expression.exponential(1.5f), Expression.zoom(),
        Expression.stop(6, 3f + extra), Expression.stop(10, 5f + extra), Expression.stop(12, 7f + extra),
        Expression.stop(13, 10f + extra), Expression.stop(14, 16f + extra), Expression.stop(16, 50f + extra));
  }

  private Bitmap destinationPin() {
    int w = 48, h = 64;
    Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
    Canvas c = new Canvas(bmp);
    Paint red = new Paint(Paint.ANTI_ALIAS_FLAG);
    red.setColor(0xffea4335);
    Paint dark = new Paint(Paint.ANTI_ALIAS_FLAG);
    dark.setColor(0xffa50e0e);
    android.graphics.Path p = new android.graphics.Path();
    p.moveTo(24, 63);
    p.cubicTo(14, 46, 4, 36, 4, 22);
    p.arcTo(new android.graphics.RectF(4, 2, 44, 42), 180, 180, false);
    p.cubicTo(44, 36, 34, 46, 24, 63);
    p.close();
    c.drawPath(p, red);
    c.drawCircle(24, 22, 7, dark);
    return bmp;
  }

  // --- navigation events -------------------------------------------------------

  @Override
  public void onStateChanged(NavClient.State state, String detail) {
    String text;
    int color;
    switch (state) {
      case CONNECTED:
        text = tracker.hasData() ? "Bağlı" : "Bağlı · oyun bekleniyor";
        color = 0xff188038;
        break;
      case PAIRING:
        text = "Eşleşiyor" + (detail != null ? " · " + detail : "");
        color = 0xffe37400;
        break;
      case CONNECTING:
        text = "Bağlanıyor · " + detail;
        color = 0xff5f6368;
        break;
      default:
        text = "Bağlantı yok · " + (detail != null ? detail : "");
        color = 0xffd93025;
    }
    statusView.setText(text);
    statusView.setTextColor(color);
    if (railNavDot != null) {
      railNavDot.setBackground(Ui.rounded(state == NavClient.State.CONNECTED ? Ui.GREEN
          : state == NavClient.State.DISCONNECTED ? Ui.RED : Ui.YELLOW, Ui.dp(this, 5)));
    }
    Log.i(TAG, "state " + state + " " + detail);
  }

  @Override
  public void onEvent(String type, Object data) {
    switch (type) {
      case "positionUpdate":
        if (data instanceof JSONObject) {
          boolean first = !tracker.hasData();
          if (first) Log.i(TAG, "first positionUpdate: " + data);
          tracker.onPositionUpdate((JSONObject) data);
          if (first) {
            onStateChanged(NavClient.State.CONNECTED, null);
            placeTruckArrow();
            truckArrow.setVisibility(following ? View.VISIBLE : View.GONE);
          }
        }
        break;
      case "routeUpdate":
        setRoute(data instanceof JSONObject ? Route.parse((JSONObject) data) : null);
        break;
      case "routeProgress":
        if (data instanceof JSONObject && route != null) {
          JSONObject idx = (JSONObject) data;
          int flat = route.flatIndex(idx.optInt("segmentIndex"), idx.optInt("stepIndex"));
          if (flat >= 0) serverStepHint = flat;
        }
        break;
      case "jobUpdate":
        if (data instanceof JSONObject) {
          String node = ((JSONObject) data).optString("toNodeUid", null);
          if (node != null && !node.equals(requestedDestNode)) routeTo(node);
        } else {
          requestedDestNode = null;
        }
        break;
      case "themeModeUpdate":
        boolean dark = "dark".equals(data);
        if (dark != darkMode) {
          darkMode = dark;
          loadStyle();
        }
        break;
      case "mapUpdate":
        String g = "usa".equals(data) ? "ats" : "ets2";
        if (!g.equals(game)) {
          game = g;
          SearchPanel.distanceScale = distanceScale();
          setRoute(null);
          loadStyle();
          syncTiles();
        }
        break;
      case "segmentComplete":
        boolean isFinal = true;
        if (data instanceof JSONObject) {
          JSONObject info = (JSONObject) data;
          isFinal = info.optBoolean("isFinal", true);
          flashMessage((isFinal ? "Varış noktasına ulaştınız\n" : "Ara noktaya ulaşıldı\n")
              + info.optString("place") + "\n" + info.optString("placeInfo"));
        }
        nav.mutate("app.unpauseRouteEvents", null, null);
        if (isFinal) arrived();
        break;
      case "staleBinding":
        statusView.setText("Oyun verisi gelmiyor");
        statusView.setTextColor(0xffe37400);
        break;
      default:
        break;
    }
  }

  /** Picks the server's first suggested route to a node and makes it active. */
  private void routeTo(String nodeUid) {
    if (pickingRoute) return;
    pickingRoute = true;
    requestedDestNode = nodeUid;
    JSONObject input = new JSONObject();
    try {
      input.put("toNodeUid", nodeUid);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
    nav.query("app.previewRoutes", input, (data, error) -> {
      pickingRoute = false;
      JSONArray routes = NavClient.asArray(data);
      if (error != null || routes.length() == 0) {
        Log.w(TAG, "no route to " + nodeUid + ": " + error);
        requestedDestNode = null;
        flashMessage("Rota bulunamadı" + (error != null ? "\n" + error : ""));
        return;
      }
      JSONObject best = routes.optJSONObject(0);
      JSONArray keys = new JSONArray();
      JSONArray segments = best.optJSONArray("segments");
      for (int i = 0; segments != null && i < segments.length(); i++) {
        keys.put(segments.optJSONObject(i).optString("key"));
      }
      setRoute(Route.parse(best));
      if (pickSource != null) pickSource.setGeoJson(FeatureCollection.fromFeatures(new Feature[0]));
      nav.mutate("app.setActiveRoute", keys, null);
    });
  }

  /** Snaps a map point to the nearest routable place and offers it as a destination. */
  private void onMapLongPress(double lon, double lat) {
    searchPanel.hide();
    setPickMarker(lon, lat);
    destTitle.setText("Konum aranıyor…");
    destSubtitle.setText("");
    destCard.setVisibility(View.VISIBLE);
    pendingDest = null;
    JSONArray input = new JSONArray();
    try {
      input.put(lon).put(lat);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
    nav.query("app.synthesizeSearchResult", input, (data, error) -> {
      if (!(data instanceof JSONObject)) {
        destTitle.setText("Buraya rota bulunamadı");
        destSubtitle.setText(error != null ? error : "Yola daha yakın bir yere basılı tutun");
        return;
      }
      showDestCard(SearchPanel.Result.from((JSONObject) data));
    });
  }

  private void showDestCard(SearchPanel.Result r) {
    pendingDest = r;
    destTitle.setText(r.title);
    destSubtitle.setText(r.subtitle);
    destCard.setVisibility(View.VISIBLE);
    setPickMarker(r.lon, r.lat);
    if (map != null) {
      setFollowing(false);
      map.animateCamera(CameraUpdateFactory.newCameraPosition(new CameraPosition.Builder()
          .target(new LatLng(r.lat, r.lon)).zoom(Math.min(map.getCameraPosition().zoom, 12)).tilt(0)
          .padding(0, 0, 0, 0).build()), 600);
    }
  }

  private void hideDestCard() {
    destCard.setVisibility(View.GONE);
    pendingDest = null;
    if (pickSource != null) pickSource.setGeoJson(FeatureCollection.fromFeatures(new Feature[0]));
  }

  private void setPickMarker(double lon, double lat) {
    if (pickSource != null) pickSource.setGeoJson(Feature.fromGeometry(Point.fromLngLat(lon, lat)));
  }

  /** Destination reached: drop the route and the red pin. */
  private void arrived() {
    if (route == null) return;
    Log.i(TAG, "arrived, clearing route");
    cancelRoute();
  }

  private void cancelRoute() {
    // Keep requestedDestNode so an ongoing job doesn't immediately re-route.
    nav.mutate("app.setActiveRoute", null, null);
    setRoute(null);
  }

  private void setRoute(Route r) {
    route = r;
    routeStep = -1;
    serverStepHint = 0;
    renderRoute();
    updateGuidance(true);
  }

  private void renderRoute() {
    if (style == null || routeSource == null) return;
    if (route == null || route.steps.isEmpty()) {
      routeSource.setGeoJson(FeatureCollection.fromFeatures(new Feature[0]));
      destSource.setGeoJson(FeatureCollection.fromFeatures(new Feature[0]));
      return;
    }
    List<Point> pts = new ArrayList<>();
    for (int i = Math.max(0, routeStep); i < route.steps.size(); i++) {
      double[] ll = route.steps.get(i).lonLat;
      for (int k = 0; k + 1 < ll.length; k += 2) pts.add(Point.fromLngLat(ll[k], ll[k + 1]));
    }
    if (pts.size() >= 2) routeSource.setGeoJson(Feature.fromGeometry(LineString.fromLngLats(pts)));
    Route.Step last = route.steps.get(route.steps.size() - 1);
    destSource.setGeoJson(Feature.fromGeometry(Point.fromLngLat(last.manLon, last.manLat)));
  }

  // --- per-frame camera + guidance -----------------------------------------------

  @Override
  public void doFrame(long frameTimeNanos) {
    if (!frameLoopRunning) return;
    Choreographer.getInstance().postFrameCallback(this);
    long now = SystemClock.uptimeMillis();
    if ("media".equals(screen) && now - lastMediaTickMs > 250) {
      lastMediaTickMs = now; // progress bar runs even without game telemetry
      mediaScreen.tick();
    }
    if (now - lastFrameMs < FRAME_INTERVAL_MS - 4 || map == null || !tracker.hasData()) return;
    lastFrameMs = now;

    tracker.poseAt(now, pose);
    if (!pose.valid) return;

    boolean mapShown = "map".equals(screen);
    if (following && mapShown) {
      double targetZoom = zoomForSpeed(pose.speed * 3.6);
      smoothedZoom += (targetZoom - smoothedZoom) * 0.03;
      int h = mapView.getHeight();
      double topPad = h * (2 * FOCUS_FROM_TOP - 1);
      map.moveCamera(CameraUpdateFactory.newCameraPosition(new CameraPosition.Builder()
          .target(new LatLng(pose.lat, pose.lon))
          .bearing(pose.bearingDeg())
          .tilt(FOLLOW_TILT)
          .zoom(smoothedZoom)
          .padding(0, topPad, 0, 0)
          .build()));
    } else if (mapShown && !following && truckSource != null && now - lastTruckSourceMs > 200) {
      lastTruckSourceMs = now;
      Feature f = Feature.fromGeometry(Point.fromLngLat(pose.lon, pose.lat));
      f.addNumberProperty("bearing", pose.bearingDeg());
      truckSource.setGeoJson(f);
    }

    if (now - lastGuidanceMs > GUIDANCE_INTERVAL_MS) {
      lastGuidanceMs = now;
      updateGuidance(false);
    }
    if (BuildConfig.DEBUG && now - lastDebugLogMs > 3000) {
      lastDebugLogMs = now;
      CameraPosition cam = map.getCameraPosition();
      Log.i(TAG, String.format(Locale.US, "pose %.5f,%.5f hdg=%.0f spd=%.1f | cam %.5f,%.5f z=%.2f b=%.0f t=%.0f",
          pose.lon, pose.lat, pose.bearingDeg(), pose.speed * 3.6,
          cam.target.getLongitude(), cam.target.getLatitude(), cam.zoom, cam.bearing, cam.tilt));
    }
    if (now - lastHudMs > 250) {
      lastHudMs = now;
      speedView.setText(String.valueOf(Math.round(Math.abs(pose.speed) * 3.6)));
      if (tracker.speedLimitKph > 0) {
        speedLimitView.setVisibility(View.VISIBLE);
        speedLimitView.setText(String.valueOf(Math.round(tracker.speedLimitKph)));
      } else {
        speedLimitView.setVisibility(View.GONE);
      }
    }
  }

  /** Map units are ~19x game meters, so these zooms feel like Google's 16-17. */
  private static double zoomForSpeed(double kph) {
    double k = Math.max(0, Math.min(1, kph / 100));
    return 14.0 - k * 1.4;
  }

  private void updateGuidance(boolean force) {
    if (route == null || route.steps.isEmpty() || !pose.valid) {
      maneuverPanel.setVisibility(View.GONE);
      tripPanel.setVisibility(View.GONE);
      if (home != null) home.setNav(null, null, null, 0);
      return;
    }
    int from = Math.max(Math.max(0, routeStep), serverStepHint);
    route.locate(pose.lon, pose.lat, Math.min(from, route.steps.size() - 1), progress);
    if (progress.stepIndex != routeStep || force) {
      routeStep = progress.stepIndex;
      renderRoute();
    }

    int nextIdx = routeStep + 1;
    // Fallback in case the server's segmentComplete never arrives.
    boolean nextIsArrival = nextIdx >= route.steps.size() - 1
        && route.steps.get(route.steps.size() - 1).direction == Route.ARRIVE;
    if (nextIsArrival && progress.metersToManeuver < 40) {
      flashMessage("Varış noktasına ulaştınız");
      arrived();
      return;
    }
    maneuverPanel.setVisibility(View.VISIBLE);
    if (nextIdx < route.steps.size()) {
      Route.Step next = route.steps.get(nextIdx);
      maneuverIcon.setDirection(next.direction);
      maneuverDistance.setText(formatDistance(progress.metersToManeuver));
      maneuverText.setText(describe(next));
      if (nextIdx + 1 < route.steps.size() && progress.metersToManeuver < 1500) {
        Route.Step after = route.steps.get(nextIdx + 1);
        if (after.direction != Route.THROUGH && route.steps.get(nextIdx).distanceMeters < 400) {
          thenIcon.setDirection(after.direction);
          thenPanel.setVisibility(View.VISIBLE);
        } else {
          thenPanel.setVisibility(View.GONE);
        }
      } else {
        thenPanel.setVisibility(View.GONE);
      }
    } else {
      maneuverIcon.setDirection(Route.ARRIVE);
      maneuverDistance.setText(formatDistance(progress.metersToManeuver));
      maneuverText.setText("Varış");
      thenPanel.setVisibility(View.GONE);
    }

    tripPanel.setVisibility(View.VISIBLE);
    long mins = Math.max(1, Math.round(progress.secondsRemaining / 60));
    tripTime.setText(mins >= 60 ? (mins / 60) + " sa " + (mins % 60) + " dk" : mins + " dk");
    String eta = new SimpleDateFormat("HH:mm", Locale.getDefault())
        .format(new Date(System.currentTimeMillis() + (long) (progress.secondsRemaining * 1000)));
    // Trip totals are shown like the game's route advisor (world meters x map
    // scale); maneuver distances stay in world meters, i.e. what you drive.
    tripDetail.setText(formatDistance(progress.metersRemaining * distanceScale()) + "  ·  " + eta);
    home.setNav(maneuverDistance.getText().toString(), maneuverText.getText().toString(),
        tripTime.getText() + "  ·  " + tripDetail.getText(),
        nextIdx < route.steps.size() ? route.steps.get(nextIdx).direction : Route.ARRIVE);
  }

  /** Map scale of the current game (ETS2 1:19, ATS 1:20). */
  private double distanceScale() {
    return "ats".equals(game) ? 20 : 19;
  }

  private static String describe(Route.Step s) {
    if (s.bannerText != null && !s.bannerText.isEmpty()) return s.bannerText;
    switch (s.direction) {
      case Route.SLIGHT_LEFT: return "Hafif sola";
      case Route.LEFT: return "Sola dönün";
      case Route.SHARP_LEFT: return "Keskin sola";
      case Route.U_TURN_LEFT: case Route.U_TURN_RIGHT: return "U dönüşü yapın";
      case Route.SLIGHT_RIGHT: return "Hafif sağa";
      case Route.RIGHT: return "Sağa dönün";
      case Route.SHARP_RIGHT: return "Keskin sağa";
      case Route.MERGE: return "Yola katılın";
      case Route.ARRIVE: return "Varış";
      case Route.FERRY: return "Feribota binin";
      case Route.ROUND_EXIT: return "Kavşaktan çıkın";
      default:
        if (s.direction >= Route.ROUND_BR && s.direction <= Route.ROUND_B) {
          return s.roundaboutExit > 0 ? "Döner kavşakta " + s.roundaboutExit + ". çıkış" : "Döner kavşak";
        }
        return "Düz devam edin";
    }
  }

  /** Same rounding rules as the web navigator (components/text.ts). */
  private static String formatDistance(double meters) {
    long m = Math.round(meters);
    if (m <= 100) return Math.max(10, Math.round(m / 10.0) * 10) + " m";
    if (m <= 1000) return (Math.round(m / 50.0) * 50) + " m";
    if (m < 10_000) return String.format(Locale.getDefault(), "%.1f km", m / 1000.0);
    return Math.round(m / 1000.0) + " km";
  }

  // --- UI helpers -----------------------------------------------------------------

  private void setFollowing(boolean follow) {
    following = follow;
    recenter.setVisibility(follow ? View.GONE : View.VISIBLE);
    truckArrow.setVisibility(follow && tracker.hasData() ? View.VISIBLE : View.GONE);
    if (style != null && style.getLayer("truck") != null) {
      style.getLayer("truck").setProperties(PropertyFactory.visibility(follow ? Property.NONE : Property.VISIBLE));
    }
  }

  private void placeTruckArrow() {
    View root = findViewById(R.id.root);
    FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) truckArrow.getLayoutParams();
    int size = lp.width;
    int left = (root.getWidth() - size) / 2;
    int top = (int) (root.getHeight() * FOCUS_FROM_TOP) - size / 2;
    // Called from a layout listener: only touch the params when they change,
    // otherwise every layout pass schedules another one.
    if (lp.leftMargin == left && lp.topMargin == top) return;
    lp.leftMargin = left;
    lp.topMargin = top;
    truckArrow.setLayoutParams(lp);
  }

  private void showSettings() {
    String[] items = {
        "PC adresi: " + host(),
        "Yeniden eşleş",
    };
    new AlertDialog.Builder(this)
        .setTitle("Ayarlar")
        .setItems(items, (d, which) -> {
          if (which == 0) showHostDialog();
          else {
            prefs.edit().remove("viewerId").apply();
            restartClients();
          }
        })
        .setNegativeButton("Kapat", null)
        .show();
  }

  private void showHostDialog() {
    EditText input = new EditText(this);
    input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
    input.setText(host());
    input.setHint("örn. 192.168.1.50");
    input.setSelectAllOnFocus(true);
    new AlertDialog.Builder(this)
        .setTitle("PC adresi (Rig Buddy çalışan bilgisayar)")
        .setMessage("PC'deki Rig Buddy penceresinde yazan adresi girin ya da otomatik bulmayı deneyin.")
        .setView(input)
        .setPositiveButton("Kaydet", (d, w) -> {
          prefs.edit().putString("host", input.getText().toString().trim()).apply();
          restartClients();
        })
        .setNeutralButton("Otomatik bul", (d, w) -> {
          showMessage("PC aranıyor…");
          PcFinder.find((found, name) -> {
            if (found != null) {
              useHost(found, name);
            } else {
              hideMessage();
              flashMessage("PC bulunamadı. Rig Buddy'nin açık ve aynı Wi-Fi'da olduğundan emin olun.");
              showHostDialog();
            }
          });
        })
        .setNegativeButton("İptal", null)
        .show();
  }

  private void showMessage(String text) {
    messageView.setText(text);
    messageView.setVisibility(View.VISIBLE);
  }

  private void hideMessage() {
    messageView.setVisibility(View.GONE);
  }

  private final Runnable hideMessageRunnable = this::hideMessage;

  private void flashMessage(String text) {
    showMessage(text);
    messageView.removeCallbacks(hideMessageRunnable);
    messageView.postDelayed(hideMessageRunnable, 6000);
  }

  private void hideSystemUi() {
    getWindow().getDecorView().setSystemUiVisibility(
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
  }

  // --- lifecycle ------------------------------------------------------------------

  @Override
  protected void onStart() {
    super.onStart();
    mapView.onStart();
    startClients();
  }

  @Override
  protected void onResume() {
    super.onResume();
    mapView.onResume();
    hideSystemUi();
    frameLoopRunning = true;
    Choreographer.getInstance().postFrameCallback(this);
  }

  @Override
  protected void onPause() {
    frameLoopRunning = false;
    mapView.onPause();
    super.onPause();
  }

  @Override
  protected void onStop() {
    screenHost.removeCallbacks(rediscover);
    nav.stop();
    agent.stop();
    mapView.onStop();
    super.onStop();
  }

  @Override
  public void onLowMemory() {
    super.onLowMemory();
    mapView.onLowMemory();
  }

  @Override
  protected void onSaveInstanceState(Bundle outState) {
    super.onSaveInstanceState(outState);
    mapView.onSaveInstanceState(outState);
  }

  @Override
  protected void onDestroy() {
    mapView.onDestroy();
    for (LocalTileServer s : tileServers.values()) s.stop();
    super.onDestroy();
  }
}
