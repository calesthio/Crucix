// Bank of England — UK Monetary Policy & Economic Indicators
// Free, no API key required. Data updated daily/monthly.
// Replaces FRED (US Federal Reserve) with UK-centric macro indicators.
//
// BoE Statistics API: bankofengland.co.uk/boeapps/database/
// Series codes: https://www.bankofengland.co.uk/statistics/details/further-details-about-data
//
// Key series:
//   IUDBEDR   — Bank Rate (Base Rate)
//   IUSNPY2Y  — 2-Year Gilt Yield
//   IUSNPY5Y  — 5-Year Gilt Yield
//   IUSNPY10  — 10-Year Gilt Yield
//   IUSNPY30  — 30-Year Gilt Yield
//   LPMAUZA   — M4 Money Supply (£ millions)
//   RPQB4A    — Total net lending to individuals
//   LPMB3OA   — Net consumer credit lending
//   XUMASR    — Sterling effective exchange rate (ERI)

import { safeFetch, daysAgo } from '../utils/fetch.mjs';

const BOE_BASE = 'https://www.bankofengland.co.uk/boeapps/database/_iadb-FromShowColumns.asp';

// Key UK macro series
const KEY_SERIES = {
  IUDBEDR:          'Bank Rate (Base Rate)',
  IUSNPY2Y:         '2-Year Gilt Yield',
  IUSNPY5Y:         '5-Year Gilt Yield',
  IUSNPY10:         '10-Year Gilt Yield',
  IUSNPY30:         '30-Year Gilt Yield',
  LPMAUZA:          'M4 Money Supply (£m)',
  XUMASR:           'Sterling Effective Exchange Rate (ERI)',
  RPQB4A:           'Net Lending to Individuals',
  LPMB3OA:          'Net Consumer Credit Lending',
};

// Also check ONS for CPI, unemployment — but BoE is the primary yield/rate source

// Fetch a series from BoE Statistics API (returns CSV)
async function fetchBoESeries(seriesCodes, fromDate = null) {
  const from = fromDate || daysAgo(90);
  const [day, month, year] = from.split('-').reverse().join('/').split('/');
  const fromStr = `${parseInt(year)}/Jan/${new Date(from).getFullYear()}`.replace('Jan', [
    'Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'
  ][new Date(from).getMonth()]);

  // Use CSV export format for multi-series fetch
  const params = new URLSearchParams({
    'csv.x': 'yes',
    'Datefrom': `01/Jan/${new Date(from).getFullYear() - 1}`,
    'Dateto': 'now',
    'SeriesCodes': Array.isArray(seriesCodes) ? seriesCodes.join(',') : seriesCodes,
    'CSVF': 'TT',  // Time series, tab-separated
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

// Parse BoE CSV (tab-separated, date column + series columns)
function parseBoECSV(csvText) {
  if (!csvText) return {};

  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length < 3) return {};

  // First line is series codes, second line is series descriptions
  // Subsequent lines are: Date\tValue1\tValue2...
  const seriesCodes = lines[0].split('\t').slice(1).map(s => s.trim().replace(/"/g, ''));
  const seriesLabels = lines[1].split('\t').slice(1).map(s => s.trim().replace(/"/g, ''));

  const data = {};
  seriesCodes.forEach((code, i) => {
    if (code) data[code] = { label: seriesLabels[i] || code, observations: [] };
  });

  for (let i = 2; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const dateStr = cols[0]?.trim().replace(/"/g, '');
    if (!dateStr || dateStr.length < 4) continue;

    // BoE dates are like "01 Jan 2024" or "2024-01-01"
    let date = dateStr;
    if (dateStr.includes(' ')) {
      const parts = dateStr.split(' ');
      const months = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
                       Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
      if (parts.length >= 3) {
        date = `${parts[2]}-${months[parts[1]] || '01'}-${parts[0].padStart(2, '0')}`;
      }
    }

    seriesCodes.forEach((code, i) => {
      if (!code || !data[code]) return;
      const val = cols[i + 1]?.trim().replace(/"/g, '');
      if (val && val !== '.' && val !== 'n.a.' && val !== '') {
        const num = parseFloat(val);
        if (!isNaN(num)) {
          data[code].observations.push({ date, value: num });
        }
      }
    });
  }

  // Sort each series newest-first and keep last 12 observations
  for (const code of Object.keys(data)) {
    data[code].observations.sort((a, b) => b.date.localeCompare(a.date));
    data[code].observations = data[code].observations.slice(0, 12);
  }

  return data;
}

// Briefing — pull key UK macro indicators from the Bank of England
export async function briefing() {
  const seriesCodes = Object.keys(KEY_SERIES);

  const csvText = await fetchBoESeries(seriesCodes);
  const seriesData = parseBoECSV(csvText);

  const indicators = [];
  const signals = [];

  for (const [code, label] of Object.entries(KEY_SERIES)) {
    const series = seriesData[code];
    const obs = series?.observations || [];
    const latest = obs[0] || null;
    const prev = obs[1] || null;

    const change = (latest && prev) ? +(latest.value - prev.value).toFixed(4) : null;

    indicators.push({
      id: code,
      label,
      value: latest?.value ?? null,
      date: latest?.date ?? null,
      change,
      recent: obs.slice(0, 5).map(o => o.value),
    });

    // Signals
    if (code === 'IUDBEDR') {
      if (latest?.value != null && latest.value > 5.0) {
        signals.push(`Bank Rate elevated at ${latest.value}% — restrictive monetary policy`);
      }
      if (latest?.value != null && change != null && Math.abs(change) >= 0.25) {
        const dir = change > 0 ? 'raised' : 'cut';
        signals.push(`Bank Rate ${dir} by ${Math.abs(change).toFixed(2)}pp to ${latest.value}%`);
      }
    }

    if (code === 'IUSNPY10' && latest?.value != null) {
      if (latest.value > 5.0) signals.push(`UK 10Y Gilt yield above 5% at ${latest.value}% — fiscal stress signal`);
    }

    // Yield curve inversion (10Y < 2Y)
    const gilt10 = indicators.find(i => i.id === 'IUSNPY10')?.value;
    const gilt2 = indicators.find(i => i.id === 'IUSNPY2Y')?.value;
    if (gilt10 != null && gilt2 != null && gilt10 < gilt2) {
      signals.push(`UK GILT CURVE INVERTED: 10Y (${gilt10}%) < 2Y (${gilt2}%) — recession signal`);
    }

    if (code === 'XUMASR' && latest?.value != null && change != null) {
      if (Math.abs(change) > 2) {
        const dir = change > 0 ? 'strengthening' : 'weakening';
        signals.push(`Sterling ERI ${dir} — ${change > 0 ? '+' : ''}${change.toFixed(1)} pts`);
      }
    }
  }

  // Fallback message if BoE API didn't respond
  const hasData = indicators.some(i => i.value !== null);

  return {
    source: 'Bank of England',
    timestamp: new Date().toISOString(),
    dataAvailable: hasData,
    indicators: indicators.filter(i => i.value !== null),
    signals: signals.length > 0
      ? signals
      : hasData
        ? ['UK macro indicators within normal ranges']
        : ['BoE Statistics API unavailable — check bankofengland.co.uk/statistics'],
    keyRates: {
      bankRate: indicators.find(i => i.id === 'IUDBEDR')?.value ?? null,
      gilt2Y: indicators.find(i => i.id === 'IUSNPY2Y')?.value ?? null,
      gilt10Y: indicators.find(i => i.id === 'IUSNPY10')?.value ?? null,
      gilt30Y: indicators.find(i => i.id === 'IUSNPY30')?.value ?? null,
      sterlingERI: indicators.find(i => i.id === 'XUMASR')?.value ?? null,
    },
    note: 'Bank of England Statistics API — free, no key required. Series updated daily/monthly.',
  };
}

if (process.argv[1]?.endsWith('boe.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
