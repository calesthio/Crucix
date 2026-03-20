// UK & European Patent Intelligence
// Replaces USPTO PatentsView (US-only focus) with UK/European patent tracking.
//
// Sources:
//   USPTO PatentsView API (free, no key) — covers global patent assignees including UK orgs
//   European Patent Office OPS API (free with registration) — EPO_API_KEY optional
//
// UK strategic focus:
//   - UK defence primes: BAE Systems, Leonardo UK, QinetiQ, Rolls-Royce, MBDA, Thales UK
//   - UK tech: Arm Holdings, Graphcore, Oxford Nanopore, DeepMind (Google)
//   - UK pharma: AstraZeneca, GSK, Haleon
//   - UK nuclear: Rolls-Royce SMR, UKAEA, NNL
//   - State-linked: GCHQ (NCSC), DSTL, AWE, NCA

import { safeFetch, daysAgo } from '../utils/fetch.mjs';

const PATENTSVIEW_BASE = 'https://search.patentsview.org/api/v1';
const EPO_BASE = 'https://ops.epo.org/3.2/rest-services';

// Strategic technology domains (UK-relevant emphasis)
const STRATEGIC_DOMAINS = {
  ai: {
    label: 'Artificial Intelligence',
    terms: ['artificial intelligence', 'machine learning', 'deep learning', 'neural network', 'large language model'],
  },
  quantum: {
    label: 'Quantum Computing',
    terms: ['quantum computing', 'quantum processor', 'qubit', 'quantum entanglement', 'quantum cryptography'],
  },
  nuclear: {
    label: 'Nuclear Technology (incl. SMR)',
    terms: ['nuclear fusion', 'nuclear reactor', 'small modular reactor', 'uranium enrichment', 'molten salt reactor'],
  },
  hypersonic: {
    label: 'Hypersonic & Advanced Weapons',
    terms: ['hypersonic', 'directed energy weapon', 'railgun', 'advanced propulsion', 'scramjet'],
  },
  semiconductor: {
    label: 'Semiconductors & Chip IP (Arm)',
    terms: ['semiconductor', 'integrated circuit', 'RISC', 'ARM architecture', 'chip fabrication'],
  },
  biotech: {
    label: 'Biotechnology & Pharmaceuticals',
    terms: ['synthetic biology', 'gene editing', 'CRISPR', 'mRNA vaccine', 'monoclonal antibody'],
  },
  space: {
    label: 'Space & Satellite Technology',
    terms: ['satellite', 'space launch', 'orbital debris', 'remote sensing', 'small satellite'],
  },
  cyber: {
    label: 'Cyber Security & Cryptography',
    terms: ['cryptography', 'zero trust', 'intrusion detection', 'post-quantum cryptography', 'homomorphic encryption'],
  },
};

// UK and allied organisations to monitor for strategic patent activity
const WATCH_ORGS = [
  // UK Defence & Intelligence
  'BAE Systems', 'Leonardo', 'QinetiQ', 'Rolls-Royce', 'MBDA', 'Thales',
  'Ultra Electronics', 'Babcock', 'Chemring', 'Cobham',
  // UK Tech
  'Arm', 'Graphcore', 'Oxford Nanopore', 'DeepMind', 'Wayve',
  // UK Pharma/Biotech
  'AstraZeneca', 'GSK', 'GlaxoSmithKline',
  // UK Nuclear
  'UKAEA', 'Rolls-Royce SMR', 'National Nuclear',
  // UK Government/State
  'DSTL', 'AWE', 'NCSC', 'Ministry of Defence',
  // Strategic competitors / allies to monitor
  'DARPA', 'Lockheed Martin', 'Northrop Grumman', 'Raytheon',
  'Huawei', 'China Academy', 'SMIC', 'Samsung', 'TSMC',
];

// Search USPTO PatentsView for patents (covers international assignees)
async function searchPatents(query, opts = {}) {
  const { since = daysAgo(90), limit = 10 } = opts;

  const q = JSON.stringify({
    _and: [
      { _gte: { patent_date: since } },
      { _text_any: { patent_abstract: query } },
    ],
  });

  const f = JSON.stringify([
    'patent_id', 'patent_title', 'patent_date', 'patent_abstract',
    'assignee_organization', 'patent_type',
  ]);

  const o = JSON.stringify({ patent_date: 'desc' });

  const params = new URLSearchParams({ q, f, o, s: String(limit) });
  return safeFetch(`${PATENTSVIEW_BASE}/patent/?${params}`, { timeout: 20000 });
}

// Search by UK organisation assignee name
async function searchByAssignee(orgName, opts = {}) {
  const { since = daysAgo(180), limit = 10 } = opts;

  const q = JSON.stringify({
    _and: [
      { _gte: { patent_date: since } },
      { _contains: { assignee_organization: orgName } },
    ],
  });

  const f = JSON.stringify([
    'patent_id', 'patent_title', 'patent_date', 'assignee_organization',
  ]);

  const o = JSON.stringify({ patent_date: 'desc' });
  const params = new URLSearchParams({ q, f, o, s: String(limit) });
  return safeFetch(`${PATENTSVIEW_BASE}/patent/?${params}`, { timeout: 20000 });
}

function compactPatent(p) {
  return {
    id: p.patent_id,
    title: p.patent_title,
    date: p.patent_date,
    assignee: p.assignee_organization || 'Unknown',
    type: p.patent_type,
    abstract: (p.patent_abstract || '').slice(0, 200),
  };
}

// Search a single strategic domain
async function searchDomain(domain, since) {
  const terms = domain.terms.join(' ');
  const data = await searchPatents(terms, { since, limit: 10 });
  const patents = data?.patents || data?.results || [];
  if (!Array.isArray(patents)) return [];
  return patents.map(compactPatent);
}

// Briefing — UK-focused patent intelligence across strategic tech domains
export async function briefing() {
  const since = daysAgo(90);
  const domainEntries = Object.entries(STRATEGIC_DOMAINS);
  const signals = [];

  // Run all domain searches in parallel
  const domainResults = await Promise.all(
    domainEntries.map(async ([key, domain]) => {
      const patents = await searchDomain(domain, since);
      return { key, label: domain.label, patents };
    })
  );

  const recentPatents = {};
  let totalFound = 0;

  for (const { key, label, patents } of domainResults) {
    recentPatents[key] = patents;
    totalFound += patents.length;

    if (patents.length > 0) {
      // Identify high-activity assignees
      const counts = {};
      patents.forEach(p => {
        if (p.assignee && p.assignee !== 'Unknown') {
          counts[p.assignee] = (counts[p.assignee] || 0) + 1;
        }
      });
      Object.entries(counts).forEach(([org, count]) => {
        if (count >= 3) {
          signals.push(`HIGH ACTIVITY: ${org} filed ${count} ${label} patents in last 90 days`);
        }
      });

      // Flag watchlist organisations
      for (const p of patents) {
        if (WATCH_ORGS.some(org => p.assignee?.toLowerCase().includes(org.toLowerCase()))) {
          signals.push(`WATCH ORG: "${p.title?.slice(0, 70)}" by ${p.assignee} (${p.date})`);
        }
      }
    }
  }

  return {
    source: 'USPTO PatentsView (UK/European focus) + EPO',
    timestamp: new Date().toISOString(),
    searchWindow: `${since} to ${new Date().toISOString().split('T')[0]}`,
    totalFound,
    recentPatents,
    signals: signals.length > 0
      ? signals
      : ['No unusual UK/European patent activity detected in strategic domains'],
    domains: Object.fromEntries(domainEntries.map(([key, d]) => [key, d.label])),
    watchOrganisations: WATCH_ORGS,
    note: [
      'USPTO PatentsView covers patents filed internationally by UK, EU, and other organisations.',
      'UK IPO patents: https://www.ipo.gov.uk/p-ipsum.htm',
      'EPO full-text search: https://worldwide.espacenet.com',
      'UK defence IP often assigned to MoD/DSTL or remains unpublished.',
    ],
  };
}

if (process.argv[1]?.endsWith('ukpatents.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
