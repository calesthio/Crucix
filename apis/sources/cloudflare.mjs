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
        const [radarData, healthData] = await Promise.all([
            fetchRadarData(process.env.CLOUDFLARE_API_TOKEN),
            fetchInternetHealthGlobal(),
        ]);

        return {
            radar: radarData,
            health: healthData,
            timestamp: Date.now(),
        };
    } catch (e) {
        console.error('[Cloudflare] Error:', e.message);
        return null;
    }
}

async function fetchRadarData(apiToken) {
    if (!apiToken) return null;

    try {
        // Cloudflare Radar API — detects BGP hijacks, outages, DDoS
        const res = await safeFetch('https://api.cloudflare.com/radar/v1/bgp/', {
            headers: { 'Authorization': `Bearer ${apiToken}` },
            timeout: 8000,
        });

        const hijacks = res?.result?.data?.hijacks || [];
        const outages = res?.result?.data?.outages || [];

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
        return null;
    }
}

async function fetchInternetHealthGlobal() {
    try {
        // Cloudflare Radar public API (no auth needed for basic data)
        const res = await safeFetch('https://api.cloudflare.com/radar/v1/http/status_codes/summary/main_summary', {
            searchParams: { dateRange: '7d', format: 'json' },
            timeout: 8000,
        });

        const data = res?.result || {};
        const percentOk = data.ok_percentage || 0;

        // Regional health (from Cloudflare's public data)
        const regions = {
            'russia': await checkRegionalHealth('ru'),
            'china': await checkRegionalHealth('cn'),
            'iran': await checkRegionalHealth('ir'),
            'venezuela': await checkRegionalHealth('ve'),
            'north_korea': await checkRegionalHealth('kp'),
            'syria': await checkRegionalHealth('sy'),
            'myanmar': await checkRegionalHealth('mm'),
        };

        return {
            global_ok_pct: percentOk,
            regional_health: regions,
            status: percentOk > 98 ? 'NORMAL' : percentOk > 95 ? 'DEGRADED' : 'CRITICAL',
        };
    } catch (e) {
        console.warn('[Health] Error:', e.message);
        return null;
    }
}

async function checkRegionalHealth(countryCode) {
    try {
        const res = await safeFetch('https://api.cloudflare.com/radar/v1/http/status_codes/summary/main_summary', {
            searchParams: { dateRange: '1d', format: 'json', location: countryCode },
            timeout: 5000,
        });

        const pct = res?.result?.ok_percentage || 100;
        return {
            ok_pct: pct,
            status: pct > 98 ? 'ONLINE' : pct > 90 ? 'DEGRADED' : 'OFFLINE',
        };
    } catch {
        return { ok_pct: 'N/A', status: 'UNKNOWN' };
    }
}
