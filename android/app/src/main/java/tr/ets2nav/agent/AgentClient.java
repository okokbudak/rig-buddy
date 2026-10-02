package tr.ets2nav.agent;

import android.os.Handler;
import android.os.Looper;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
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
 * Client for the PC-side ETS2 Nav agent (pc/agent): full telemetry and the in-game
 * radio over WebSocket, save-game data (profile, jobs) over HTTP. Callbacks run on
 * the main thread.
 */
public final class AgentClient {
  public static final int PORT = 62843;

  public interface Listener {
    /** Latest telemetry summary, or null when the game isn't sending data. */
    void onTelemetry(JSONObject t);

    /** A newer save was loaded on the PC (jobs/profile changed). */
    void onSaveChanged();

    /** The in-game radio station and song ({"name","genre","country","song"}), or null when it is off. */
    void onRadio(JSONObject radio);

    void onAgentConnected(boolean connected);
  }

  public interface JsonCallback {
    void onResult(JSONObject json, String error);
  }

  private final OkHttpClient http = new OkHttpClient.Builder()
      .connectTimeout(4, TimeUnit.SECONDS)
      .readTimeout(15, TimeUnit.SECONDS)
      .build();
  private final Handler main = new Handler(Looper.getMainLooper());
  private final Listener listener;
  private String host;
  private WebSocket ws;
  private boolean running;
  private boolean connected;

  public AgentClient(Listener listener) {
    this.listener = listener;
  }

  public boolean isConnected() {
    return connected;
  }

  public void start(String host) {
    this.host = host;
    running = true;
    connect();
  }

  public void stop() {
    running = false;
    connected = false;
    main.removeCallbacksAndMessages(null);
    if (ws != null) ws.close(1000, "bye");
    ws = null;
  }

  private void connect() {
    if (!running) return;
    Request req = new Request.Builder().url("ws://" + host + ":" + PORT + "/ws").build();
    ws = http.newWebSocket(req, new WebSocketListener() {
      @Override
      public void onOpen(WebSocket s, Response r) {
        main.post(() -> {
          connected = true;
          listener.onAgentConnected(true);
        });
      }

      @Override
      public void onMessage(WebSocket s, String text) {
        final JSONObject msg;
        try {
          msg = new JSONObject(text);
        } catch (JSONException e) {
          return;
        }
        main.post(() -> {
          if (s != ws) return;
          String type = msg.optString("type");
          if ("telemetry".equals(type)) listener.onTelemetry(msg.optJSONObject("data"));
          else if ("save".equals(type)) listener.onSaveChanged();
          else if ("radio".equals(type)) listener.onRadio(msg.optJSONObject("data"));
        });
      }

      @Override
      public void onFailure(WebSocket s, Throwable t, Response r) {
        main.post(() -> reconnect(s));
      }

      @Override
      public void onClosed(WebSocket s, int code, String reason) {
        main.post(() -> reconnect(s));
      }
    });
  }

  private void reconnect(WebSocket s) {
    if (s != ws || !running) return;
    ws = null;
    connected = false;
    listener.onAgentConnected(false);
    listener.onTelemetry(null);
    listener.onRadio(null);
    main.postDelayed(this::connect, 3000);
  }

  /** The agent's error codes in the app's language; other messages are shown as they are. */
  private static String errorText(String error, int httpCode) {
    if ("nosave".equals(error)) return Ui.s(R.string.home_waiting_save);
    return error.isEmpty() ? Ui.s(R.string.agent_error, httpCode) : error;
  }

  public void get(String path, JsonCallback cb) {
    Request req = new Request.Builder().url("http://" + host + ":" + PORT + path).build();
    http.newCall(req).enqueue(new Callback() {
      @Override
      public void onFailure(Call call, IOException e) {
        main.post(() -> cb.onResult(null, Ui.s(R.string.agent_unreachable)));
      }

      @Override
      public void onResponse(Call call, Response response) throws IOException {
        String body = response.body() != null ? response.body().string() : "";
        JSONObject json = null;
        try {
          json = new JSONObject(body);
        } catch (JSONException ignored) {
        }
        final JSONObject result = json;
        final boolean ok = response.isSuccessful();
        main.post(() -> {
          if (result == null) cb.onResult(null, Ui.s(R.string.agent_bad_reply));
          else if (!ok) cb.onResult(null, errorText(result.optString("error"), response.code()));
          else cb.onResult(result, null);
        });
      }
    });
  }
}
