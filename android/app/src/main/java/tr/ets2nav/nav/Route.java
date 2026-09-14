package tr.ets2nav.nav;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import tr.ets2nav.geo.Polyline;

/**
 * A navigation-server Route, flattened into a list of steps. A step's
 * maneuver happens at the *start* of the step; while driving along step i the
 * upcoming maneuver is step i+1's.
 */
public final class Route {
  // BranchType values from apis/navigation/constants.ts
  public static final int THROUGH = 0, SLIGHT_LEFT = 1, LEFT = 2, SHARP_LEFT = 3, U_TURN_LEFT = 4,
      SLIGHT_RIGHT = 11, RIGHT = 12, SHARP_RIGHT = 13, U_TURN_RIGHT = 14,
      ROUND_BR = 21, ROUND_R = 22, ROUND_TR = 23, ROUND_T = 24, ROUND_TL = 25, ROUND_L = 26,
      ROUND_BL = 27, ROUND_B = 28, ROUND_EXIT = 29,
      MERGE = -1, DEPART = -2, ARRIVE = -3, FERRY = -4;

  public static final class Step {
    public int direction;
    public int roundaboutExit;
    public int thenDirection = Integer.MIN_VALUE;
    public String bannerText;
    public double manLon, manLat;
    public double[] lonLat; // flat {lon, lat, ...}
    public double[] cumLen; // cumulative planar length per vertex (arbitrary units)
    public double distanceMeters, duration;
    public int nodesTraveled;
    public int segmentIndex, stepIndexInSegment;
  }

  public final String id;
  public final List<Step> steps = new ArrayList<>();
  public final double distanceMeters, duration;

  private Route(String id, double distanceMeters, double duration) {
    this.id = id;
    this.distanceMeters = distanceMeters;
    this.duration = duration;
  }

  public static Route parse(JSONObject json) {
    Route r = new Route(json.optString("id"), json.optDouble("distanceMeters"), json.optDouble("duration"));
    JSONArray segments = json.optJSONArray("segments");
    if (segments == null) return r;
    for (int si = 0; si < segments.length(); si++) {
      JSONArray steps = segments.optJSONObject(si).optJSONArray("steps");
      if (steps == null) continue;
      for (int i = 0; i < steps.length(); i++) {
        JSONObject js = steps.optJSONObject(i);
        Step s = new Step();
        s.segmentIndex = si;
        s.stepIndexInSegment = i;
        JSONObject man = js.optJSONObject("maneuver");
        if (man != null) {
          s.direction = man.optInt("direction");
          s.roundaboutExit = man.optInt("roundaboutExitNumber", 0);
          JSONArray ll = man.optJSONArray("lonLat");
          if (ll != null) {
            s.manLon = ll.optDouble(0);
            s.manLat = ll.optDouble(1);
          }
          JSONObject banner = man.optJSONObject("banner");
          if (banner != null) s.bannerText = banner.optString("text", null);
          JSONObject then = man.optJSONObject("thenHint");
          if (then != null) s.thenDirection = then.optInt("direction");
        }
        s.lonLat = Polyline.decode(js.optString("geometry", ""));
        s.cumLen = cumulative(s.lonLat);
        s.distanceMeters = js.optDouble("distanceMeters");
        s.duration = js.optDouble("duration");
        s.nodesTraveled = js.optInt("nodesTraveled");
        r.steps.add(s);
      }
    }
    return r;
  }

  /** Flat step index for a server RouteIndex, or -1. */
  public int flatIndex(int segmentIndex, int stepIndex) {
    for (int i = 0; i < steps.size(); i++) {
      Step s = steps.get(i);
      if (s.segmentIndex == segmentIndex && s.stepIndexInSegment == stepIndex) return i;
    }
    return -1;
  }

  /** Result of locating the truck along the route. */
  public static final class Progress {
    public int stepIndex;            // step being driven
    public double stepFraction;      // [0, 1] along that step
    public double metersToManeuver;  // to the start of step stepIndex + 1
    public double metersRemaining;
    public double secondsRemaining;
    public double offRouteLonLatDist; // planar distance to the step polyline (degrees, approx)
  }

  /**
   * Projects (lon, lat) onto steps [fromStep, fromStep + 2] and reports the
   * best match; searching a small window keeps it cheap and stable.
   */
  public void locate(double lon, double lat, int fromStep, Progress out) {
    int best = Math.max(0, Math.min(fromStep, steps.size() - 1));
    double bestFrac = 0, bestDist = Double.MAX_VALUE;
    double cosLat = Math.cos(Math.toRadians(lat));
    for (int i = Math.max(0, fromStep); i < Math.min(steps.size(), fromStep + 3); i++) {
      Step s = steps.get(i);
      double[] p = s.lonLat;
      if (p.length < 4) continue;
      double total = s.cumLen[s.cumLen.length - 1];
      for (int k = 0; k + 3 < p.length; k += 2) {
        double ax = p[k] * cosLat, ay = p[k + 1], bx = p[k + 2] * cosLat, by = p[k + 3];
        double px = lon * cosLat, py = lat;
        double dx = bx - ax, dy = by - ay;
        double l2 = dx * dx + dy * dy;
        double t = l2 == 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
        double qx = ax + t * dx - px, qy = ay + t * dy - py;
        double d = qx * qx + qy * qy;
        // small bias towards the current step to avoid flicker at step joints
        if (i > fromStep) d *= 1.05;
        if (d < bestDist) {
          bestDist = d;
          best = i;
          double along = s.cumLen[k / 2] + t * (s.cumLen[k / 2 + 1] - s.cumLen[k / 2]);
          bestFrac = total > 0 ? along / total : 1;
        }
      }
    }
    out.stepIndex = best;
    out.stepFraction = bestFrac;
    out.offRouteLonLatDist = Math.sqrt(bestDist);
    Step cur = steps.get(best);
    out.metersToManeuver = (1 - bestFrac) * cur.distanceMeters;
    double meters = out.metersToManeuver, secs = (1 - bestFrac) * cur.duration;
    for (int i = best + 1; i < steps.size(); i++) {
      meters += steps.get(i).distanceMeters;
      secs += steps.get(i).duration;
    }
    out.metersRemaining = meters;
    out.secondsRemaining = secs;
  }

  private static double[] cumulative(double[] ll) {
    int n = ll.length / 2;
    double[] cum = new double[Math.max(n, 1)];
    for (int i = 1; i < n; i++) {
      double cosLat = Math.cos(Math.toRadians(ll[2 * i + 1]));
      double dx = (ll[2 * i] - ll[2 * i - 2]) * cosLat, dy = ll[2 * i + 1] - ll[2 * i - 1];
      cum[i] = cum[i - 1] + Math.sqrt(dx * dx + dy * dy);
    }
    return cum;
  }
}
