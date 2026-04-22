import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const ConfirmCtx = createContext(null);

// Replaces window.confirm with an in-app modal. Wrap the app once, then any
// component can call `const confirm = useConfirm()` and await a boolean.
// Usage:
//   if (!await confirm({ message: 'Delete this step?', danger: true })) return;
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolveRef = useRef(null);

  const confirm = useCallback((opts) => {
    const o = typeof opts === 'string' ? { message: opts } : (opts || {});
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setState({
        title: o.title || null,
        message: o.message || 'Are you sure?',
        confirmLabel: o.confirmLabel || (o.danger ? 'Delete' : 'Confirm'),
        cancelLabel: o.cancelLabel || 'Cancel',
        danger: !!o.danger,
      });
    });
  }, []);

  function settle(value) {
    const r = resolveRef.current;
    resolveRef.current = null;
    setState(null);
    if (r) r(value);
  }

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {state && createPortal(
        <div className="confirm-overlay" onClick={() => settle(false)}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            {state.title && <div className="confirm-title">{state.title}</div>}
            <div className="confirm-message">{state.message}</div>
            <div className="confirm-actions">
              <button className="confirm-btn confirm-btn-cancel" onClick={() => settle(false)} autoFocus>
                {state.cancelLabel}
              </button>
              <button
                className={`confirm-btn confirm-btn-primary${state.danger ? ' confirm-btn-danger' : ''}`}
                onClick={() => settle(true)}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmCtx);
  if (!confirm) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return confirm;
}
