import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../hooks.js';
import { routeStore, navigate } from '../js/router.js';
import { authStore } from '../js/vk-auth.js';
import { onlineStore, toast } from '../js/ui-state.js';
import { confirmDialog } from '../js/dialogs.js';
import {
  sourcesStore,
  LISTS,
  addSourcesFromText,
  searchGroups,
  saveSources,
  updateSource,
  setAllSelected,
  removeSource,
  clearSources,
} from '../js/sources.js';
import { scanSources, rankProducts, SORTS, saveResults, loadResults, productToPublisherRecord } from '../js/top-products.js';
import { addPosts } from '../js/post-editor.js';
import { formatDateTime } from '../js/scheduler.js';
import ProductCard from '../components/ProductCard.jsx';
import VirtualList from '../components/VirtualList.jsx';
import { Avatar, Progress, Toggle } from '../components/Bits.jsx';
import Icon from '../components/Icon.jsx';

const PREFS_KEY = 'itools.topPrefs';
const QUICK_QUERIES = ['Садовод', 'Садовод рынок', 'Садовод опт', 'Садовод одежда', 'Садовод обувь', 'Садовод детская одежда'];
const PERIODS = [
  [7, '7 дней'],
  [30, '30 дней'],
  [90, '3 месяца'],
  [365, 'Год'],
];
const DEPTHS = [100, 300, 500];

function readPrefs() {
  try {
    return { periodDays: 30, maxPerSource: 100, onlyPhotos: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { periodDays: 30, maxPerSource: 100, onlyPhotos: true };
  }
}

function useNeedAccount() {
  const auth = useStore(authStore);
  const online = useStore(onlineStore);
  return async () => {
    if (!online) {
      toast('Нужен интернет', 'error');
      return true;
    }
    if (auth.status !== 'connected') {
      if (
        await confirmDialog({
          title: 'Нужен аккаунт ВКонтакте',
          body: 'Поиск и чтение стен идут через официальный VK API от вашего имени. Подключите аккаунт — право wall для этого не нужно.',
          confirmText: 'Подключить',
        })
      )
        navigate('/account');
      return true;
    }
    return false;
  };
}

/** Инструмент 1: поиск сообществ и продавцов Садовода во ВКонтакте. */
function SadovodSearch() {
  const [query, setQuery] = useState('Садовод');
  const [found, setFound] = useState(null);
  const [picked, setPicked] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const needAccount = useNeedAccount();
  const existing = useStore(sourcesStore, (s) => s.items);
  const existingIds = useMemo(() => new Set(existing.filter((s) => s.list === LISTS.SADOVOD).map((s) => s.id)), [existing]);

  const run = async (q = query) => {
    if (await needAccount()) return;
    setBusy(true);
    try {
      const groups = await searchGroups(q.trim());
      setFound(groups);
      setPicked(new Set(groups.filter((g) => !existingIds.has(g.id)).slice(0, 20).map((g) => g.id)));
      if (!groups.length) toast('Открытых сообществ не найдено', 'info');
    } catch (e) {
      toast(e.message, 'error', 6000);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const chosen = found.filter((g) => picked.has(g.id));
    const { added, existing: dup } = await saveSources(chosen, LISTS.SADOVOD);
    toast(`Добавлено источников: ${added.length}${dup ? `, уже были: ${dup}` : ''}`, 'success');
    setFound(null);
  };

  return (
    <section className="card">
      <h2 className="card-title">
        <Icon name="search" size={18} /> Найти сообщества и продавцов Садовода
      </h2>
      <div className="input-row">
        <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="Например: Садовод платья" />
        <button className="btn btn-primary" onClick={() => run()} disabled={busy || !query.trim()}>
          {busy ? <span className="spinner spinner-xs" /> : 'Найти'}
        </button>
      </div>
      <div className="chips mt">
        {QUICK_QUERIES.map((q) => (
          <button
            key={q}
            className="chip chip-btn"
            onClick={() => {
              setQuery(q);
              run(q);
            }}
          >
            {q}
          </button>
        ))}
      </div>
      {found ? (
        <div className="found-box">
          <div className="workspace-bar">
            <span className="small">
              Найдено открытых: <b>{found.length}</b> · выбрано <b>{picked.size}</b>
            </span>
            <div className="workspace-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set(found.slice(0, 20).map((g) => g.id)))}>
                Топ-20
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>
                Снять
              </button>
            </div>
          </div>
          <ul className="source-list scroll-box">
            {found.map((g) => (
              <li key={g.id}>
                <label className="source-row">
                  <input
                    type="checkbox"
                    checked={picked.has(g.id)}
                    onChange={(e) =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(g.id);
                        else n.delete(g.id);
                        return n;
                      })
                    }
                  />
                  <Avatar src={g.photo} name={g.name} size={32} />
                  <span className="source-meta">
                    <b className="ellipsis">{g.name}</b>
                    <span className="muted small">
                      {g.members != null ? `${g.members.toLocaleString('ru-RU')} подписчиков` : ''}
                      {existingIds.has(g.id) ? ' · уже в источниках' : ''}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <button className="btn btn-primary btn-block mt" onClick={save} disabled={!picked.size}>
            <Icon name="plus" size={18} /> Добавить в источники ({picked.size})
          </button>
        </div>
      ) : null}
    </section>
  );
}


/** Инструмент 2: добавление аккаунтов и сообществ по ссылкам. */
function AccountsAdd() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState([]);
  const needAccount = useNeedAccount();
  const add = async () => {
    if (await needAccount()) return;
    setBusy(true);
    try {
      const r = await addSourcesFromText(text, LISTS.ACCOUNTS);
      setFailed(r.failed);
      toast(`Добавлено: ${r.added.length}${r.existing ? `, уже были: ${r.existing}` : ''}${r.failed.length ? `, не найдено: ${r.failed.length}` : ''}`, r.failed.length ? 'error' : 'success');
      if (!r.failed.length) setText('');
    } catch (e) {
      toast(e.message, 'error', 6000);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <h2 className="card-title">
        <Icon name="user" size={18} /> Добавить аккаунты
      </h2>
      <textarea
        className="textarea"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'Ссылки на людей или сообщества ВКонтакте — через новую строку, пробел или запятую:\nhttps://vk.com/durov\nvk.com/club1, id123, @shop_name'}
        autoCapitalize="off"
        spellCheck={false}
      />
      <button className="btn btn-primary btn-block mt" onClick={add} disabled={busy || !text.trim()}>
        {busy ? <span className="spinner spinner-xs" /> : <Icon name="plus" size={18} />} Добавить
      </button>
      {failed.length ? (
        <ul className="invalid-list mt">
          {failed.map((f, i) => (
            <li key={i}>
              <code>{f.input}</code>
              <span>{f.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SourceList({ list }) {
  const all = useStore(sourcesStore, (s) => s.items);
  const items = useMemo(() => all.filter((s) => s.list === list), [all, list]);
  const selected = items.filter((s) => s.selected).length;
  if (!items.length) return null;
  return (
    <section className="card">
      <div className="workspace-bar">
        <label className="select-all">
          <input type="checkbox" checked={selected === items.length} onChange={(e) => setAllSelected(list, e.target.checked)} />
          <span>
            Источники: <b>{items.length}</b> · выбрано {selected}
          </span>
        </label>
        <button
          className="btn btn-ghost btn-sm text-danger"
          onClick={async () => {
            if (await confirmDialog({ title: 'Удалить все источники?', body: 'Список будет очищен на этом устройстве.', confirmText: 'Удалить', danger: true })) clearSources(list);
          }}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
      <ul className="source-list scroll-box">
        {items.map((s) => (
          <li key={s.id} className="source-row">
            <input type="checkbox" checked={s.selected} onChange={(e) => updateSource(s.id, { selected: e.target.checked })} aria-label={`Выбрать ${s.name}`} />
            <Avatar src={s.photo} name={s.name} size={32} />
            <a className="source-meta" href={s.url} target="_blank" rel="noopener noreferrer">
              <b className="ellipsis">{s.name}</b>
              <span className="muted small">
                {s.type === 'group' ? 'Сообщество' : 'Пользователь'}
                {s.members != null ? ` · ${s.members.toLocaleString('ru-RU')}` : ''}
                {s.closed ? ' · закрыто' : ''}
              </span>
            </a>
            <button className="icon-btn icon-btn-sm" onClick={() => removeSource(s.id)} aria-label={`Удалить ${s.name}`}>
              <Icon name="x" size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function TopPage() {
  const route = useStore(routeStore);
  const list = route.params.tab === LISTS.ACCOUNTS ? LISTS.ACCOUNTS : LISTS.SADOVOD;
  const allSources = useStore(sourcesStore, (s) => s.items);
  const sources = useMemo(() => allSources.filter((s) => s.list === list && s.selected), [allSources, list]);
  const [prefs, setPrefs] = useState(readPrefs);
  const [result, setResult] = useState(null);
  const [scan, setScan] = useState(null);
  const [sortKey, setSortKey] = useState('score');
  const [picked, setPicked] = useState(new Set());
  const abortRef = useRef(null);
  const needAccount = useNeedAccount();

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);

  useEffect(() => {
    let alive = true;
    setResult(null);
    setPicked(new Set());
    loadResults(list).then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [list]);

  const ranked = useMemo(() => (result ? rankProducts(result.products, sortKey).slice(0, 200) : []), [result, sortKey]);
  const byKey = useMemo(() => new Map(ranked.map((p) => [p.key, p])), [ranked]);
  const ids = useMemo(() => ranked.map((p) => p.key), [ranked]);

  const toggle = useCallback(
    (key) =>
      setPicked((s) => {
        const n = new Set(s);
        if (n.has(key)) n.delete(key);
        else n.add(key);
        return n;
      }),
    [],
  );
  const renderItem = useCallback(
    (key, index) => <ProductCard product={byKey.get(key)} rank={index + 1} selected={picked.has(key)} onToggle={toggle} sortKey={sortKey} />,
    [byKey, picked, toggle, sortKey],
  );

  const runScan = async () => {
    if (await needAccount()) return;
    if (!sources.length) {
      toast('Выберите хотя бы один источник', 'info');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setScan({ done: 0, total: sources.length });
    try {
      const r = await scanSources(sources, { ...prefs, onProgress: setScan, signal: controller.signal });
      const data = { ...r, sourcesCount: sources.length, periodDays: prefs.periodDays };
      await saveResults(list, data);
      setResult(await loadResults(list));
      setPicked(new Set());
      toast(`Найдено товаров: ${r.products.length} из ${r.scannedPosts} записей${r.errors.length ? ` · недоступно источников: ${r.errors.length}` : ''}`, r.products.length ? 'success' : 'info', 5000);
    } catch (e) {
      toast(e.message, 'error', 6000);
    } finally {
      setScan(null);
      abortRef.current = null;
    }
  };

  const toPublisher = async () => {
    const chosen = ranked.filter((p) => picked.has(p.key));
    const { added, skipped } = await addPosts(chosen.map(productToPublisherRecord));
    toast(`В VK Publisher добавлено: ${added.length}${skipped.length ? `, уже были: ${skipped.length}` : ''}`, 'success');
    setPicked(new Set());
    navigate('/publisher');
  };

  return (
    <div className={`page top ${picked.size ? 'has-actionbar-sm' : ''}`}>
      <div className="segmented tabs" role="tablist">
        <button role="tab" aria-selected={list === LISTS.SADOVOD} className={list === LISTS.SADOVOD ? 'active' : ''} onClick={() => navigate('/top', { tab: LISTS.SADOVOD })}>
          Садовод
        </button>
        <button role="tab" aria-selected={list === LISTS.ACCOUNTS} className={list === LISTS.ACCOUNTS ? 'active' : ''} onClick={() => navigate('/top', { tab: LISTS.ACCOUNTS })}>
          Мои аккаунты
        </button>
      </div>

      {list === LISTS.SADOVOD ? (
        <SadovodSearch />
      ) : (
        <AccountsAdd />
      )}

      <SourceList list={list} />

      <section className="card">
        <h2 className="card-title">
          <Icon name="layers" size={18} /> Найти топ товаров
        </h2>
        <div className="field">
          <span>Период</span>
          <div className="segmented seg-4">
            {PERIODS.map(([d, label]) => (
              <button key={d} className={prefs.periodDays === d ? 'active' : ''} onClick={() => setPrefs((p) => ({ ...p, periodDays: d }))}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="field mt">
          <span>Записей на источник (глубина)</span>
          <div className="segmented seg-3">
            {DEPTHS.map((d) => (
              <button key={d} className={prefs.maxPerSource === d ? 'active' : ''} onClick={() => setPrefs((p) => ({ ...p, maxPerSource: d }))}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="mt">
          <Toggle id="only-photos" checked={prefs.onlyPhotos} onChange={(v) => setPrefs((p) => ({ ...p, onlyPhotos: v }))} label="Только записи с фото (товары)" />
        </div>
        {scan ? (
          <div className="loading-box mt">
            <Progress value={scan.done} total={scan.total} label={scan.source ? `Сканирую: ${scan.source}` : 'Сканирование'} />
            <button className="btn btn-ghost btn-sm" onClick={() => abortRef.current?.abort()}>
              Остановить
            </button>
          </div>
        ) : (
          <button className="btn btn-primary btn-block btn-lg mt" onClick={runScan} disabled={!sources.length}>
            <Icon name="search" size={18} /> Найти топ ({sources.length} источн.)
          </button>
        )}
        <p className="muted small mt">Балл = (лайки + 3×репосты + 2×комментарии + просмотры/50) × свежесть. Одинаковые репосты считаются один раз.</p>
      </section>

      {result ? (
        <>
          <div className="results-head">
            <span className="small">
              Товаров: <b>{result.products.length}</b> · {result.sourcesCount} источн. · {formatDateTime(result.savedAt)}
            </span>
            {result.errors?.length ? (
              <details className="small">
                <summary className="text-warn">Недоступно: {result.errors.length}</summary>
                <ul className="failed-list">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      {e.source.name} — {e.error}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
          <div className="filter-chips" role="tablist" aria-label="Сортировка">
            {Object.entries(SORTS).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={sortKey === k} className={`chip chip-btn ${sortKey === k ? 'active' : ''}`} onClick={() => setSortKey(k)}>
                {label}
              </button>
            ))}
          </div>
          {ranked.length ? (
            <VirtualList ids={ids} renderItem={renderItem} estimateSize={180} gap={10} />
          ) : (
            <div className="empty">
              <p>За выбранный период записей-товаров не найдено. Увеличьте период или глубину.</p>
            </div>
          )}
        </>
      ) : null}

      {picked.size ? (
        <div className="action-bar">
          <div className="btn-row">
            <button className="btn btn-ghost" onClick={() => setPicked(new Set())}>
              Снять ({picked.size})
            </button>
            <button className="btn btn-primary grow" onClick={toPublisher}>
              <Icon name="send" size={16} /> В VK Publisher ({picked.size})
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
