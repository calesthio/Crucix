// LLM-Powered Translation — batch translates news headlines and OSINT text

const CHINESE_REGEX = /[\u4e00-\u9fff]/;

function hasChinese(text) {
  return CHINESE_REGEX.test(text);
}

function stripNumberPrefix(text) {
  return text.replace(/^\d+\.\s*/, '');
}

/**
 * Batch translate news feed headlines using LLM.
 * Groups headlines into batches of 20 to keep token usage reasonable.
 * @param {LLMProvider} provider - configured LLM provider
 * @param {Array} feed - newsFeed array with headline fields
 * @param {string} targetLang - target language code (default: 'zh')
 * @returns {Promise<Array>} - feed with translated headlines
 */
export async function translateNewsFeed(provider, feed, targetLang = 'zh') {
  if (!provider?.isConfigured) return feed;
  if (targetLang !== 'zh') return feed;

  // Filter items that actually need translation
  const itemsToTranslate = feed.filter(item => item.headline && !hasChinese(item.headline));
  if (itemsToTranslate.length === 0) return feed;

  const BATCH_SIZE = 20;
  const translated = new Map();

  for (let i = 0; i < itemsToTranslate.length; i += BATCH_SIZE) {
    const batch = itemsToTranslate.slice(i, i + BATCH_SIZE);
    const result = await translateBatch(provider, batch.map(b => b.headline), targetLang, 'news');
    if (result && Array.isArray(result)) {
      batch.forEach((item, idx) => {
        if (result[idx] && typeof result[idx] === 'string') {
          translated.set(item, stripNumberPrefix(result[idx].trim()));
        }
      });
    }
  }

  if (translated.size === 0) return feed;

  return feed.map(item => {
    if (translated.has(item)) {
      return { ...item, headline: translated.get(item), _translated: true };
    }
    return item;
  });
}

/**
 * Batch translate Telegram OSINT posts.
 * Translates the `text` field of each post object.
 * @param {LLMProvider} provider - configured LLM provider
 * @param {Array} posts - array of { text, channel, views, date, ... }
 * @param {string} targetLang - target language code (default: 'zh')
 * @returns {Promise<Array>} - posts with translated text
 */
export async function translateTelegramPosts(provider, posts, targetLang = 'zh') {
  if (!provider?.isConfigured) return posts;
  if (targetLang !== 'zh') return posts;

  // Filter items that actually need translation
  const itemsToTranslate = posts.filter(p => p.text && !hasChinese(p.text));
  if (itemsToTranslate.length === 0) return posts;

  const BATCH_SIZE = 15;
  const translated = new Map();

  for (let i = 0; i < itemsToTranslate.length; i += BATCH_SIZE) {
    const batch = itemsToTranslate.slice(i, i + BATCH_SIZE);
    const result = await translateBatch(provider, batch.map(b => b.text), targetLang, 'telegram');
    if (result && Array.isArray(result)) {
      batch.forEach((item, idx) => {
        if (result[idx] && typeof result[idx] === 'string') {
          translated.set(item, stripNumberPrefix(result[idx].trim()));
        }
      });
    }
  }

  if (translated.size === 0) return posts;

  return posts.map(item => {
    if (translated.has(item)) {
      return { ...item, text: translated.get(item), _translated: true };
    }
    return item;
  });
}

/**
 * Translate a batch of text strings.
 * @param {LLMProvider} provider
 * @param {string[]} texts
 * @param {string} targetLang
 * @param {string} context - 'news' | 'telegram'
 * @returns {Promise<string[]|null>}
 */
async function translateBatch(provider, texts, targetLang, context = 'news') {
  const isZh = targetLang === 'zh';

  let systemPrompt;
  if (isZh) {
    if (context === 'telegram') {
      systemPrompt = `你是一位专业的情报分析师和翻译。请将以下 OSINT（开源情报）社交媒体帖子翻译成自然、地道的中文（简体）。\n\n翻译要求：\n- 保持原文的语气、紧迫感和信息密度\n- 保留专有名词（人名、地名、机构名）的可识别性\n- 保留 URL、@提及、hashtag 等标记的原始形式\n- 不添加解释、编号或 markdown 代码块\n- 只输出有效的 JSON 数组，每个元素按顺序对应输入文本`;
    } else {
      systemPrompt = `你是一位专业的新闻翻译。请将以下新闻标题翻译成自然、流畅的中文（简体）。保持原意和语气，使用准确的专业术语。\n\n必须遵守：\n- 只输出有效的 JSON 数组\n- 数组中每个元素按顺序对应输入的标题\n- 不要添加解释、编号或 markdown 代码块`;
    }
  } else {
    systemPrompt = `You are a professional translator. Translate the following texts into natural, fluent ${targetLang}. Preserve meaning and tone.\n\nRules:\n- Output ONLY a valid JSON array\n- Each element corresponds to the input text in order\n- No explanations, numbering, or markdown code blocks`;
  }

  const userMessage = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');

  try {
    const result = await provider.complete(systemPrompt, userMessage, {
      maxTokens: Math.min(4096, texts.length * 120),
      timeout: 30000,
    });

    const parsed = parseJSONArray(result.text);
    if (!parsed) {
      console.warn(`[Translate] Failed to parse JSON for ${context} batch of ${texts.length} items.`);
    } else if (parsed.length !== texts.length) {
      console.warn(`[Translate] Mismatch: expected ${texts.length} items, got ${parsed.length} for ${context}`);
    }
    return parsed;
  } catch (err) {
    console.warn('[Translate] Batch failed:', err.message);
    return null;
  }
}

/**
 * Parse JSON array from LLM response. Handles markdown code blocks.
 */
function parseJSONArray(text) {
  if (!text) return null;
  let cleaned = text.trim();

  // Strip markdown code block wrappers
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '');
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Try to extract array from mixed text
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch { /* give up */ }
    }
  }
  return null;
}
