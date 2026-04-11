import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

import { getSDNMetadata, getSDNAdvanced, getConsolidatedMetadata, briefing } from '../apis/sources/ofac.mjs';

before(() => saveFetch());
after(() => restoreFetch());

const sampleXml = `<?xml version="1.0"?>
<sdnList>
<Publish_Date>04/01/2026</Publish_Date>
<Record_Count>15000</Record_Count>
<sdnEntry><uid>1234</uid><firstName>John</firstName><lastName>Doe</lastName><sdnType>Individual</sdnType><programList><program>IRAN</program><program>SDGT</program></programList></sdnEntry>
<sdnEntry><uid>5678</uid><firstName>Jane</firstName><lastName>Smith</lastName><sdnType>Entity</sdnType><programList><program>UKRAINE-EO13661</program></programList></sdnEntry>
</sdnList>`;

describe('ofac - getSDNMetadata', () => {
  it('parses publish date and record count from XML', async () => {
    // safeFetch returns { rawText } for non-JSON responses
    mockFetch({ rawText: sampleXml });
    const result = await getSDNMetadata();
    assert.equal(result.publishDate, '04/01/2026');
    assert.equal(result.recordCount, 15000);
    assert.ok(result.hasData);
    assert.ok(result.dataSize > 0);
  });

  it('handles error response', async () => {
    mockFetch({ error: 'HTTP 500: Server Error' });
    const result = await getSDNMetadata();
    assert.ok(result.error);
  });

  it('handles empty response', async () => {
    mockFetch({ rawText: '' });
    const result = await getSDNMetadata();
    assert.equal(result.publishDate, null);
    assert.equal(result.entryCount, null);
    assert.equal(result.hasData, false);
  });
});

describe('ofac - getSDNAdvanced', () => {
  it('fetches from SDN_ADVANCED endpoint', async () => {
    const fn = mockFetch({ rawText: sampleXml });
    await getSDNAdvanced();
    const url = fn.mock.calls[0].arguments[0];
    assert.ok(url.includes('SDN_ADVANCED.XML'));
  });
});

describe('ofac - getConsolidatedMetadata', () => {
  it('fetches from CONS_ADVANCED endpoint', async () => {
    const fn = mockFetch({ rawText: sampleXml });
    await getConsolidatedMetadata();
    const url = fn.mock.calls[0].arguments[0];
    assert.ok(url.includes('CONS_ADVANCED.XML'));
  });
});

describe('ofac - briefing', () => {
  it('returns structured sanctions data', async () => {
    // briefing calls getSDNMetadata, getSDNAdvanced (parallel), then safeFetch again for entries
    mockFetch({ rawText: sampleXml });

    const result = await briefing();
    assert.equal(result.source, 'OFAC Sanctions');
    assert.ok(result.timestamp);
    assert.equal(result.lastUpdated, '04/01/2026');

    // SDN list metadata
    assert.ok(result.sdnList);
    assert.equal(result.sdnList.publishDate, '04/01/2026');
    assert.equal(result.sdnList.recordCount, 15000);
    assert.ok(result.sdnList.dataAvailable);

    // Advanced list metadata
    assert.ok(result.advancedList);
    assert.equal(result.advancedList.publishDate, '04/01/2026');

    // Sample entries parsed from XML
    assert.ok(Array.isArray(result.sampleEntries));
    assert.ok(result.sampleEntries.length <= 10);
    if (result.sampleEntries.length > 0) {
      const entry = result.sampleEntries[0];
      assert.ok(entry.uid);
      assert.ok(entry.name);
      assert.ok(entry.type);
      assert.ok(Array.isArray(entry.programs));
    }

    // Endpoints
    assert.ok(result.endpoints);
    assert.ok(result.endpoints.sdnXml);
    assert.ok(result.endpoints.sdnAdvanced);
    assert.ok(result.endpoints.consolidatedAdvanced);
  });

  it('handles API errors gracefully', async () => {
    mockFetch({ error: 'Service unavailable', source: 'https://sanctionslistservice.ofac.treas.gov' });

    const result = await briefing();
    assert.equal(result.source, 'OFAC Sanctions');
    assert.equal(result.lastUpdated, 'unknown');
  });

  it('parses multiple SDN entries with programs', async () => {
    mockFetch({ rawText: sampleXml });
    const result = await briefing();

    const entries = result.sampleEntries;
    assert.ok(entries.length >= 2);

    const john = entries.find(e => e.name.includes('John'));
    assert.ok(john);
    assert.equal(john.uid, '1234');
    assert.equal(john.type, 'Individual');
    assert.ok(john.programs.includes('IRAN'));
    assert.ok(john.programs.includes('SDGT'));

    const jane = entries.find(e => e.name.includes('Jane'));
    assert.ok(jane);
    assert.equal(jane.uid, '5678');
    assert.equal(jane.type, 'Entity');
  });

  it('handles no XML data returned', async () => {
    mockFetch({});
    const result = await briefing();
    assert.equal(result.source, 'OFAC Sanctions');
    assert.deepEqual(result.sampleEntries, []);
  });
});
