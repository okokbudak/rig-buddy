package tr.ets2nav.geo;

/** Google encoded-polyline decoder (precision 5). */
public final class Polyline {
  private Polyline() {}

  /**
   * Decodes into a flat array of coordinate pairs, in the order they were
   * encoded. The navigation server encodes [lon, lat] pairs, so for its route
   * geometry the result is {lon0, lat0, lon1, lat1, ...}.
   */
  public static double[] decode(String encoded) {
    int len = encoded.length();
    double[] out = new double[len]; // upper bound: >= 2 chars per value
    int count = 0, index = 0;
    long a = 0, b = 0;
    while (index < len) {
      long[] r = next(encoded, index);
      a += r[0];
      index = (int) r[1];
      r = next(encoded, index);
      b += r[0];
      index = (int) r[1];
      out[count++] = a / 1e5;
      out[count++] = b / 1e5;
    }
    double[] trimmed = new double[count];
    System.arraycopy(out, 0, trimmed, 0, count);
    return trimmed;
  }

  private static long[] next(String s, int index) {
    long result = 0;
    int shift = 0, c;
    do {
      c = s.charAt(index++) - 63;
      result |= (long) (c & 0x1f) << shift;
      shift += 5;
    } while (c >= 0x20);
    long delta = (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
    return new long[] {delta, index};
  }
}
