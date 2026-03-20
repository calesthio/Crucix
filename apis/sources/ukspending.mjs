// UK Government Spending — Contracts Finder + Find a Tender Service
// Replaces USAspending.gov with UK equivalents.
//
// Sources:
//   Contracts Finder API (free, no key): contractsfinder.service.gov.uk
//   Find a Tender Service (free, no key): find-tender.service.gov.uk
//   Cabinet Office spend data published quarterly via data.gov.uk
//
// Covers: defence contracts, NHS procurement, infrastructure, technology
// Focus: Ministry of Defence (MoD), DSTL, Home Office, GCHQ-adjacent contracts

import { safeFetch, daysAgo } from '../utils/fetch.mjs';

const CF_BASE = 'https://www.contractsfinder.service.gov.uk/api/rest/2';
const FTS_BASE = 'https://www.find-tender.service.gov.uk/api/1.0';

// Defence and strategic procurement keywords
const DEFENCE_KEYWORDS = [
  'defence', 'military', 'missile', 'ammunition', 'aircraft', 'naval',
  'armoured', 'combat', 'surveillance', 'intelligence', 'cyber security',
  'DSTL', 'QinetiQ', 'BAE Systems',
];

// Key UK government buyers for strategic contracts
const STRATEGIC_BUYERS = [
  'Ministry of Defence',
  'MOD',
  'Home Office',
  'GCHQ',
  'MI5',
  'MI6',
  'Cabinet Office',
  'Foreign Commonwealth and Development Office',
  'FCDO',
  'DSTL',
  'Defence Infrastructure Organisation',
  'DIO',
  'NHS England',
  'NHS Supply Chain',
  'Department for Transport',
  'HMRC',
  'Border Force',
];

// Search Contracts Finder for recent notices
async function searchContractsFinder(opts = {}) {
  const {
    keywords = DEFENCE_KEYWORDS.slice(0, 5),
    limit = 20,
    publishedFrom = daysAgo(30),
  } = opts;

  const body = {
    searchCriteria: {
      keyword: keywords.join(' '),
      publishedFrom,
      publishedTo: daysAgo(0),
      postcode: null,
      radius: null,
      buyerTypes: [],
      buyerCountries: ['GB'],
      lotTypes: [],
    },
    size: limit,
    from: 0,
    sort: 'publishedDate',
    direction: 'DESC',
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(`${CF_BASE}/search_notices/json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Crucix-UK/1.0',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return { error: `HTTP ${res.status}: ${err.slice(0, 200)}`, results: [] };
    }
    return res.json();
  } catch (e) {
    return { error: e.message, results: [] };
  }
}

// Search Find a Tender Service (UK post-Brexit replacement for OJEU)
async function searchFindATender(keyword, limit = 10) {
  const params = new URLSearchParams({
    keyword,
    status: 'active',
    publishedFrom: daysAgo(30),
    size: String(limit),
  });

  return safeFetch(`${FTS_BASE}/search?${params}`, {
    headers: { 'Accept': 'application/json' },
    timeout: 20000,
  });
}

// Compact a contract notice for briefing output
function compactNotice(n) {
  return {
    id: n.id || n.noticeId || null,
    title: n.title || n.noticeTitle || 'Unknown',
    buyer: n.organisationName || n.buyerName || n.contracting_authority || null,
    value: n.value?.amount || n.estimatedValue || null,
    currency: n.value?.currency || 'GBP',
    description: (n.description || n.noticeBody || '').slice(0, 200),
    publishedDate: n.publishedDate || n.publication_date || null,
    deadline: n.deadlineDate || n.deadline || null,
    type: n.noticeType || n.type || null,
    cpvCodes: n.cpvCodes || n.cpv_codes || [],
  };
}

// Is this contract from a strategic buyer?
function isStrategicBuyer(notice) {
  const buyer = (notice.buyer || '').toLowerCase();
  return STRATEGIC_BUYERS.some(b => buyer.includes(b.toLowerCase()));
}

// Briefing
export async function briefing() {
  const [defenceResult, techResult, infraResult] = await Promise.allSettled([
    searchContractsFinder({
      keywords: ['defence', 'military', 'missile', 'naval', 'intelligence', 'surveillance'],
      limit: 20,
      publishedFrom: daysAgo(14),
    }),
    searchContractsFinder({
      keywords: ['cyber', 'SIGINT', 'communications', 'satellite', 'radar', 'encryption'],
      limit: 10,
      publishedFrom: daysAgo(14),
    }),
    searchContractsFinder({
      keywords: ['critical infrastructure', 'nuclear', 'border force', 'ballistic', 'CBRN'],
      limit: 10,
      publishedFrom: daysAgo(14),
    }),
  ]);

  const defenceContracts = (defenceResult.status === 'fulfilled')
    ? (defenceResult.value?.results || defenceResult.value?.notices || [])
    : [];
  const techContracts = (techResult.status === 'fulfilled')
    ? (techResult.value?.results || techResult.value?.notices || [])
    : [];
  const infraContracts = (infraResult.status === 'fulfilled')
    ? (infraResult.value?.results || infraResult.value?.notices || [])
    : [];

  const allContracts = [...defenceContracts, ...techContracts, ...infraContracts];
  const uniqueContracts = [];
  const seenIds = new Set();
  for (const c of allContracts) {
    const id = c.id || c.noticeId || JSON.stringify(c).slice(0, 50);
    if (!seenIds.has(id)) {
      seenIds.add(id);
      uniqueContracts.push(c);
    }
  }

  const compacted = uniqueContracts.slice(0, 20).map(compactNotice);
  const strategic = compacted.filter(isStrategicBuyer);

  // High-value contracts
  const highValue = compacted
    .filter(c => c.value != null && c.value > 10_000_000)
    .sort((a, b) => (b.value || 0) - (a.value || 0));

  const signals = [];
  if (highValue.length > 0) {
    signals.push(
      `${highValue.length} high-value UK government contract(s) >£10m: ` +
      highValue.slice(0, 3).map(c => `${c.title?.slice(0, 50)} (£${(c.value / 1e6).toFixed(1)}m)`).join('; ')
    );
  }
  if (strategic.length > 3) {
    signals.push(`${strategic.length} contracts from strategic UK government buyers (MoD, Home Office, FCDO, etc.)`);
  }

  return {
    source: 'UK Contracts Finder / Find a Tender Service',
    timestamp: new Date().toISOString(),
    recentDefenceContracts: compacted,
    strategicBuyerContracts: strategic.slice(0, 10),
    highValueContracts: highValue.slice(0, 10),
    signals: signals.length > 0
      ? signals
      : ['No unusual UK government procurement activity detected'],
    note: [
      'Contracts Finder covers UK public sector contracts above £10k (£25k for central government).',
      'Find a Tender Service covers contracts above OJEU threshold (~£138k for services).',
      'Major UK defence primes: BAE Systems, Leonardo UK, QinetiQ, Rolls-Royce, MBDA UK, Thales UK.',
    ],
    ...(defenceResult.status === 'rejected' ? { defenceError: defenceResult.reason?.message } : {}),
  };
}

if (process.argv[1]?.endsWith('ukspending.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
