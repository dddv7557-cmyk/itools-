import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../hooks.js';
import { parseLinks } from '../js/link-parser.js';
import { loadPosts } from '../js/post-loader.js';
import { postsStore, addPosts, selectAll, clearWorkspace, removeFinished } from '../js/post-editor.js';
import { settingsStore, setAuthorLinksEnabled } from '../js/settings.js';
import { authStore, hasWallScope } from '../js/vk-auth.js';
import { buildPreview } from '../js/preview.js';
import { planPublication, publishPosts, saveAllDrafts, isPublishing } from '../js/publisher.js';
import { formatDateTime, FINAL_STATUSES } from '../js/scheduler.js';
import { routeStore, navigate } from '../js/router.js';
import { onlineStore, toast } from '../js/ui-state.js';
import { confirmDialog, askCaptcha } from '../js/dialogs.js';
import { requestPersistentStorage } from '../js/database.js';
import PostCard from '../components/PostCard.jsx';
import PreviewCard from '../components/PreviewCard.jsx';
import ScheduleSheet from '../components/ScheduleSheet.jsx';
import ManualPublishSheet from '../components/ManualPublishSheet.jsx';
import { manualQueue } from '../js/manual-publish.js';
import VirtualList from '../components/VirtualList.jsx';
import { Progress, Toggle } from '../components/Bits.jsx';
import Icon from '../components/Icon.jsx';

const LINKS_DRAFT_KEY = 'itools.linksDraft';
const readDraft = () => {
  try {
    return localStorage.getItem(LINKS_DRAFT_KEY) || '';
  } catch {
    return '';
  }
};

function LinkInput({ onLoaded }) {
  const [text, setTextValue] = useState(readDraft);
  const deferred = useDeferredValue(text);
  const parsed = useMemo(() => parseLinks(deferred), [deferred]);
  const [loading, setLoading] = useState(null); // {done,total}
  const [failed, setFailed] = useState([]);
  const [showInvalid, setShowInvalid] = useState(false);
  const online = useStore(onlineStore);
  const auth = useStore(authStore);
  const chunkSize = useStore(settingsStore, (s) => s.loadChunkSize);
  const abortRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(LINKS_DRAFT_KEY, text);
    } catch {
      /* ignore */
    }
  }, [text]);

  const load = async () => {
    const { valid } = parseLinks(text);
    if (!valid.length) {
      toast('Не найдено ни одной корректной ссылки на запись ВКонтакте', 'error');
      return;
    }
    if (!online) {
      toast('Нет интернета: загрузка публикаций недоступна. Редактирование работает офлайн.', 'error');
      return;
    }
    if (auth.status !== 'connected') {
      const ok = await confirmDialog({
        title: 'Нужен аккаунт ВКонтакте',
        body: 'Чтобы получить оригинальные публикации через официальный VK API, подключите свой аккаунт ВКонтакте. Пароль iTools не запрашивает.',
        confirmText: 'Подключить',
      });
      if (ok) navigate('/account');
      return;
    }
    const existing = postsStore.get().byId;
    const fresh = valid.filter((l) => !existing[l.key]);
    const already = valid.length - fresh.length;
    if (!fresh.length) {
      toast(`Все ${valid.length} публикаций уже загружены в рабочую область`, 'info');
      return;
    }
    requestPersistentStorage();
    const controller = new AbortController();
    abortRef.current = controller;
    setFailed([]);
    setLoading({ done: 0, total: fresh.length });
    try {
      const { loaded, failed: fails } = await loadPosts(fresh, {
        onProgress: setLoading,
        signal: controller.signal,
        chunkSize,
      });
      const { added } = await addPosts(loaded);
      setFailed(fails);
      const parts = [`Загружено: ${added.length}`];
      if (fails.length) parts.push(`с ошибкой: ${fails.length}`);
      if (already) parts.push(`уже были: ${already}`);
      toast(parts.join(' · '), fails.length ? 'error' : 'success', 5000);
      if (added.length && !fails.length) setTextValue('');
      onLoaded?.(added.length);
    } catch (e) {
      toast(e.message, 'error', 6000);
      if (e.code === 5 || e.name === 'VkAuthRequiredError') navigate('/account');
    } finally {
      setLoading(null);
      abortRef.current = null;
    }
  };

  return (
    <section className="card links-card" aria-labelledby="links-title">
      <h2 id="links-title" className="card-title">
        <Icon name="link" size={18} /> Ссылки на публикации
      </h2>
      <textarea
        className="textarea links-input"
        value={text}
        onChange={(e) => setTextValue(e.target.value)}
        placeholder={'Вставьте любое количество ссылок — через новую строку, пробел или запятую:\nhttps://vk.com/wall-123_456\nhttps://vk.com/wall123_789'}
        rows={6}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        inputMode="url"
        aria-describedby="links-stats"
        disabled={Boolean(loading)}
      />
      <div id="links-stats" className="link-stats">
        <span className="stat stat-blue">
          <b>{parsed.valid.length}</b> ссылок
        </span>
        {parsed.duplicates.length ? (
          <span className="stat">
            <b>{parsed.duplicates.length}</b> дубликатов удалено
          </span>
        ) : null}
        {parsed.invalid.length ? (
          <button className="stat stat-red" onClick={() => setShowInvalid((v) => !v)} aria-expanded={showInvalid}>
            <b>{parsed.invalid.length}</b> некорректных {showInvalid ? '▲' : '▼'}
          </button>
        ) : null}
      </div>
      {showInvalid && parsed.invalid.length ? (
        <ul className="invalid-list">
          {parsed.invalid.slice(0, 200).map((inv, i) => (
            <li key={i}>
              <code>{inv.input}</code>
              <span>{inv.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {loading ? (
        <div className="loading-box">
          <Progress value={loading.done} total={loading.total} label="Загрузка публикаций пакетами" />
          <button className="btn btn-ghost btn-sm" onClick={() => abortRef.current?.abort()}>
            Остановить
          </button>
        </div>
      ) : (
        <div className="btn-row">
          <button className="btn btn-primary grow" onClick={load} disabled={!parsed.valid.length}>
            <Icon name="download" size={18} /> Загрузить публикации
          </button>
          <button className="btn btn-ghost" onClick={() => setTextValue('')} disabled={!text}>
            Очистить
          </button>
        </div>
      )}
      {failed.length ? (
        <div className="notice notice-error">
          <Icon name="alert" size={16} />
          <div className="grow">
            <p>
              <b>Не удалось загрузить: {failed.length}</b>
            </p>
            <ul className="failed-list">
              {failed.slice(0, 100).map((f) => (
                <li key={f.link.key}>
                  <a href={f.link.url} target="_blank" rel="noopener noreferrer">
                    {f.link.url.replace('https://', '')}
                  </a>{' '}
                  — {f.error}
                </li>
              ))}
            </ul>
            <button className="btn btn-sm btn-ghost" onClick={() => setFailed([])}>
              Скрыть
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function AuthorLinksSetting() {
  const enabled = useStore(settingsStore, (s) => s.authorLinksEnabled);
  return (
    <section className="card card-compact">
      <Toggle
        id="author-links-toggle"
        checked={enabled}
        onChange={async (v) => {
          await setAuthorLinksEnabled(v);
          toast(v ? 'Ссылки авторов будут добавляться ко всем публикациям' : 'Автодобавление ссылок авторов выключено', v ? 'success' : 'info');
        }}
        label="Автоматически добавлять ссылку автора ко всем публикациям"
        description="Своя ссылка для каждой записи. Ваш текст не изменяется, ссылка не дублируется. Настройка сохраняется на устройстве."
      />
    </section>
  );
}

export default function PublisherPage() {
  const { order, byId, loaded } = useStore(postsStore);
  const settings = useStore(settingsStore);
  const auth = useStore(authStore);
  const online = useStore(onlineStore);
  const route = useStore(routeStore);
  const view = route.params.view === 'preview' ? 'preview' : 'editor';
  const [scheduleFor, setScheduleFor] = useState(null); // {id, number}
  const [publishing, setPublishing] = useState(null);
  const [manual, setManual] = useState(null); // {ids, numbers} — мастер ручной публикации

  const posts = useMemo(() => order.map((id) => byId[id]).filter(Boolean), [order, byId]);
  const preview = useMemo(() => (view === 'preview' ? buildPreview(posts, settings) : []), [view, posts, settings]);
  const selectedCount = posts.filter((p) => p.selected !== false && !FINAL_STATUSES.has(p.status)).length;
  const finishedCount = posts.filter((p) => FINAL_STATUSES.has(p.status)).length;
  const allSelected = posts.length > 0 && posts.every((p) => p.selected !== false || FINAL_STATUSES.has(p.status));

  const onSchedule = useCallback((id, number) => setScheduleFor({ id, number }), []);
  const renderPreview = useCallback((id, index) => <PreviewCard item={preview[index]} profile={auth.profile} />, [preview, auth.profile]);

  const openManual = useCallback(
    (list) => {
      const ids = manualQueue(list);
      if (!ids.length) {
        toast('Нечего публиковать: все записи уже отправлены', 'info');
        return;
      }
      const numbers = Object.fromEntries(order.map((x, i) => [x, i + 1]));
      setManual({ ids, numbers });
    },
    [order],
  );
  const onManualOne = useCallback((id) => openManual([postsStore.get().byId[id]]), [openManual]);

  const renderEditor = useCallback(
    (id, index) => <PostCard id={id} number={index + 1} onSchedule={onSchedule} onManual={onManualOne} />,
    [onSchedule, onManualOne],
  );

  const doPublish = async (kind) => {
    if (settings.publishMode !== 'api') {
      openManual(kind === 'all' ? posts : posts.filter((p) => p.selected !== false));
      return;
    }
    if (isPublishing()) return;
    if (!online) {
      toast('Нет интернета. Публикации сохранены — отправьте их, когда появится связь.', 'error', 5000);
      return;
    }
    if (auth.status !== 'connected') {
      const ok = await confirmDialog({
        title: 'Аккаунт не подключён',
        body: 'Для публикации подключите свой аккаунт ВКонтакте.',
        confirmText: 'Подключить',
      });
      if (ok) navigate('/account');
      return;
    }
    const target = kind === 'all' ? posts : posts.filter((p) => p.selected !== false);
    const plan = planPublication(target, settings);
    const sendList = [...plan.now, ...plan.scheduled, ...plan.pastDue];
    if (!sendList.length) {
      toast(kind === 'selected' ? 'Нет выбранных публикаций для отправки' : 'Нечего публиковать: все записи уже отправлены или пусты', 'info');
      return;
    }
    const body = (
      <div className="confirm-summary">
        <p>
          <Icon name="send" size={16} /> <b>Сразу:</b> {plan.now.length}
        </p>
        <p>
          <Icon name="clock" size={16} /> <b>В расписание ВКонтакте:</b> {plan.scheduled.length}
        </p>
        {plan.scheduled.length ? (
          <ul className="small muted">
            {plan.scheduled.slice(0, 6).map((p) => (
              <li key={p.id}>
                №{order.indexOf(p.id) + 1} — {formatDateTime(p.schedule.at)}
              </li>
            ))}
            {plan.scheduled.length > 6 ? <li>…и ещё {plan.scheduled.length - 6}</li> : null}
          </ul>
        ) : null}
        {plan.pastDue.length ? (
          <p className="text-warn">
            <Icon name="alert" size={16} /> Время уже прошло у {plan.pastDue.length} — они получат статус «Требуется действие», не будут
            отправлены.
          </p>
        ) : null}
        {plan.verify.length ? (
          <p className="text-warn">
            <Icon name="refresh" size={16} /> {plan.verify.length} с неподтверждённой прошлой отправкой — сначала будет проверена стена,
            чтобы не создать дубль.
          </p>
        ) : null}
        {plan.skipped.length ? (
          <p className="muted">
            Пропущено: {plan.skipped.length} ({[...new Set(plan.skipped.map((s) => s.reason))].join('; ')})
          </p>
        ) : null}
        {!hasWallScope() ? (
          <p className="text-warn small">
            <Icon name="shield" size={14} /> В токене не видно права «wall». Если ВКонтакте вернёт ошибку доступа — см. раздел «Мой аккаунт».
          </p>
        ) : null}
        <p className="muted small">Публикации появятся на вашей стене ВКонтакте от вашего имени.</p>
      </div>
    );
    const ok = await confirmDialog({ title: kind === 'all' ? 'Опубликовать все?' : 'Опубликовать выбранные?', body, confirmText: 'Опубликовать' });
    if (!ok) return;
    setPublishing({ done: 0, total: sendList.length });
    try {
      const s = await publishPosts(
        sendList.map((p) => p.id),
        { onProgress: setPublishing, onCaptcha: askCaptcha },
      );
      const parts = [];
      if (s.published) parts.push(`опубликовано: ${s.published}`);
      if (s.scheduled) parts.push(`в расписании: ${s.scheduled}`);
      if (s.action) parts.push(`требуют действия: ${s.action}`);
      if (s.failed) parts.push(`ошибок: ${s.failed}`);
      toast(parts.join(' · ') || 'Готово', s.failed || s.action ? 'error' : 'success', 6000);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setPublishing(null);
    }
  };

  const onSaveDrafts = async () => {
    const n = await saveAllDrafts();
    toast(n ? `Черновики сохранены: ${n}` : 'Нет черновиков для сохранения', 'success');
  };

  const onClearAll = async () => {
    const ok = await confirmDialog({
      title: 'Очистить рабочую область?',
      body: `Все ${posts.length} публикаций будут удалены с этого устройства. История операций сохранится. Во ВКонтакте ничего не удаляется.`,
      confirmText: 'Очистить',
      danger: true,
    });
    if (ok) {
      await clearWorkspace();
      toast('Рабочая область очищена');
    }
  };

  if (!loaded) return <div className="page-loading"><span className="spinner" /></div>;

  return (
    <div className={`page publisher ${posts.length ? 'has-actionbar' : ''}`}>
      {view === 'editor' ? (
        <>
          <AuthorLinksSetting />
          <LinkInput />
          {posts.length ? (
            <div className="workspace-bar">
              <label className="select-all">
                <input type="checkbox" checked={allSelected} onChange={(e) => selectAll(e.target.checked)} />
                <span>
                  Публикации: <b>{posts.length}</b>
                </span>
              </label>
              <div className="workspace-actions">
                {finishedCount ? (
                  <button className="btn btn-ghost btn-sm" onClick={async () => toast(`Убрано отправленных: ${await removeFinished()}`)}>
                    Убрать отправленные
                  </button>
                ) : null}
                <button className="btn btn-ghost btn-sm text-danger" onClick={onClearAll}>
                  <Icon name="trash" size={16} /> Очистить
                </button>
              </div>
            </div>
          ) : (
            <div className="empty">
              <Icon name="layers" size={40} stroke={1.5} />
              <p>Вставьте ссылки и нажмите «Загрузить публикации» — для каждой появится отдельный редактор с оригинальным текстом.</p>
            </div>
          )}
          {posts.length ? <VirtualList ids={order} renderItem={renderEditor} estimateSize={560} /> : null}
        </>
      ) : (
        <>
          <div className="preview-head">
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/publisher')}>
              <Icon name="back" size={16} /> Вернуться к редакторам
            </button>
            <span className="muted small">
              Карточек: <b>{preview.length}</b>
            </span>
          </div>
          {preview.length ? (
            <VirtualList ids={order} renderItem={renderPreview} estimateSize={420} />
          ) : (
            <div className="empty">
              <p>Нет публикаций для предпросмотра.</p>
            </div>
          )}
        </>
      )}

      {posts.length ? (
        <div className="action-bar" role="region" aria-label="Действия с публикациями">
          {publishing ? (
            <Progress value={publishing.done} total={publishing.total} label="Отправка во ВКонтакте" />
          ) : (
            <>
              {view === 'editor' ? (
                <button className="btn btn-outline btn-block" onClick={() => navigate('/publisher', { view: 'preview' })}>
                  <Icon name="eye" size={18} /> Предпросмотр всех публикаций
                </button>
              ) : (
                <button className="btn btn-outline btn-block" onClick={() => navigate('/publisher')}>
                  <Icon name="back" size={18} /> Вернуться к редакторам
                </button>
              )}
              <div className="action-grid">
                <button className="btn btn-primary" onClick={() => doPublish('all')}>
                  <Icon name="send" size={16} /> Опубликовать все
                </button>
                <button className="btn btn-soft" onClick={() => doPublish('selected')} disabled={!selectedCount}>
                  Опубликовать выбранные ({selectedCount})
                </button>
                <button className="btn btn-soft" onClick={onSaveDrafts}>
                  <Icon name="save" size={16} /> Сохранить все черновики
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {manual ? <ManualPublishSheet ids={manual.ids} numbers={manual.numbers} onClose={() => setManual(null)} /> : null}

      {scheduleFor && byId[scheduleFor.id] ? (
        <ScheduleSheet post={byId[scheduleFor.id]} number={scheduleFor.number} onClose={() => setScheduleFor(null)} />
      ) : null}
    </div>
  );
}
