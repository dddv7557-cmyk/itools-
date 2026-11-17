// Инструменты «Топ товаров»: разбор источников, поиск сообществ, сканирование стен, рейтинг.
// Ответы VK подменены тестовым транспортом — только в тестах.
import { describe, it, expect, beforeEach } from 'vite-plus/test';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '../src/js/database.js';
import { setTransport, setTokenProvider, setMinInterval } from '../src/js/vk-api.js';
import { parseSourceToken, addSourcesFromText, searchGroups, loadSources, sourcesOf, saveSources, LISTS } from '../src/js/sources.js';
import { extractPrice, popularityScore, scanSources, rankProducts, productToPublisherRecord, saveResults, loadResults, DAY } from '../src/js/top-products.js';
import { initPosts, addPosts, getAllPosts } from '../src/js/post-editor.js';

const NOW = Date.UTC(2026, 10, 17, 12);
let calls;

function photo(id) {
  return { type: 'photo', photo: { id, owner_id: -10, sizes: [{ url: `https://sun.userapi.com/p${id}.jpg`, width: 604, height: 800 }] } };
}
function post(owner, id, { likes = 0, reposts = 0, comments = 0, views = 0, daysAgo = 1, text = 'Платье 1 500 ₽', photos = 1, copy = null } = {}) {
  return {
    id,
    owner_id: owner,
    from_id: owner,
    date: Math.floor((NOW - daysAgo * DAY) / 1000),
    text,
    attachments: Array.from({ length: photos }, (_, i) => photo(id * 10 + i)),
    likes: { count: likes },
    reposts: { count: reposts },
    comments: { count: comments },
    views: { count: views },
    ...(copy ? { copy_history: [copy] } : {}),
  };
}

const WALLS = {
  [-10]: [
    post(-10, 1, { likes: 100, reposts: 5, comments: 10, views: 5000 }),
    post(-10, 2, { likes: 300, views: 9000, daysAgo: 3 }),
    post(-10, 3, { likes: 50, photos: 0, text: 'Без фото — не товар' }),
    post(-10, 4, { likes: 999, daysAgo: 60 }), // старше периода 30 дней
  ],
  [-20]: [
    post(-20, 7, { likes: 10, reposts: 40, views: 2000 }),
    // репост того же товара, что -10_2 → дубль
    post(-20, 8, { likes: 1, text: '', copy: post(-10, 2, { likes: 300 }) }),
  ],
  [-30]: 'closed',
};

beforeEach(async () => {
  await closeDB();
  globalThis.indexedDB = new IDBFactory();
  calls = [];
  setTokenProvider(async () => 'test-token');
  setMinInterval(0);
  setTransport(async (method, p) => {
    calls.push({ method, p });
    switch (method) {
      case 'utils.resolveScreenName':
        return { response: p.screen_name === 'sadovod_shop' ? { type: 'group', object_id: 10 } : p.screen_name === 'ivan' ? { type: 'user', object_id: 5 } : [] };
      case 'users.get':
        return { response: p.user_ids.split(',').map((id) => ({ id: Number(id), first_name: 'Иван', last_name: 'Продавец', screen_name: 'ivan' })) };
      case 'groups.getById':
        return { response: { groups: p.group_ids.split(',').map((id) => ({ id: Number(id), name: `Садовод ${id}`, screen_name: `sad${id}`, members_count: 1000 * Number(id) })) } };
      case 'groups.search':
        return {
          response: {
            count: 3,
            items: [
              { id: 10, name: 'Садовод Платья', is_closed: 0, members_count: 5000 },
              { id: 20, name: 'Садовод Обувь', is_closed: 0, members_count: 90000 },
              { id: 99, name: 'Закрытая', is_closed: 1, members_count: 1 },
            ],
          },
        };
      case 'wall.get': {
        const wall = WALLS[p.owner_id];
        if (wall === 'closed') return { error: { error_code: 15, error_msg: 'Access denied: this wall available only for community members' } };
        return { response: { count: wall.length, items: wall.slice(Number(p.offset), Number(p.offset) + Number(p.count)), groups: [{ id: 10, name: 'Садовод 10', screen_name: 'sad10' }, { id: 20, name: 'Садовод 20', screen_name: 'sad20' }], profiles: [] } };
      }
      default:
        return { error: { error_code: 3, error_msg: 'Unknown method' } };
    }
  });
  await initPosts();
  await loadSources();
});

describe('Источники: разбор ссылок', () => {
  it('понимает разные форматы', () => {
    expect(parseSourceToken('https://vk.com/club123')).toMatchObject({ ok: true, ownerId: -123 });
    expect(parseSourceToken('public77')).toMatchObject({ ok: true, ownerId: -77 });
    expect(parseSourceToken('id5')).toMatchObject({ ok: true, ownerId: 5 });
    expect(parseSourceToken('@Shop_Name')).toMatchObject({ ok: true, kind: 'screen', screenName: 'shop_name' });
    expect(parseSourceToken('https://m.vk.com/sadovod_shop?w=1')).toMatchObject({ ok: true, screenName: 'sadovod_shop' });
    expect(parseSourceToken('-10')).toMatchObject({ ok: true, ownerId: -10 });
    expect(parseSourceToken('https://ok.ru/x').ok).toBe(false);
  });
  it('Инструмент 2: добавляет аккаунты и сообщества по ссылкам, без дублей', async () => {
    const r = await addSourcesFromText('https://vk.com/sadovod_shop, vk.com/ivan\nclub20 https://vk.com/nobody_here', LISTS.ACCOUNTS);
    expect(r.added.map((s) => s.ownerId).sort((a, b) => a - b)).toEqual([-20, -10, 5]);
    expect(r.failed).toHaveLength(1);
    const again = await addSourcesFromText('club20', LISTS.ACCOUNTS);
    expect(again.added).toHaveLength(0);
    expect(again.existing).toBe(1);
    await closeDB();
    await loadSources(); // переживает перезапуск
    expect(sourcesOf(LISTS.ACCOUNTS)).toHaveLength(3);
  });
  it('Инструмент 1: поиск сообществ Садовода — только открытые, по подписчикам', async () => {
    const found = await searchGroups('Садовод');
    expect(found.map((g) => g.ownerId)).toEqual([-20, -10]);
    expect(calls.find((c) => c.method === 'groups.search').p.q).toBe('Садовод');
  });
});

describe('Рейтинг товаров', () => {
  it('цена из текста', () => {
    expect(extractPrice('Платье 1 500 ₽, опт от 5 шт')).toBe(1500);
    expect(extractPrice('Цена: 850р')).toBe(850);
    expect(extractPrice('2.300 руб.')).toBe(2300);
    expect(extractPrice('Размеры 42-48')).toBeNull();
  });
  it('общий балл учитывает репосты, комментарии, просмотры и свежесть', () => {
    const fresh = { likes: 10, reposts: 10, comments: 5, views: 1000, date: NOW };
    expect(popularityScore(fresh, NOW)).toBe(10 + 30 + 10 + 20);
    expect(popularityScore({ ...fresh, date: NOW - 30 * DAY }, NOW)).toBe(35);
  });
  it('сканирование: период, только с фото, дубли репостов, закрытые стены', async () => {
    const sources = (await saveSources(await searchGroups('Садовод'), LISTS.SADOVOD)).added;
    sources.push({ id: 'sadovod:-30', ownerId: -30, name: 'Закрытая', url: 'https://vk.com/club30' });
    const r = await scanSources(sources, { periodDays: 30, maxPerSource: 100, now: NOW });
    const keys = rankProducts(r.products).map((p) => p.key);
    expect(keys).not.toContain('-10_3'); // без фото
    expect(keys).not.toContain('-10_4'); // старше 30 дней
    expect(keys.filter((k) => k === '-10_2' || k === '-20_8')).toHaveLength(1); // репост — один товар
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].error).toMatch(/15/);
    // сортировка по разным метрикам
    expect(rankProducts(r.products, 'reposts')[0].key).toBe('-20_7');
    expect(rankProducts(r.products, 'likes')[0].likes).toBe(300);
    // цена распознана
    expect(r.products.every((p) => p.price === 1500 || p.text === '')).toBe(true);
  });
  it('результаты сохраняются и доступны офлайн', async () => {
    const r = await scanSources([{ id: 's', ownerId: -10, name: 'S', url: 'u' }], { now: NOW });
    await saveResults('sadovod', { ...r, sourcesCount: 1 });
    await closeDB();
    const saved = await loadResults('sadovod');
    expect(saved.products.length).toBe(r.products.length);
  });
  it('выбранные товары добавляются в VK Publisher без повторной загрузки', async () => {
    const r = await scanSources([{ id: 's', ownerId: -10, name: 'S', url: 'u' }], { now: NOW });
    const before = calls.length;
    const { added } = await addPosts(rankProducts(r.products).slice(0, 2).map(productToPublisherRecord));
    expect(added).toHaveLength(2);
    expect(calls.length).toBe(before);
    expect(getAllPosts()[0].text).toBe('Платье 1 500 ₽');
    expect(getAllPosts()[0].attachments[0].vkId).toMatch(/^photo-10_/);
  });
});
