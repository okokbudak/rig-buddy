package tr.ets2nav.geo;

/**
 * Game coordinates <-> WGS84, ported from truckermudgeon/maps
 * (packages/libs/map/projections.ts). Both games use a spherical Lambert
 * conformal conic projection whose parameters come from def/climate.sii.
 */
public final class Projection {
  private static final double EARTH_RADIUS = 6_370_997; // cancels out
  private static final double LENGTH_OF_DEGREE = EARTH_RADIUS * Math.PI / 180;

  public static final Projection ETS2 =
      new Projection(37, 65, 50, 15, -0.000171570875, 0.0001729241463, 16660, 4150, true);
  public static final Projection ATS =
      new Projection(33, 45, 39, -96, -0.00017706234, 0.000176689948, 0, 0, false);

  private final double n, f, rho0, lon0;
  private final double factorY, factorX;
  private final double offsetX, offsetY;
  private final boolean ukHack;

  private Projection(double lat1, double lat2, double lat0, double lon0Deg,
                     double factorY, double factorX, double offsetX, double offsetY, boolean ukHack) {
    double p1 = Math.toRadians(lat1), p2 = Math.toRadians(lat2), p0 = Math.toRadians(lat0);
    n = Math.log(Math.cos(p1) / Math.cos(p2))
        / Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
    f = Math.cos(p1) * Math.pow(Math.tan(Math.PI / 4 + p1 / 2), n) / n;
    rho0 = EARTH_RADIUS * f / Math.pow(Math.tan(Math.PI / 4 + p0 / 2), n);
    lon0 = Math.toRadians(lon0Deg);
    this.factorY = factorY;
    this.factorX = factorX;
    this.offsetX = offsetX;
    this.offsetY = offsetY;
    this.ukHack = ukHack;
  }

  /** Game (x, z) -> {lon, lat} in degrees. */
  public double[] toLonLat(double x, double z) {
    double sx = Math.floor(x / 4000), sy = Math.floor(z / 4000);
    x -= offsetX;
    z -= offsetY;
    if (ukHack && isUkSector(sx, sy)) {
      // UK content is authored at a slightly larger scale.
      x = (x + CALAIS_X / 2) * UK_SCALE;
      z = (z + CALAIS_Y / 2) * UK_SCALE;
    }
    double px = x * factorX * LENGTH_OF_DEGREE;
    double py = z * factorY * LENGTH_OF_DEGREE;
    // inverse LCC (sphere)
    double dy = rho0 - py;
    double rho = Math.copySign(Math.hypot(px, dy), n);
    double theta = Math.atan2(n > 0 ? px : -px, n > 0 ? dy : -dy);
    double lat = 2 * Math.atan(Math.pow(EARTH_RADIUS * f / rho, 1 / n)) - Math.PI / 2;
    double lon = theta / n + lon0;
    return new double[] {Math.toDegrees(lon), Math.toDegrees(lat)};
  }

  /** {lon, lat} in degrees -> game (x, z). */
  public double[] toGame(double lonDeg, double latDeg) {
    double lat = Math.toRadians(latDeg), lon = Math.toRadians(lonDeg);
    double rho = EARTH_RADIUS * f / Math.pow(Math.tan(Math.PI / 4 + lat / 2), n);
    double theta = n * (lon - lon0);
    double px = rho * Math.sin(theta);
    double py = rho0 - rho * Math.cos(theta);
    double x = px / factorX / LENGTH_OF_DEGREE;
    double z = py / factorY / LENGTH_OF_DEGREE;
    if (ukHack) {
      double xIfUk = x / UK_SCALE - CALAIS_X / 2 + offsetX;
      double zIfUk = z / UK_SCALE - CALAIS_Y / 2 + offsetY;
      if (isUkSector(Math.floor(xIfUk / 4000), Math.floor(zIfUk / 4000))) {
        x = x / UK_SCALE - CALAIS_X / 2;
        z = z / UK_SCALE - CALAIS_Y / 2;
      }
    }
    return new double[] {x + offsetX, z + offsetY};
  }

  private static final double UK_SCALE = 0.75;
  private static final double CALAIS_X = -31100, CALAIS_Y = -5500;

  // HACK from upstream: everything up-and-left of the sector containing Calais is UK.
  private static boolean isUkSector(double sx, double sy) {
    return sx <= -8 && sy <= -2 && !(sx == -8 && sy == -2);
  }
}
