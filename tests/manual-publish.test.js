// Полуавтоматическая публикация без права wall.
import { describe, it, expect, beforeEach } from 'vite-plus/test';
import { IDBFactory } from 'fake-indexeddb';
import { closeDB } from '../src/js/database.js';
import { initPosts, addPosts, getPost, setPostSchedule } from '../src/js/post-editor.js';
import { loadSettings, updateSettings, getSettings, DEFAULT_SETTINGS } from '../src/js/settings.js';
import { loadHistory, historyStore } from '../src/js/history.js';
import { manualQueue, shareText, photoUrls, otherAttachmentLinks, fetchPhotoFiles, markManual } from '../src/js/manual-publish.js';
import { STATUS } from '../src/js/scheduler.js';

const rec = (i, extra = {}) => ({
  id: `-1_${i}`,
  key: `-1_${i}`,
  sourceUrl: `https://vk.com/wall-1_${i}`,
  authorName: 'Сообщество',
  authorUrl: 'https://vk.com/club1',
  originalText: `Текст ${i}`,
  text: `Текст ${i}`,
  attachments: [
    { type: 'photo', vkId: `photo-1_${i}`, preview: `https://sun.userapi.com/s${i}.jpg`, full: `https://sun.userapi.com/f${i}.jpg` },
    { type: 'video', vkId: `video-1_${i}_abcdef123456`, preview: 'x' },
  ],
  unsupported: [],
  schedule: null,
  status: STATUS.READY,
  selected: true,
  ...extra,
});

beforeEach(async () => {
  await closeDB();
  globalThis.indexedDB = new IDBFactory();
  globalThis.localStorage.clear();
  await Promise.all([initPosts(), loadSettings(), loadHistory()]);
});

describe('Ручная публикация (без wall)', () => {
  it('по умолчанию включён ручной режим', () => {
    expect(DEFAULT_SETTINGS.publishMode).toBe('manual');
    expect(getSettings().publishMode).toBe('manual');
  });
  it('очередь мастера пропускает уже отправленные', () => {
    const q = manualQueue([rec(1), rec(2, { status: STATUS.PUBLISHED }), rec(3, { status: STATUS.SCHEDULED_VK }), rec(4)]);
    expect(q).toEqual(['-1_1', '-1_4']);
  });
  it('текст для ВК включает ссылку автора, если Checkbox включён', async () => {
    await updateSettings({ authorLinksEnabled: true });
    expect(shareText(rec(1))).toBe('Текст 1\n\nАвтор: https://vk.com/club1');
  });
  it('фото — в лучшем качестве, видео — ссылкой без ключа доступа', () => {
    expect(photoUrls(rec(1))).toEqual(['https://sun.userapi.com/f1.jpg']);
    expect(otherAttachmentLinks(rec(1))).toEqual(['https://vk.com/video-1_1']);
  });
  it('фото скачиваются как файлы, ошибки не ломают остальное', async () => {
    const post = rec(1, { attachments: [...rec(1).attachments, { type: 'photo', full: 'https://sun.userapi.com/bad.jpg' }] });
    const fetchImpl = async (u) =>
      u.includes('bad') ? { ok: false, status: 404 } : { ok: true, blob: async () => new Blob(['img'], { type: 'image/jpeg' }) };
    const { files, failed } = await fetchPhotoFiles(post, { fetchImpl });
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('itools--1_1-1.jpg');
    expect(failed).toEqual(['https://sun.userapi.com/bad.jpg']);
  });
  it('отметка «Опубликовал» и «Отложил в ВК»: статус, История, без дублей', async () => {
    await addPosts([rec(1), rec(2)]);
    const at = Date.now() + 86400000;
    await setPostSchedule('-1_2', at);
    await markManual('-1_1', 'published', 'https://vk.com/wall777_5');
    await markManual('-1_2', 'scheduled', 'not a link');
    expect(getPost('-1_1').status).toBe(STATUS.PUBLISHED);
    expect(getPost('-1_1').result).toMatchObject({ manual: true, url: 'https://vk.com/wall777_5' });
    expect(getPost('-1_2').status).toBe(STATUS.SCHEDULED_VK);
    expect(getPost('-1_2').result).toMatchObject({ manual: true, url: null, scheduledAt: at });
    await markManual('-1_1', 'published'); // повторно — без новой записи в Истории
    const kinds = historyStore.get().items.map((h) => h.kind).sort();
    expect(kinds).toEqual(['published', 'scheduled']);
  });
});
