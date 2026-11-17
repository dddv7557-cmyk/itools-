import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../hooks.js';
import { postsStore } from '../js/post-editor.js';
import { settingsStore } from '../js/settings.js';
import { formatDateTime } from '../js/scheduler.js';
import {
  shareText,
  photoUrls,
  otherAttachmentLinks,
  fetchPhotoFiles,
  canShare,
  canShareFiles,
  isMobile,
  copyText,
  shareToVk,
  downloadPhotos,
  copyAndOpenVk,
  markManual,
} from '../js/manual-publish.js';
import { toast } from '../js/ui-state.js';
import { Sheet } from './Overlays.jsx';
import Icon from './Icon.jsx';

/**
 * Мастер ручной публикации: по одной записи — подготовить в ВКонтакте, затем отметить результат.
 * @param {{ids: string[], numbers: Record<string, number>, onClose: Function}} props
 */
export default function ManualPublishSheet({ ids, numbers, onClose }) {
  const byId = useStore(postsStore, (s) => s.byId);
  const settings = useStore(settingsStore);
  const [index, setIndex] = useState(0);
  const [prepared, setPrepared] = useState(null); // {files, failed} | null (загрузка)
  const [url, setUrl] = useState('');
  const [done, setDone] = useState({ published: 0, scheduled: 0, skipped: 0 });
  const mobile = isMobile();

  const id = ids[index];
  const post = byId[id];
  const number = numbers[id] ?? index + 1;
  const text = useMemo(() => (post ? shareText(post, settings) : ''), [post, settings]);
  const photos = post ? photoUrls(post) : [];
  const extra = post ? otherAttachmentLinks(post) : [];
  const scheduledAt = post?.schedule?.at || null;
  const pastDue = scheduledAt && scheduledAt < Date.now() + 60 * 1000;
  const finished = index >= ids.length;

  // Фото скачиваются заранее: окно «Поделиться» должно открыться сразу по нажатию (требование браузера).
  useEffect(() => {
    if (!post) return undefined;
    let alive = true;
    setPrepared(null);
    setUrl('');
    if (!photoUrls(post).length) {
      setPrepared({ files: [], failed: [] });
      return undefined;
    }
    fetchPhotoFiles(post).then((r) => alive && setPrepared(r));
    return () => {
      alive = false;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = (kind) => {
    setDone((d) => ({ ...d, [kind]: d[kind] + 1 }));
    setIndex((i) => i + 1);
  };

  const onShare = async () => {
    try {
      const r = await shareToVk(post, prepared);
      if (r.cancelled) return;
      if (r.withPhotos) toast('Выберите ВКонтакте → «На стену». Если текста нет — вставьте его: он скопирован', 'info', 6000);
      else toast('Текст отправлен. Фото этим способом не передаются — скачайте их кнопкой ниже', 'info', 6000);
    } catch (e) {
      toast(`Не удалось открыть «Поделиться»: ${e.message}`, 'error');
    }
  };
  const onCopyOpen = async () => {
    const r = await copyAndOpenVk(post);
    toast(r.copied ? 'Текст скопирован. В ВК: «Что у вас нового?» → Ctrl+V' : 'Не удалось скопировать — выделите текст вручную', r.copied ? 'success' : 'error', 5000);
  };
  const onDownload = async () => {
    const r = await downloadPhotos(post, prepared);
    toast(`Скачано фото: ${r.downloaded}${r.failed.length ? `, не удалось: ${r.failed.length}` : ''}`, r.failed.length ? 'error' : 'success');
  };
  const onMark = async (kind) => {
    await markManual(id, kind, url);
    toast(kind === 'scheduled' ? `№${number}: отмечена как отложенная во ВКонтакте` : `№${number}: отмечена как опубликованная`, 'success');
    next(kind);
  };

  if (finished) {
    return (
      <Sheet
        title="Готово"
        onClose={onClose}
        footer={
          <button className="btn btn-primary btn-block" onClick={onClose}>
            Закрыть
          </button>
        }
      >
        <div className="confirm-summary">
          <p>
            <Icon name="check" size={16} /> Опубликовано: <b>{done.published}</b>
          </p>
          <p>
            <Icon name="clock" size={16} /> Отложено во ВКонтакте: <b>{done.scheduled}</b>
          </p>
          <p className="muted">Пропущено: {done.skipped}. Все отметки сохранены в Истории.</p>
        </div>
      </Sheet>
    );
  }
  if (!post) {
    return (
      <Sheet title={`Публикация вручную · ${index + 1} из ${ids.length}`} onClose={onClose}>
        <p className="muted">Эта запись удалена из рабочей области.</p>
        <button className="btn btn-primary btn-block" onClick={() => next('skipped')}>
          Дальше
        </button>
      </Sheet>
    );
  }

  const photosReady = prepared !== null;
  const shareWithFiles = photosReady && canShareFiles(prepared.files);

  return (
    <Sheet title={`Публикация вручную · ${index + 1} из ${ids.length}`} onClose={onClose}>
      <div className="manual">
        <div className="manual-head">
          <span className="num">№ {number}</span>
          {scheduledAt ? (
            <span className={`pill ${pastDue ? 'pill-red' : 'pill-amber'}`}>
              <Icon name="clock" size={13} /> {formatDateTime(scheduledAt)}
            </span>
          ) : (
            <span className="pill pill-blue">Сразу</span>
          )}
        </div>

        {scheduledAt && !pastDue ? (
          <div className="notice notice-warn">
            <Icon name="clock" size={16} />
            <p>
              В редакторе ВКонтакте нажмите значок часов («Отложенная запись») и выберите <b>{formatDateTime(scheduledAt)}</b>. ВКонтакте опубликует
              запись сам.
            </p>
          </div>
        ) : pastDue ? (
          <div className="notice notice-error">
            <Icon name="alert" size={16} />
            <p>Назначенное время уже прошло — публикуйте сразу или выберите новое время в ВК.</p>
          </div>
        ) : null}

        <pre className="manual-text">{text || 'Без текста'}</pre>

        {photos.length ? (
          <div className="manual-photos">
            {photos.map((u, i) => (
              <a key={u} href={u} target="_blank" rel="noopener noreferrer" aria-label={`Фото ${i + 1}`}>
                <img src={u} alt="" loading="lazy" referrerPolicy="no-referrer" />
              </a>
            ))}
          </div>
        ) : null}
        {extra.length ? (
          <p className="muted small">
            Видео и другие вложения прикрепите в ВК вручную:{' '}
            {extra.map((l) => (
              <a key={l} href={l} target="_blank" rel="noopener noreferrer" className="break">
                {l}{' '}
              </a>
            ))}
          </p>
        ) : null}

        <div className="btn-col">
          {mobile && canShare() ? (
            <button className="btn btn-primary btn-block btn-lg" onClick={onShare} disabled={!photosReady}>
              {photosReady ? <Icon name="send" size={18} /> : <span className="spinner spinner-xs" />}
              {photosReady ? `Поделиться во ВКонтакте${shareWithFiles ? ` (+${prepared.files.length} фото)` : ''}` : 'Готовлю фото…'}
            </button>
          ) : (
            <button className="btn btn-primary btn-block btn-lg" onClick={onCopyOpen}>
              <Icon name="external" size={18} /> Скопировать текст и открыть ВКонтакте
            </button>
          )}
          <div className="btn-row">
            <button className="btn btn-soft" onClick={async () => toast((await copyText(text)) ? 'Текст скопирован' : 'Не удалось скопировать', 'success')}>
              Скопировать текст
            </button>
            {photos.length ? (
              <button className="btn btn-soft" onClick={onDownload} disabled={!photosReady}>
                <Icon name="download" size={16} /> Фото ({photos.length})
              </button>
            ) : null}
          </div>
          {photosReady && prepared.failed.length ? (
            <p className="text-warn small">Не удалось подготовить {prepared.failed.length} фото — откройте их нажатием на миниатюру и сохраните.</p>
          ) : null}
        </div>

        <div className="manual-mark">
          <p className="small">
            <b>После публикации во ВКонтакте</b> отметьте результат:
          </p>
          <input
            className="input"
            inputMode="url"
            placeholder="Ссылка на запись (необязательно): https://vk.com/wall…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="btn-row">
            {scheduledAt && !pastDue ? (
              <button className="btn btn-primary" onClick={() => onMark('scheduled')}>
                <Icon name="clock" size={16} /> Отложил в ВК
              </button>
            ) : null}
            <button className={`btn ${scheduledAt && !pastDue ? 'btn-soft' : 'btn-primary'}`} onClick={() => onMark('published')}>
              <Icon name="check" size={16} /> Опубликовал
            </button>
          </div>
          <button className="btn btn-ghost btn-block" onClick={() => next('skipped')}>
            Пропустить {index + 1 < ids.length ? '→ следующая' : ''}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
