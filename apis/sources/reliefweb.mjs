// ReliefWeb — UN OCHA humanitarian crisis tracking
// Requires approved appname since Nov 2025. Register at https://apidoc.reliefweb.int/parameters#appname
// Falls back to HDX (Humanitarian Data Exchange) if ReliefWeb API returns 403.

import { safeFetch } from '../utils/fetch.mjs';

const BASE = 'https://api.reliefweb.int/v1';
// Register your own appname at https://apidoc.reliefweb.int/parameters#appname
// and replace this value. Without an approved appname the API returns 403.
const APPNAME = process.env.RELIEFWEB_APPNAME || 'crucix';

const HDX_BASE = 'https://data.humdata.org/api/3/action';
const HEALTH_QUERY = [
  'outbreak',
  'epidemic',
  'pandemic',
  'cholera',
  'measles',
  'mpox',
  'dengue',
  'hantavirus',
  'polio',
  'influenza',
  'ebola',
  'marburg',
  'meningitis',
  '"yellow fever"',
].join(' OR ');

const HEALTH_KEYWORD_RE = /outbreak|epidemic|pandemic|cholera|measles|mpox|dengue|hantavirus|polio|influenza|ebola|marburg|meningitis|yellow fever|public health/i;

// POST-based search for reports (ReliefWeb API v1 POST format)
async function rwPost(endpoint, body) {
  const url = `${BASE}/${endpoint}?appname=${APPNAME}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Crucix/1.0',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 200)}`);
    }
    return await res.json();
  } catch (e) {
    return { error: e.message, source: url };
  }
}

// Search recent reports via ReliefWeb API (POST method)
export async function searchReports(opts = {}) {
  const { query = '', limit = 15 } = opts;
  const body = {
    limit,
    fields: {
      include: [
        'title',
        'date.created',
        'country.name',
        'disaster_type.name',
        'url_alias',
        'source.name',
      ],
    },
    sort: ['date.created:desc'],
  };
  if (query) {
    body.query = { value: query };
  }
  return rwPost('reports', body);
}

export async function searchHealthReports(opts = {}) {
  const { limit = 20 } = opts;
  return searchReports({ query: HEALTH_QUERY, limit });
}

// Get active disasters via ReliefWeb API (POST method)
export async function getDisasters(opts = {}) {
  const { limit = 15 } = opts;
  const body = {
    limit,
    fields: {
      include: ['name', 'date.created', 'country.name', 'type.name', 'status'],
    },
    filter: {
      field: 'status',
      value: 'ongoing',
    },
    sort: ['date.created:desc'],
  };
  return rwPost('disasters', body);
}

// Fallback: search HDX (Humanitarian Data Exchange) for crisis datasets
async function hdxFallback(limit = 15) {
  const data = await safeFetch(
    `${HDX_BASE}/package_search?q=crisis+OR+disaster+OR+emergency&rows=${limit}&sort=metadata_modified+desc`
  );
  if (data?.result?.results) {
    return data.result.results.map(pkg => ({
      title: pkg.title,
      date: pkg.metadata_modified,
      source: pkg.dataset_source || pkg.organization?.title,
      countries: pkg.groups?.map(g => g.display_name),
      url: `https://data.humdata.org/dataset/${pkg.name}`,
    }));
  }
  return [];
}

async function hdxHealthFallback(limit = 15) {
  const data = await safeFetch(
    `${HDX_BASE}/package_search?q=${encodeURIComponent('who outbreak epidemic cholera measles dengue mpox health emergency')}&rows=${limit}&sort=metadata_modified+desc`
  );
  if (data?.result?.results) {
    return data.result.results
      .map(pkg => ({
        title: pkg.title,
        date: pkg.metadata_modified,
        source: pkg.dataset_source || pkg.organization?.title,
        countries: pkg.groups?.map(g => g.display_name),
        url: `https://data.humdata.org/dataset/${pkg.name}`,
      }))
      .filter(pkg => HEALTH_KEYWORD_RE.test(pkg.title || ''));
  }
  return [];
}

function mapHealthAlert(report, sourceLabel = 'ReliefWeb') {
  return {
    title: report.fields?.title || report.title || null,
    date: report.fields?.date?.created || report.date || null,
    countries: report.fields?.country?.map(c => c.name) || report.countries || [],
    disasterType: report.fields?.disaster_type?.map(d => d.name) || report.disasterType || [],
    source: report.fields?.source?.map(s => s.name)?.join(', ') || report.source || sourceLabel,
    url: report.fields?.url_alias
      ? `https://reliefweb.int${report.fields.url_alias}`
      : report.url || null,
  };
}

function isHealthAlertCandidate(report = {}) {
  const haystack = [
    report.title,
    ...(report.disasterType || []),
    ...(report.countries || []),
    report.source,
  ].filter(Boolean).join(' ');
  return HEALTH_KEYWORD_RE.test(haystack);
}

// Briefing — get latest humanitarian crises
export async function briefing() {
  const [reports, disasters, healthReports] = await Promise.all([
    searchReports({ limit: 15 }),
    getDisasters({ limit: 15 }),
    searchHealthReports({ limit: 20 }),
  ]);

  const rwFailed = !!reports?.error || !!disasters?.error || !!healthReports?.error;

  let latestReports = [];
  let activeDisasters = [];
  let hdxDatasets = [];
  let healthAlerts = [];

  if (!rwFailed) {
    latestReports = (reports?.data || []).map(r => ({
      title: r.fields?.title,
      date: r.fields?.date?.created,
      countries: r.fields?.country?.map(c => c.name),
      disasterType: r.fields?.disaster_type?.map(d => d.name),
      source: r.fields?.source?.map(s => s.name),
      url: r.fields?.url_alias
        ? `https://reliefweb.int${r.fields.url_alias}`
        : null,
    }));
    activeDisasters = (disasters?.data || []).map(d => ({
      name: d.fields?.name,
      date: d.fields?.date?.created,
      countries: d.fields?.country?.map(c => c.name),
      type: d.fields?.type?.map(t => t.name),
      status: d.fields?.status,
    }));
    healthAlerts = (healthReports?.data || [])
      .map(r => mapHealthAlert(r))
      .filter(isHealthAlertCandidate);
  } else {
    // Fallback to HDX when ReliefWeb returns 403 (unapproved appname)
    hdxDatasets = await hdxFallback(15);
    healthAlerts = (await hdxHealthFallback(15)).filter(isHealthAlertCandidate);
  }

  return {
    source: rwFailed ? 'HDX (Humanitarian Data Exchange) — ReliefWeb fallback' : 'ReliefWeb (UN OCHA)',
    timestamp: new Date().toISOString(),
    ...(rwFailed
      ? {
          rwError: reports?.error || disasters?.error,
          rwNote: 'ReliefWeb API requires an approved appname since Nov 2025. Set RELIEFWEB_APPNAME env var after registering at https://apidoc.reliefweb.int/parameters#appname',
          hdxDatasets,
          healthAlerts,
        }
      : {
          latestReports,
          activeDisasters,
          healthAlerts,
        }),
  };
}

if (process.argv[1]?.endsWith('reliefweb.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
