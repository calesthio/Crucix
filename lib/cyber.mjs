import { sourceHealth } from './source-health.mjs';

export function summarizeCyber(sources = {}) {
  const kev = sources['CISA-KEV'];
  const radar = sources['Cloudflare-Radar'];
  const kevState = sourceHealth(kev);
  const radarState = sourceHealth(radar);
  const available = ['healthy', 'degraded'].includes(kevState.status);
  const entries = available ? (kev.vulnerabilities || []) : [];
  const outagesAvailable = ['healthy', 'degraded'].includes(radarState.status) && Boolean(radar.outages) && !radar.outages.error;
  const anomaliesAvailable = ['healthy', 'degraded'].includes(radarState.status) && Boolean(radar.anomalies) && !radar.anomalies.error;
  return {
    cyber: {
      status: kevState.status, available, timestamp: kev?.timestamp || null,
      catalogDate: kev?.dateReleased || null,
      total: available ? kev.summary?.totalInCatalog ?? null : null,
      recentAdditions: available ? kev.summary?.recentAdditions ?? null : null,
      ransomwareLinked: available ? kev.summary?.ransomwareLinked ?? null : null,
      vulnerabilities: entries.slice(0, 20),
      hotProducts: available ? (kev.summary?.hotProducts || []).slice(0, 5) : [],
    },
    internet: {
      status: radarState.status, timestamp: radar?.timestamp || null,
      outagesAvailable, anomaliesAvailable,
      active: outagesAvailable ? radar.outages.active ?? null : null,
      anomalies: anomaliesAvailable ? radar.anomalies.total ?? null : null,
      activeEvents: outagesAvailable ? (radar.outages.activeEvents || []).slice(0, 20) : [],
      recentResolved: outagesAvailable ? (radar.outages.recentResolved || []).slice(0, 5) : [],
    },
  };
}
