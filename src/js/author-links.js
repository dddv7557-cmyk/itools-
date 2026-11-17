// Ссылка первоначального автора.
// Принцип: текст пользователя в редакторе НИКОГДА не изменяется автоматически.
// Ссылка добавляется при формировании итогового текста (предпросмотр и отправка),
// поэтому включение/выключение общего Checkbox не может повредить правки,
// а повторное добавление исключено проверкой наличия ссылки в тексте.
export const DEFAULT_TEMPLATE = 'Автор: {url}';

function normalizeVkUrl(url) {
  return String(url || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^(?:www\.|m\.)/, '')
    .replace(/^vk\.ru\//, 'vk.com/')
    .replace(/\/+$/, '');
}

/** Есть ли уже ссылка автора в тексте (с учётом http/https, m., www., vk.ru). */
export function textContainsAuthorLink(text, authorUrl) {
  const target = normalizeVkUrl(authorUrl);
  if (!target) return false;
  const haystack = String(text || '')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/(^|[^\w.])(?:www\.|m\.)(vk\.(?:com|ru)\/)/g, '$1$2')
    .replace(/vk\.ru\//g, 'vk.com/');
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(target, from);
    if (idx === -1) return false;
    const before = idx === 0 ? '' : haystack[idx - 1];
    const after = haystack[idx + target.length] || '';
    if (!/[\w.]/.test(before) && !/[\w]/.test(after)) return true;
    from = idx + 1;
  }
}

export function authorLinkLine(post, template = DEFAULT_TEMPLATE) {
  if (!post?.authorUrl) return '';
  const tpl = template && template.includes('{url}') ? template : DEFAULT_TEMPLATE;
  return tpl.replaceAll('{url}', post.authorUrl).replaceAll('{name}', post.authorName || '').trim();
}

/**
 * Итоговый текст публикации с учётом общего Checkbox.
 * @param {string} text  — текущий (возможно отредактированный) текст
 * @param {object} post  — запись с authorUrl/authorName
 * @param {{authorLinksEnabled: boolean, authorLinkTemplate?: string}} settings
 */
export function applyAuthorLink(text, post, settings) {
  const value = String(text ?? '');
  if (!settings?.authorLinksEnabled || !post?.authorUrl) return value;
  if (textContainsAuthorLink(value, post.authorUrl)) return value;
  const line = authorLinkLine(post, settings.authorLinkTemplate);
  const base = value.replace(/\s+$/u, '');
  return base ? `${base}\n\n${line}` : line;
}

export function finalText(post, settings) {
  return applyAuthorLink(post?.text, post, settings);
}

/** Для подсказки в карточке: 'added' | 'present' | 'off' | 'none'. */
export function authorLinkState(post, settings) {
  if (!settings?.authorLinksEnabled) return 'off';
  if (!post?.authorUrl) return 'none';
  return textContainsAuthorLink(post.text, post.authorUrl) ? 'present' : 'added';
}
