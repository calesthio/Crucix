const TITLE = 'Crucix — Open-Source Intelligence Terminal';
const DESCRIPTION = 'A self-hosted intelligence dashboard monitoring 31 public sources across geopolitics, markets, cyber, infrastructure, climate and space.';

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function validOrigin(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function resolvePublicOrigin(configuredUrl, request = {}) {
  const configured = validOrigin(configuredUrl);
  if (configured) return configured;

  const protocol = request.protocol === 'https' ? 'https' : 'http';
  return validOrigin(`${protocol}://${request.host}`) || 'http://localhost:3117';
}

export function socialPreviewMeta(origin) {
  const pageUrl = `${origin}/`;
  const imageUrl = `${origin}/share-card.png`;
  const title = escapeAttribute(TITLE);
  const description = escapeAttribute(DESCRIPTION);

  return [
    `<meta name="description" content="${description}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Crucix">',
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${escapeAttribute(pageUrl)}">`,
    `<meta property="og:image" content="${escapeAttribute(imageUrl)}">`,
    '<meta property="og:image:type" content="image/png">',
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="Crucix global intelligence dashboard">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${escapeAttribute(imageUrl)}">`,
  ].join('\n');
}
