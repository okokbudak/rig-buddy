package tr.ets2nav.nav;

import android.os.SystemClock;

import org.json.JSONObject;

import tr.ets2nav.geo.Projection;

/**
 * Turns the server's ~2 Hz positionUpdate events into a smooth per-frame truck
 * pose. Rendering runs a fixed delay behind the newest sample so it can
 * interpolate between two real samples (no rubber-banding); if samples stop
 * arriving it dead-reckons from the last one for up to a second.
 */
public final class TruckTracker {
  /** Must exceed the push interval (500 ms) plus network jitter. */
  private static final long DELAY_MS = 600;
  private static final long MAX_EXTRAPOLATE_MS = 1000;
  private static final double TELEPORT_METERS = 150;
  private static final int CAPACITY = 8;

  public static final class Pose {
    public double x, z;        // game meters
    public double heading;     // game heading: turns in [0, 1), 0 = north (-z), counter-clockwise
    public double speed;       // m/s
    public double lon, lat;
    public double bearing;     // map bearing: degrees clockwise from geographic north
    public boolean valid;

    public double bearingDeg() {
      return bearing;
    }
  }

  private static final class Sample {
    double t; // game ms
    double x, z, heading, speed;
  }

  private final Sample[] ring = new Sample[CAPACITY];
  private int count, head; // head = index of newest
  private double clockOffset = Double.NaN; // local ms - game ms
  private double lastRenderT = Double.NEGATIVE_INFINITY;
  private Projection projection = Projection.ETS2;

  public String game = "ets2";
  public boolean paused;
  public double speedLimitKph;
  public double scale;

  public TruckTracker() {
    for (int i = 0; i < CAPACITY; i++) ring[i] = new Sample();
  }

  public boolean hasData() {
    return count > 0;
  }

  /** Feeds a GameState (positionUpdate.data). */
  public void onPositionUpdate(JSONObject s) {
    JSONObject pos = s.optJSONObject("position");
    if (pos == null) return;
    String g = s.optString("game", game);
    if (!g.equals(game)) {
      game = g;
      projection = "ats".equals(g) ? Projection.ATS : Projection.ETS2;
      count = 0;
    }
    paused = s.optBoolean("paused");
    JSONObject limit = s.optJSONObject("speedLimit");
    speedLimitKph = limit != null ? limit.optDouble("kph", 0) : 0;
    scale = s.optDouble("scale", 0);

    double t = s.optDouble("t");
    // GameState positions are in map space: x = game X, y = game Z (south),
    // z = elevation. (Telemetry's X/Y/Z get remapped server-side.)
    double x = pos.optDouble("x"), z = pos.optDouble("y");
    long now = SystemClock.uptimeMillis();

    if (count > 0) {
      Sample last = ring[head];
      boolean teleported = Math.hypot(x - last.x, z - last.z) > TELEPORT_METERS;
      if (t <= last.t && !teleported) {
        // paused or duplicate: keep the latest pose but refresh speed/heading
        last.heading = s.optDouble("heading");
        last.speed = s.optDouble("speed");
        clockOffset = now - last.t; // freeze render time at the newest sample
        return;
      }
      if (teleported) count = 0;
    }
    if (count == 0) {
      clockOffset = now - t;
      lastRenderT = Double.NEGATIVE_INFINITY;
    } else {
      // Track the fastest-arriving sample so jitter doesn't push us into extrapolation.
      double observed = now - t;
      clockOffset = observed < clockOffset ? observed : clockOffset * 0.98 + observed * 0.02;
    }
    head = (head + 1) % CAPACITY;
    Sample n = ring[head];
    n.t = t;
    n.x = x;
    n.z = z;
    n.heading = s.optDouble("heading");
    n.speed = s.optDouble("speed");
    count = Math.min(count + 1, CAPACITY);
  }

  /** Computes the pose to draw right now. */
  public void poseAt(long nowMs, Pose out) {
    out.valid = count > 0;
    if (!out.valid) return;
    Sample newest = ring[head];
    double t = paused ? newest.t : nowMs - clockOffset - DELAY_MS;
    if (t < lastRenderT) t = lastRenderT; // never step backwards
    lastRenderT = t;

    Sample a = null, b = null;
    for (int i = 0; i < count - 1; i++) {
      Sample s1 = ring[(head - i + CAPACITY) % CAPACITY];
      Sample s0 = ring[(head - i - 1 + CAPACITY) % CAPACITY];
      if (s0.t <= t && t <= s1.t) {
        a = s0;
        b = s1;
        break;
      }
    }
    if (a != null) {
      double f = (t - a.t) / Math.max(1, b.t - a.t);
      out.x = a.x + (b.x - a.x) * f;
      out.z = a.z + (b.z - a.z) * f;
      out.heading = (a.heading + wrap(b.heading - a.heading) * f + 1) % 1;
      out.speed = a.speed + (b.speed - a.speed) * f;
    } else if (t > newest.t) {
      double dt = Math.min(t - newest.t, MAX_EXTRAPOLATE_MS) / 1000.0;
      out.heading = newest.heading;
      out.speed = newest.speed;
      double rad = newest.heading * 2 * Math.PI;
      out.x = newest.x - Math.sin(rad) * newest.speed * dt;
      out.z = newest.z - Math.cos(rad) * newest.speed * dt;
    } else {
      Sample oldest = ring[(head - count + 1 + CAPACITY) % CAPACITY];
      out.x = oldest.x;
      out.z = oldest.z;
      out.heading = oldest.heading;
      out.speed = oldest.speed;
    }
    double[] ll = projection.toLonLat(out.x, out.z);
    out.lon = ll[0];
    out.lat = ll[1];
    // Game north isn't map north away from the projection's central meridian,
    // so derive the bearing from a point projected 100 m ahead (like the server's
    // toPosAndBearing).
    double rad = out.heading * 2 * Math.PI;
    double[] ahead = projection.toLonLat(out.x - Math.sin(rad) * 100, out.z - Math.cos(rad) * 100);
    double dEast = (ahead[0] - out.lon) * Math.cos(Math.toRadians(out.lat));
    double dNorth = ahead[1] - out.lat;
    double deg = Math.toDegrees(Math.atan2(dEast, dNorth));
    out.bearing = deg < 0 ? deg + 360 : deg;
  }

  public Projection projection() {
    return projection;
  }

  /** Shortest signed difference between two headings, in turns. */
  private static double wrap(double a) {
    while (a > 0.5) a -= 1;
    while (a < -0.5) a += 1;
    return a;
  }
}
