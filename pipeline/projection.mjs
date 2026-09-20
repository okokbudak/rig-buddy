// Game coordinates <-> WGS84, the same spherical Lambert conformal conic the app
// uses (android geo/Projection.java, from truckermudgeon/maps projections.ts).
// The map is built in game metres - roads, lanes and junctions are exact there -
// and only projected to longitude / latitude at the very end.
const EARTH_RADIUS = 6_370_997;
const LENGTH_OF_DEGREE = (EARTH_RADIUS * Math.PI) / 180;
const UK_SCALE = 0.75;
const CALAIS_X = -31100, CALAIS_Y = -5500;
const isUkSector = (sx, sy) => sx <= -8 && sy <= -2 && !(sx === -8 && sy === -2);

const PARAMS = {
  ets2: { lat1: 37, lat2: 65, lat0: 50, lon0: 15, factorY: -0.000171570875, factorX: 0.0001729241463, offsetX: 16660, offsetY: 4150, ukHack: true },
  ats: { lat1: 33, lat2: 45, lat0: 39, lon0: -96, factorY: -0.00017706234, factorX: 0.000176689948, offsetX: 0, offsetY: 0, ukHack: false },
};

export function makeProjection(game) {
  const q = PARAMS[game];
  if (!q) throw new Error(`unknown game "${game}"`);
  const rad = d => (d * Math.PI) / 180;
  const p1 = rad(q.lat1), p2 = rad(q.lat2), p0 = rad(q.lat0);
  const n = Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
  const f = (Math.cos(p1) * Math.pow(Math.tan(Math.PI / 4 + p1 / 2), n)) / n;
  const rho0 = (EARTH_RADIUS * f) / Math.pow(Math.tan(Math.PI / 4 + p0 / 2), n);
  const lon0 = rad(q.lon0);

  /** Game (x, z) -> [lon, lat] in degrees. */
  function toLonLat(x, z) {
    const sx = Math.floor(x / 4000), sy = Math.floor(z / 4000);
    x -= q.offsetX;
    z -= q.offsetY;
    if (q.ukHack && isUkSector(sx, sy)) {
      x = (x + CALAIS_X / 2) * UK_SCALE;
      z = (z + CALAIS_Y / 2) * UK_SCALE;
    }
    const px = x * q.factorX * LENGTH_OF_DEGREE;
    const py = z * q.factorY * LENGTH_OF_DEGREE;
    const dy = rho0 - py;
    const rho = Math.sign(n) * Math.hypot(px, dy);
    const theta = Math.atan2(n > 0 ? px : -px, n > 0 ? dy : -dy);
    const lat = 2 * Math.atan(Math.pow((EARTH_RADIUS * f) / rho, 1 / n)) - Math.PI / 2;
    const lon = theta / n + lon0;
    return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
  }

  /** [lon, lat] in degrees -> game [x, z]. */
  function toGame(lonDeg, latDeg) {
    const lat = rad(latDeg), lon = rad(lonDeg);
    const rho = (EARTH_RADIUS * f) / Math.pow(Math.tan(Math.PI / 4 + lat / 2), n);
    const theta = n * (lon - lon0);
    const px = rho * Math.sin(theta);
    const py = rho0 - rho * Math.cos(theta);
    let x = px / q.factorX / LENGTH_OF_DEGREE;
    let z = py / q.factorY / LENGTH_OF_DEGREE;
    if (q.ukHack) {
      const xIfUk = x / UK_SCALE - CALAIS_X / 2 + q.offsetX;
      const zIfUk = z / UK_SCALE - CALAIS_Y / 2 + q.offsetY;
      if (isUkSector(Math.floor(xIfUk / 4000), Math.floor(zIfUk / 4000))) {
        x = x / UK_SCALE - CALAIS_X / 2;
        z = z / UK_SCALE - CALAIS_Y / 2;
      }
    }
    return [x + q.offsetX, z + q.offsetY];
  }

  return { toLonLat, toGame };
}
