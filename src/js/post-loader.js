// Загрузка оригинальных публикаций через официальный метод wall.getById.
// Пакетная обработка: до 100 записей за один запрос, запросы идут последовательно
// (ограничение VK — 3 запроса/с соблюдается в vk-api.js).
import { callApi, VkAuthRequiredError, VkNetworkError } from './vk-api.js';
import { chunk } from './link-parser.js';
import { STATUS } from './scheduler.js';

export const MAX_CHUNK = 100;
const UNAVAILABLE =
  'Публикация недоступна: она удалена, закрыта настройками приватности или API ВКонтакте не разрешает её получение';

function biggest(sizes = []) {
  return [...sizes].sort((a, b) => (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0))[0];
}
function previewSize(sizes = [], target = 720) {
  const sorted = [...sizes].filter((s) => s.url).sort((a, b) => (a.width || 0) - (b.width || 0));
  return sorted.find((s) => (s.width || 0) >= target) || sorted[sorted.length - 1];
}
const withKey = (prefix, o) => `${prefix}${o.owner_id}_${o.id}${o.access_key ? '_' + o.access_key : ''}`;

export function mapAttachment(att) {
  const t = att?.type;
  const o = att?.[t];
  if (!o) return { type: t || 'unknown', label: 'Неизвестное вложение', unsupported: true };
  switch (t) {
    case 'photo': {
      const p = previewSize(o.sizes);
      const full = biggest(o.sizes);
      return { type: 'photo', vkId: withKey('photo', o), preview: p?.url, full: full?.url, width: p?.width, height: p?.height, label: 'Фото' };
    }
    case 'video': {
      const img = previewSize(o.image || o.first_frame || []);
      return { type: 'video', vkId: withKey('video', o), preview: img?.url, label: o.title || 'Видео', duration: o.duration };
    }
    case 'doc': {
      const img = previewSize(o.preview?.photo?.sizes?.map((s) => ({ url: s.src, width: s.width, height: s.height })) || []);
      return { type: 'doc', vkId: withKey('doc', o), preview: img?.url, label: o.title || 'Документ' };
    }
    case 'audio':
      return { type: 'audio', vkId: withKey('audio', o), label: [o.artist, o.title].filter(Boolean).join(' — ') || 'Аудио' };
    case 'poll':
      return { type: 'poll', vkId: `poll${o.owner_id}_${o.id}`, label: `Опрос: ${o.question || ''}`.trim() };
    case 'link': {
      const img = previewSize(o.photo?.sizes);
      return { type: 'link', vkId: o.url, url: o.url, preview: img?.url, label: o.title || o.url };
    }
    case 'album':
      return { type: 'album', vkId: `album${o.owner_id}_${o.id}`, preview: previewSize(o.thumb?.sizes)?.url, label: `Альбом: ${o.title || ''}` };
    default:
      return { type: t, label: `Вложение «${t}» не переносится через API`, unsupported: true };
  }
}

function authorOf(fromId, profiles, groups) {
  if (fromId > 0) {
    const p = profiles.find((x) => x.id === fromId);
    return {
      authorId: fromId,
      authorName: p ? `${p.first_name} ${p.last_name}`.trim() : `id${fromId}`,
      authorUrl: `https://vk.com/${p?.screen_name || 'id' + fromId}`,
      authorPhoto: p?.photo_100 || null,
    };
  }
  const gid = Math.abs(fromId);
  const g = groups.find((x) => x.id === gid);
  return {
    authorId: fromId,
    authorName: g?.name || `club${gid}`,
    authorUrl: `https://vk.com/${g?.screen_name || 'club' + gid}`,
    authorPhoto: g?.photo_100 || null,
  };
}

/** Преобразует ответ VK в запись рабочей области. Источник текста — оригинал (для репоста без своего текста — исходная запись). */
export function mapPost(item, { profiles = [], groups = [] } = {}, link, now = Date.now()) {
  const repost = item.copy_history?.[0];
  const ownContent = Boolean(item.text?.trim()) || Boolean(item.attachments?.length);
  const source = !ownContent && repost ? repost : item;
  const fromId = source.from_id || source.owner_id;
  const mapped = (source.attachments || []).map(mapAttachment);
  const originalText = source.text || '';
  return {
    id: link.key,
    key: link.key,
    sourceUrl: link.url,
    ownerId: item.owner_id,
    postId: item.id,
    sourceDate: (source.date || item.date || 0) * 1000,
    isRepost: source !== item,
    ...authorOf(fromId, profiles, groups),
    originalText,
    text: originalText,
    edited: false,
    attachments: mapped.filter((a) => !a.unsupported),
    unsupported: mapped.filter((a) => a.unsupported),
    schedule: null,
    status: STATUS.READY,
    selected: true,
    guid: `itools-${link.key}-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * @param {Array<{key: string, url: string}>} links — валидные ссылки из link-parser
 * @param {{onProgress?: (p: {done: number, total: number}) => void, signal?: AbortSignal, chunkSize?: number}} opts
 * @returns {Promise<{loaded: object[], failed: Array<{link: object, error: string}>}>}
 */
export async function loadPosts(links, { onProgress, signal, chunkSize = MAX_CHUNK } = {}) {
  const loaded = [];
  const failed = [];
  let done = 0;
  const total = links.length;
  onProgress?.({ done, total });
  for (const part of chunk(links, Math.min(Math.max(1, chunkSize), MAX_CHUNK))) {
    if (signal?.aborted) {
      for (const link of links.slice(done)) failed.push({ link, error: 'Загрузка остановлена' });
      break;
    }
    try {
      const resp = await callApi('wall.getById', {
        posts: part.map((l) => l.key).join(','),
        extended: 1,
        fields: 'photo_100,screen_name',
      });
      const items = Array.isArray(resp) ? resp : resp?.items || [];
      const ctx = { profiles: resp?.profiles || [], groups: resp?.groups || [] };
      const byKey = new Map(items.map((it) => [`${it.owner_id}_${it.id}`, it]));
      for (const link of part) {
        const item = byKey.get(link.key);
        if (item) loaded.push(mapPost(item, ctx, link));
        else failed.push({ link, error: UNAVAILABLE });
      }
    } catch (e) {
      if (e instanceof VkAuthRequiredError || e.code === 5) throw e;
      const msg = e instanceof VkNetworkError ? `Нет связи с ВКонтакте: ${e.message}` : e.message;
      for (const link of part) failed.push({ link, error: msg });
    }
    done += part.length;
    onProgress?.({ done, total });
  }
  return { loaded, failed };
}
