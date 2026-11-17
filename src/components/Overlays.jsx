import { useEffect, useRef, useState } from 'react';
import { useStore } from '../hooks.js';
import { toastStore, dismissToast } from '../js/ui-state.js';
import { dialogStore, closeDialog } from '../js/dialogs.js';
import Icon from './Icon.jsx';

export function Toasts() {
  const toasts = useStore(toastStore);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast toast-${t.type}`} onClick={() => dismissToast(t.id)}>
          <Icon name={t.type === 'success' ? 'check' : t.type === 'error' ? 'alert' : 'eye'} size={18} />
          <span>{t.message}</span>
        </button>
      ))}
    </div>
  );
}

/** Нижний лист (bottom sheet) — удобно для управления одной рукой. */
export function Sheet({ title, onClose, children, footer, labelledBy = 'sheet-title' }) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={ref}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 id={labelledBy}>{title}</h2>
          {onClose ? (
            <button className="icon-btn" onClick={onClose} aria-label="Закрыть">
              <Icon name="x" />
            </button>
          ) : null}
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

function ConfirmDialog({ props }) {
  const { title, body, confirmText = 'Подтвердить', cancelText = 'Отмена', danger = false } = props;
  return (
    <Sheet
      title={title}
      onClose={() => closeDialog(false)}
      footer={
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => closeDialog(false)}>
            {cancelText}
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => closeDialog(true)} autoFocus>
            {confirmText}
          </button>
        </div>
      }
    >
      {typeof body === 'string' ? <p className="muted pre">{body}</p> : body}
    </Sheet>
  );
}

function CaptchaDialog({ props }) {
  const [value, setValue] = useState('');
  return (
    <Sheet
      title="ВКонтакте просит ввести капчу"
      onClose={() => closeDialog(null)}
      footer={
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => closeDialog(null)}>
            Пропустить
          </button>
          <button className="btn btn-primary" disabled={!value.trim()} onClick={() => closeDialog(value.trim())}>
            Отправить
          </button>
        </div>
      }
    >
      <p className="muted">Введите символы с картинки — это проверка ВКонтакте, iTools её не обходит.</p>
      <img className="captcha-img" src={props.img} alt="Капча ВКонтакте" referrerPolicy="no-referrer" />
      <input className="input" value={value} onChange={(e) => setValue(e.target.value)} autoFocus inputMode="text" aria-label="Код с картинки" />
    </Sheet>
  );
}

export function Dialogs() {
  const dialog = useStore(dialogStore);
  if (!dialog) return null;
  if (dialog.type === 'confirm') return <ConfirmDialog props={dialog.props} />;
  if (dialog.type === 'captcha') return <CaptchaDialog props={dialog.props} />;
  return null;
}
