import { memo, useRef } from 'react';
import { useStore, useAutoResize } from '../hooks.js';
import { postsStore, setText, restoreOriginal, setSelected, removePost, clearPostSchedule } from '../js/post-editor.js';
import { settingsStore } from '../js/settings.js';
import { authorLinkLine, authorLinkState } from '../js/author-links.js';
import { effectiveStatus, formatDateTime, FINAL_STATUSES, STATUS } from '../js/scheduler.js';
import { enableLocalWait } from '../js/publisher.js';
import { confirmDialog } from '../js/dialogs.js';
import { toast } from '../js/ui-state.js';
import { StatusPill, Attachments, Avatar } from './Bits.jsx';
import Icon from './Icon.jsx';

const VK_TEXT_LIMIT = 16384;

/** Независимый редактор одной публикации. Подписан только на свою запись. */
function PostCard({ id, number, onSchedule }) {
  const post = useStore(postsStore, (s) => s.byId[id]);
  const authorLinksEnabled = useStore(settingsStore, (s) => s.authorLinksEnabled);
  const template = useStore(settingsStore, (s) => s.authorLinkTemplate);
  const ref = useRef(null);
  useAutoResize(ref, post?.text);
  if (!post) return null;

  const status = effectiveStatus(post);
  const locked = FINAL_STATUSES.has(post.status) || post.status === STATUS.PUBLISHING;
  const linkState = authorLinkState(post, { authorLinksEnabled });
  const changed = post.text !== post.originalText;

  const onRemove = async () => {
    const ok = await confirmDialog({
      title: `Убрать публикацию №${number}?`,
      body: 'Запись будет удалена из рабочей области на этом устройстве. Во ВКонтакте ничего не удаляется.',
      confirmText: 'Убрать',
      danger: true,
    });
    if (ok) {
      await removePost(id);
      toast(`Публикация №${number} убрана`);
    }
  };

  return (
    <article className={`card post-card ${post.selected === false ? 'is-unselected' : ''}`} aria-label={`Публикация №${number}`}>
      <header className="post-head">
        <label className="select-box" title="Выбрать для «Опубликовать выбранные»">
          <input type="checkbox" checked={post.selected !== false} onChange={(e) => setSelected(id, e.target.checked)} disabled={locked} />
          <span className="num">№ {number}</span>
        </label>
        <StatusPill status={status} />
        <button className="icon-btn ml-auto" onClick={onRemove} aria-label={`Убрать публикацию №${number}`} disabled={post.status === STATUS.PUBLISHING}>
          <Icon name="trash" size={18} />
        </button>
      </header>

      <a className="source-link" href={post.sourceUrl} target="_blank" rel="noopener noreferrer">
        <Icon name="link" size={14} /> {post.sourceUrl.replace(/^https:\/\//, '')}
      </a>

      <div className="author-row">
        <Avatar src={post.authorPhoto} name={post.authorName} size={32} />
        <div className="author-meta">
          <span className="author-label">Первоначальный автор{post.isRepost ? ' (из репоста)' : ''}</span>
          <a href={post.authorUrl} target="_blank" rel="noopener noreferrer" className="author-name">
            {post.authorName}
          </a>
        </div>
      </div>

      <Attachments attachments={post.attachments} unsupported={post.unsupported} />

      <div className="editor">
        <textarea
          ref={ref}
          className="textarea post-text"
          value={post.text}
          onChange={(e) => setText(id, e.target.value)}
          placeholder="Текст публикации (можно оставить пустым, если есть вложения)"
          readOnly={locked}
          rows={4}
          aria-label={`Текст публикации №${number}`}
          spellCheck
        />
        <div className="editor-meta">
          <span className={post.text.length > VK_TEXT_LIMIT ? 'text-danger' : ''}>
            {post.text.length.toLocaleString('ru-RU')} симв.
          </span>
          {changed ? <span className="muted">· изменён · сохранено</span> : <span className="muted">· оригинал</span>}
        </div>
        {linkState === 'added' ? (
          <p className="author-hint">
            <Icon name="plus" size={14} /> В конец будет добавлено: <b>{authorLinkLine(post, template)}</b>
          </p>
        ) : linkState === 'present' ? (
          <p className="author-hint muted">
            <Icon name="check" size={14} /> Ссылка автора уже есть в тексте — повторно не добавляется
          </p>
        ) : null}
      </div>

      {post.error && (post.status === STATUS.ERROR || post.status === STATUS.ACTION) ? (
        <div className={`notice ${post.status === STATUS.ERROR ? 'notice-error' : 'notice-warn'}`} role="alert">
          <Icon name="alert" size={16} />
          <div>
            <p>{post.error}</p>
            {post.scheduleRejected ? (
              <div className="btn-row-wrap">
                <button className="btn btn-sm btn-ghost" onClick={() => clearPostSchedule(id)}>
                  Снять время
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: 'Локальное ожидание',
                      body:
                        'ВКонтакте не принял запись в серверное расписание. В режиме локального ожидания iTools отправит запись сам, когда наступит время, ' +
                        'НО только если приложение в этот момент открыто и есть интернет. Android может остановить Chrome в фоне — тогда запись не будет опубликована вовремя. ' +
                        'Это не гарантированная отложенная публикация.',
                      confirmText: 'Понимаю, включить',
                    });
                    if (ok) enableLocalWait(id);
                  }}
                >
                  Ждать в приложении
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {post.localWait && !FINAL_STATUSES.has(post.status) ? (
        <div className="notice notice-warn">
          <Icon name="alert" size={16} />
          <p>
            Локальное ожидание: запись отправится, только если iTools будет открыт в {formatDateTime(post.schedule?.at)}. Это не серверное
            расписание ВКонтакте.
          </p>
        </div>
      ) : null}

      {post.result?.url ? (
        <a className="result-link" href={post.result.url} target="_blank" rel="noopener noreferrer">
          <Icon name="external" size={16} />
          {post.status === STATUS.SCHEDULED_VK ? `В отложенных ВКонтакте на ${formatDateTime(post.result.scheduledAt)}` : 'Открыть опубликованную запись'}
        </a>
      ) : null}

      <footer className="post-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => restoreOriginal(id)} disabled={!changed || locked}>
          <Icon name="restore" size={16} /> Восстановить оригинальный текст
        </button>
        {post.schedule?.at ? (
          <div className="time-chip-group">
            <button className="time-chip" onClick={() => onSchedule(id, number)} disabled={locked} aria-label={`Изменить время публикации №${number}`}>
              <Icon name="clock" size={16} /> {formatDateTime(post.schedule.at)}
            </button>
            {!locked ? (
              <button className="icon-btn icon-btn-sm" onClick={() => clearPostSchedule(id)} aria-label={`Отменить время публикации №${number}`}>
                <Icon name="x" size={16} />
              </button>
            ) : null}
          </div>
        ) : (
          <button className="btn btn-outline btn-sm" onClick={() => onSchedule(id, number)} disabled={locked}>
            <Icon name="clock" size={16} /> Назначить время
          </button>
        )}
      </footer>
    </article>
  );
}

export default memo(PostCard);
