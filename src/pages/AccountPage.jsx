import { useState } from 'react';
import { useStore } from '../hooks.js';
import { authStore, startLogin, checkConnection, logout, hasWallScope, redirectUri } from '../js/vk-auth.js';
import { settingsStore } from '../js/settings.js';
import { onlineStore, toast } from '../js/ui-state.js';
import { confirmDialog } from '../js/dialogs.js';
import { navigate } from '../js/router.js';
import { formatDateTime } from '../js/scheduler.js';
import { Avatar } from '../components/Bits.jsx';
import Icon from '../components/Icon.jsx';

export default function AccountPage() {
  const auth = useStore(authStore);
  const appId = useStore(settingsStore, (s) => s.vkAppId);
  const mode = useStore(settingsStore, (s) => s.authMode);
  const online = useStore(onlineStore);
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      await startLogin();
    } catch (e) {
      toast(e.message, 'error', 6000);
      setBusy(false);
    }
  };
  const check = async () => {
    try {
      const p = await checkConnection();
      if (p) toast(`Подключение работает: ${p.name}`, 'success');
    } catch (e) {
      toast(`Проверка не пройдена: ${e.message}`, 'error', 6000);
    }
  };
  const disconnect = async () => {
    if (await confirmDialog({ title: 'Отключить аккаунт?', body: 'Токен будет удалён с устройства. Черновики и история останутся.', confirmText: 'Отключить', danger: true })) {
      await logout();
      toast('Аккаунт отключён');
    }
  };

  const connected = auth.status === 'connected';
  const wall = hasWallScope();

  return (
    <div className="page account">
      <h1 className="page-title">Мой аккаунт ВКонтакте</h1>

      <section className="card profile-card">
        {connected || auth.status === 'expired' ? (
          <>
            <Avatar src={auth.profile?.photo} name={auth.profile?.name} size={72} />
            <h2>{auth.profile?.name || `ID ${auth.session?.userId}`}</h2>
            {auth.profile?.url ? (
              <a href={auth.profile.url} target="_blank" rel="noopener noreferrer" className="muted small">
                {auth.profile.url.replace('https://', '')}
              </a>
            ) : null}
            <span className={`pill ${connected ? 'pill-green' : 'pill-amber'}`}>{connected ? 'Подключён' : 'Требуется повторный вход'}</span>
            <dl className="kv">
              <dt>Способ входа</dt>
              <dd>{auth.session?.mode === 'classic' ? 'OAuth ВКонтакте (Standalone)' : 'VK ID (OAuth 2.1 + PKCE)'}</dd>
              <dt>Права токена</dt>
              <dd>{auth.session?.scope || '—'}</dd>
              <dt>Публикация на стене</dt>
              <dd className={wall ? 'text-success' : 'text-warn'}>{wall ? 'разрешена (wall)' : 'право wall не выдано'}</dd>
              {auth.lastCheck ? (
                <>
                  <dt>Последняя проверка</dt>
                  <dd>{formatDateTime(auth.lastCheck)}</dd>
                </>
              ) : null}
            </dl>
            {auth.error ? <p className="notice notice-warn small">{auth.error}</p> : null}
            <div className="btn-col">
              <button className="btn btn-outline btn-block" onClick={check} disabled={!online || auth.checking}>
                {auth.checking ? <span className="spinner spinner-xs" /> : <Icon name="refresh" size={18} />} Проверить подключение
              </button>
              <button className="btn btn-soft btn-block" onClick={connect} disabled={!online || busy}>
                <Icon name="user" size={18} /> Подключить заново
              </button>
              <button className="btn btn-danger-ghost btn-block" onClick={disconnect}>
                <Icon name="logout" size={18} /> Отключить аккаунт
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="avatar avatar-fallback" style={{ width: 72, height: 72 }}>
              <Icon name="user" size={32} />
            </span>
            <h2>Аккаунт не подключён</h2>
            <p className="muted center">Вход через официальный {mode === 'classic' ? 'OAuth ВКонтакте' : 'VK ID'}. iTools не запрашивает и не видит ваш пароль.</p>
            {auth.error ? <p className="notice notice-error small">{auth.error}</p> : null}
            {!appId ? (
              <div className="notice notice-warn">
                <Icon name="alert" size={16} />
                <div>
                  <p>Сначала укажите ID приложения ВКонтакте в настройках (бесплатная регистрация — см. README).</p>
                  <button className="btn btn-sm btn-ghost" onClick={() => navigate('/settings')}>
                    Открыть настройки
                  </button>
                </div>
              </div>
            ) : null}
            <button className="btn btn-primary btn-block btn-lg" onClick={connect} disabled={!online || !appId || busy}>
              {busy ? <span className="spinner spinner-xs" /> : <Icon name="user" size={18} />} Подключить ВКонтакте
            </button>
            {!online ? <p className="muted small">Для входа нужен интернет.</p> : null}
          </>
        )}
      </section>

      <section className="card help-card">
        <h3>
          <Icon name="shield" size={18} /> Что нужно знать
        </h3>
        <ul>
          <li>Токен хранится только на этом устройстве в зашифрованном виде (AES-GCM, IndexedDB) — не в LocalStorage.</li>
          <li>Секретные ключи приложения в iTools не используются: VK ID работает как публичное приложение с PKCE.</li>
          <li>
            Для чтения записей и публикации нужны права <b>wall</b> (и <b>photos</b>, <b>video</b> — для вложений). В VK ID это «расширенные
            доступы»: их нужно включить в кабинете приложения, а некоторые выдаются только по запросу в поддержку VK (devsupport@corp.vk.com).
          </li>
          <li>
            Адрес возврата (Доверенный redirect URL), который нужно указать в настройках приложения VK: <code>{redirectUri()}</code>
          </li>
        </ul>
      </section>
    </div>
  );
}
