// Индивидуальное (необязательное) время публикации.
// Время хранится как timestamp (мс, UTC) + имя часового пояса устройства на момент назначения.
// В ВКонтакте передаётся как publish_date (unix-секунды) — серверная отложенная публикация.
export const MIN_LEAD_MS = 2 * 60 * 1000; // не раньше чем через 2 минуты
export const MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000; // не позже чем через год

const pad = (n) => String(n).padStart(2, '0');

export function deviceTimeZone(date = new Date()) {
  let name = 'локальный';
  try {
    name = Intl.DateTimeFormat().resolvedOptions().timeZone || name;
  } catch {
    /* ignore */
  }
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return { name, offset: `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`, offsetMin };
}

export function toLocalParts(ts) {
  const d = new Date(ts);
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    hours: pad(d.getHours()),
    minutes: pad(d.getMinutes()),
  };
}

/** Собирает timestamp из локальных даты/часов/минут. null — если такого времени нет (например, переход на летнее время). */
export function fromLocalParts(date, hours, minutes) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  const h = Number(hours);
  const mi = Number(minutes);
  if (!m || !Number.isInteger(h) || !Number.isInteger(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d || dt.getHours() !== h || dt.getMinutes() !== mi)
    return null;
  return dt.getTime();
}

export function validateSchedule(ts, now = Date.now()) {
  if (ts == null || !Number.isFinite(ts)) return { ok: false, error: 'Укажите корректные дату и время' };
  if (ts < now + MIN_LEAD_MS) {
    return ts <= now
      ? { ok: false, error: 'Нельзя назначить время в прошлом' }
      : { ok: false, error: 'Время должно быть минимум на 2 минуты позже текущего' };
  }
  if (ts > now + MAX_AHEAD_MS) return { ok: false, error: 'ВКонтакте позволяет откладывать записи не более чем на год' };
  return { ok: true };
}

export function makeSchedule(ts) {
  return { at: ts, tz: deviceTimeZone(new Date(ts)).name, setAt: Date.now() };
}

export function formatDateTime(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

export function isPastDue(post, now = Date.now()) {
  return Boolean(post?.schedule?.at) && post.schedule.at < now + 30 * 1000;
}

// --- Статусы ---------------------------------------------------------------
export const STATUS = Object.freeze({
  DRAFT: 'draft',
  READY: 'ready',
  WAITING: 'waiting',
  SCHEDULED_VK: 'scheduled_vk',
  PUBLISHING: 'publishing',
  PUBLISHED: 'published',
  ERROR: 'error',
  ACTION: 'action_required',
});

export const STATUS_LABELS = Object.freeze({
  draft: 'Черновик',
  ready: 'Готова к публикации',
  waiting: 'Ожидает запланированного времени',
  scheduled_vk: 'Передана в расписание ВКонтакте',
  publishing: 'Публикуется',
  published: 'Опубликована',
  error: 'Ошибка',
  action_required: 'Требуется действие пользователя',
});

export const FINAL_STATUSES = new Set([STATUS.PUBLISHED, STATUS.SCHEDULED_VK]);

/** Статус для отображения: черновик/готовая запись с временем показывается как «Ожидает запланированного времени». */
export function effectiveStatus(post) {
  if (!post) return STATUS.DRAFT;
  if ((post.status === STATUS.READY || post.status === STATUS.DRAFT) && post.schedule?.at) return STATUS.WAITING;
  return post.status || STATUS.DRAFT;
}
