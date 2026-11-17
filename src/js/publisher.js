// Массовая публикация в собственный аккаунт ВКонтакте.
//  • Без времени — wall.post сразу.
//  • С временем — wall.post с publish_date: запись попадает в «Отложенные» на сервере ВКонтакте
//    и публикуется самим ВКонтакте, даже если телефон выключен.
//  • Защита от дублей: блокировка повторного запуска, параметр guid VK, статус «Публикуется»
//    сохраняется ДО запроса; при неопределённом результате сначала проверяется стена (wall.get).
import { callApi, VkNetworkError } from './vk-api.js';
import { currentUserId } from './vk-auth.js';
import { getSettings } from './settings.js';
import { finalText } from './author-links.js';
import { getPost, getAllPosts, updatePost, flushPending } from './post-editor.js';
import { addHistory, upsertDraftHistory } from './history.js';
import { STATUS, FINAL_STATUSES, formatDateTime } from './scheduler.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_ATTACHMENTS = 10;
const PAST_DUE_MARGIN = 60 * 1000;
const ACTION_CODES = new Set([5, 7, 9, 15, 17, 29, 214, 219, 222, 224]);

let running = false;
export const isPublishing = () => running;

export function buildAttachments(post) {
  const list = [];
  let hasLink = false;
  for (const a of post.attachments || []) {
    if (!a.vkId) continue;
    if (a.type === 'link') {
      if (hasLink) continue; // VK допускает только одну ссылку-вложение
      hasLink = true;
    }
    list.push(a.vkId);
    if (list.length >= MAX_ATTACHMENTS) break;
  }
  return list.join(',');
}

/** Что будет сделано при публикации — для окна подтверждения. */
export function planPublication(posts, settings = getSettings(), now = Date.now()) {
  const now_ = [];
  const scheduled = [];
  const skipped = [];
  const pastDue = [];
  const verify = [];
  for (const post of posts) {
    if (FINAL_STATUSES.has(post.status)) {
      skipped.push({ post, reason: post.status === STATUS.PUBLISHED ? 'Уже опубликована' : 'Уже в расписании ВКонтакте' });
      continue;
    }
    if (!finalText(post, settings).trim() && !buildAttachments(post)) {
      skipped.push({ post, reason: 'Пустая публикация' });
      continue;
    }
    if (post.attempt && (post.status === STATUS.PUBLISHING || post.needsVerify || post.attempt.uncertain)) verify.push(post);
    if (post.localWait) {
      if (post.schedule?.at > now) skipped.push({ post, reason: 'Ожидает локально (отправится, когда наступит время)' });
      else now_.push(post);
      continue;
    }
    if (post.schedule?.at) {
      if (post.schedule.at < now + PAST_DUE_MARGIN) pastDue.push(post);
      else scheduled.push(post);
    } else now_.push(post);
  }
  return { now: now_, scheduled, skipped, pastDue, verify };
}

const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Ищет на стене запись, отправленную попыткой attempt (для неопределённого результата). */
export async function findPublished(attempt, userId, api = callApi) {
  const filter = attempt.scheduledAt ? 'postponed' : 'owner';
  const resp = await api('wall.get', { owner_id: userId, filter, count: 50 });
  const items = resp?.items || [];
  const target = normalize(attempt.message);
  return (
    items.find((it) => {
      if (normalize(it.text) !== target) return false;
      if (attempt.scheduledAt) return Math.abs(it.date - attempt.scheduledAt / 1000) < 120;
      return it.date >= attempt.at / 1000 - 300;
    }) || null
  );
}

async function markSuccess(post, vkPostId, scheduledAt, userId, message) {
  const status = scheduledAt ? STATUS.SCHEDULED_VK : STATUS.PUBLISHED;
  const url = `https://vk.com/wall${userId}_${vkPostId}`;
  await updatePost(
    post.id,
    { status, result: { vkPostId, url, at: Date.now(), scheduledAt }, attempt: null, needsVerify: false, error: null, localWait: false },
    { immediate: true },
  );
  await addHistory({
    kind: scheduledAt ? 'scheduled' : 'published',
    postId: post.id,
    sourceUrl: post.sourceUrl,
    authorName: post.authorName,
    text: message,
    url,
    scheduledAt,
  });
  return status;
}

async function markProblem(post, status, error, { keepAttempt = false, extra = {} } = {}) {
  await updatePost(
    post.id,
    (p) => ({
      status,
      error,
      needsVerify: false,
      attempt: keepAttempt ? p.attempt : null,
      ...extra,
    }),
    { immediate: true },
  );
  await addHistory({ kind: 'error', postId: post.id, sourceUrl: post.sourceUrl, authorName: post.authorName, text: post.text, error });
  return status;
}

/**
 * Публикация одной записи.
 * @returns {Promise<string>} итоговый статус
 */
export async function publishOne(post, opts = {}) {
  const api = opts.api || callApi;
  const settings = opts.settings || getSettings();
  const userId = opts.userId ?? currentUserId();
  const now = opts.now ?? Date.now();
  if (!userId) return markProblem(post, STATUS.ACTION, 'Подключите аккаунт ВКонтакте');

  // 1. Предыдущая попытка с неизвестным результатом — сначала проверяем стену, а не отправляем вслепую.
  if (post.attempt && (post.status === STATUS.PUBLISHING || post.needsVerify || post.attempt.uncertain)) {
    try {
      const found = await findPublished(post.attempt, userId, api);
      if (found) return markSuccess(post, found.id, post.attempt.scheduledAt, userId, post.attempt.message);
    } catch (e) {
      return markProblem(post, STATUS.ACTION, `Не удалось проверить результат прошлой отправки: ${e.message}. Повторите позже.`, {
        keepAttempt: true,
      });
    }
  }

  const message = finalText(post, settings);
  const attachments = buildAttachments(post);
  if (!message.trim() && !attachments) return markProblem(post, STATUS.ERROR, 'Пустая публикация: добавьте текст или вложения');

  const scheduledAt = post.localWait ? null : post.schedule?.at || null;
  if (scheduledAt && scheduledAt < now + PAST_DUE_MARGIN) {
    return markProblem(post, STATUS.ACTION, `Назначенное время (${formatDateTime(scheduledAt)}) уже прошло — измените время или снимите его`);
  }

  const attempt = { at: Date.now(), message, scheduledAt, guid: post.guid, uncertain: true };
  await updatePost(post.id, { status: STATUS.PUBLISHING, attempt, error: null, needsVerify: false }, { immediate: true });

  const params = {
    owner_id: userId,
    message,
    attachments,
    guid: post.guid,
    publish_date: scheduledAt ? Math.floor(scheduledAt / 1000) : undefined,
  };
  let captcha = {};
  for (let tries = 0; tries < 3; tries++) {
    try {
      const resp = await api('wall.post', { ...params, ...captcha }, { timeout: 30000, retry: false });
      if (!resp?.post_id) throw new VkNetworkError('ВКонтакте не вернул номер записи', { uncertain: true });
      return markSuccess(post, resp.post_id, scheduledAt, userId, message);
    } catch (e) {
      if (e.code === 14 && opts.onCaptcha) {
        const key = await opts.onCaptcha(e.captchaImg);
        if (key) {
          captcha = { captcha_sid: e.captchaSid, captcha_key: key };
          continue;
        }
        return markProblem(post, STATUS.ACTION, 'ВКонтакте запросил капчу, но она не была введена');
      }
      if (e instanceof VkNetworkError && e.uncertain) {
        // Запрос мог дойти до ВКонтакте. Проверяем стену, прежде чем что-либо делать.
        await sleep(opts.verifyDelay ?? 1500);
        try {
          const found = await findPublished(attempt, userId, api);
          if (found) return markSuccess(post, found.id, scheduledAt, userId, message);
        } catch {
          /* проверка не удалась — ниже статус «Требуется действие» с сохранённой попыткой */
        }
        return markProblem(
          post,
          STATUS.ACTION,
          'Результат отправки не подтверждён (обрыв связи). При следующей публикации iTools сначала проверит вашу стену, чтобы не создать дубль.',
          { keepAttempt: true },
        );
      }
      if (e instanceof VkNetworkError) return markProblem(post, STATUS.ERROR, e.message);
      if (scheduledAt && e.code === 214) {
        return markProblem(
          post,
          STATUS.ACTION,
          `ВКонтакте не принял запись в расписание: ${e.message}. Можно изменить время, опубликовать сразу или включить локальное ожидание.`,
          { extra: { scheduleRejected: true } },
        );
      }
      return markProblem(post, ACTION_CODES.has(e.code) ? STATUS.ACTION : STATUS.ERROR, e.message);
    }
  }
  return markProblem(post, STATUS.ACTION, 'Капча введена неверно несколько раз');
}

/**
 * Публикация списка записей (последовательно, с прогрессом).
 * @param {string[]} ids
 * @param {{onProgress?: Function, onCaptcha?: Function, signal?: AbortSignal, api?: Function, userId?: number, settings?: object}} opts
 */
export async function publishPosts(ids, opts = {}) {
  if (running) throw new Error('Публикация уже выполняется');
  running = true;
  const summary = { published: 0, scheduled: 0, failed: 0, action: 0, skipped: 0, total: ids.length };
  try {
    await flushPending();
    let done = 0;
    for (const id of ids) {
      if (opts.signal?.aborted) break;
      const post = getPost(id);
      if (!post || FINAL_STATUSES.has(post.status) || (post.localWait && post.schedule?.at > Date.now())) {
        summary.skipped++;
      } else {
        const status = await publishOne(post, opts);
        if (status === STATUS.PUBLISHED) summary.published++;
        else if (status === STATUS.SCHEDULED_VK) summary.scheduled++;
        else if (status === STATUS.ACTION) summary.action++;
        else summary.failed++;
      }
      done++;
      opts.onProgress?.({ done, total: ids.length, id });
    }
  } finally {
    running = false;
  }
  return summary;
}

/** Локальное ожидание (запасной вариант, если ВКонтакте не принял расписание). Работает ТОЛЬКО пока приложение открыто. */
export function enableLocalWait(id) {
  return updatePost(id, { localWait: true, status: STATUS.READY, error: null, scheduleRejected: false }, { immediate: true });
}

export async function publishDueLocal(opts = {}) {
  if (running || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
  const due = getAllPosts().filter(
    (p) => p.localWait && p.schedule?.at <= Date.now() && !FINAL_STATUSES.has(p.status) && p.status !== STATUS.PUBLISHING,
  );
  if (!due.length) return null;
  return publishPosts(
    due.map((p) => p.id),
    opts,
  );
}

/** «Сохранить все черновики»: всё уже сохранено автоматически; фиксируем статус и запись в Истории. */
export async function saveAllDrafts() {
  await flushPending();
  let count = 0;
  for (const post of getAllPosts()) {
    if (FINAL_STATUSES.has(post.status) || post.status === STATUS.PUBLISHING) continue;
    await updatePost(post.id, { status: STATUS.DRAFT }, { immediate: true });
    await upsertDraftHistory({
      postId: post.id,
      sourceUrl: post.sourceUrl,
      authorName: post.authorName,
      text: post.text,
      scheduledAt: post.schedule?.at || null,
    });
    count++;
  }
  return count;
}
