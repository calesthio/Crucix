// Maritime chokepoints monitored by the Maritime/AIS source
// Shared by apis/sources/ships.mjs (briefing) and lib/maritime/ais-collector.mjs (live stream)

export const CHOKEPOINTS = {
  straitOfHormuz: { label: 'Strait of Hormuz', lat: 26.5, lon: 56.5, note: '20% of world oil' },
  suezCanal: { label: 'Suez Canal', lat: 30.5, lon: 32.3, note: '12% of world trade' },
  straitOfGibraltar: { label: 'Strait of Gibraltar', lat: 36.0, lon: -5.7, note: 'Gateway to Mediterranean, ~10-20% global trade influence' },
  straitOfMalacca: { label: 'Strait of Malacca', lat: 2.5, lon: 101.5, note: '25% of world trade' },
  babElMandeb: { label: 'Bab el-Mandeb', lat: 12.6, lon: 43.3, note: 'Red Sea gateway' },
  taiwanStrait: { label: 'Taiwan Strait', lat: 24.0, lon: 119.0, note: '88% of largest container ships' },
  bosporusStrait: { label: 'Bosphorus', lat: 41.1, lon: 29.1, note: 'Black Sea access' },
  panamaCanal: { label: 'Panama Canal', lat: 9.1, lon: -79.7, note: '5% of world trade' },
  capeOfGoodHope: { label: 'Cape of Good Hope', lat: -34.4, lon: 18.5, note: 'Suez alternative' },
};

export const DEFAULT_BBOX_DEG = 2;

// AISstream bounding boxes: [[lat, lon], [lat, lon]] corner pairs
export function chokepointBoxes(bboxDeg = DEFAULT_BBOX_DEG) {
  return Object.values(CHOKEPOINTS).map(cp => [
    [cp.lat - bboxDeg, cp.lon - bboxDeg],
    [cp.lat + bboxDeg, cp.lon + bboxDeg],
  ]);
}

// Key of the chokepoint whose box contains the position (nearest centre wins), or null
export function findChokepoint(lat, lon, bboxDeg = DEFAULT_BBOX_DEG) {
  let best = null;
  let bestDist = Infinity;
  for (const [key, cp] of Object.entries(CHOKEPOINTS)) {
    const dLat = Math.abs(lat - cp.lat);
    const dLon = Math.abs(lon - cp.lon);
    if (dLat > bboxDeg || dLon > bboxDeg) continue;
    const dist = dLat * dLat + dLon * dLon;
    if (dist < bestDist) {
      best = key;
      bestDist = dist;
    }
  }
  return best;
}
