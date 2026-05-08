import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const VERSION = 'social-lead-store-v1';
const LEAD_VERSION = 'social-lead-v1';
const DEFAULT_MAX_LEADS = 200;

function ensureDir(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function readJson(path, fallback) {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function nowIso() {
  return new Date().toISOString();
}

function trimString(value, max = 10000) {
  if (value == null) return '';
  return String(value).trim().slice(0, max);
}

function normalizeArray(values, maxItems = 20, maxLength = 2000) {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => trimString(value, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeAttachment(value) {
  if (!value || typeof value !== 'object') return null;
  const type = trimString(value.type || value.mimeType || value.kind, 100);
  const url = trimString(value.url || value.href || '', 4000);
  const description = trimString(value.description || value.alt || value.label || '', 500);
  if (!type && !url && !description) return null;
  return {
    type: type || null,
    url: url || null,
    description: description || null,
  };
}

function compactLeadSummary(lead) {
  return {
    leadId: lead.leadId,
    platform: lead.source?.platform || 'unknown',
    authorHandle: lead.source?.authorHandle || null,
    postUrl: lead.source?.postUrl || null,
    capturedAt: lead.source?.capturedAt || null,
    captureMethod: lead.source?.captureMethod || null,
    acquisitionTier: lead.source?.acquisitionTier || null,
    textPreview: trimString(lead.content?.normalizedText || lead.rawEvidence?.rawText || '', 160) || null,
  };
}

export function normalizeSocialLeadInput(input = {}) {
  const platform = trimString(input.platform || 'x', 50).toLowerCase() || 'x';
  const postUrl = trimString(input.postUrl || input.url || '', 4000);
  const rawText = trimString(input.rawText || input.text || '', 20000);
  const quotedThreadText = normalizeArray(input.quotedThreadText || input.threadContext || [], 20, 4000);
  const operatorContext = trimString(input.operatorContext || input.note || '', 4000);
  const authorHandle = trimString(input.authorHandle || input.handle || '', 200).replace(/^@+/, '');
  const authorDisplayName = trimString(input.authorDisplayName || input.displayName || '', 500);
  const citedUrls = normalizeArray(input.citedUrls || input.links || [], 20, 4000);
  const hashtags = normalizeArray(input.hashtags || [], 30, 200);
  const mentions = normalizeArray(input.mentions || [], 30, 200);
  const attachments = Array.isArray(input.attachments)
    ? input.attachments.map(normalizeAttachment).filter(Boolean).slice(0, 20)
    : [];
  const captureMethod = trimString(input.captureMethod || (postUrl ? 'operator-url-drop' : 'operator-text-drop'), 100) || 'operator-text-drop';
  const acquisitionTier = trimString(input.acquisitionTier || (postUrl ? 'manual-url' : 'manual-text'), 100) || 'manual-text';
  const observedAt = trimString(input.observedAt || '', 100) || nowIso();

  if (platform === 'x' && !postUrl && !rawText && quotedThreadText.length === 0) {
    throw new Error('x lead intake requires postUrl, rawText, or quotedThreadText');
  }

  if (!rawText && quotedThreadText.length === 0) {
    throw new Error('social lead intake requires rawText or quotedThreadText');
  }

  return {
    platform,
    postUrl: postUrl || null,
    rawText,
    quotedThreadText,
    operatorContext: operatorContext || null,
    authorHandle: authorHandle || null,
    authorDisplayName: authorDisplayName || null,
    citedUrls,
    hashtags,
    mentions,
    attachments,
    captureMethod,
    acquisitionTier,
    observedAt,
  };
}

export function createSocialLead(input = {}, options = {}) {
  const normalized = normalizeSocialLeadInput(input);
  const capturedAt = trimString(options.capturedAt || '', 100) || nowIso();
  const leadId = trimString(options.leadId || '', 120) || `lead-${normalized.platform}-${capturedAt.replace(/[^0-9]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const normalizedText = [normalized.rawText, ...normalized.quotedThreadText].filter(Boolean).join('\n\n').replace(/\s+$/g, '');

  return {
    version: LEAD_VERSION,
    leadId,
    status: 'captured',
    source: {
      platform: normalized.platform,
      postUrl: normalized.postUrl,
      postId: null,
      authorHandle: normalized.authorHandle,
      authorDisplayName: normalized.authorDisplayName,
      capturedAt,
      observedAt: normalized.observedAt,
      captureMethod: normalized.captureMethod,
      acquisitionTier: normalized.acquisitionTier,
      acquisitionDetail: {
        usedLogin: false,
        usedBrowser: false,
        usedApi: false,
        usedPasteFallback: normalized.acquisitionTier === 'manual-text',
      },
    },
    rawEvidence: {
      rawText: normalized.rawText || null,
      quotedThreadText: normalized.quotedThreadText,
      operatorContext: normalized.operatorContext,
      attachments: normalized.attachments,
    },
    content: {
      rawText: normalized.rawText || null,
      normalizedText,
      language: trimString(input.language || 'unknown', 32) || 'unknown',
      citedUrls: normalized.citedUrls,
      hashtags: normalized.hashtags,
      mentions: normalized.mentions,
      threadContext: normalized.quotedThreadText,
      media: normalized.attachments,
    },
    provenance: {
      isFirsthand: null,
      derivativeClass: 'unknown',
      repostDistance: null,
      sourceReputation: {
        score: null,
        inputs: [],
      },
    },
    safety: {
      contentRisk: 'normal',
      promptInjectionSignals: [],
      truncated: false,
      quarantined: false,
    },
  };
}

export function createSocialLeadStore({ rootDir, maxLeads = DEFAULT_MAX_LEADS } = {}) {
  if (!rootDir) throw new Error('rootDir is required');
  const baseDir = join(rootDir, 'social-leads');
  const storePath = join(baseDir, 'store.json');
  ensureDir(baseDir);

  function load() {
    return readJson(storePath, {
      version: VERSION,
      updatedAt: null,
      totalLeads: 0,
      leads: [],
    });
  }

  function save(state) {
    const payload = {
      version: VERSION,
      updatedAt: nowIso(),
      totalLeads: Array.isArray(state.leads) ? state.leads.length : 0,
      leads: Array.isArray(state.leads) ? state.leads.slice(0, maxLeads) : [],
    };
    writeJson(storePath, payload);
    return payload;
  }

  function intake(input = {}, options = {}) {
    const state = load();
    const lead = createSocialLead(input, options);
    const existingIndex = state.leads.findIndex(item => item.leadId === lead.leadId);
    if (existingIndex >= 0) state.leads.splice(existingIndex, 1);
    state.leads.unshift(lead);
    const saved = save(state);
    return {
      lead,
      summary: buildContract(saved),
    };
  }

  function list({ limit = 25 } = {}) {
    const state = load();
    return state.leads.slice(0, Math.max(1, Math.min(Number(limit) || 25, maxLeads)));
  }

  function get(leadId) {
    if (!leadId) return null;
    return load().leads.find(item => item.leadId === leadId) || null;
  }

  function buildContract(state = load(), { limit = 10 } = {}) {
    const leads = Array.isArray(state.leads) ? state.leads : [];
    return {
      version: 'social-leads-contract-v1',
      endpoint: '/api/social-leads',
      intakeEndpoint: '/api/social-leads/intake',
      totalLeads: leads.length,
      recent: leads.slice(0, Math.max(1, Math.min(Number(limit) || 10, maxLeads))).map(compactLeadSummary),
      capabilities: {
        supportsWrite: true,
        firstClassPlatforms: ['x'],
        acceptedCaptureMethods: ['operator-url-drop', 'operator-text-drop', 'operator-thread-quote', 'operator-screenshot-context'],
        acceptedAcquisitionTiers: ['manual-url', 'manual-text'],
      },
      notes: [
        'This initial social-leads contract is intentionally bounded. It stores operator-submitted X leads before automated retrieval, claim extraction, or verification fanout exists.',
        'Raw evidence is preserved alongside normalized fields so later LLM or verification stages can operate without rewriting the original capture.',
      ],
    };
  }

  return {
    storePath,
    intake,
    list,
    get,
    load,
    buildContract,
  };
}
