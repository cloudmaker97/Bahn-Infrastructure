// Caching Proxy for live train data from Transitous.
// Verantwortung: Caching und Proxy-Steuerung (SRP).
// Implements 10-second caching burst and grid-alignment to protect external API rate limits.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_DIR } from '../config.js';
import { boundaryRings, normalizeTrips, type Coord } from '../utils/live-trips-utils.js';

export class TripsService {
  private cache = new Map<string, { data: unknown; ts: number }>();
  private readonly ttlMs = 10_000; // 10 Sekunden Caching Burst
  private boundaryRingsList: Coord[][] | null = null;

  constructor() {
    try {
      const boundaryPath = join(PUBLIC_DIR, 'de-boundary.geojson');
      const rawGeo = readFileSync(boundaryPath, 'utf8');
      const gj = JSON.parse(rawGeo);
      this.boundaryRingsList = boundaryRings(gj);
      console.log(`[TripsService] Deutschland-Grenze geladen (${this.boundaryRingsList.length} Ringe)`);
    } catch (e) {
      console.warn('[TripsService] Deutschland-Grenze konnte nicht geladen werden, Geofilter inaktiv:', e);
    }
  }

  /**
   * Retrieves live trips for the given bounds and time, using a 10s grid-aligned cache.
   * Normalisiert und filtert die Daten serverseitig.
   * @param min Coordinates of south-west corner (lat,lon)
   * @param max Coordinates of north-east corner (lat,lon)
   * @param startTime Start of range
   * @param endTime End of range
   * @param zoom Map zoom level
   */
  async getTrips(
    min: string,
    max: string,
    startTime: string | null,
    endTime: string | null,
    zoom: string | null
  ): Promise<unknown> {
    // 1. Parse bounding box coordinates
    const [minLat, minLng] = min.split(',').map(Number);
    const [maxLat, maxLng] = max.split(',').map(Number);

    if (minLat == null || minLng == null || maxLat == null || maxLng == null ||
        isNaN(minLat) || isNaN(minLng) || isNaN(maxLat) || isNaN(maxLng)) {
      throw new Error('Invalid bounding box coordinates');
    }

    // 2. Align to 0.5-degree grid to map multiple nearby viewports to the same cache key.
    // This allows panning slightly without triggering new API requests.
    const gridMinLat = Math.floor(minLat / 0.5) * 0.5;
    const gridMinLng = Math.floor(minLng / 0.5) * 0.5;
    const gridMaxLat = Math.ceil(maxLat / 0.5) * 0.5;
    const gridMaxLng = Math.ceil(maxLng / 0.5) * 0.5;

    // 3. Align startTime to the nearest 10 seconds to maximize cache hits.
    const nowMs = Date.now();
    const requestTimeMs = startTime ? Date.parse(startTime) : nowMs;
    const alignedStartMs = Math.floor(requestTimeMs / 10000) * 10000;
    const alignedEndMs = alignedStartMs + 30000; // 30 seconds span

    const alignedStart = new Date(alignedStartMs).toISOString();
    const alignedEnd = new Date(alignedEndMs).toISOString();
    const activeZoom = zoom || '6';

    // 4. Check cache
    const cacheKey = `${gridMinLat.toFixed(1)},${gridMinLng.toFixed(1)},${gridMaxLat.toFixed(1)},${gridMaxLng.toFixed(1)}|${alignedStart}|${activeZoom}`;
    const cached = this.cache.get(cacheKey);
    if (cached && nowMs - cached.ts < this.ttlMs) {
      return cached.data;
    }

    // 5. Fetch from Transitous API
    const url = `https://api.transitous.org/api/v6/map/trips?min=${gridMinLat},${gridMinLng}&max=${gridMaxLat},${gridMaxLng}&startTime=${alignedStart}&endTime=${alignedEnd}&zoom=${activeZoom}`;
    
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Bahn-Infrastructure/1.0; +https://github.com/cloudmaker97/Bahn-Infrastructure)',
        'Accept': 'application/json',
      },
    });

    if (!resp.ok) {
      throw new Error(`Transitous API returned HTTP ${resp.status}`);
    }

    const rawData = await resp.json();

    // 6. Server-side normalization and boundary filtering
    const normalized = normalizeTrips(rawData, nowMs, this.boundaryRingsList);

    this.cache.set(cacheKey, { data: normalized, ts: nowMs });

    // Clean up stale cache items to prevent memory leak
    for (const [k, v] of this.cache.entries()) {
      if (nowMs - v.ts > this.ttlMs * 3) {
        this.cache.delete(k);
      }
    }

    return normalized;
  }
}

