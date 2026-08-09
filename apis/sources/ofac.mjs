// OFAC — US Treasury Office of Foreign Assets Control Sanctions
// No auth required. Monitors the Specially Designated Nationals (SDN) list
// and consolidated sanctions list for changes.

const EXPORTS_BASE = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports';

// SDN list endpoints
const SDN_XML_URL = `${EXPORTS_BASE}/SDN.XML`;
const SDN_ADVANCED_URL = `${EXPORTS_BASE}/SDN_ADVANCED.XML`;
const CONS_ADVANCED_URL = `${EXPORTS_BASE}/CONS_ADVANCED.XML`;

// These exports are whole-database dumps — SDN.XML is ~27 MB and
// SDN_ADVANCED.XML ~120 MB — but everything this briefing reports (publish
// date, record count, a sample of entries) sits in the first few KB. Ask for
// just that range: the S3 origin sets `Accept-Ranges: bytes` and answers 206.
const HEAD_BYTES = 64 * 1024;

// Read at most `bytes` from `url`. Uses a Range request, and still stops early
// if an intermediary ignores it and starts streaming the full body, so a 120 MB
// export can never be pulled into memory.
async function fetchHead(url, { bytes = HEAD_BYTES, timeout = 20000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Crucix/1.0', 'Range': `bytes=0-${bytes - 1}` },
    });
    // 206 = Range honoured, 200 = ignored (we bound the read below either way).
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while (received < bytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
    }
    await reader.cancel().catch(() => {});

    return { rawText: Buffer.concat(chunks).toString('utf8') };
  } catch (e) {
    return { error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

// The ADVANCED exports date themselves with <DateOfIssue><Year/><Month/><Day/>
// rather than a <Publish_Date> string. Normalise it to YYYY-MM-DD.
function parseDateOfIssue(raw) {
  const block = raw.match(/<DateOfIssue[^>]*>([\s\S]*?)<\/DateOfIssue>/i)?.[1];
  if (!block) return null;
  const y = block.match(/<Year>(\d+)<\/Year>/i)?.[1];
  const m = block.match(/<Month>(\d+)<\/Month>/i)?.[1];
  const d = block.match(/<Day>(\d+)<\/Day>/i)?.[1];
  return y && m && d ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : null;
}

// Parse basic info from SDN XML (publish date, entry count)
function parseSDNMetadata(xml) {
  if (!xml || xml.error) return { error: xml?.error || 'No data returned' };

  const raw = xml.rawText || '';

  // Extract publish date. SDN.XML uses <Publish_Date>; the ADVANCED exports
  // carry a structured <DateOfIssue> block instead, which is why the advanced
  // list's publishDate was always null.
  const publishDate = raw.match(/<Publish_Date>(.*?)<\/Publish_Date>/)?.[1]
    || raw.match(/<publish_date>(.*?)<\/publish_date>/i)?.[1]
    || parseDateOfIssue(raw)
    || null;

  // Entries visible in the sampled window — `recordCount` below is the
  // authoritative total for the whole list.
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

// Fetch SDN list metadata from the head of the export
export async function getSDNMetadata() {
  return parseSDNMetadata(await fetchHead(SDN_XML_URL));
}

// Fetch advanced SDN data (includes more structured info)
export async function getSDNAdvanced() {
  return parseSDNMetadata(await fetchHead(SDN_ADVANCED_URL));
}

// Fetch consolidated list metadata
export async function getConsolidatedMetadata() {
  return parseSDNMetadata(await fetchHead(CONS_ADVANCED_URL));
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

// Briefing — report on sanctions list status and metadata
export async function briefing() {
  // One ranged read per list, reused for both metadata and sample entries.
  // The advanced export was previously downloaded twice — once here and again
  // for the sample — and neither pass could ever succeed on it: SDN_ADVANCED.XML
  // contains no <sdnEntry> elements at all. Sample from SDN.XML, which does.
  const [sdnHead, advancedHead] = await Promise.all([
    fetchHead(SDN_XML_URL),
    fetchHead(SDN_ADVANCED_URL),
  ]);

  const sdnMeta = parseSDNMetadata(sdnHead);
  const advancedMeta = parseSDNMetadata(advancedHead);
  const sampleEntries = parseRecentEntries(sdnHead);

  return {
    source: 'OFAC Sanctions',
    timestamp: new Date().toISOString(),
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
      recordCount: advancedMeta.recordCount,
      dataAvailable: advancedMeta.hasData,
    },
    sampleEntries: sampleEntries.slice(0, 10),
    endpoints: {
      sdnXml: SDN_XML_URL,
      sdnAdvanced: SDN_ADVANCED_URL,
      consolidatedAdvanced: CONS_ADVANCED_URL,
    },
  };
}

// Run standalone
if (process.argv[1]?.endsWith('ofac.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
