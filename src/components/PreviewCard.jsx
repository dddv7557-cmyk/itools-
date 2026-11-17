import { memo } from 'react';
import { StatusPill, Attachments, Avatar } from './Bits.jsx';
import Icon from './Icon.jsx';

/** Карточка общего предпросмотра — так запись будет выглядеть при отправке. */
function PreviewCard({ item, profile }) {
  return (
    <article className={`card preview-card ${item.selected ? '' : 'is-unselected'}`} aria-label={`Предпросмотр публикации №${item.number}`}>
      <header className="post-head">
        <span className="num">№ {item.number}</span>
        <StatusPill status={item.status} />
      </header>
      <div className="preview-author">
        <Avatar src={profile?.photo} name={profile?.name || 'Мой аккаунт'} size={36} />
        <div>
          <b>{profile?.name || 'Ваш аккаунт ВКонтакте'}</b>
          <span className={`mode-badge ${item.mode === 'scheduled' ? 'mode-scheduled' : 'mode-now'}`}>
            <Icon name={item.mode === 'scheduled' ? 'clock' : 'send'} size={13} /> {item.modeLabel}
          </span>
        </div>
      </div>
      {item.text ? <p className="preview-text">{item.text}</p> : <p className="muted small">Без текста</p>}
      <Attachments attachments={item.attachments} large />
      <footer className="preview-foot">
        {item.authorLinkShown ? (
          <span className="chip chip-blue">
            <Icon name="link" size={13} /> Ссылка автора: {item.authorName}
          </span>
        ) : null}
        {!item.selected ? <span className="chip chip-muted">Не выбрана</span> : null}
        {item.resultUrl ? (
          <a className="chip chip-green" href={item.resultUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="external" size={13} /> Открыть во ВКонтакте
          </a>
        ) : null}
      </footer>
    </article>
  );
}

export default memo(PreviewCard);
