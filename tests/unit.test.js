import { describe, it, expect } from 'vite-plus/test';
import { parseLinks, parseLink } from '../src/js/link-parser.js';
import { applyAuthorLink, textContainsAuthorLink, authorLinkState } from '../src/js/author-links.js';
import { validateSchedule, fromLocalParts, toLocalParts, effectiveStatus, deviceTimeZone } from '../src/js/scheduler.js';
import { mapPost } from '../src/js/post-loader.js';

describe('link-parser: одно поле для любого количества ссылок', () => {
  it('разделители: новая строка, пробел, запятая', () => {
    const r = parseLinks('https://vk.com/wall123_456\nhttps://vk.com/wall123_789 https://vk.com/wall-1_111,https://vk.ru/wall5_6');
    expect(r.valid.map((l) => l.key)).toEqual(['123_456', '123_789', '-1_111', '5_6']);
  });
  it('удаляет дубликаты (включая m.vk.com и параметры)', () => {
    const r = parseLinks('https://vk.com/wall1_2 https://m.vk.com/wall1_2?reply=5 vk.com/wall1_2');
    expect(r.valid).toHaveLength(1);
    expect(r.duplicates).toHaveLength(2);
  });
  it('понимает ?w=wall и голые wall-1_2', () => {
    expect(parseLink('https://vk.com/club1?w=wall-1_2').key).toBe('-1_2');
    expect(parseLink('https://vk.com/feed?w=wall-1_2%2Fall').key).toBe('-1_2');
    expect(parseLink('wall-77_88').key).toBe('-77_88');
  });
  it('показывает некорректные ссылки с причиной', () => {
    const r = parseLinks('https://google.com/wall1_2 https://vk.com/id1 hello https://vk.com/wall0_1');
    expect(r.valid).toHaveLength(0);
    expect(r.invalid).toHaveLength(4);
    expect(r.invalid[0].reason).toMatch(/ВКонтакте/);
  });
  it('нет фиксированного лимита: 250 ссылок', () => {
    const text = Array.from({ length: 250 }, (_, i) => `https://vk.com/wall-1_${i + 1}`).join('\n');
    expect(parseLinks(text).valid).toHaveLength(250);
  });
});

describe('author-links: общий Checkbox', () => {
  const post = { authorUrl: 'https://vk.com/durov', authorName: 'Павел' };
  const on = { authorLinksEnabled: true, authorLinkTemplate: 'Автор: {url}' };
  it('добавляет индивидуальную ссылку в конец', () => {
    expect(applyAuthorLink('Привет', post, on)).toBe('Привет\n\nАвтор: https://vk.com/durov');
  });
  it('не дублирует, если ссылка уже есть (http/m./vk.ru варианты)', () => {
    expect(applyAuthorLink('Текст vk.com/durov', post, on)).toBe('Текст vk.com/durov');
    expect(applyAuthorLink('Текст https://m.vk.com/durov', post, on)).toBe('Текст https://m.vk.com/durov');
    expect(applyAuthorLink('Текст https://vk.ru/durov/', post, on)).toBe('Текст https://vk.ru/durov/');
    expect(textContainsAuthorLink('vk.com/durovv', post.authorUrl)).toBe(false);
  });
  it('выключенный Checkbox ничего не добавляет и не трогает текст', () => {
    expect(applyAuthorLink('Мой текст 🙂\n', post, { authorLinksEnabled: false })).toBe('Мой текст 🙂\n');
    expect(authorLinkState({ ...post, text: 'x' }, { authorLinksEnabled: false })).toBe('off');
  });
  it('пустой текст → только ссылка', () => {
    expect(applyAuthorLink('', post, on)).toBe('Автор: https://vk.com/durov');
  });
});

describe('scheduler', () => {
  it('нельзя назначить время в прошлом', () => {
    const now = Date.now();
    expect(validateSchedule(now - 60000, now).ok).toBe(false);
    expect(validateSchedule(now + 30000, now).ok).toBe(false);
    expect(validateSchedule(now + 3600000, now).ok).toBe(true);
    expect(validateSchedule(now + 400 * 864e5, now).ok).toBe(false);
  });
  it('локальные дата/часы/минуты ↔ timestamp', () => {
    const ts = fromLocalParts('2026-11-20', '10', '00');
    expect(toLocalParts(ts)).toEqual({ date: '2026-11-20', hours: '10', minutes: '00' });
    expect(fromLocalParts('2026-02-30', '10', '00')).toBeNull();
  });
  it('часовой пояс устройства явно известен', () => {
    expect(deviceTimeZone().offset).toMatch(/^UTC[+-]\d\d:\d\d$/);
  });
  it('запись со временем отображается как «Ожидает запланированного времени»', () => {
    expect(effectiveStatus({ status: 'ready', schedule: { at: 1 } })).toBe('waiting');
    expect(effectiveStatus({ status: 'ready', schedule: null })).toBe('ready');
  });
});

describe('post-loader: разбор ответа wall.getById', () => {
  const link = { key: '-1_10', url: 'https://vk.com/wall-1_10' };
  it('оригинальный текст, автор-сообщество и вложения', () => {
    const item = {
      id: 10,
      owner_id: -1,
      from_id: -1,
      date: 1700000000,
      text: 'Оригинал',
      attachments: [
        { type: 'photo', photo: { id: 5, owner_id: -1, access_key: 'k', sizes: [{ url: 'a', width: 100, height: 100 }, { url: 'b', width: 800, height: 600 }] } },
        { type: 'video', video: { id: 7, owner_id: -1, title: 'Клип', image: [{ url: 'v', width: 320 }] } },
        { type: 'market', market: { id: 1 } },
      ],
    };
    const p = mapPost(item, { groups: [{ id: 1, name: 'Группа', screen_name: 'apiclub' }] }, link);
    expect(p.originalText).toBe('Оригинал');
    expect(p.text).toBe('Оригинал');
    expect(p.authorName).toBe('Группа');
    expect(p.authorUrl).toBe('https://vk.com/apiclub');
    expect(p.attachments.map((a) => a.vkId)).toEqual(['photo-1_5_k', 'video-1_7']);
    expect(p.unsupported).toHaveLength(1);
    expect(p.schedule).toBeNull();
  });
  it('репост без своего текста → текст и автор оригинала', () => {
    const item = { id: 10, owner_id: -1, from_id: -1, text: '', copy_history: [{ id: 3, owner_id: 42, from_id: 42, text: 'Исходник' }] };
    const p = mapPost(item, { profiles: [{ id: 42, first_name: 'Иван', last_name: 'Петров', screen_name: 'ivan' }] }, link);
    expect(p.text).toBe('Исходник');
    expect(p.authorUrl).toBe('https://vk.com/ivan');
    expect(p.isRepost).toBe(true);
  });
});
