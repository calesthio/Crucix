// ONS — UK Office for National Statistics
// Replaces BLS (US Bureau of Labor Statistics) with UK economic statistics.
// Free API, no key required.
//
// ONS API: api.ons.gov.uk/v1/datasets/{dataset}/timeseries/{series}/data
// Key datasets:
//   mm23     — CPI, CPIH, RPI (Consumer Prices Index)
//   lms      — Labour Market Statistics (unemployment, employment, earnings)
//   ukea     — National Accounts (GDP, GVA)
//   pn2      — Public Sector Finances
//
// Key series IDs:
//   D7G7     — UK CPI All Items (mm23)
//   L55O     — UK CPIH All Items (mm23)
//   MGSX     — UK Unemployment Rate (LFS) (lms)
//   MGRZ     — UK Employment Rate (lms)
//   KAB9     — UK GDP (Quarter on Quarter) (ukea)
//   A9ES     — Average Weekly Earnings, Total Pay (emp)
//   CGLK     — Government Borrowing (pn2)

import { safeFetch } from '../utils/fetch.mjs';

const ONS_BASE = 'https://api.ons.gov.uk/v1';

// Series definitions: [datasetId, seriesId, label]
const SERIES = [
  { dataset: 'mm23', series: 'D7G7',  label: 'UK CPI All Items (annual %)',       type: 'inflation'  },
  { dataset: 'mm23', series: 'L55O',  label: 'UK CPIH All Items (annual %)',      type: 'inflation'  },
  { dataset: 'mm23', series: 'CZBH',  label: 'UK Core CPI (ex energy/food, %)',   type: 'inflation'  },
  { dataset: 'lms',  series: 'MGSX',  label: 'UK Unemployment Rate (%)',           type: 'labour'     },
  { dataset: 'lms',  series: 'MGRZ',  label: 'UK Employment Rate (%)',             type: 'labour'     },
  { dataset: 'lms',  series: 'KAB9',  label: 'UK GDP Growth (Quarter on Quarter)', type: 'gdp'        },
  { dataset: 'lms',  series: 'A9ES',  label: 'Average Weekly Earnings - Total Pay',type: 'earnings'   },
];

// Fetch the latest time series data for a given dataset/series
async function fetchSeries(datasetId, seriesId) {
  const url = `${ONS_BASE}/datasets/${datasetId}/timeseries/${seriesId}/data`;
  return safeFetch(url, { timeout: 20000 });
}

// Extract the most recent observation from ONS time series response
function latestObservation(data) {
  // ONS returns { months: [...], quarters: [...], years: [...] }
  // Priority: months > quarters > years
  const sources = ['months', 'quarters', 'years'];

  for (const source of sources) {
    const arr = data?.[source];
    if (Array.isArray(arr) && arr.length > 0) {
      // Sort by date descending, filter out empty values
      const valid = arr
        .filter(o => o.value && o.value !== '' && o.value !== 'n/a')
        .sort((a, b) => b.date?.localeCompare(a.date));
      if (valid.length > 0) {
        return {
          value: parseFloat(valid[0].value),
          date: valid[0].date,
          label: valid[0].label || valid[0].date,
          previous: valid.length > 1 ? parseFloat(valid[1].value) : null,
          previousDate: valid.length > 1 ? valid[1].date : null,
        };
      }
    }
  }
  return null;
}

// Briefing — pull key UK economic indicators from ONS
export async function briefing() {
  const results = await Promise.allSettled(
    SERIES.map(async ({ dataset, series, label, type }) => {
      const data = await fetchSeries(dataset, series);
      const latest = latestObservation(data);
      return { id: series, dataset, label, type, latest };
    })
  );

  const indicators = [];
  const signals = [];

  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { id, label, type, latest } = r.value;

    if (!latest) {
      indicators.push({ id, label, type, value: null, date: null });
      continue;
    }

    const change = (latest.previous != null) ? +(latest.value - latest.previous).toFixed(4) : null;
    const changePct = (latest.previous != null && latest.previous !== 0)
      ? +(((latest.value - latest.previous) / Math.abs(latest.previous)) * 100).toFixed(3)
      : null;

    indicators.push({
      id,
      label,
      type,
      value: latest.value,
      date: latest.date,
      previous: latest.previous,
      previousDate: latest.previousDate,
      change,
      changePct,
    });

    // Generate signals
    if (id === 'D7G7' && latest.value > 4.0) {
      signals.push(`UK CPI elevated at ${latest.value}% — above BoE 2% target`);
    }
    if (id === 'D7G7' && latest.value > 7.0) {
      signals.push(`UK CPI at ${latest.value}% — high inflation stress`);
    }
    if (id === 'MGSX' && latest.value > 5.0) {
      signals.push(`UK Unemployment rising at ${latest.value}% — labour market weakening`);
    }
    if (id === 'KAB9' && latest.value < 0) {
      signals.push(`UK GDP contracted ${latest.value}% QoQ — recession risk`);
    }
    if (id === 'KAB9' && latest.value < -1.0) {
      signals.push(`UK GDP sharp contraction: ${latest.value}% QoQ`);
    }
    if (id === 'A9ES' && change !== null && changePct !== null && changePct > 6) {
      signals.push(`Average earnings growth at ${changePct.toFixed(1)}% — wage inflation pressure`);
    }
    if (id === 'CZBH' && latest.value > 5.0) {
      signals.push(`UK Core CPI at ${latest.value}% — sticky underlying inflation`);
    }
  }

  const hasData = indicators.some(i => i.value !== null);

  return {
    source: 'ONS (Office for National Statistics)',
    timestamp: new Date().toISOString(),
    dataAvailable: hasData,
    indicators: indicators.filter(i => i.value !== null),
    signals: signals.length > 0
      ? signals
      : hasData
        ? ['UK economic indicators within normal ranges']
        : ['ONS API unavailable — check api.ons.gov.uk'],
    summary: {
      cpiAllItems: indicators.find(i => i.id === 'D7G7')?.value ?? null,
      coreInflation: indicators.find(i => i.id === 'CZBH')?.value ?? null,
      unemploymentRate: indicators.find(i => i.id === 'MGSX')?.value ?? null,
      gdpGrowthQoQ: indicators.find(i => i.id === 'KAB9')?.value ?? null,
    },
    note: 'ONS provides official UK national statistics. Updated monthly/quarterly. Free, no key required.',
  };
}

if (process.argv[1]?.endsWith('ons.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
