import { useEffect, useRef, useState, version as reactVersion } from 'react';
import { useStore } from '../hooks.js';
import { settingsStore, updateSettings, setAuthorLinksEnabled } from '../js/settings.js';
import { authStore } from '../js/vk-auth.js';
import { downloadBackup, importBackupFile } from '../js/backup.js';
import { storageEstimate, requestPersistentStorage, idb } from '../js/database.js';
import { authorLinkLine, DEFAULT_TEMPLATE } from '../js/author-links.js';
import { initPosts } from '../js/post-editor.js';
import { loadHistory } from '../js/history.js';
import { navigate } from '../js/router.js';
import { toast } from '../js/ui-state.js';
import { confirmDialog } from '../js/dialogs.js';
import { Toggle, Avatar } from '../components/Bits.jsx';
import Icon from '../components/Icon.jsx';

const fmtBytes = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} ГБ` : b > 1e6 ? `${(b / 1e6).toFixed(1)} МБ` : `${Math.round(b / 1e3)} КБ`);

export default function SettingsPage() {
  const s = useStore(settingsStore);
  const auth = useStore(authStore);
  const [appId, setAppId] = useState(s.vkAppId);
  const [template, setTemplate] = useState(s.authorLinkTemplate);
  const [estimate, setEstimate] = useState(null);
  const fileRef = useRef(null);
  const [importMode, setImportMode] = useState('merge');

  useEffect(() => setAppId(s.vkAppId), [s.vkAppId]);
  useEffect(() => setTemplate(s.authorLinkTemplate), [s.authorLinkTemplate]);
  useEffect(() => {
    storageEstimate().then(setEstimate);
  }, []);

  const saveAppId = async () => {
    const v = appId.trim();
    if (v && !/^\d+$/.test(v)) {
      toast('ID приложения — это число из кабинета VK ID', 'error');
      return;
    }
    await updateSettings({ vkAppId: v });
    toast('ID приложения сохранён', 'success');
  };
  const saveTemplate = async () => {
    const v = template.trim() || DEFAULT_TEMPLATE;
    if (!v.includes('{url}')) {
      toast('Шаблон должен содержать {url}', 'error');
      return;
    }
    await updateSettings({ authorLinkTemplate: v });
    toast('Формат ссылки автора сохранён', 'success');
  };

  const onImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (importMode === 'replace') {
      const ok = await confirmDialog({
        title: 'Заменить данные?',
        body: 'Текущие публикации и история на устройстве будут заменены содержимым копии.',
        confirmText: 'Заменить',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const r = await importBackupFile(file, importMode);
      toast(`Импортировано: публикаций ${r.posts}, записей истории ${r.history}${r.skipped ? `, пропущено (уже есть): ${r.skipped}` : ''}`, 'success', 6000);
    } catch (err) {
      toast(err.message, 'error', 6000);
    }
  };

  const wipe = async () => {
    const ok = await confirmDialog({
      title: 'Удалить все данные?',
      body: 'Будут удалены публикации, история и настройки на этом устройстве. Аккаунт ВКонтакте тоже будет отключён. Действие нельзя отменить — сначала сделайте резервную копию.',
      confirmText: 'Удалить всё',
      danger: true,
    });
    if (!ok) return;
    await Promise.all([idb.clear('posts'), idb.clear('history'), idb.clear('kv'), idb.clear('sources')]);
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    await Promise.all([initPosts(), loadHistory()]);
    location.reload();
  };

  return (
    <div className="page settings">
      <h1 className="page-title">Настройки</h1>

      <button className="card settings-account" onClick={() => navigate('/account')}>
        <Avatar src={auth.profile?.photo} name={auth.profile?.name || '?'} size={44} />
        <div className="grow left">
          <b>Мой аккаунт ВКонтакте</b>
          <span className="muted small">{auth.status === 'connected' ? auth.profile?.name || 'Подключён' : 'Не подключён'}</span>
        </div>
        <Icon name="external" size={18} />
      </button>

      <section className="card">
        <h2 className="card-title">Способ публикации</h2>
        <fieldset className="radio-group" style={{ marginTop: 0 }}>
          <legend className="sr-only">Способ публикации</legend>
          <label>
            <input type="radio" name="publishMode" checked={s.publishMode !== 'api'} onChange={() => updateSettings({ publishMode: 'manual' })} />
            <span>
              <b>Через ВКонтакте вручную</b> — без права wall. iTools готовит текст и фото, вы публикуете в приложении или на сайте ВК
              одним-двумя нажатиями.
            </span>
          </label>
          <label>
            <input type="radio" name="publishMode" checked={s.publishMode === 'api'} onChange={() => updateSettings({ publishMode: 'api' })} />
            <span>
              <b>Автоматически через VK API</b> — нужно право wall (выдаётся VK по запросу в поддержку).
            </span>
          </label>
        </fieldset>
      </section>

      <section className="card">
        <h2 className="card-title">Приложение ВКонтакте</h2>
        <label className="field">
          <span>ID приложения (client_id из кабинета VK ID)</span>
          <div className="input-row">
            <input className="input" inputMode="numeric" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="Например, 54000000" />
            <button className="btn btn-primary" onClick={saveAppId} disabled={appId === s.vkAppId}>
              Сохранить
            </button>
          </div>
        </label>
        <fieldset className="radio-group">
          <legend>Способ входа</legend>
          <label>
            <input type="radio" name="authMode" checked={s.authMode === 'vkid'} onChange={() => updateSettings({ authMode: 'vkid' })} />
            <span>
              <b>VK ID</b> — рекомендуется (OAuth 2.1 + PKCE, публичное приложение)
            </span>
          </label>
          <label>
            <input type="radio" name="authMode" checked={s.authMode === 'classic'} onChange={() => updateSettings({ authMode: 'classic' })} />
            <span>
              <b>Классический OAuth</b> — для старых Standalone-приложений, если VK ещё поддерживает для них этот вход
            </span>
          </label>
        </fieldset>
        <div className="mt">
          <Toggle
            id="extended-scopes"
            checked={s.requestExtendedScopes}
            onChange={(v) => updateSettings({ requestExtendedScopes: v })}
            label="Запрашивать расширенные доступы (wall, photos, video)"
            description="Нужны только для публикации. Включайте, если VK уже выдал их вашему приложению, затем подключите аккаунт заново. Для загрузки записей и «Топ товаров» не нужны."
          />
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Ссылки авторов</h2>
        <Toggle
          id="settings-author-toggle"
          checked={s.authorLinksEnabled}
          onChange={(v) => setAuthorLinksEnabled(v)}
          label="Автоматически добавлять ссылку автора ко всем публикациям"
          description="Та же настройка, что и вверху VK Publisher."
        />
        <label className="field mt">
          <span>
            Формат строки (<code>{'{url}'}</code> — ссылка, <code>{'{name}'}</code> — имя автора)
          </span>
          <div className="input-row">
            <input className="input" value={template} onChange={(e) => setTemplate(e.target.value)} />
            <button className="btn btn-primary" onClick={saveTemplate} disabled={template === s.authorLinkTemplate}>
              Сохранить
            </button>
          </div>
        </label>
        <p className="muted small">Пример: {authorLinkLine({ authorUrl: 'https://vk.com/example', authorName: 'Имя Автора' }, template)}</p>
      </section>

      <section className="card">
        <h2 className="card-title">Резервная копия</h2>
        <p className="muted small">JSON-файл с публикациями, временем, историей и настройками. Токены ВКонтакте в копию не попадают.</p>
        <div className="btn-col">
          <button
            className="btn btn-outline btn-block"
            onClick={async () => {
              const r = await downloadBackup();
              toast(`Копия создана: публикаций ${r.posts}, истории ${r.history}`, 'success');
            }}
          >
            <Icon name="download" size={18} /> Экспорт резервной копии
          </button>
          <div className="segmented" role="radiogroup" aria-label="Режим импорта">
            <button role="radio" aria-checked={importMode === 'merge'} className={importMode === 'merge' ? 'active' : ''} onClick={() => setImportMode('merge')}>
              Объединить
            </button>
            <button role="radio" aria-checked={importMode === 'replace'} className={importMode === 'replace' ? 'active' : ''} onClick={() => setImportMode('replace')}>
              Заменить
            </button>
          </div>
          <button className="btn btn-soft btn-block" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={18} /> Импорт резервной копии
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImport} />
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Хранилище</h2>
        {estimate ? (
          <p className="small">
            Занято {fmtBytes(estimate.usage)} из доступных {fmtBytes(estimate.quota)}.{' '}
            {estimate.persisted ? (
              <span className="text-success">Постоянное хранилище включено — браузер не удалит данные.</span>
            ) : (
              <span className="text-warn">Браузер может очистить данные при нехватке места.</span>
            )}
          </p>
        ) : (
          <p className="muted small">Информация о хранилище недоступна.</p>
        )}
        {!estimate?.persisted ? (
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              const ok = await requestPersistentStorage();
              toast(ok ? 'Постоянное хранилище включено' : 'Браузер пока не разрешил — установите iTools на главный экран', ok ? 'success' : 'info');
              setEstimate(await storageEstimate());
            }}
          >
            Защитить данные от очистки
          </button>
        ) : null}
        <button className="btn btn-danger-ghost btn-block mt" onClick={wipe}>
          <Icon name="trash" size={18} /> Удалить все данные на устройстве
        </button>
      </section>

      <p className="muted small center">iTools 1.0 · React {reactVersion} · Local-first PWA</p>
    </div>
  );
}
