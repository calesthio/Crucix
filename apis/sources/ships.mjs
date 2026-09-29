// Ship/Vessel Tracking — aisstream.io (free real-time global AIS)
// Detects: chokepoint traffic, tanker flows, naval presence, AIS gaps
//
// Live AIS is a WebSocket stream, which a one-shot sweep can't hold open. When Crucix
// runs as a server, lib/maritime/ais-collector.mjs keeps a persistent connection and
// this source reports a snapshot of it. When run standalone (npm run sweep), it samples
// the stream for AIS_SAMPLE_SECONDS instead. Without AISSTREAM_API_KEY it returns the
// static chokepoint list, as before.

import '../utils/env.mjs';
import { CHOKEPOINTS, chokepointBoxes } from '../../lib/maritime/chokepoints.mjs';
import { AisCollector, AIS_STREAM_URL, aisCollector, aisDisabled } from '../../lib/maritime/ais-collector.mjs';

const MONITORING_CAPABILITIES = [
  'Vessel counts per chokepoint (tankers, cargo, passenger, military)',
  'Stationary / anchored vessel build-up',
  'AIS gaps (underway vessels that go silent — often coverage, sometimes transponder shutoff)',
  'Chokepoint traffic anomalies between sweeps',
];

function sampleSeconds() {
  const n = Number(process.env.AIS_SAMPLE_SECONDS);
  // Stay well inside the 30s per-source sweep timeout
  return Number.isFinite(n) && n > 0 ? Math.min(n, 25) : 20;
}

function fromSnapshot(snapshot, mode) {
  return {
    source: 'Maritime/AIS',
    timestamp: new Date().toISOString(),
    mode,
    status: snapshot.status,
    live: snapshot.live,
    warmingUp: snapshot.warmingUp,
    stream: snapshot.stream,
    totals: snapshot.totals,
    chokepoints: snapshot.chokepoints,
    vessels: snapshot.vessels,
    gaps: snapshot.gaps,
    monitoringCapabilities: MONITORING_CAPABILITIES,
  };
}

async function sampleStream(apiKey) {
  const seconds = sampleSeconds();
  const collector = new AisCollector({ fromEnv: true, warmupMinutes: Infinity });
  collector.start(apiKey);
  await new Promise(resolve => {
    const timer = setTimeout(resolve, seconds * 1000);
    timer.unref?.();
  });
  const snapshot = collector.getSnapshot();
  collector.stop();
  return { snapshot, seconds };
}

export async function briefing() {
  const apiKey = process.env.AISSTREAM_API_KEY;
  const base = {
    source: 'Maritime/AIS',
    timestamp: new Date().toISOString(),
    chokepoints: CHOKEPOINTS,
    monitoringCapabilities: MONITORING_CAPABILITIES,
  };

  if (!apiKey) {
    return {
      ...base,
      status: 'limited',
      message: 'Set AISSTREAM_API_KEY for live vessel counts at chokepoints (free at aisstream.io)',
    };
  }

  if (aisDisabled()) {
    return { ...base, status: 'disabled', message: 'AIS_DISABLED is set — live AIS collection is off' };
  }

  // Standalone run (no server-managed collector): take a short sample
  if (aisCollector.state === 'idle') {
    const { snapshot, seconds } = await sampleStream(apiKey);
    const result = fromSnapshot(snapshot, 'sampled');
    result.message = `Sampled the AIS stream for ${seconds}s — counts are partial`;
    if (snapshot.stream.messages === 0) {
      result.error = snapshot.stream.lastError || `No AIS messages received in ${seconds}s`;
    }
    return result;
  }

  const snapshot = aisCollector.getSnapshot();
  const result = fromSnapshot(snapshot, 'stream');

  if (snapshot.status === 'auth_failed' || snapshot.status === 'unsupported') {
    result.error = snapshot.stream.lastError || `AIS collector ${snapshot.status}`;
  } else if (!snapshot.live && snapshot.totals.vessels === 0) {
    result.error = snapshot.stream.lastError || 'AIS stream not connected yet';
  }
  if (snapshot.warmingUp && !result.error) {
    result.message = 'AIS stream recently connected — counts are still filling in';
  }
  return result;
}

// Kept for compatibility: the subscription the collector sends
export function getWebSocketConfig(apiKey) {
  return {
    url: AIS_STREAM_URL,
    message: JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: chokepointBoxes(),
    }),
  };
}

export { CHOKEPOINTS };

if (process.argv[1]?.endsWith('ships.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
