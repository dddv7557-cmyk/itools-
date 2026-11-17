// Сценарии 1–11 из ТЗ + логика массовой публикации.
// VK API подменяется тестовым транспортом (имитация ответов ВКонтакте) — только в тестах.
import { describe, it, expect, beforeEach } from 'vite-plus/test';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '../src/js/database.js';
import { setTransport, setTokenProvider, setMinInterval, VkNetworkError } from '../src/js/vk-api.js';
import { parseLinks } from '../src/js/link-parser.js';
import { loadPosts } from '../src/js/post-loader.js';
import {
  initPosts,
  addPosts,
  getAllPosts,
  getPost,
  setText,
  restoreOriginal,
  setPostSchedule,
  clearPostSchedule,
  flushPending,
  postsStore,
  setSelected,
} from '../src/js/post-editor.js';
import { loadSettings, setAuthorLinksEnabled, getSettings } from '../src/js/settings.js';
import { buildPreview } from '../src/js/preview.js';
import { planPublication, publishPosts, saveAllDrafts } from '../src/js/publisher.js';
import { loadHistory, historyStore } from '../src/js/history.js';
import { createBackup, restoreBackup } from '../src/js/backup.js';
import { STATUS } from '../src/js/scheduler.js';

const ME = 777;
let vk;

function makeFakeVk() {
  const state = { calls: [], wall: [], postponed: [], nextId: 1000, guids: new Map(), failNextPost: null };
  const source = (key) => {
    const [owner, id] = key.split('_').map(Number);
    if (id === 404) return null; // удалённая/закрытая запись
    return {
      id,
      owner_id: owner,
      from_id: owner,
      date: 1700000000,
      text: `Оригинальный текст записи ${key}`,
      attachments: [{ type: 'photo', photo: { id: id + 1, owner_id: owner, sizes: [{ url: `https://sun.userapi.com/${key}.jpg`, width: 800, height: 600 }] } }],
    };
  };
  state.transport = async (method, params) => {
    state.calls.push({ method, params });
    switch (method) {
      case 'wall.getById': {
        const items = params.posts.split(',').map(source).filter(Boolean);
        const groups = [...new Set(items.filter((i) => i.owner_id < 0).map((i) => -i.owner_id))].map((id) => ({ id, name: `Сообщество ${id}`, screen_name: `club_${id}` }));
        const profiles = [...new Set(items.filter((i) => i.owner_id > 0).map((i) => i.owner_id))].map((id) => ({ id, first_name: 'Автор', last_name: String(id), screen_name: `author${id}` }));
        return { response: { items, groups, profiles } };
      }
      case 'wall.post': {
        if (state.guids.has(params.guid)) return { response: { post_id: state.guids.get(params.guid) } };
        const post_id = state.nextId++;
        const rec = { id: post_id, owner_id: ME, text: params.message, date: params.publish_date ? Number(params.publish_date) : Math.floor(Date.now() / 1000) };
        (params.publish_date ? state.postponed : state.wall).unshift(rec);
        state.guids.set(params.guid, post_id);
        if (state.failNextPost === 'lost-response') {
          state.failNextPost = null;
          throw new VkNetworkError('timeout', { uncertain: true });
        }
        return { response: { post_id } };
      }
      case 'wall.get':
        return { response: { count: 0, items: params.filter === 'postponed' ? state.postponed : state.wall } };
      default:
        return { error: { error_code: 3, error_msg: 'Unknown method' } };
    }
  };
  return state;
}

async function freshApp() {
  await closeDB();
  await initPosts();
  await loadSettings();
  await loadHistory();
}

async function loadLinks(text) {
  const { valid } = parseLinks(text);
  const { loaded, failed } = await loadPosts(valid);
  const { added } = await addPosts(loaded);
  return { added, failed };
}

const links = (n, owner = -100) => Array.from({ length: n }, (_, i) => `https://vk.com/wall${owner}_${i + 1}`).join('\n');
const inHour = (h) => Date.now() + h * 3600 * 1000;

beforeEach(async () => {
  await closeDB();
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage.clear();
  vk = makeFakeVk();
  setTransport(vk.transport);
  setTokenProvider(async () => 'test-token');
  setMinInterval(0);
  await freshApp();
});

describe('Сценарии 1–3: N ссылок → N независимых редакторов с оригинальным текстом', () => {
  for (const n of [1, 2, 10]) {
    it(`${n} ссылок → ${n} редакторов`, async () => {
      const { added } = await loadLinks(links(n));
      expect(added).toHaveLength(n);
      const posts = getAllPosts();
      expect(posts).toHaveLength(n);
      posts.forEach((p, i) => expect(p.text).toBe(`Оригинальный текст записи -100_${i + 1}`));
    });
  }
  it('150 ссылок загружаются пакетами по 100 (2 запроса wall.getById)', async () => {
    const { added } = await loadLinks(links(150));
    expect(added).toHaveLength(150);
    expect(vk.calls.filter((c) => c.method === 'wall.getById')).toHaveLength(2);
  });
  it('недоступная публикация → понятная ошибка, остальные загружаются', async () => {
    const { added, failed } = await loadLinks('https://vk.com/wall-1_1 https://vk.com/wall-1_404');
    expect(added).toHaveLength(1);
    expect(failed[0].error).toMatch(/недоступна/);
  });
  it('редакторы независимы: правка одного не меняет другие', async () => {
    await loadLinks(links(2));
    const [a, b] = getAllPosts();
    setText(a.id, 'Новый текст 🚀\nвторая строка https://example.com');
    expect(getPost(a.id).text).toBe('Новый текст 🚀\nвторая строка https://example.com');
    expect(getPost(b.id).text).toBe(b.originalText);
    await restoreOriginal(a.id);
    expect(getPost(a.id).text).toBe(a.originalText);
  });
});

describe('Сценарии 4–5: общий Checkbox ссылок авторов', () => {
  it('включение добавляет ссылку каждого автора к своей публикации', async () => {
    await loadLinks('https://vk.com/wall-1_1 https://vk.com/wall-2_1 https://vk.com/wall55_1');
    await setAuthorLinksEnabled(true);
    const preview = buildPreview(getAllPosts(), getSettings());
    expect(preview[0].text).toMatch(/Автор: https:\/\/vk\.com\/club_1$/);
    expect(preview[1].text).toMatch(/Автор: https:\/\/vk\.com\/club_2$/);
    expect(preview[2].text).toMatch(/Автор: https:\/\/vk\.com\/author55$/);
    // сам текст в редакторе не изменён — правки пользователя не повреждаются
    expect(getAllPosts()[0].text).toBe('Оригинальный текст записи -1_1');
  });
  it('новые публикации получают ссылку автоматически', async () => {
    await setAuthorLinksEnabled(true);
    await loadLinks('https://vk.com/wall-9_9');
    expect(buildPreview(getAllPosts(), getSettings())[0].text).toMatch(/club_9$/);
  });
  it('Сценарий 5: после «перезапуска» Checkbox остаётся включённым', async () => {
    await setAuthorLinksEnabled(true);
    globalThis.localStorage.clear(); // источник истины — IndexedDB, не LocalStorage
    await freshApp();
    expect(getSettings().authorLinksEnabled).toBe(true);
  });
});

describe('Сценарии 6–9: индивидуальное время и общий предпросмотр', () => {
  it('Сценарий 6: время только у двух из пяти', async () => {
    await loadLinks(links(5));
    const ids = postsStore.get().order;
    await setPostSchedule(ids[0], inHour(24));
    await setPostSchedule(ids[2], inHour(48));
    const posts = getAllPosts();
    expect(posts.map((p) => Boolean(p.schedule))).toEqual([true, false, true, false, false]);
    const plan = planPublication(posts, getSettings());
    expect(plan.scheduled).toHaveLength(2);
    expect(plan.now).toHaveLength(3);
  });
  it('Сценарий 7: изменение времени одной не меняет другие', async () => {
    await loadLinks(links(3));
    const ids = postsStore.get().order;
    const t1 = inHour(5);
    const t2 = inHour(6);
    await setPostSchedule(ids[0], t1);
    await setPostSchedule(ids[1], t2);
    await setPostSchedule(ids[0], inHour(10));
    expect(getPost(ids[1]).schedule.at).toBe(t2);
    expect(getPost(ids[2]).schedule).toBeNull();
    await clearPostSchedule(ids[0]);
    expect(getPost(ids[0]).schedule).toBeNull();
    expect(getPost(ids[1]).schedule.at).toBe(t2);
  });
  it('Сценарий 8–9: предпросмотр = все карточки и отражает правки', async () => {
    await loadLinks(links(5));
    const ids = postsStore.get().order;
    await setPostSchedule(ids[1], inHour(3));
    let preview = buildPreview(getAllPosts(), getSettings());
    expect(preview).toHaveLength(5);
    expect(preview[1].mode).toBe('scheduled');
    expect(preview[0].mode).toBe('now');
    expect(preview[0].photos).toHaveLength(1);
    setText(ids[0], 'Отредактировано');
    preview = buildPreview(getAllPosts(), getSettings());
    expect(preview[0].text).toBe('Отредактировано');
  });
});

describe('Сценарии 10–11: данные сохраняются локально', () => {
  it('черновики, тексты и время переживают перезапуск', async () => {
    await loadLinks(links(3));
    const ids = postsStore.get().order;
    setText(ids[0], 'Черновик пользователя');
    const at = inHour(30);
    await setPostSchedule(ids[2], at);
    await flushPending();
    await freshApp(); // новое соединение с БД, состояние из IndexedDB
    const posts = getAllPosts();
    expect(posts).toHaveLength(3);
    expect(posts[0].text).toBe('Черновик пользователя');
    expect(posts[2].schedule.at).toBe(at);
  });
  it('резервная копия: экспорт → импорт в «чистое» устройство', async () => {
    await loadLinks(links(2));
    await setAuthorLinksEnabled(true);
    const backup = JSON.parse(JSON.stringify(await createBackup()));
    await closeDB();
    globalThis.indexedDB = new IDBFactory();
    await freshApp();
    expect(getAllPosts()).toHaveLength(0);
    const r = await restoreBackup(backup, 'replace');
    expect(r.posts).toBe(2);
    expect(getAllPosts()).toHaveLength(2);
    expect(getSettings().authorLinksEnabled).toBe(true);
  });
});

describe('Массовая публикация', () => {
  it('без времени — сразу, со временем — publish_date (расписание VK)', async () => {
    await loadLinks(links(3));
    const ids = postsStore.get().order;
    const at = inHour(26);
    await setPostSchedule(ids[1], at);
    await setAuthorLinksEnabled(true);
    const s = await publishPosts(ids, { userId: ME, verifyDelay: 0 });
    expect(s).toMatchObject({ published: 2, scheduled: 1, failed: 0, action: 0 });
    const posts = vk.calls.filter((c) => c.method === 'wall.post').map((c) => c.params);
    expect(posts[0].publish_date).toBeUndefined();
    expect(Number(posts[1].publish_date)).toBe(Math.floor(at / 1000));
    expect(posts[0].message).toMatch(/Автор: https:\/\/vk\.com\/club_100$/);
    expect(posts[0].attachments).toBe('photo-100_2');
    expect(getPost(ids[1]).status).toBe(STATUS.SCHEDULED_VK);
    expect(getPost(ids[0]).status).toBe(STATUS.PUBLISHED);
    expect(getPost(ids[0]).result.url).toMatch(/^https:\/\/vk\.com\/wall777_\d+$/);
    expect(historyStore.get().items.filter((h) => h.kind === 'published')).toHaveLength(2);
  });
  it('повторное нажатие не создаёт дублей', async () => {
    await loadLinks(links(2));
    const ids = postsStore.get().order;
    await publishPosts(ids, { userId: ME });
    const second = await publishPosts(ids, { userId: ME });
    expect(second.skipped).toBe(2);
    expect(vk.calls.filter((c) => c.method === 'wall.post')).toHaveLength(2);
  });
  it('параллельный запуск блокируется', async () => {
    await loadLinks(links(2));
    const ids = postsStore.get().order;
    const p1 = publishPosts(ids, { userId: ME });
    await expect(publishPosts(ids, { userId: ME })).rejects.toThrow(/уже выполняется/);
    await p1;
  });
  it('обрыв связи после отправки → проверка стены, без повторной отправки', async () => {
    await loadLinks(links(1));
    vk.failNextPost = 'lost-response';
    const s = await publishPosts(postsStore.get().order, { userId: ME, verifyDelay: 0 });
    expect(s.published).toBe(1);
    expect(vk.calls.filter((c) => c.method === 'wall.post')).toHaveLength(1);
    expect(vk.calls.some((c) => c.method === 'wall.get')).toBe(true);
    expect(vk.wall).toHaveLength(1);
  });
  it('запись, застрявшая в «Публикуется» после закрытия приложения, сначала проверяется', async () => {
    await loadLinks(links(1));
    const [id] = postsStore.get().order;
    // имитация: wall.post дошёл до VK, но приложение закрылось до ответа
    const message = getPost(id).text;
    vk.wall.unshift({ id: 5555, owner_id: ME, text: message, date: Math.floor(Date.now() / 1000) });
    const { updatePost } = await import('../src/js/post-editor.js');
    await updatePost(id, { status: STATUS.PUBLISHING, attempt: { at: Date.now() - 1000, message, scheduledAt: null, uncertain: true } }, { immediate: true });
    await freshApp();
    const s = await publishPosts([id], { userId: ME });
    expect(s.published).toBe(1);
    expect(vk.calls.filter((c) => c.method === 'wall.post')).toHaveLength(0);
    expect(getPost(id).result.vkPostId).toBe(5555);
  });
  it('прошедшее время → «Требуется действие», запись не отправляется', async () => {
    await loadLinks(links(1));
    const [id] = postsStore.get().order;
    const { updatePost } = await import('../src/js/post-editor.js');
    await updatePost(id, { schedule: { at: Date.now() - 60000, tz: 'UTC' } }, { immediate: true });
    await publishPosts([id], { userId: ME });
    expect(getPost(id).status).toBe(STATUS.ACTION);
    expect(vk.calls.filter((c) => c.method === 'wall.post')).toHaveLength(0);
  });
  it('«Опубликовать выбранные» и «Сохранить все черновики»', async () => {
    await loadLinks(links(3));
    const ids = postsStore.get().order;
    setSelected(ids[1], false);
    const selected = getAllPosts().filter((p) => p.selected !== false);
    expect(selected).toHaveLength(2);
    const n = await saveAllDrafts();
    expect(n).toBe(3);
    expect(getAllPosts().every((p) => p.status === STATUS.DRAFT)).toBe(true);
    expect(historyStore.get().items.filter((h) => h.kind === 'draft')).toHaveLength(3);
    await saveAllDrafts(); // повторно — без дублей в истории
    expect(historyStore.get().items.filter((h) => h.kind === 'draft')).toHaveLength(3);
  });
});
