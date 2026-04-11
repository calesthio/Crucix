import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { saveFetch, restoreFetch, mockFetch, mockFetchError } from './helpers.mjs';

import { briefing } from '../apis/sources/cisa-kev.mjs';

before(() => saveFetch());
after(() => restoreFetch());

function makeVuln(overrides = {}) {
  const now = new Date();
  const recentDate = new Date(now - 5 * 86400_000).toISOString().split('T')[0]; // 5 days ago
  return {
    cveID: 'CVE-2026-0001',
    vendorProject: 'Microsoft',
    product: 'Windows',
    vulnerabilityName: 'Windows Privilege Escalation',
    dateAdded: recentDate,
    dueDate: new Date(now.getTime() + 14 * 86400_000).toISOString().split('T')[0], // 14 days from now
    shortDescription: 'A vulnerability in Windows allows privilege escalation.',
    knownRansomwareCampaignUse: 'Unknown',
    ...overrides,
  };
}

describe('cisa-kev - briefing', () => {
  it('returns structured vulnerability data', async () => {
    const vulns = [
      makeVuln({ cveID: 'CVE-2026-0001' }),
      makeVuln({ cveID: 'CVE-2026-0002', vendorProject: 'Apple', product: 'iOS' }),
    ];

    mockFetch({
      catalogVersion: '2026.04.10',
      dateReleased: '2026-04-10T00:00:00Z',
      vulnerabilities: vulns,
    });

    const result = await briefing();
    assert.equal(result.source, 'CISA-KEV');
    assert.ok(result.timestamp);
    assert.equal(result.catalogVersion, '2026.04.10');
    assert.equal(result.dateReleased, '2026-04-10T00:00:00Z');

    // Summary
    assert.ok(result.summary);
    assert.equal(result.summary.totalInCatalog, 2);
    assert.ok(typeof result.summary.recentAdditions === 'number');
    assert.ok(typeof result.summary.ransomwareLinked === 'number');
    assert.ok(typeof result.summary.overdueCount === 'number');
    assert.ok(Array.isArray(result.summary.topVendors));

    // Vulnerabilities list
    assert.ok(Array.isArray(result.vulnerabilities));
    assert.ok(result.vulnerabilities.length <= 20);
    const vuln = result.vulnerabilities[0];
    assert.ok(vuln.cveID);
    assert.ok(vuln.vendorProject);
    assert.ok(vuln.product);
    assert.ok(vuln.dateAdded);

    // Signals
    assert.ok(Array.isArray(result.signals));
  });

  it('handles API error', async () => {
    mockFetch({ error: 'HTTP 503: Service unavailable', source: 'https://www.cisa.gov' });
    const result = await briefing();
    assert.equal(result.source, 'CISA-KEV');
    assert.ok(result.error);
    assert.ok(!result.vulnerabilities);
  });

  it('counts ransomware-linked vulnerabilities', async () => {
    const vulns = [
      makeVuln({ cveID: 'CVE-2026-0001', knownRansomwareCampaignUse: 'Known' }),
      makeVuln({ cveID: 'CVE-2026-0002', knownRansomwareCampaignUse: 'Unknown' }),
      makeVuln({ cveID: 'CVE-2026-0003', knownRansomwareCampaignUse: 'Known' }),
    ];

    mockFetch({ vulnerabilities: vulns });
    const result = await briefing();
    assert.equal(result.summary.ransomwareLinked, 2);
  });

  it('detects overdue vulnerabilities', async () => {
    const pastDate = new Date(Date.now() - 30 * 86400_000).toISOString().split('T')[0];
    const vulns = [
      makeVuln({ cveID: 'CVE-2026-0001', dueDate: pastDate }),
      makeVuln({ cveID: 'CVE-2026-0002' }), // future due date
    ];

    mockFetch({ vulnerabilities: vulns });
    const result = await briefing();
    assert.equal(result.summary.overdueCount, 1);
  });

  it('generates high severity signal for many recent additions', async () => {
    const vulns = [];
    for (let i = 0; i < 8; i++) {
      vulns.push(makeVuln({ cveID: `CVE-2026-${String(i).padStart(4, '0')}` }));
    }

    mockFetch({ vulnerabilities: vulns });
    const result = await briefing();
    const highSignal = result.signals.find(s => s.severity === 'high');
    assert.ok(highSignal, 'should have high severity signal for >5 recent additions');
    assert.ok(highSignal.signal.includes('new KEV entries'));
  });

  it('generates critical signal for ransomware-linked recent entries', async () => {
    const vulns = [
      makeVuln({ cveID: 'CVE-2026-0001', knownRansomwareCampaignUse: 'Known' }),
    ];

    mockFetch({ vulnerabilities: vulns });
    const result = await briefing();
    const critSignal = result.signals.find(s => s.severity === 'critical');
    assert.ok(critSignal, 'should flag ransomware-linked recent CVEs');
    assert.ok(critSignal.signal.includes('ransomware'));
  });

  it('detects hot products with multiple recent CVEs', async () => {
    const vulns = [
      makeVuln({ cveID: 'CVE-2026-0001', vendorProject: 'Microsoft', product: 'Exchange' }),
      makeVuln({ cveID: 'CVE-2026-0002', vendorProject: 'Microsoft', product: 'Exchange' }),
      makeVuln({ cveID: 'CVE-2026-0003', vendorProject: 'Microsoft', product: 'Exchange' }),
    ];

    mockFetch({ vulnerabilities: vulns });
    const result = await briefing();
    assert.ok(result.summary.hotProducts.length > 0);
    assert.equal(result.summary.hotProducts[0].product, 'Microsoft Exchange');
    assert.equal(result.summary.hotProducts[0].count, 3);

    // Should also generate medium signal
    const medSignal = result.signals.find(s => s.severity === 'medium');
    assert.ok(medSignal);
  });

  it('handles empty vulnerabilities array', async () => {
    mockFetch({ vulnerabilities: [], catalogVersion: '2026.04.10' });
    const result = await briefing();
    // summarizeVulnerabilities returns {} for empty array
    assert.deepEqual(result.summary, {});
    assert.deepEqual(result.vulnerabilities, []);
    assert.deepEqual(result.signals, []);
  });

  it('truncates long descriptions', async () => {
    const longDesc = 'A'.repeat(500);
    const vulns = [makeVuln({ shortDescription: longDesc })];
    mockFetch({ vulnerabilities: vulns });
    const result = await briefing();
    assert.ok(result.vulnerabilities[0].shortDescription.length <= 300);
  });
});
