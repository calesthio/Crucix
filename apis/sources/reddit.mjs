// Reddit — social sentiment intelligence
// Reddit now requires OAuth for API access (public JSON API returns 403).
// Gracefully degrades when not authenticated.
// To enable: register an app at https://www.reddit.com/prefs/apps/ and set
// REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in .env

import { safeFetch } from '../utils/fetch.mjs';
import '../utils/env.mjs';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// UK-centric subreddit selection — UK politics, economics, and global context
const SUBREDDITS = [
  'unitedkingdom',    // UK news and discussion
  'ukpolitics',       // UK domestic politics
  'Economics',        // UK-relevant economics (global but with UK angle)
  'geopolitics',      // Global geopolitics (UK-relevant)
  'worldnews',        // Breaking international news
  'UKInvesting',      // UK-specific investing (FTSE, ISA, pensions)
];

// Get OAuth token using client credentials flow (application-only)
async function getToken() {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Crucix/1.0 intelligence-engine',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

// Fetch hot posts — tries OAuth first, then falls back to public endpoint
export async function getHot(subreddit, opts = {}) {
  const { limit = 10, token = null } = opts;

  if (token) {
    // Use OAuth endpoint
    return safeFetch(`https://oauth.reddit.com/r/${subreddit}/hot?limit=${limit}&raw_json=1`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Crucix/1.0 intelligence-engine',
      },
    });
  }

  // Try public endpoint (may 403)
  return safeFetch(`https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}&raw_json=1`, {
    headers: { 'User-Agent': 'Crucix/1.0 intelligence-engine' },
  });
}

function compactPost(child) {
  const d = child?.data;
  if (!d) return null;
  return {
    title: d.title,
    score: d.score ?? 0,
    comments: d.num_comments ?? 0,
    url: d.url,
    created: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
  };
}

export async function briefing() {
  const token = await getToken();

  if (!token && !process.env.REDDIT_CLIENT_ID) {
    return {
      source: 'Reddit',
      timestamp: new Date().toISOString(),
      status: 'no_key',
      message: 'Reddit requires OAuth. Register at https://www.reddit.com/prefs/apps/ (script type), set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET in .env',
    };
  }

  const subredditResults = {};
  for (const sub of SUBREDDITS) {
    const result = await getHot(sub, { limit: 10, token });
    const children = result?.data?.children || [];
    subredditResults[sub] = children.map(compactPost).filter(Boolean);
    await delay(token ? 1000 : 2000);
  }

  return {
    source: 'Reddit',
    timestamp: new Date().toISOString(),
    subreddits: subredditResults,
  };
}

if (process.argv[1]?.endsWith('reddit.mjs')) {
  const data = await briefing();
  console.log(JSON.stringify(data, null, 2));
}
