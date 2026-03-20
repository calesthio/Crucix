// OFAC + UK OFSI — US & UK Financial Sanctions Lists
// No auth required. Monitors:
//   - OFAC SDN list (US Treasury Specially Designated Nationals)
//   - UK OFSI Consolidated List (HM Treasury Office of Financial Sanctions Implementation)
//
// Both lists are critical for UK-based compliance and OSINT:
//   - OFAC applies to USD transactions and US persons globally
//   - OFSI applies to all UK persons/entities and GBP transactions

import { safeFetch } from '../utils/fetch.mjs';

// UK OFSI Consolidated Sanctions List (CSV format)
const OFSI_LIST_URL = 'https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.csv';
// OFSI also publishes a summary page:
const OFSI_PAGE_URL = 'https://www.gov.uk/government/publications/financial-sanctions-consolidated-list-of-targets';

const EXPORTS_BASE = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports';

// SDN list endpoints
const SDN_XML_URL = `${EXPORTS_BASE}/SDN.XML`;
const SDN_ADVANCED_URL = `${EXPORTS_BASE}/SDN_ADVANCED.XML`;
const CONS_ADVANCED_URL = `${EXPORTS_BASE}/CONS_ADVANCED.XML`;

// Parse basic info from SDN XML (publish date, entry count)
function parseSDNMetadata(xml) {
  if (!xml || xml.error) return { error: xml?.error || 'No data returned' };

  const raw = xml.rawText || '';

  // Extract publish date
  const publishDate = raw.match(/<Publish_Date>(.*?)<\/Publish_Date>/)?.[1]
    || raw.match(/<publish_date>(.*?)<\/publish_date>/i)?.[1]
    || null;

  // Count SDN entries
  const entryMatches = raw.match(/<sdnEntry>/gi);
  const entryCount = entryMatches ? entryMatches.length : null;

  // Extract record count if present
  const recordCount = raw.match(/<Record_Count>(.*?)<\/Record_Count>/)?.[1]
    || raw.match(/<records_count>(.*?)<\/records_count>/i)?.[1]
    || null;

  return {
    publishDate,
    entryCount,
    recordCount: recordCount ? parseInt(recordCount, 10) : null,
    hasData: raw.length > 0,
    dataSize: raw.length,
  };
}

// Fetch SDN list metadata (smaller initial chunk via timeout)
export async function getSDNMetadata() {
  // The full SDN XML is large; safeFetch will get the first 500 chars
  // which should include the header/publish date
  const data = await safeFetch(SDN_XML_URL, { timeout: 20000 });
  return parseSDNMetadata(data);
}

// Fetch advanced SDN data (includes more structured info)
export async function getSDNAdvanced() {
  const data = await safeFetch(SDN_ADVANCED_URL, { timeout: 20000 });
  return parseSDNMetadata(data);
}

// Fetch consolidated list metadata
export async function getConsolidatedMetadata() {
  const data = await safeFetch(CONS_ADVANCED_URL, { timeout: 20000 });
  return parseSDNMetadata(data);
}

// Parse recent SDN entries from XML snippet
function parseRecentEntries(xml) {
  if (!xml || xml.error) return [];

  const raw = xml.rawText || '';
  const entries = [];
  const entryRegex = /<sdnEntry>([\s\S]*?)<\/sdnEntry>/gi;
  let match;
  let count = 0;

  while ((match = entryRegex.exec(raw)) !== null && count < 20) {
    const content = match[1];
    const uid = content.match(/<uid>(.*?)<\/uid>/i)?.[1];
    const lastName = content.match(/<lastName>(.*?)<\/lastName>/i)?.[1];
    const firstName = content.match(/<firstName>(.*?)<\/firstName>/i)?.[1];
    const sdnType = content.match(/<sdnType>(.*?)<\/sdnType>/i)?.[1];

    // Extract programs
    const programs = [];
    const progRegex = /<program>(.*?)<\/program>/gi;
    let progMatch;
    while ((progMatch = progRegex.exec(content)) !== null) {
      programs.push(progMatch[1]);
    }

    if (uid || lastName) {
      entries.push({
        uid,
        name: [firstName, lastName].filter(Boolean).join(' '),
        type: sdnType,
        programs,
      });
      count++;
    }
  }

  return entries;
}

// Fetch and parse UK OFSI Consolidated List metadata
async function getOFSIMetadata() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(OFSI_LIST_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Crucix-UK/1.0' },
    });
    clearTimeout(timer);
    if (!res.ok) return { error: `HTTP ${res.status}`, available: false };
    const text = await res.text();

    // Parse CSV header and first few rows
    const lines = text.split('\n').filter(l => l.trim());
    const header = lines[0]?.split(',') || [];
    const entryCount = lines.length - 1; // subtract header

    // Extract unique names from first column (if available)
    const sampleNames = lines.slice(1, 11).map(l => {
      const cols = l.split(',');
      return cols[0]?.replace(/"/g, '').trim() || null;
    }).filter(Boolean);

    // Try to find a date in the CSV
    const dateMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);

    return {
      available: true,
      entryCount,
      estimatedEntries: entryCount,
      columns: header.slice(0, 8).map(h => h.replace(/"/g, '').trim()),
      sampleNames,
      lastUpdatedGuess: dateMatch ? dateMatch[1] : 'unknown',
    };
  } catch (e) {
    return { error: e.message, available: false };
  }
}

// Briefing — report on US OFAC + UK OFSI sanctions list status
export async function briefing() {
  const [sdnMeta, advancedMeta, ofsiMeta] = await Promise.all([
    getSDNMetadata(),
    getSDNAdvanced(),
    getOFSIMetadata(),
  ]);

  // Try to extract any entries visible in the OFAC advanced data
  const sampleEntries = parseRecentEntries(
    await safeFetch(SDN_ADVANCED_URL, { timeout: 25000 })
  );

  return {
    source: 'OFAC Sanctions (US) + OFSI Consolidated List (UK)',
    timestamp: new Date().toISOString(),
    // UK OFSI
    ukOFSI: {
      description: 'HM Treasury Office of Financial Sanctions Implementation',
      available: ofsiMeta.available,
      entryCount: ofsiMeta.entryCount || null,
      sampleNames: ofsiMeta.sampleNames || [],
      lastUpdated: ofsiMeta.lastUpdatedGuess || 'unknown',
      url: OFSI_PAGE_URL,
      error: ofsiMeta.error || null,
    },
    // US OFAC
    usOFAC: {
      description: 'US Treasury Office of Foreign Assets Control SDN List',
      lastUpdated: sdnMeta.publishDate || advancedMeta.publishDate || 'unknown',
      sdnList: {
        publishDate: sdnMeta.publishDate,
        entryCount: sdnMeta.entryCount,
        recordCount: sdnMeta.recordCount,
        dataAvailable: sdnMeta.hasData,
      },
      advancedList: {
        publishDate: advancedMeta.publishDate,
        entryCount: advancedMeta.entryCount,
        dataAvailable: advancedMeta.hasData,
      },
    },
    sampleEntries: sampleEntries.slice(0, 10),
    note: [
      'OFSI list applies to all UK persons/entities under UK sanctions regimes.',
      'OFAC list applies to US persons and USD transactions globally.',
      'Post-Brexit, UK sanctions can diverge from US/EU — monitor both.',
      'UK Russia sanctions: most extensive programme, updated frequently.',
    ],
    endpoints: {
      ukOFSI_CSV: OFSI_LIST_URL,
      ukOFSI_page: OFSI_PAGE_URL,
      usOFAC_sdnXml: SDN_XML_URL,
      usOFAC_sdnAdvanced: SDN_ADVANCED_URL,
    },
  };
}

// Run standalone
if (process.argv[1]?.endsWith('ofac.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
