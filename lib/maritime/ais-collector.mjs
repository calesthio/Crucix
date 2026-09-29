// AIS collector — persistent aisstream.io WebSocket listener
//
// Crucix sweeps are one-shot and each source is capped at 30s, so live AIS can't be
// collected inside a sweep. The server starts this collector once; it keeps an
// in-memory picture of vessels in the monitored chokepoints, and the Maritime source
// (apis/sources/ships.mjs) reads a snapshot from it on every sweep.
//
// Uses Node's built-in WebSocket (Node 22+), which negotiates permessage-deflate as
// aisstream.io requires. No extra dependencies.

import { CHOKEPOINTS, DEFAULT_BBOX_DEG, chokepointBoxes, findChokepoint } from './chokepoints.mjs';

export const AIS_STREAM_URL = 'wss://stream.aisstream.io/v0/stream';

const MESSAGE_TYPES = [
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'ShipStaticData',
  'StaticDataReport',
];

const POSITION_TYPES = new Set(['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport']);

const DEFAULTS = {
  bboxDeg: DEFAULT_BBOX_DEG,
  staleMinutes: 60,        // forget vessels not heard from for this long
  gapMinutes: 30,          // underway vessel silent this long = AIS gap
  warmupMinutes: 10,       // counts are partial until connected this long
  maxVessels: 20000,       // hard memory cap
  sampleSize: 200,         // vessels included in each snapshot for the map
  gapSampleSize: 50,
  stallMinutes: 5,         // reconnect if a live stream goes quiet this long
  connectTimeoutMs: 30000, // give up on a handshake that never completes
  backoffBaseMs: 2000,
  backoffMaxMs: 5 * 60 * 1000,
  housekeepingMs: 60 * 1000,
};

// NavigationalStatus: 1 = at anchor, 5 = moored
const STATIONARY_NAV = new Set([1, 5]);

// AIS ship type code → category
export function shipCategory(type) {
  const t = Number(type);
  if (!Number.isFinite(t) || t <= 0) return 'unknown';
  if (t >= 80 && t <= 89) return 'tanker';
  if (t >= 70 && t <= 79) return 'cargo';
  if (t >= 60 && t <= 69) return 'passenger';
  if (t === 35) return 'military';
  if (t === 55) return 'lawEnforcement';
  if (t === 30) return 'fishing';
  return 'other';
}

// Vessel names and destinations are free text typed by crews: keep printable text only
export function cleanText(value, maxLen = 20) {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\x20-\x7E]/g, '').replace(/@+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, maxLen) : null;
}

function validLatLon(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon)
    && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    && !(lat === 0 && lon === 0);
}

function numberOrNull(v, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || (max != null && n >= max)) return null;
  return n;
}

function envNumber(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function configFromEnv() {
  return {
    bboxDeg: envNumber('AIS_BBOX_DEG', DEFAULTS.bboxDeg),
    staleMinutes: envNumber('AIS_STALE_MINUTES', DEFAULTS.staleMinutes),
    maxVessels: envNumber('AIS_MAX_VESSELS', DEFAULTS.maxVessels),
  };
}

export function aisDisabled() {
  return /^(1|true|yes)$/i.test(process.env.AIS_DISABLED || '');
}

export class AisCollector {
  constructor(options = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.WebSocketImpl = options.WebSocketImpl || globalThis.WebSocket;
    this.now = options.now || (() => Date.now());
    this.log = options.logger || console;
    this.vessels = new Map(); // mmsi → vessel record
    this._resetState();
  }

  _resetState() {
    this.state = 'idle'; // idle | connecting | live | reconnecting | auth_failed | unsupported | stopped
    this.apiKey = null;
    this.ws = null;
    this.connectedSince = null;
    this.lastMessageAt = null;
    this.messages = 0;
    this.reconnects = 0;
    this.attempt = 0;
    this.lastError = null;
    this.reconnectTimer = null;
    this.housekeepingTimer = null;
    this.connectTimer = null;
  }

  isRunning() {
    return ['connecting', 'live', 'reconnecting'].includes(this.state);
  }

  start(apiKey) {
    if (!apiKey) throw new Error('AIS collector needs an API key');
    if (this.isRunning()) return;
    if (typeof this.WebSocketImpl !== 'function') {
      this.state = 'unsupported';
      this.lastError = 'WebSocket is not available in this Node.js version (needs Node 22.4+)';
      this.log.error(`[AIS] ${this.lastError}`);
      return;
    }
    // Read AIS_* settings now rather than at import, so .env has been loaded
    if (this.opts.fromEnv) Object.assign(this.opts, configFromEnv());
    this.apiKey = apiKey;
    this.attempt = 0;
    this.housekeepingTimer = setInterval(() => this._housekeeping(), this.opts.housekeepingMs);
    this.housekeepingTimer.unref?.();
    this._connect();
  }

  stop() {
    this.state = 'stopped';
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.connectTimer);
    clearInterval(this.housekeepingTimer);
    this.reconnectTimer = null;
    this.connectTimer = null;
    this.housekeepingTimer = null;
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch { /* already closed */ }
    }
  }

  _connect() {
    this.state = this.reconnects > 0 ? 'reconnecting' : 'connecting';
    let ws;
    try {
      ws = new this.WebSocketImpl(AIS_STREAM_URL);
    } catch (err) {
      this.lastError = err.message;
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    let opened = false;

    // A handshake that never completes would otherwise leave us waiting forever
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (this.ws === ws && !opened) this._dropSocket(ws, 'connection timed out');
    }, this.opts.connectTimeoutMs);
    this.connectTimer.unref?.();

    ws.onopen = () => {
      if (this.ws !== ws) return;
      opened = true;
      clearTimeout(this.connectTimer);
      // aisstream closes the connection if the subscription isn't sent within ~3s
      ws.send(JSON.stringify({
        APIKey: this.apiKey,
        BoundingBoxes: chokepointBoxes(this.opts.bboxDeg),
        FilterMessageTypes: MESSAGE_TYPES,
      }));
      this.connectedSince = this.now();
      this.lastMessageAt = this.now();
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      this.handleRaw(event.data);
    };

    ws.onerror = (event) => {
      if (this.ws !== ws) return;
      this.lastError = event?.message || event?.error?.message || 'WebSocket error';
      // Node's WebSocket reports a failed handshake with an error but no close event,
      // so reconnect from here rather than waiting for onclose
      if (!opened) this._dropSocket(ws, this.lastError);
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      let reason = null;
      if (event?.code && event.code !== 1000 && !this.lastError) {
        reason = `connection closed (${event.code}${event.reason ? `: ${event.reason}` : ''})`;
      }
      this._dropSocket(ws, reason, { alreadyClosed: true });
    };
  }

  // Detach a socket (closing it if needed) and reconnect unless stopped or auth failed
  _dropSocket(ws, reason, { alreadyClosed = false } = {}) {
    if (this.ws !== ws) return;
    this.ws = null;
    this.connectedSince = null;
    clearTimeout(this.connectTimer);
    if (reason) this.lastError = reason;
    if (!alreadyClosed) {
      try { ws.close(); } catch { /* ignore */ }
    }
    if (this.state === 'stopped' || this.state === 'auth_failed') return;
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.state === 'stopped' || this.state === 'auth_failed') return;
    this.state = 'reconnecting';
    this.reconnects++;
    const exp = Math.min(this.opts.backoffMaxMs, this.opts.backoffBaseMs * 2 ** this.attempt);
    const delay = Math.round(exp * (0.8 + Math.random() * 0.4));
    this.attempt++;
    this.log.warn?.(`[AIS] Stream disconnected${this.lastError ? ` (${this.lastError})` : ''} — reconnecting in ${Math.round(delay / 1000)}s`);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
    this.reconnectTimer.unref?.();
  }

  handleRaw(data) {
    let text = data;
    if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    else if (ArrayBuffer.isView(data)) text = new TextDecoder().decode(data);
    if (typeof text !== 'string') return;

    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.error) {
      this.lastError = String(msg.error).slice(0, 200);
      if (/api ?key/i.test(this.lastError)) {
        // Bad or expired key: stop instead of reconnecting forever
        this.state = 'auth_failed';
        this.log.error(`[AIS] ${this.lastError} — check AISSTREAM_API_KEY`);
        clearInterval(this.housekeepingTimer);
        this.housekeepingTimer = null;
        try { this.ws?.close(); } catch { /* ignore */ }
        this.ws = null;
      }
      return;
    }

    this.lastMessageAt = this.now();
    this.messages++;
    if (this.state !== 'live') {
      this.state = 'live';
      this.attempt = 0;
      this.lastError = null;
      this.log.log?.('[AIS] Live stream connected');
    }
    this.handleMessage(msg);
  }

  handleMessage(msg) {
    const type = msg.MessageType;
    const body = msg.Message?.[type];
    const meta = msg.MetaData || {};
    const mmsi = String(meta.MMSI ?? body?.UserID ?? '');
    if (!/^\d{9}$/.test(mmsi) || !body) return;

    const now = this.now();
    let v = this.vessels.get(mmsi);

    if (POSITION_TYPES.has(type)) {
      const lat = Number(body.Latitude ?? meta.latitude ?? meta.Latitude);
      const lon = Number(body.Longitude ?? meta.longitude ?? meta.Longitude);
      if (!validLatLon(lat, lon)) return;
      const cp = findChokepoint(lat, lon, this.opts.bboxDeg);
      if (!cp) return;
      if (!v) {
        v = { mmsi, name: null, type: null, destination: null };
        this.vessels.set(mmsi, v);
      }
      v.lat = lat;
      v.lon = lon;
      v.cp = cp;
      v.sog = numberOrNull(body.Sog, 102.3);
      v.cog = numberOrNull(body.Cog, 360);
      v.nav = Number.isInteger(body.NavigationalStatus) ? body.NavigationalStatus : null;
      v.lastSeen = now;
      if (!v.name) v.name = cleanText(meta.ShipName);
      if (type === 'ExtendedClassBPositionReport' && body.Type) v.type = body.Type;
    } else if (type === 'ShipStaticData') {
      if (!v) return; // only track static data for vessels already positioned in a chokepoint
      v.name = cleanText(body.Name) || v.name;
      v.type = body.Type || v.type;
      v.destination = cleanText(body.Destination);
    } else if (type === 'StaticDataReport') {
      if (!v) return;
      v.name = cleanText(body.ReportA?.Name) || v.name;
      if (body.ReportB?.ShipType) v.type = body.ReportB.ShipType;
    }

    if (this.vessels.size > this.opts.maxVessels * 1.1) this._enforceCap();
  }

  _housekeeping() {
    this._prune();
    // Reconnect a stream that is open but has gone silent
    if (this.state === 'live' && this.lastMessageAt
      && this.now() - this.lastMessageAt > this.opts.stallMinutes * 60000) {
      this._dropSocket(this.ws, `no AIS messages for ${this.opts.stallMinutes} minutes`);
    }
  }

  _prune() {
    const cutoff = this.now() - this.opts.staleMinutes * 60000;
    for (const [mmsi, v] of this.vessels) {
      if (v.lastSeen < cutoff) this.vessels.delete(mmsi);
    }
  }

  _enforceCap() {
    const sorted = [...this.vessels.entries()].sort((a, b) => b[1].lastSeen - a[1].lastSeen);
    this.vessels = new Map(sorted.slice(0, this.opts.maxVessels));
  }

  getStatus() {
    return {
      state: this.state,
      connectedSince: this.connectedSince ? new Date(this.connectedSince).toISOString() : null,
      lastMessageAt: this.lastMessageAt ? new Date(this.lastMessageAt).toISOString() : null,
      messages: this.messages,
      reconnects: this.reconnects,
      vessels: this.vessels.size,
      lastError: this.lastError,
    };
  }

  getSnapshot() {
    this._prune();
    const now = this.now();
    const gapCutoff = now - this.opts.gapMinutes * 60000;

    const chokepoints = {};
    for (const [key, cp] of Object.entries(CHOKEPOINTS)) {
      chokepoints[key] = {
        ...cp,
        total: 0, tanker: 0, cargo: 0, passenger: 0, military: 0,
        lawEnforcement: 0, fishing: 0, other: 0, unknown: 0,
        stationary: 0, aisGaps: 0,
      };
    }

    const all = [];
    const gaps = [];
    for (const v of this.vessels.values()) {
      const c = chokepoints[v.cp];
      if (!c) continue;
      const category = shipCategory(v.type);
      const stationary = STATIONARY_NAV.has(v.nav) || (v.sog != null && v.sog < 0.5);
      // A vessel that was underway and then went silent. Often just leaving receiver
      // coverage, so this is an "AIS gap", not proof of a transponder switched off.
      const isGap = v.lastSeen < gapCutoff && !stationary;
      c.total++;
      c[category]++;
      if (stationary) c.stationary++;
      if (isGap) c.aisGaps++;
      const entry = {
        mmsi: v.mmsi, name: v.name, cat: category, cp: v.cp,
        lat: Number(v.lat.toFixed(4)), lon: Number(v.lon.toFixed(4)),
        sog: v.sog, cog: v.cog, stationary,
        ageMin: Math.round((now - v.lastSeen) / 60000),
      };
      if (isGap) gaps.push(entry);
      else all.push(entry);
    }

    all.sort((a, b) => a.ageMin - b.ageMin);
    gaps.sort((a, b) => a.ageMin - b.ageMin);

    const values = Object.values(chokepoints);
    const sum = key => values.reduce((s, c) => s + c[key], 0);
    const warmingUp = !this.connectedSince
      || now - this.connectedSince < this.opts.warmupMinutes * 60000;

    return {
      status: this.state,
      live: this.state === 'live',
      warmingUp,
      updatedAt: new Date(now).toISOString(),
      stream: this.getStatus(),
      totals: {
        vessels: sum('total'),
        tankers: sum('tanker'),
        cargo: sum('cargo'),
        military: sum('military'),
        stationary: sum('stationary'),
        aisGaps: sum('aisGaps'),
      },
      chokepoints,
      vessels: all.slice(0, this.opts.sampleSize),
      gaps: gaps.slice(0, this.opts.gapSampleSize),
    };
  }
}

// Shared instance used by the server and the Maritime source
export const aisCollector = new AisCollector({ fromEnv: true });
