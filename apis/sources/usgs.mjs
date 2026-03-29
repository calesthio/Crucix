// USGS Earthquake Hazards Program — Real-time earthquake monitoring
// No auth required. Public domain data from USGS.

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0';

// Fetch recent earthquakes (last 24 hours)
export async function getEarthquakes() {
  // Use 'significant' feed for earthquakes with mag >= 2.5 or with reviews
  // Alternatively, 'all_day' for all, but we'll filter
  const url = `${BASE}/summary/significant_day.geojson`;
  return safeFetch(url);
}

// Briefing — monitor significant earthquakes globally
export async function briefing() {
  const data = await getEarthquakes();

  if (!data || !data.features) {
    return {
      source: 'USGS',
      timestamp: new Date().toISOString(),
      earthquakes: [],
      signals: ['No recent significant earthquake data available'],
    };
  }

  // Filter for earthquakes with magnitude >= 4.0 or tsunami alerts
  const significant = data.features.filter(feature => {
    const props = feature.properties;
    return props.mag >= 4.0 || props.tsunami > 0;
  });

  const earthquakes = significant.map(feature => {
    const props = feature.properties;
    const geometry = feature.geometry;
    return {
      id: feature.id,
      magnitude: props.mag,
      place: props.place,
      time: new Date(props.time).toISOString(),
      coordinates: geometry.coordinates, // [lon, lat, depth]
      depth: geometry.coordinates[2],
      tsunami: props.tsunami > 0 ? 'Warning issued' : 'No warning',
      url: props.url,
      felt: props.felt || 0,
      cdi: props.cdi || null, // Community Determined Intensity
    };
  });

  // Sort by magnitude descending
  earthquakes.sort((a, b) => b.magnitude - a.magnitude);

  const signals = earthquakes.length > 0
    ? earthquakes.slice(0, 5).map(eq => {
        const tsunamiNote = eq.tsunami === 'Warning issued' ? ' (TSUNAMI WARNING)' : '';
        return `M${eq.magnitude.toFixed(1)} earthquake: ${eq.place}${tsunamiNote}`;
      })
    : ['No significant earthquakes (M≥4.0) in the last 24 hours'];

  return {
    source: 'USGS',
    timestamp: new Date().toISOString(),
    totalEarthquakes: data.metadata.count,
    significantEarthquakes: earthquakes.length,
    earthquakes: earthquakes.slice(0, 10), // Limit to top 10 for dashboard
    signals,
  };
}

if (process.argv[1]?.endsWith('usgs.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}