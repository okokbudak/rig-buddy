package tr.ets2nav.nav;

import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;

import tr.ets2nav.R;
import tr.ets2nav.ui.Ui;

/**
 * Minimal tRPC v11 WebSocket client for the truckermudgeon navigation server
 * (apis/navigation), speaking the same protocol as its web navigator app:
 *
 *   -> {"method":"connectionParams","data":{"viewerId":"..."}|null}
 *   -> {"id":1,"method":"mutation","params":{"path":"app.redeemCode","input":{"code":"abcd"}}}
 *   -> {"id":2,"method":"subscription","params":{"path":"app.subscribeToDevice"}}
 *   <- {"id":2,"result":{"type":"data","data":{"type":"positionUpdate","data":{...}}}}
 *
 * Pairing is automatic: the (locally patched) server exposes the current
 * pairing code at GET /local/pairing-code.
 *
 * All listener callbacks run on the main thread.
 */
public final class NavClient {
  private static final String TAG = "NavClient";
  private static final int PORT = 62840;
  private static final String ORIGIN = "http://ets2nav.local";
  private static final String PREF_VIEWER_ID = "viewerId";

  public enum State { DISCONNECTED, CONNECTING, PAIRING, CONNECTED }

  public interface Listener {
    void onStateChanged(State state, String detail);

    /** An ActorEvent from app.subscribeToDevice; data may be JSONObject, JSONArray, String or NULL. */
    void onEvent(String type, Object data);
  }

  public interface ResultCallback {
    void onResult(Object data, String error);
  }

  private final OkHttpClient http = new OkHttpClient.Builder()
      .connectTimeout(4, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.MILLISECONDS)
      .pingInterval(0, TimeUnit.SECONDS)
      .build();
  private final Handler main = new Handler(Looper.getMainLooper());
  private final SharedPreferences prefs;
  private final Listener listener;

  private String host;
  private WebSocket ws;
  private int nextId = 1;
  private int subscriptionId = -1;
  private final Map<Integer, ResultCallback> pending = new HashMap<>();
  private boolean usingStoredViewerId;
  private boolean running;
  private int reconnectDelayMs = 1000;

  public NavClient(SharedPreferences prefs, Listener listener) {
    this.prefs = prefs;
    this.listener = listener;
  }

  public void start(String host) {
    this.host = host;
    running = true;
    connect();
  }

  public void stop() {
    running = false;
    main.removeCallbacksAndMessages(null);
    if (ws != null) ws.close(1000, "bye");
    ws = null;
  }

  public void query(String path, Object input, ResultCallback cb) {
    send("query", path, input, cb);
  }

  public void mutate(String path, Object input, ResultCallback cb) {
    send("mutation", path, input, cb);
  }

  // --- connection lifecycle -------------------------------------------------

  private void connect() {
    if (!running) return;
    setState(State.CONNECTING, host);
    Request req = new Request.Builder()
        .url("ws://" + host + ":" + PORT + "/navigator?connectionParams=1")
        .header("Origin", ORIGIN)
        .header("User-Agent", "ets2nav-android")
        .build();
    ws = http.newWebSocket(req, new Socket());
  }

  private void scheduleReconnect(String why) {
    if (!running) return;
    ws = null;
    // Fail queries, but not the subscription: a dropped socket must not be
    // mistaken for a rejected viewerId (which would force a re-pair).
    pending.remove(subscriptionId);
    subscriptionId = -1;
    failPending(why);
    setState(State.DISCONNECTED, why);
    main.postDelayed(this::connect, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 8000);
  }

  private final class Socket extends WebSocketListener {
    @Override
    public void onOpen(WebSocket webSocket, Response response) {
      main.post(() -> {
        if (webSocket != ws) return;
        reconnectDelayMs = 1000;
        String viewerId = prefs.getString(PREF_VIEWER_ID, null);
        JSONObject params = new JSONObject();
        try {
          params.put("method", "connectionParams");
          params.put("data", viewerId == null ? JSONObject.NULL : new JSONObject().put("viewerId", viewerId));
        } catch (JSONException e) {
          throw new IllegalStateException(e);
        }
        webSocket.send(params.toString());
        if (viewerId != null) {
          usingStoredViewerId = true;
          subscribe();
        } else {
          pair();
        }
      });
    }

    @Override
    public void onMessage(WebSocket webSocket, String text) {
      if ("PING".equals(text)) {
        webSocket.send("PONG");
        return;
      }
      final JSONObject msg;
      try {
        msg = new JSONObject(text);
      } catch (JSONException e) {
        Log.w(TAG, "bad message: " + text);
        return;
      }
      main.post(() -> {
        if (webSocket == ws) handleMessage(msg);
      });
    }

    @Override
    public void onClosed(WebSocket webSocket, int code, String reason) {
      main.post(() -> {
        if (webSocket == ws) scheduleReconnect(Ui.s(R.string.nav_closed, code));
      });
    }

    @Override
    public void onFailure(WebSocket webSocket, Throwable t, Response response) {
      main.post(() -> {
        if (webSocket == ws) scheduleReconnect(t.getClass().getSimpleName() + ": " + t.getMessage());
      });
    }
  }

  // --- pairing / subscription ----------------------------------------------

  private void pair() {
    setState(State.PAIRING, Ui.s(R.string.nav_requesting_code));
    Request req = new Request.Builder().url("http://" + host + ":" + PORT + "/local/pairing-code").build();
    final WebSocket forSocket = ws;
    http.newCall(req).enqueue(new Callback() {
      @Override
      public void onFailure(Call call, IOException e) {
        main.post(() -> retryPairing(forSocket, Ui.s(R.string.nav_code_failed, e.getMessage())));
      }

      @Override
      public void onResponse(Call call, Response response) throws IOException {
        String body = response.body() != null ? response.body().string() : "";
        String code = null;
        try {
          code = new JSONObject(body).optString("code", null);
        } catch (JSONException ignored) {
        }
        final String finalCode = code;
        main.post(() -> {
          if (forSocket != ws) return;
          if (finalCode == null) {
            retryPairing(forSocket, Ui.s(R.string.nav_no_telemetry_client));
            return;
          }
          redeem(finalCode);
        });
      }
    });
  }

  private void retryPairing(WebSocket forSocket, String why) {
    if (forSocket != ws || !running) return;
    setState(State.PAIRING, why);
    main.postDelayed(() -> {
      if (forSocket == ws) pair();
    }, 3000);
  }

  private void redeem(String code) {
    JSONObject input = new JSONObject();
    try {
      input.put("code", code);
    } catch (JSONException e) {
      throw new IllegalStateException(e);
    }
    final WebSocket forSocket = ws;
    mutate("app.redeemCode", input, (data, error) -> {
      if (forSocket != ws) return;
      if (error != null || !(data instanceof JSONObject)) {
        retryPairing(forSocket, Ui.s(R.string.nav_pairing_failed, error));
        return;
      }
      prefs.edit().putString(PREF_VIEWER_ID, ((JSONObject) data).optString("viewerId")).apply();
      usingStoredViewerId = false;
      subscribe();
    });
  }

  private void subscribe() {
    subscriptionId = send("subscription", "app.subscribeToDevice", null, (data, error) -> {
      // Only called for errors: subscription data is dispatched as events.
      if (error == null) return;
      Log.w(TAG, "subscription error: " + error);
      subscriptionId = -1;
      if (usingStoredViewerId) {
        // Server restarted (in-memory KV) or the binding went stale: re-pair.
        prefs.edit().remove(PREF_VIEWER_ID).apply();
        usingStoredViewerId = false;
        if (ws != null) ws.close(1000, "re-pair");
      } else {
        setState(State.PAIRING, Ui.s(R.string.nav_subscribe_failed, error));
      }
    });
  }

  // --- messages -----------------------------------------------------------

  private int send(String method, String path, Object input, ResultCallback cb) {
    if (ws == null) {
      if (cb != null) cb.onResult(null, Ui.s(R.string.nav_not_connected));
      return -1;
    }
    int id = nextId++;
    try {
      JSONObject params = new JSONObject().put("path", path);
      if (input != null) params.put("input", input);
      JSONObject msg = new JSONObject().put("id", id).put("method", method).put("params", params);
      if (cb != null) pending.put(id, cb);
      ws.send(msg.toString());
    } catch (JSONException e) {
      throw new IllegalStateException(e);
    }
    return id;
  }

  private void handleMessage(JSONObject msg) {
    int id = msg.optInt("id", -1);
    JSONObject error = msg.optJSONObject("error");
    if (error != null) {
      ResultCallback cb = pending.remove(id);
      String text = error.optString("message", "error");
      JSONObject data = error.optJSONObject("data");
      if (data != null) text = data.optString("code", "") + ": " + text;
      if (cb != null) cb.onResult(null, text);
      else Log.w(TAG, "error for id " + id + ": " + text);
      return;
    }
    JSONObject result = msg.optJSONObject("result");
    if (result == null) return;
    String type = result.optString("type");
    if (id == subscriptionId) {
      if ("started".equals(type)) {
        setState(State.CONNECTED, null);
      } else if ("data".equals(type)) {
        JSONObject event = result.optJSONObject("data");
        if (event != null) listener.onEvent(event.optString("type"), event.opt("data"));
      } else if ("stopped".equals(type)) {
        pending.remove(id);
        subscriptionId = -1;
        if (ws != null) ws.close(1000, "subscription stopped");
      }
      return;
    }
    ResultCallback cb = pending.remove(id);
    if (cb != null && "data".equals(type)) cb.onResult(result.opt("data"), null);
  }

  private void failPending(String why) {
    Map<Integer, ResultCallback> copy = new HashMap<>(pending);
    pending.clear();
    for (ResultCallback cb : copy.values()) cb.onResult(null, why);
  }

  private void setState(State state, String detail) {
    listener.onStateChanged(state, detail);
  }

  /** Helper for callers that expect arrays (e.g. previewRoutes). */
  public static JSONArray asArray(Object data) {
    return data instanceof JSONArray ? (JSONArray) data : new JSONArray();
  }
}
