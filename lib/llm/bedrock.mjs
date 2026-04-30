// Amazon Bedrock Provider — raw fetch with AWS SigV4, uses Converse API

import { LLMProvider } from './provider.mjs';
import { createHmac, createHash } from 'crypto';

function sha256hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key, data) {
  return createHmac('sha256', key).update(data).digest();
}

function getSigningKey(secretKey, dateStamp, region, service) {
  const kDate    = hmacSha256(`AWS4${secretKey}`, dateStamp);
  const kRegion  = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

export class BedrockProvider extends LLMProvider {
  constructor(config) {
    super(config);
    this.name = 'bedrock';
    this.accessKeyId     = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.region          = config.region || 'us-east-1';
    this.model           = config.model  || 'us.meta.llama3-3-70b-instruct-v1:0';
  }

  get isConfigured() {
    return !!(this.accessKeyId && this.secretAccessKey);
  }

  _sign(method, url, bodyStr) {
    const now = new Date();
    const amzDate  = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
    const dateStamp = amzDate.slice(0, 8);

    const { host, pathname } = new URL(url);
    // SigV4 requires each path segment to be URI-encoded (encodes the % in %3A → %253A)
    const canonicalPath  = pathname.split('/').map(seg => encodeURIComponent(seg)).join('/');
    const bodyHash       = sha256hex(bodyStr);
    const canonicalHdrs  = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
    const signedHdrs     = 'content-type;host;x-amz-date';
    const canonicalReq   = [method, canonicalPath, '', canonicalHdrs, signedHdrs, bodyHash].join('\n');
    const credScope      = `${dateStamp}/${this.region}/bedrock/aws4_request`;
    const stringToSign   = ['AWS4-HMAC-SHA256', amzDate, credScope, sha256hex(canonicalReq)].join('\n');
    const signingKey     = getSigningKey(this.secretAccessKey, dateStamp, this.region, 'bedrock');
    const signature      = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    return {
      'Content-Type':  'application/json',
      'x-amz-date':    amzDate,
      'Authorization': `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credScope}, SignedHeaders=${signedHdrs}, Signature=${signature}`,
    };
  }

  // Converse API — supports multi-turn natively
  async chat(messages, systemPrompt, opts = {}) {
    const url  = `https://bedrock-runtime.${this.region}.amazonaws.com/model/${encodeURIComponent(this.model)}/converse`;
    const body = JSON.stringify({
      ...(systemPrompt ? { system: [{ text: systemPrompt }] } : {}),
      messages: messages.map(m => ({ role: m.role, content: [{ text: m.content }] })),
      inferenceConfig: { maxTokens: opts.maxTokens || 4096 },
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: this._sign('POST', url, body),
      body,
      signal: AbortSignal.timeout(opts.timeout || 90000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Bedrock ${res.status}: ${err.substring(0, 300)}`);
    }

    const data = await res.json();
    const text = data.output?.message?.content?.[0]?.text || '';
    return {
      text,
      usage: { inputTokens: data.usage?.inputTokens || 0, outputTokens: data.usage?.outputTokens || 0 },
      model: this.model,
    };
  }

  // complete() delegates to chat() for compatibility with ideas/alerts code
  async complete(systemPrompt, userMessage, opts = {}) {
    return this.chat([{ role: 'user', content: userMessage }], systemPrompt, opts);
  }
}
