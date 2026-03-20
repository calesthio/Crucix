// UK DMO + OBR — UK Government Debt, Gilts & Fiscal Position
// Replaces US Treasury fiscal data with UK equivalents.
// Sources:
//   UK Debt Management Office (DMO): dmo.gov.uk/data/
//   Office for Budget Responsibility (OBR): obr.uk/data/
//   Bank of England (gilt yields): bankofengland.co.uk/boeapps/database/
//   ONS Public Sector Finances (PSF): ons.gov.uk
//
// No auth required. Data updated daily (gilt data) and monthly (fiscal).

import { safeFetch, daysAgo } from '../utils/fetch.mjs';

const BOE_BASE = 'https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp';
const ONS_BASE = 'https://api.ons.gov.uk/v1';

// Gilt yield series from BoE
const GILT_SERIES = {
  IUSNPY2Y:  '2-Year Gilt Yield (%)',
  IUSNPY5Y:  '5-Year Gilt Yield (%)',
  IUSNPY10:  '10-Year Gilt Yield (%)',
  IUSNPY20:  '20-Year Gilt Yield (%)',
  IUSNPY30:  '30-Year Gilt Yield (%)',
};

// ONS Public Sector Finance series
// PSNB: Public Sector Net Borrowing
// PSND: Public Sector Net Debt
const PSF_SERIES = [
  { dataset: 'pn2', series: 'J5II',  label: 'Public Sector Net Borrowing (£bn)' },
  { dataset: 'pn2', series: 'BKQK',  label: 'Public Sector Net Debt ex BoE (£bn)' },
  { dataset: 'pn2', series: 'MF6U',  label: 'Public Sector Net Debt ex BoE (% GDP)' },
  { dataset: 'pn2', series: 'KH6W',  label: 'Central Government Net Borrowing (£bn)' },
];

// Fetch BoE gilt yield data (multi-series CSV)
async function fetchGiltYields() {
  const params = new URLSearchParams({
    'csv.x': 'yes',
    'Datefrom': `01/Jan/${new Date().getFullYear() - 1}`,
    'Dateto': 'now',
    'SeriesCodes': Object.keys(GILT_SERIES).join(','),
    'CSVF': 'TT',
    'UsingCodes': 'Y',
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const res = await fetch(`${BOE_BASE}?${params}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Crucix-UK/1.0' },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    return null;
  }
}

// Parse BoE gilt CSV (tab-separated)
function parseGiltCSV(csvText) {
  if (!csvText) return {};

  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 3) return {};

  const codes = lines[0].split('\t').slice(1).map(s => s.trim().replace(/"/g, ''));
  const result = {};

  for (let i = 2; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const rawDate = cols[0]?.trim().replace(/"/g, '');
    if (!rawDate || rawDate.length < 4) continue;

    // Parse "01 Jan 2024" -> "2024-01-01"
    const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                     Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    let date = rawDate;
    if (rawDate.includes(' ')) {
      const parts = rawDate.split(' ');
      if (parts.length >= 3) date = `${parts[2]}-${MONTHS[parts[1]] || '01'}-${parts[0].padStart(2, '0')}`;
    }

    codes.forEach((code, i) => {
      if (!code) return;
      const val = cols[i + 1]?.trim().replace(/"/g, '');
      if (val && val !== '.' && val !== '') {
        const num = parseFloat(val);
        if (!isNaN(num)) {
          if (!result[code]) result[code] = [];
          result[code].push({ date, value: num });
        }
      }
    });
  }

  // Sort newest-first
  for (const code of Object.keys(result)) {
    result[code].sort((a, b) => b.date.localeCompare(a.date));
    result[code] = result[code].slice(0, 10);
  }

  return result;
}

// Fetch ONS Public Sector Finance series
async function fetchPSFSeries(datasetId, seriesId) {
  return safeFetch(`${ONS_BASE}/datasets/${datasetId}/timeseries/${seriesId}/data`, { timeout: 20000 });
}

function latestMonthly(data) {
  const arr = data?.months || data?.quarters;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const valid = arr.filter(o => o.value && o.value !== '').sort((a, b) => b.date.localeCompare(a.date));
  if (!valid.length) return null;
  return { value: parseFloat(valid[0].value), date: valid[0].date };
}

// Briefing — UK government debt and gilt market data
export async function briefing() {
  const [giltCSV, ...psfResults] = await Promise.allSettled([
    fetchGiltYields(),
    ...PSF_SERIES.map(s => fetchPSFSeries(s.dataset, s.series)),
  ]);

  const giltData = parseGiltCSV(giltCSV.status === 'fulfilled' ? giltCSV.value : null);
  const signals = [];

  // Build gilt yield summary
  const gilts = Object.entries(GILT_SERIES).map(([code, label]) => {
    const obs = giltData[code] || [];
    const latest = obs[0] || null;
    const prev = obs[1] || null;
    return {
      code,
      label,
      yield: latest?.value ?? null,
      date: latest?.date ?? null,
      change: (latest && prev) ? +(latest.value - prev.value).toFixed(3) : null,
      recent: obs.slice(0, 5).map(o => o.value),
    };
  });

  // Gilt signals
  const gilt10Y = gilts.find(g => g.code === 'IUSNPY10');
  const gilt2Y = gilts.find(g => g.code === 'IUSNPY2Y');
  const gilt30Y = gilts.find(g => g.code === 'IUSNPY30');

  if (gilt10Y?.yield != null && gilt10Y.yield > 5.0) {
    signals.push(`UK 10Y gilt above 5% at ${gilt10Y.yield}% — fiscal market stress`);
  }
  if (gilt30Y?.yield != null && gilt30Y.yield > 5.5) {
    signals.push(`UK 30Y gilt at ${gilt30Y.yield}% — long-end deterioration, LDI risk`);
  }
  if (gilt2Y && gilt10Y && gilt2Y.yield != null && gilt10Y.yield != null) {
    const spread = gilt10Y.yield - gilt2Y.yield;
    if (spread < 0) {
      signals.push(`UK GILT CURVE INVERTED: 10Y-2Y spread = ${spread.toFixed(2)}pp — recession signal`);
    }
  }
  if (gilt10Y?.change != null && Math.abs(gilt10Y.change) > 0.15) {
    const dir = gilt10Y.change > 0 ? 'rose' : 'fell';
    signals.push(`UK 10Y gilt ${dir} ${Math.abs(gilt10Y.change).toFixed(2)}pp — significant gilt market move`);
  }

  // Public Sector Finances
  const psfData = psfResults.map((r, i) => {
    const data = r.status === 'fulfilled' ? r.value : null;
    const latest = latestMonthly(data);
    return {
      series: PSF_SERIES[i].series,
      label: PSF_SERIES[i].label,
      value: latest?.value ?? null,
      date: latest?.date ?? null,
    };
  });

  const netDebt = psfData.find(d => d.series === 'MF6U');
  if (netDebt?.value != null && netDebt.value > 100) {
    signals.push(`UK net debt at ${netDebt.value.toFixed(1)}% of GDP — fiscal constraint`);
  }

  const netBorrowing = psfData.find(d => d.series === 'J5II');
  if (netBorrowing?.value != null && netBorrowing.value > 15) {
    signals.push(`UK monthly borrowing elevated at £${netBorrowing.value.toFixed(1)}bn`);
  }

  return {
    source: 'UK DMO / Bank of England / ONS Public Sector Finances',
    timestamp: new Date().toISOString(),
    giltYields: gilts,
    publicSectorFinances: psfData.filter(d => d.value !== null),
    signals: signals.length > 0
      ? signals
      : ['UK gilt market and fiscal data within expected ranges'],
    yieldCurve: gilt2Y && gilt10Y ? {
      twoYear: gilt2Y.yield,
      tenYear: gilt10Y.yield,
      spread10y2y: (gilt2Y.yield != null && gilt10Y.yield != null)
        ? +(gilt10Y.yield - gilt2Y.yield).toFixed(3)
        : null,
      inverted: (gilt2Y.yield != null && gilt10Y.yield != null) ? gilt10Y.yield < gilt2Y.yield : null,
    } : null,
    note: 'UK Debt Management Office manages HM Treasury gilt issuance. BoE holds ~30% via QE.',
  };
}

if (process.argv[1]?.endsWith('ukdmo.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
