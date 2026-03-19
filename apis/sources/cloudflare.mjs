// Internet Outages & BGP Hijacks — Cloudflare API
// Monitors global internet health, detects BGP hijacks, DNS outages
// Signals geopolitical events, cyberattacks, infrastructure failures

import { safeFetch } from '../utils/fetch.mjs';

const REGIONS_TO_MONITOR = [
    'russia', 'ukraine', 'china', 'iran', 'north korea', 'syria', 'venezuela',
    'cuba', 'myanmar', 'belarus', 'sudan', 'congo', 'zimbabwe', 'lithuania',
];

export async function briefing() {
    try {
        const radarData = await fetchRadarData(process.env.CLOUDFLARE_API_TOKEN);

        return {
            radar: radarData,
            timestamp: Date.now(),
        };
    } catch (e) {
        console.error('[Cloudflare] Error:', e.message);
        return null;
    }
}

async function fetchRadarData(apiToken) {
    if (!apiToken) {
        console.log('[Cloudflare] No API token — returning placeholder data');
        return {
            hijacks: [],
            status: 'NORMAL',
            note: 'Cloudflare Radar requires authentication. Using placeholder.',
        };
    }

    try {
        // Cloudflare Radar API — detects BGP hijacks, outages, DDoS
        const res = await safeFetch('https://api.cloudflare.com/radar/v1/bgp/', {
            headers: { 'Authorization': `Bearer ${apiToken}` },
            timeout: 8000,
        });

        const hijacks = res?.result?.data?.hijacks || [];
        const outages = res?.result?.data?.outages || [];

        console.log(`[Cloudflare] BGP hijacks: ${hijacks.length}, outages: ${outages.length}`);

        // Filter for high-risk regions
        const regional = hijacks
            .filter(h => REGIONS_TO_MONITOR.some(r =>
                (h.location?.toLowerCase() || '').includes(r) ||
                (h.asn_name?.toLowerCase() || '').includes(r)
            ))
            .map(h => ({
                type: 'BGP_HIJACK',
                asn: h.asn,
                asnName: h.asn_name,
                location: h.location,
                severity: h.confidence_score ? 'HIGH' : 'MEDIUM',
                timestamp: h.detected_at,
            }));

        return {
            hijacks: regional,
            totalOutages: outages.length,
            status: hijacks.length > 5 ? 'ELEVATED_RISK' : 'NORMAL',
        };
    } catch (e) {
        console.warn('[Radar] API error:', e.message);
        return {
            hijacks: [],
            status: 'UNKNOWN',
            error: e.message,
        };
    }
}
