// «Топ товаров»: сканирование стен источников (wall.get) и рейтинг записей-товаров.
// wall.get доступен с обычным ключом пользователя — право wall для чтения не требуется.
//
// Общий балл = (лайки + 3·репосты + 2·комментарии + просмотры/50) × свежесть,
// свежесть = 1 / (1 + возраст_в_днях / 30). Репост ценнее лайка (товар распространяют),
// комментарий обычно означает вопрос «сколько стоит / есть ли размер».
import { callApi, VkAuthRequiredError } from './vk-api.js';
import { idb } from './database.js';
import { mapPost } from './post-loader.js';

export const SORTS = Object.freeze({
  score: 'Общий балл',
  likes: 'Лайки',
  reposts: 'Репосты',
  comments: 'Комментарии',
  views: 'Просмотры',
  er: 'Вовлечённость',
});

export const DAY = 24 * 60 * 60 * 1000;

export function freshness(dateMs, now = Date.now()) {
  const ageDays = Math.max(0, (now - dateMs) / DAY);
  return 1 / (1 + ageDays / 30);
}

export function popularityScore(p, now = Date.now()) {
  const base = p.likes + 3 * p.reposts + 2 * p.comments + p.views / 50;
  return Math.round(base * freshness(p.date, now) * 10) / 10;
}

export function engagementRate(p) {
  if (!p.views) return 0;
  return Math.round(((p.likes + p.reposts + p.comments) / p.views) * 1000) / 10; // %
}

/** Цена из текста: «1 200 ₽», «850р», «цена 1500 руб», «2.500 руб». Возвращает число или null. */
export function extractPrice(text) {
  const t = String(text || '');
  const re = /(\d{1,3}(?:[\s. ]\d{3})+|\d{2,7})\s*(?:₽|руб(?:\.|лей|ля)?|р\.?(?![а-яa-z]))/giu;
  let m;
  const prices = [];
  while ((m = re.exec(t))) {
    const n = Number(m[1].replace(/[\s. ]/g, ''));
    if (n >= 10 && n <= 10_000_000) prices.push(n);
  }
  if (!prices.length) {
    const alt = /цен[аы]\s*[:\-–]?\s*(\d{2,7})/iu.exec(t);
    if (alt) prices.push(Number(alt[1]));
  }
  return prices.length ? Math.min(...prices) : null;
}

function photosOf(post) {
  const atts = [...(post.attachments || []), ...(post.copy_history?.[0]?.attachments || [])];
  return atts
    .filter((a) => a.type === 'photo' && a.photo?.sizes?.length)
    .map((a) => {
      const sizes = [...a.photo.sizes].filter((s) => s.url).sort((x, y) => (x.width || 0) - (y.width || 0));
      return (sizes.find((s) => (s.width || 0) >= 400) || sizes[sizes.length - 1])?.url;
    })
    .filter(Boolean);
}

/** Запись стены → товар для рейтинга. ctx — profiles/groups из ответа (нужны для «В VK Publisher»). */
export function toProduct(item, source, ctx, now = Date.now()) {
  const orig = item.copy_history?.[0];
  const ownText = item.text?.trim();
  const text = ownText || orig?.text || '';
  const key = `${item.owner_id}_${item.id}`;
  const p = {
    key,
    dedupeKey: orig ? `${orig.owner_id}_${orig.id}` : key,
    url: `https://vk.com/wall${key}`,
    ownerId: item.owner_id,
    postId: item.id,
    date: (item.date || 0) * 1000,
    text,
    likes: item.likes?.count || 0,
    reposts: item.reposts?.count || 0,
    comments: item.comments?.count || 0,
    views: item.views?.count || 0,
    photos: photosOf(item),
    price: extractPrice(text),
    isAd: Boolean(item.marked_as_ads),
    isRepost: Boolean(orig),
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: source.url,
    raw: item,
    ctx: {
      profiles: (ctx?.profiles || []).filter((x) => [item.from_id, orig?.from_id, orig?.owner_id].includes(x.id)),
      groups: (ctx?.groups || []).filter((x) => [-item.owner_id, -item.from_id, -(orig?.owner_id || 0), -(orig?.from_id || 0)].includes(x.id)),
    },
  };
  p.score = popularityScore(p, now);
  p.er = engagementRate(p);
  return p;
}

export function rankProducts(products, sortKey = 'score') {
  const key = SORTS[sortKey] ? sortKey : 'score';
  return [...products].sort((a, b) => b[key] - a[key] || b.score - a.score || b.date - a.date);
}

/** Один и тот же товар, разошедшийся репостами по разным продавцам, считается один раз (остаётся лучший). */
export function dedupeProducts(products) {
  const best = new Map();
  for (const p of products) {
    const cur = best.get(p.dedupeKey);
    if (!cur || p.score > cur.score) best.set(p.dedupeKey, p);
  }
  return [...best.values()];
}

/**
 * Сканирование стен источников.
 * @param {object[]} sources
 * @param {{periodDays?: number, maxPerSource?: number, onlyPhotos?: boolean, skipAds?: boolean,
 *          onProgress?: Function, signal?: AbortSignal, api?: Function, now?: number}} opts
 */
export async function scanSources(sources, opts = {}) {
  const { periodDays = 30, maxPerSource = 100, onlyPhotos = true, skipAds = true, onProgress, signal, api = callApi } = opts;
  const now = opts.now ?? Date.now();
  const since = periodDays > 0 ? now - periodDays * DAY : 0;
  const products = [];
  const errors = [];
  let scannedPosts = 0;
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (signal?.aborted) break;
    onProgress?.({ done: i, total: sources.length, source: source.name });
    try {
      for (let offset = 0; offset < maxPerSource; offset += 100) {
        const resp = await api('wall.get', {
          owner_id: source.ownerId,
          offset,
          count: Math.min(100, maxPerSource - offset),
          extended: 1,
          fields: 'photo_100,screen_name',
        });
        const items = resp?.items || [];
        let older = false;
        for (const item of items) {
          scannedPosts++;
          if (since && item.date * 1000 < since) {
            if (!item.is_pinned) older = true;
            continue;
          }
          const p = toProduct(item, source, resp, now);
          if (onlyPhotos && !p.photos.length) continue;
          if (skipAds && p.isAd) continue;
          products.push(p);
        }
        if (items.length < 100 || older || signal?.aborted) break;
      }
    } catch (e) {
      if (e instanceof VkAuthRequiredError || e.code === 5) throw e;
      errors.push({ source, error: e.message });
    }
  }
  onProgress?.({ done: sources.length, total: sources.length });
  return { products: dedupeProducts(products), errors, scannedPosts };
}

/** Запись рейтинга → запись рабочей области VK Publisher (без повторного запроса к VK). */
export function productToPublisherRecord(p) {
  return mapPost(p.raw, p.ctx, { key: p.key, url: p.url });
}

// --- кэш последних результатов (офлайн-просмотр) ---
const RESULT_KEY = (list) => `top:${list}`;
export const MAX_SAVED = 300;

export async function saveResults(list, data) {
  const products = rankProducts(data.products, 'score').slice(0, MAX_SAVED);
  await idb.put('kv', { ...data, products, savedAt: Date.now() }, RESULT_KEY(list));
}

export async function loadResults(list) {
  return (await idb.get('kv', RESULT_KEY(list))) || null;
}
