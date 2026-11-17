// Клиент официального VK API (https://api.vk.com/method/...).
// api.vk.com не отдаёт CORS-заголовки для произвольных сайтов, поэтому из браузера
// используется официально поддерживаемый JSONP-режим (параметр callback).
// Ограничение VK: не более 3 запросов в секунду с пользовательским токеном — соблюдается очередью.
export const API_VERSION = '5.199';
const API_BASE = 'https://api.vk.com/method/';
const MIN_INTERVAL_MS = 350;
export const MAX_URL_LENGTH = 60000;

const ERROR_TEXTS = {
  1: 'Неизвестная ошибка ВКонтакте',
  5: 'Авторизация не удалась — подключите аккаунт ВКонтакте заново',
  6: 'Слишком много запросов в секунду',
  7: 'Нет прав для этого действия — проверьте разрешения приложения',
  9: 'Flood control: ВКонтакте временно ограничил однотипные действия, попробуйте позже',
  10: 'Внутренняя ошибка сервера ВКонтакте',
  14: 'ВКонтакте запросил ввод капчи',
  15: 'Доступ запрещён',
  17: 'ВКонтакте требует подтвердить действие (validation required)',
  18: 'Страница удалена или заблокирована',
  29: 'Достигнут дневной лимит запросов',
  30: 'Профиль приватный',
  100: 'Неверный параметр запроса',
  113: 'Неверный идентификатор пользователя',
  200: 'Доступ к записи запрещён',
  203: 'Доступ к сообществу запрещён',
  210: 'Нет доступа к записи',
  214: 'Публикация запрещена: возможно, превышен лимит отложенных записей, время уже занято или недопустимо',
  219: 'Реклама или ссылка заблокированы ВКонтакте',
  220: 'Слишком много получателей',
  222: 'Публикация ссылок запрещена',
  224: 'Превышен лимит рекламных записей',
};

export class VkApiError extends Error {
  constructor(error = {}) {
    const code = error.error_code;
    const base = ERROR_TEXTS[code] || 'Ошибка ВКонтакте';
    super(`${base} (код ${code ?? '?'}${error.error_msg ? `: ${error.error_msg}` : ''})`);
    this.name = 'VkApiError';
    this.code = code;
    this.vkMessage = error.error_msg;
    this.captchaSid = error.captcha_sid;
    this.captchaImg = error.captcha_img;
  }
}

/** Сетевая ошибка. uncertain=true — запрос мог дойти до ВКонтакте, результат неизвестен. */
export class VkNetworkError extends Error {
  constructor(message, { uncertain = false } = {}) {
    super(message);
    this.name = 'VkNetworkError';
    this.uncertain = uncertain;
  }
}

export class VkAuthRequiredError extends Error {
  constructor() {
    super('Подключите аккаунт ВКонтакте (раздел «Настройки → Мой аккаунт ВКонтакте»)');
    this.name = 'VkAuthRequiredError';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let seq = 0;
function jsonpTransport(method, params, { timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      reject(new VkNetworkError('Нет подключения к интернету', { uncertain: false }));
      return;
    }
    const cb = `__itoolsVk${++seq}_${Date.now().toString(36)}`;
    const qs = new URLSearchParams({ ...params, callback: cb });
    const url = `${API_BASE}${encodeURIComponent(method)}?${qs.toString()}`;
    if (url.length > MAX_URL_LENGTH) {
      reject(new VkNetworkError('Текст публикации слишком длинный для отправки из браузера. Сократите текст.', { uncertain: false }));
      return;
    }
    const script = document.createElement('script');
    let done = false;
    const finish = (err, data) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      script.remove();
      // поздний ответ после таймаута не должен ронять страницу
      window[cb] = () => {
        delete window[cb];
      };
      if (err) reject(err);
      else {
        delete window[cb];
        resolve(data);
      }
    };
    const timer = setTimeout(
      () => finish(new VkNetworkError('ВКонтакте не ответил вовремя', { uncertain: true })),
      timeout,
    );
    window[cb] = (data) => finish(null, data);
    script.onerror = () => finish(new VkNetworkError('Сетевая ошибка при обращении к ВКонтакте', { uncertain: true }));
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = url;
    document.head.appendChild(script);
  });
}

let transport = jsonpTransport;
let tokenProvider = async () => null;
let authErrorHandler = () => {};

export const setTransport = (fn) => {
  transport = fn;
};
export const resetTransport = () => {
  transport = jsonpTransport;
};
export const setTokenProvider = (fn) => {
  tokenProvider = fn;
};
export const setAuthErrorHandler = (fn) => {
  authErrorHandler = fn;
};

let lastCall = 0;
let queue = Promise.resolve();
let minInterval = MIN_INTERVAL_MS;
export const setMinInterval = (ms) => {
  minInterval = ms;
};

function throttle() {
  const p = queue.then(async () => {
    const wait = lastCall + minInterval - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
  });
  queue = p.catch(() => {});
  return p;
}

function cleanParams(params) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  return out;
}

/**
 * Вызов метода VK API.
 * @param {string} method
 * @param {object} params
 * @param {{timeout?: number, retry?: boolean, token?: string}} options
 *   retry=false для неидемпотентных методов (wall.post) — повтор только по ошибке 6 (запрос не выполнен).
 */
export async function callApi(method, params = {}, { timeout = 20000, retry = true, token } = {}) {
  const accessToken = token ?? (await tokenProvider());
  if (!accessToken) throw new VkAuthRequiredError();
  const query = { ...cleanParams(params), access_token: accessToken, v: API_VERSION };
  for (let attempt = 0; ; attempt++) {
    await throttle();
    const data = await transport(method, query, { timeout });
    if (data && data.error) {
      const err = new VkApiError(data.error);
      // 6 — «слишком много запросов»: VK запрос не выполнил, повтор безопасен даже для wall.post
      if (err.code === 6 && attempt < 3) {
        await sleep(700 * (attempt + 1));
        continue;
      }
      if (retry && err.code === 10 && attempt < 1) {
        await sleep(1000);
        continue;
      }
      if (err.code === 5) authErrorHandler(err);
      throw err;
    }
    if (!data || !('response' in data)) throw new VkNetworkError('Некорректный ответ ВКонтакте', { uncertain: true });
    return data.response;
  }
}
