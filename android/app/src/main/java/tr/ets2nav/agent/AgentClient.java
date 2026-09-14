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

/**
 * Client for the PC-side ETS2 Nav agent (pc/agent): full telemetry and media
 * over WebSocket, save-game data (profile, jobs) over HTTP. Callbacks run on
 * the main thread.
 */
public final class AgentClient {
  public static final int PORT = 62843;

  public interface Listener {
    /** Latest telemetry summary, or null when the game isn't sending data. */
    void onTelemetry(JSONObject t);

    /** A newer save was loaded on the PC (jobs/profile changed). */
    void onSaveChanged();

    /** PC media sessions + in-game radio ({"sessions","current","appVolume","masterVolume","radio"}). */
    void onMedia(JSONObject media);

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

  public AgentClient(Listener listener) {
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

  private void connect() {
    if (!running) return;
    Request req = new Request.Builder().url("ws://" + host + ":" + PORT + "/ws").build();
    ws = http.newWebSocket(req, new WebSocketListener() {
      @Override
      public void onOpen(WebSocket s, Response r) {
        main.post(() -> listener.onAgentConnected(true));
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
          else if ("media".equals(type)) listener.onMedia(msg.optJSONObject("data"));
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
    listener.onAgentConnected(false);
    listener.onTelemetry(null);
    main.postDelayed(this::connect, 3000);
  }

  /** Fire-and-forget media command, e.g. {"cmd":"toggle"}. */
  public void mediaCommand(JSONObject cmd) {
    if (host == null) return;
    Request req = new Request.Builder()
        .url("http://" + host + ":" + PORT + "/media/cmd")
        .post(okhttp3.RequestBody.create(cmd.toString(), okhttp3.MediaType.get("application/json")))
        .build();
    http.newCall(req).enqueue(new Callback() {
      @Override public void onFailure(Call call, IOException e) {}
      @Override public void onResponse(Call call, Response response) { response.close(); }
    });
  }

  public interface BitmapCallback {
    void onBitmap(android.graphics.Bitmap bmp);
  }

  /** Album art for a key from the media state (decoded off the main thread). */
  public void loadArt(String key, BitmapCallback cb) {
    Request req = new Request.Builder().url("http://" + host + ":" + PORT + "/media/art/" + key).build();
    http.newCall(req).enqueue(new Callback() {
      @Override
      public void onFailure(Call call, IOException e) {
        main.post(() -> cb.onBitmap(null));
      }

      @Override
      public void onResponse(Call call, Response response) throws IOException {
        byte[] bytes = response.isSuccessful() && response.body() != null ? response.body().bytes() : null;
        response.close();
        android.graphics.Bitmap bmp = bytes != null ? android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length) : null;
        main.post(() -> cb.onBitmap(bmp));
      }
    });
  }

  public void get(String path, JsonCallback cb) {
    Request req = new Request.Builder().url("http://" + host + ":" + PORT + path).build();
    http.newCall(req).enqueue(new Callback() {
      @Override
      public void onFailure(Call call, IOException e) {
        main.post(() -> cb.onResult(null, "PC'deki agent'a ulaşılamadı"));
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
          if (result == null) cb.onResult(null, "geçersiz cevap");
          else if (!ok) cb.onResult(null, result.optString("error", "hata " + response.code()));
          else cb.onResult(result, null);
        });
      }
    });
  }
}
