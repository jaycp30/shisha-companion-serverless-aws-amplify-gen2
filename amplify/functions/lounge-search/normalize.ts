// Turn a search origin into a stable cache key. Two searches close enough together —
// either the same typed city, or two device fixes a couple of streets apart — should hit
// the SAME cached web-search result rather than each paying for a fresh search.
//
// Strategy: snap the coordinates to a coarse grid and use the grid cell as the key. At the
// equator 0.05° is roughly 5.5 km; it shrinks with latitude but stays neighbourhood-scale,
// which is the right granularity for "lounges near here". The human label is NOT part of
// the key — "Shibuya" and "渋谷" geocode to the same cell and should share a cache entry.
const GRID_DEGREES = 0.05;

/** Snap a lat/lon to its grid cell and format a deterministic key like `35.65,139.70`. */
export function locationKey(lat: number, lon: number): string {
  const snap = (n: number) => (Math.round(n / GRID_DEGREES) * GRID_DEGREES).toFixed(2);
  return `${snap(lat)},${snap(lon)}`;
}
