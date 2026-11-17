// Разбор ссылок на публикации ВКонтакте из одного большого поля.
// Разделители: новая строка, пробел, запятая (а также ; и табуляция).
// Поддерживаются:
//   https://vk.com/wall-123_456, https://m.vk.com/wall123_456?reply=1, vk.ru/wall…
//   https://vk.com/club1?w=wall-1_2, https://vk.com/feed?w=wall1_2%2Fall
//   wall-123_456 (без домена)
const VK_HOST = /^(?:m\.|www\.|new\.|mobile\.)?(?:vk\.com|vk\.ru|vkontakte\.ru)$/i;
const WALL_IN_PATH = /^\/?wall(-?\d+)_(\d+)(?:$|[/?#&%])/i;
const WALL_BARE = /^wall(-?\d+)_(\d+)$/i;

export function splitInput(text) {
  return String(text || '')
    .split(/[\s,;]+/u)
    .map((t) => t.trim())
    .filter(Boolean);
}

function stripPunctuation(token) {
  return token.replace(/^[<([«"'“]+/u, '').replace(/[>)\]»"'”.!?:]+$/u, '');
}

function makeValid(input, owner, id) {
  const ownerId = Number(owner);
  const postId = Number(id);
  if (!Number.isSafeInteger(ownerId) || !Number.isSafeInteger(postId) || ownerId === 0 || postId <= 0) {
    return { ok: false, input, reason: 'Некорректный идентификатор публикации' };
  }
  const key = `${ownerId}_${postId}`;
  return { ok: true, input, key, ownerId, postId, url: `https://vk.com/wall${key}` };
}

export function parseLink(token) {
  const input = token;
  const raw = stripPunctuation(String(token).trim());
  if (!raw) return { ok: false, input, reason: 'Пустое значение' };

  const bare = WALL_BARE.exec(raw);
  if (bare) return makeValid(input, bare[1], bare[2]);

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
  } catch {
    return { ok: false, input, reason: 'Не похоже на ссылку' };
  }
  if (!VK_HOST.test(url.hostname)) return { ok: false, input, reason: 'Ссылка не ведёт на ВКонтакте' };

  const candidates = [url.pathname, url.searchParams.get('w') || '', url.searchParams.get('z') || ''];
  for (const c of candidates) {
    let decoded = c;
    try {
      decoded = decodeURIComponent(c);
    } catch {
      /* оставляем как есть */
    }
    const m = WALL_IN_PATH.exec(decoded);
    if (m) return makeValid(input, m[1], m[2]);
  }
  return { ok: false, input, reason: 'Это не ссылка на запись (ожидается формат vk.com/wall-123_456)' };
}

/**
 * Разбирает текст поля целиком.
 * @returns {{valid: Array, invalid: Array, duplicates: Array, totalTokens: number}}
 */
export function parseLinks(text) {
  const tokens = splitInput(text);
  const seen = new Set();
  const valid = [];
  const invalid = [];
  const duplicates = [];
  for (const token of tokens) {
    const parsed = parseLink(token);
    if (!parsed.ok) {
      invalid.push(parsed);
      continue;
    }
    if (seen.has(parsed.key)) {
      duplicates.push(parsed);
      continue;
    }
    seen.add(parsed.key);
    valid.push(parsed);
  }
  return { valid, invalid, duplicates, totalTokens: tokens.length };
}

export function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}
