// Hinweise (Toasts) und Bestätigungsdialog.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, TriangleAlert, X } from 'lucide-react';
import { Button, cx } from './ui';

// --- Toasts ---

interface Toast {
  id: number;
  tone: 'success' | 'error';
  text: string;
}

const ToastContext = createContext<(tone: Toast['tone'], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed top-4 right-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={cx(
              'pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-surface px-3.5 py-3 text-sm shadow-lg',
              t.tone === 'error' ? 'border-danger/40' : 'border-line',
            )}
          >
            {t.tone === 'error' ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
            ) : (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
            )}
            <span className="flex-1 text-fg">{t.text}</span>
            <button
              type="button"
              aria-label="Schließen"
              className="text-subtle hover:text-fg"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return {
    success: (text: string) => push('success', text),
    error: (err: unknown) => push('error', err instanceof Error ? err.message : String(err)),
  };
}

// --- Bestätigungsdialog ---

export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  loading,
}: {
  open: boolean;
  title: string;
  text: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-fg shadow-xl backdrop:bg-black/40"
    >
      <div className="p-5">
        <h2 className="text-base font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-muted">{text}</div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
        <Button onClick={onCancel}>Abbrechen</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

export interface ConfirmOptions {
  title: string;
  text: ReactNode;
  confirmLabel: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(opts: ConfirmOptions) => Promise<boolean>>(() => Promise.resolve(window.confirm('Fortfahren?')));

/** Ein gemeinsamer Bestätigungsdialog für die ganze App */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ opts: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null);
  const confirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ opts, resolve })), []);
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        open={!!state}
        title={state?.opts.title ?? ''}
        text={state?.opts.text ?? ''}
        confirmLabel={state?.opts.confirmLabel ?? 'OK'}
        danger={state?.opts.danger}
        onConfirm={() => close(true)}
        onCancel={() => close(false)}
      />
    </ConfirmContext.Provider>
  );
}

/** Rückfrage als Promise: if (!(await confirm({...}))) return; */
export function useConfirm() {
  return useContext(ConfirmContext);
}

/** Rückfrage beim Verlassen der Freigabe ohne Entscheidung des Kunden */
export function leaveApprovalOptions(to: number): ConfirmOptions {
  return to > 4
    ? {
        title: 'Ohne Rückmeldung des Kunden weiter?',
        text: 'Die offene Freigabeanfrage wird als freigegeben vermerkt und erscheint so im Freigabe-Protokoll. Hat der Kunde zugestimmt, besser im Projekt „Freigegeben“ wählen.',
        confirmLabel: 'Als freigegeben weiter',
      }
    : {
        title: 'Freigabeanfrage zurücknehmen?',
        text: 'Die offene Anfrage wird zurückgenommen und erscheint nicht im Freigabe-Protokoll. Für Änderungswünsche des Kunden besser im Projekt „Korrektur nötig“ wählen, dann zählt die Korrekturschleife.',
        confirmLabel: 'Zurücknehmen und verschieben',
      };
}

// --- Allgemeiner Dialog ---

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cx(
        'm-auto max-h-[calc(100vh-2rem)] rounded-lg border border-line bg-surface p-0 text-fg shadow-xl backdrop:bg-black/40',
        wide ? 'w-[min(720px,calc(100vw-2rem))]' : 'w-[min(480px,calc(100vw-2rem))]',
      )}
    >
      {open && (
        <>
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" aria-label="Schließen" onClick={onClose} className="text-subtle hover:text-fg">
              <X className="size-4" />
            </button>
          </div>
          <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
        </>
      )}
    </dialog>
  );
}
