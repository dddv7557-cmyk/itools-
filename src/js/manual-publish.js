// Полуавтоматическая публикация БЕЗ права wall.
// iTools готовит текст (со ссылкой автора) и фото, а саму запись публикуете вы в официальном
// приложении или на сайте ВКонтакте — от своего аккаунта, обычным способом:
//  • телефон: системное окно «Поделиться» (Web Share API) → ВКонтакте → редактор записи;
//  • компьютер: текст копируется в буфер, фото скачиваются, открывается vk.com.
// Никаких внутренних запросов vk.com, cookie или чужих токенов не используется.
import { finalText } from './author-links.js';
import { getSettings } from './settings.js';
import { getPost, updatePost } from './post-editor.js';
import { addHistory } from './history.js';
import { STATUS, FINAL_STATUSES } from './scheduler.js';

export const VK_HOME = 'https://vk.com/';

/** Очередь мастера: только существующие и ещё не отправленные записи, в исходном порядке. */
export function manualQueue(posts) {
  return posts.filter((p) => p && !FINAL_STATUSES.has(p.status) && p.status !== STATUS.PUBLISHING).map((p) => p.id);
}

export function shareText(post, settings = getSettings()) {
  return finalText(post, settings);
}

/** Фото записи (лучшее доступное качество). Видео/документы нельзя передать файлом — только ссылкой. */
export function photoUrls(post) {
  return (post.attachments || []).filter((a) => a.type === 'photo').map((a) => a.full || a.preview).filter(Boolean);
}

export function otherAttachmentLinks(post) {
  return (post.attachments || [])
    .filter((a) => a.type !== 'photo')
    .map((a) => (a.type === 'link' ? a.url : a.vkId ? `https://vk.com/${a.vkId.replace(/_[0-9a-f]{6,}$/i, '')}` : null))
    .filter(Boolean);
}

/** Скачать фото как файлы (VK CDN разрешает CORS). Ошибочные пропускаются. */
export async function fetchPhotoFiles(post, { fetchImpl = fetch } = {}) {
  const files = [];
  const failed = [];
  const urls = photoUrls(post);
  for (let i = 0; i < urls.length; i++) {
    try {
      const res = await fetchImpl(urls[i], { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
      const ext = type.split('/')[1].replace('jpeg', 'jpg');
      files.push(new File([blob], `itools-${post.id}-${i + 1}.${ext}`, { type }));
    } catch {
      failed.push(urls[i]);
    }
  }
  return { files, failed };
}

export function canShare() {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

export function canShareFiles(files) {
  try {
    return canShare() && typeof navigator.canShare === 'function' && files.length > 0 && navigator.canShare({ files });
  } catch {
    return false;
  }
}

export function isMobile() {
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // запасной путь для старых браузеров
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Телефон: «Поделиться» → ВКонтакте. Текст дополнительно копируется в буфер — некоторые версии
 * приложения ВК принимают только фото; тогда текст вставляется долгим нажатием.
 * @returns {Promise<{shared: boolean, withPhotos: boolean, copied: boolean, failedPhotos: number, cancelled?: boolean}>}
 */
export async function shareToVk(post, prepared) {
  const text = shareText(post);
  const copied = await copyText(text);
  const { files, failed } = prepared || (await fetchPhotoFiles(post));
  const withPhotos = canShareFiles(files);
  try {
    await navigator.share(withPhotos ? { text, files } : { text });
    return { shared: true, withPhotos, copied, failedPhotos: failed.length };
  } catch (e) {
    if (e?.name === 'AbortError') return { shared: false, cancelled: true, withPhotos, copied, failedPhotos: failed.length };
    throw e;
  }
}

/** Скачать фото на устройство (компьютер). */
export async function downloadPhotos(post, prepared) {
  const { files, failed } = prepared || (await fetchPhotoFiles(post));
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    await new Promise((r) => setTimeout(r, 250)); // браузер не блокирует серию скачиваний
  }
  return { downloaded: files.length, failed };
}

/** Компьютер: текст в буфер + открыть ВКонтакте в новой вкладке. */
export async function copyAndOpenVk(post) {
  const copied = await copyText(shareText(post));
  window.open(VK_HOME, '_blank', 'noopener');
  return { copied };
}

/**
 * Отметить запись как опубликованную вручную.
 * @param {'published'|'scheduled'} kind — 'scheduled', если в редакторе ВК выбрано отложенное время
 * @param {string} [url] — необязательная ссылка на запись во ВКонтакте
 */
export async function markManual(id, kind, url = '') {
  const post = getPost(id);
  if (!post) return null;
  if (FINAL_STATUSES.has(post.status)) return post; // повторная отметка не создаёт дублей в Истории
  const cleanUrl = /^https:\/\/(m\.)?vk\.(com|ru)\//i.test(url.trim()) ? url.trim() : '';
  const scheduledAt = kind === 'scheduled' ? post.schedule?.at || null : null;
  const status = kind === 'scheduled' ? STATUS.SCHEDULED_VK : STATUS.PUBLISHED;
  const next = await updatePost(
    id,
    { status, error: null, localWait: false, result: { manual: true, url: cleanUrl || null, at: Date.now(), scheduledAt } },
    { immediate: true },
  );
  await addHistory({
    kind: kind === 'scheduled' ? 'scheduled' : 'published',
    postId: id,
    sourceUrl: post.sourceUrl,
    authorName: post.authorName,
    text: shareText(post),
    url: cleanUrl || null,
    scheduledAt,
    manual: true,
  });
  return next;
}
