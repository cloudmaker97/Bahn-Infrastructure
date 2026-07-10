// Google encoded-polyline decoding (Transitous: precision 5).
// Pure function, used by the server (normalization/DE filter) and web (track building).

/** A point as [lat, lon]. */
export type LatLon = [number, number];

/**
 * Decodes a Google encoded polyline into [[lat, lon], …].
 * @param str encoded polyline
 * @param precision decimal-place factor (Transitous: 5)
 */
export function decodePolyline(str: string, precision = 5): LatLon[] {
  let idx = 0;
  let lat = 0;
  let lon = 0;
  const out: LatLon[] = [];
  const f = Math.pow(10, precision);
  while (idx < str.length) {
    let b = 0;
    let shift = 0;
    let res = 0;
    do {
      b = str.charCodeAt(idx++) - 63;
      res |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += res & 1 ? ~(res >> 1) : res >> 1;
    shift = 0;
    res = 0;
    do {
      b = str.charCodeAt(idx++) - 63;
      res |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lon += res & 1 ? ~(res >> 1) : res >> 1;
    out.push([lat / f, lon / f]);
  }
  return out;
}
