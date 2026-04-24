// Crucix Configuration — all settings with env var overrides

import "./apis/utils/env.mjs"; // Load .env first

export default {
  port: parseInt(process.env.PORT) || 3117,
  refreshIntervalMinutes: parseInt(process.env.REFRESH_INTERVAL_MINUTES) || 15,

  llm: {
    provider: process.env.LLM_PROVIDER || null, // anthropic | openai | gemini | codex | openrouter | minimax | mistral | ollama | grok
    apiKey: process.env.LLM_API_KEY || null,
    model: process.env.LLM_MODEL || null,
    baseUrl: process.env.OLLAMA_BASE_URL || null,
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
    chatId: process.env.TELEGRAM_CHAT_ID || null,
    botPollingInterval: parseInt(process.env.TELEGRAM_POLL_INTERVAL) || 5000,
    channels: process.env.TELEGRAM_CHANNELS || null, // Comma-separated extra channel IDs
  },

  discord: {
    botToken: process.env.DISCORD_BOT_TOKEN || null,
    channelId: process.env.DISCORD_CHANNEL_ID || null,
    guildId: process.env.DISCORD_GUILD_ID || null, // Server ID (for instant slash command registration)
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || null, // Fallback: webhook-only alerts (no bot needed)
  },

  review: {
    ackTtlHours: parseInt(process.env.REVIEW_ACK_TTL_HOURS) || 72,
    ackMaxEntries: parseInt(process.env.REVIEW_ACK_MAX_ENTRIES) || 100,
    repairArtifactMaxSamples: parseInt(process.env.REPAIR_ARTIFACT_MAX_SAMPLES) || 12,
    repairArtifactRetentionDays: parseInt(process.env.REPAIR_ARTIFACT_RETENTION_DAYS) || 14,
    repairArtifactMaxEntries: parseInt(process.env.REPAIR_ARTIFACT_MAX_ENTRIES) || 50,
  },

  debugEndpoints: {
    exposure: process.env.DEBUG_ENDPOINT_EXPOSURE || 'local-only', // local-only | open
  },

  freshnessPolicy: {
    defaultFreshnessMinutes: parseInt(process.env.DEFAULT_FRESHNESS_MINUTES) || 60,
    sources: {
      ...(process.env.OPENSKY_FRESHNESS_MINUTES ? { OpenSky: { freshnessTargetMinutes: parseInt(process.env.OPENSKY_FRESHNESS_MINUTES) || 20 } } : {}),
      ...(process.env.YFINANCE_FRESHNESS_MINUTES ? { YFinance: { freshnessTargetMinutes: parseInt(process.env.YFINANCE_FRESHNESS_MINUTES) || 20 } } : {}),
      ...(process.env.TELEGRAM_FRESHNESS_MINUTES ? { Telegram: { freshnessTargetMinutes: parseInt(process.env.TELEGRAM_FRESHNESS_MINUTES) || 30 } } : {}),
      ...(process.env.GDELT_FRESHNESS_MINUTES ? { GDELT: { freshnessTargetMinutes: parseInt(process.env.GDELT_FRESHNESS_MINUTES) || 30 } } : {}),
    },
    areas: {
      ...(process.env.AIR_FRESHNESS_WARN_MINUTES ? { air: { freshnessWarnMinutes: parseInt(process.env.AIR_FRESHNESS_WARN_MINUTES) || 30 } } : {}),
      ...(process.env.MARKETS_FRESHNESS_WARN_MINUTES ? { markets: { freshnessWarnMinutes: parseInt(process.env.MARKETS_FRESHNESS_WARN_MINUTES) || 20 } } : {}),
      ...(process.env.TELEGRAM_FRESHNESS_WARN_MINUTES ? { telegram: { freshnessWarnMinutes: parseInt(process.env.TELEGRAM_FRESHNESS_WARN_MINUTES) || 30 } } : {}),
      ...(process.env.NEWS_FRESHNESS_WARN_MINUTES ? { news: { freshnessWarnMinutes: parseInt(process.env.NEWS_FRESHNESS_WARN_MINUTES) || 120 } } : {}),
    },
  },

  // Delta engine thresholds — override defaults from lib/delta/engine.mjs
  // Set to null to use built-in defaults
  delta: {
    thresholds: {
      numeric: {
        // Example overrides (uncomment to customize):
        // vix: 3,       // more sensitive to VIX moves
        // wti: 5,       // less sensitive to oil moves
      },
      count: {
        // urgent_posts: 3,     // need ±3 urgent posts to flag
        // thermal_total: 1000, // need ±1000 thermal detections
      },
    },
  },
};
