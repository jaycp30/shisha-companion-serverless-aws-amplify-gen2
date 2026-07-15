// Nearby shisha-lounge search via free OpenStreetMap services — no API key, no billing.
//  - Overpass API: queries OSM for amenity=hookah_lounge venues near a point. That tag
//    is the one with real coverage (verified against live Tokyo data); name-matching
//    returned nothing useful.
//  - Nominatim: turns a typed city name into coordinates.
//
// Both are donated community servers. We stay within their fair-use rules by identifying
// through the browser Referer (sent automatically) and making at most one request per
// user action. Coverage is crowd-sourced, so results are patchy — great in big cities,
// sparse elsewhere. That's the accepted trade for not paying for Google Places.

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DEFAULT_RADIUS_KM = 15;
const EARTH_RADIUS_KM = 6371;

// Where "suggest a lounge" notes are posted. Defaults to the LIVE OSM map; point at the
// dev sandbox (https://api06.dev.openstreetmap.org) via VITE_OSM_API_BASE while testing,
// so you never write throwaway notes to real OpenStreetMap.
const OSM_API_BASE =
  (import.meta.env.VITE_OSM_API_BASE as string | undefined) ?? 'https://api.openstreetmap.org';
// If a mapped lounge is already within this distance, the user's spot is "already on the
// map" and we don't offer to suggest a new one.
export const SUGGEST_NEAR_KM = 0.15;
// A device fix coarser than this (metres) is too imprecise to place a map suggestion —
// dropping a note on a bad fix pollutes the shared map.
export const MAX_SUGGEST_ACCURACY_M = 250;

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Human-readable origin, e.g. "your location" or "渋谷区, 東京都". */
  label: string;
  /** How the point was obtained. Only a 'device' fix can seed a map suggestion — a typed
      city means the user is not physically at the venue. */
  source: 'device' | 'geocoded';
  /** Device-fix accuracy in metres, when known — guards against a note on a bad fix. */
  accuracyMeters?: number;
}

export interface Cafe {
  id: number;
  name: string;
  lat: number;
  lon: number;
  distanceKm: number;
}

/** Errors carrying a message safe to show the user. */
export class NearbyError extends Error {}

// Great-circle distance so we can sort results by nearest and show "3.2 km away".
function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Ask the browser for the user's position. The permission prompt is the user's to grant. */
export function getBrowserLocation(): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new NearbyError("This browser can't share a location — try typing a city."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          label: 'your location',
          source: 'device',
          accuracyMeters: pos.coords.accuracy,
        }),
      () =>
        reject(new NearbyError("Couldn't get your location — type a city instead.")),
      { timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

/** Geocode a typed place name to coordinates (Nominatim). */
export async function geocodeCity(query: string): Promise<GeoPoint> {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=json&limit=1`;
  let data: Array<{ lat: string; lon: string; display_name: string }>;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    throw new NearbyError("Couldn't reach the map service — check your connection.");
  }
  if (data.length === 0) {
    throw new NearbyError(`Couldn't find "${query}" — try a nearby city or district.`);
  }
  return {
    lat: Number(data[0].lat),
    lon: Number(data[0].lon),
    label: data[0].display_name.split(',').slice(0, 2).join(',').trim(),
    source: 'geocoded',
  };
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Find shisha lounges within `radiusKm` of an origin, nearest first. */
export async function findNearbyCafes(
  origin: GeoPoint,
  radiusKm: number = DEFAULT_RADIUS_KM,
): Promise<Cafe[]> {
  const radiusM = Math.round(radiusKm * 1000);
  // nwr = nodes, ways AND relations; `out center` gives ways/relations a single point.
  const query = `[out:json][timeout:25];nwr["amenity"="hookah_lounge"](around:${radiusM},${origin.lat},${origin.lon});out center;`;

  let elements: OverpassElement[];
  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    elements = (await res.json()).elements ?? [];
  } catch {
    throw new NearbyError("The lounge finder is busy right now — try again in a moment.");
  }

  return elements
    .map((el): Cafe | null => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (lat === undefined || lon === undefined) return null;
      return {
        id: el.id,
        name: el.tags?.name ?? 'Unnamed shisha lounge',
        lat,
        lon,
        distanceKm: haversineKm(origin.lat, origin.lon, lat, lon),
      };
    })
    .filter((cafe): cafe is Cafe => cafe !== null)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** A maps link for a venue — just a URL, no API. */
export function mapsLink(cafe: Cafe): string {
  return `https://www.openstreetmap.org/?mlat=${cafe.lat}&mlon=${cafe.lon}#map=18/${cafe.lat}/${cafe.lon}`;
}

/**
 * Post an anonymous OSM "note" suggesting a lounge at the given point — a lightweight
 * "someone should map this here" flag a real mapper reviews, NOT a direct edit to the map.
 * Notes are the responsible, low-blast-radius way for an app to contribute: no OAuth, no
 * silent mutation of shared data, and a human in the loop before anything lands.
 *
 * `point` MUST be a device fix — a suggestion is only meaningful when the user is
 * physically at the venue, and only a good-enough fix may place it.
 */
export async function suggestLounge(point: GeoPoint, name: string): Promise<void> {
  const cleanName = name.trim();
  if (cleanName.length === 0) {
    throw new NearbyError('Give the lounge a name first.');
  }
  if (point.source !== 'device') {
    throw new NearbyError('Suggestions can only come from your current location.');
  }
  if (point.accuracyMeters !== undefined && point.accuracyMeters > MAX_SUGGEST_ACCURACY_M) {
    throw new NearbyError(
      `Your location is only accurate to about ${Math.round(
        point.accuracyMeters,
      )} m — too imprecise to place on the map.`,
    );
  }

  const text =
    `Possible shisha / hookah lounge here: "${cleanName}". ` +
    `Reported by a visitor on-site via the Shisha Companion app — please verify before ` +
    `mapping (suggested tag: amenity=hookah_lounge).`;

  const url =
    `${OSM_API_BASE}/api/0.6/notes.json` +
    `?lat=${point.lat}&lon=${point.lon}&text=${encodeURIComponent(text)}`;

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST' });
  } catch {
    // A CORS rejection also lands here. If that happens against the live API, the fix is a
    // thin Lambda that proxies this one POST (reads stay direct from the browser).
    throw new NearbyError("Couldn't reach OpenStreetMap — please try again.");
  }
  if (!res.ok) {
    throw new NearbyError(`OpenStreetMap rejected the suggestion (HTTP ${res.status}).`);
  }
}
