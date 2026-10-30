import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { toast } from '../store/store';
import { X } from './lucide-subset';
import { viewport } from './viewport';

/* ───────── Esc 키: 가장 위에 열린 것부터 닫는다 ───────── */

const escStack: (() => void)[] = [];
let escBound = false;

export function useEscape(handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = () => ref.current();
    escStack.push(fn);
    if (!escBound) {
      escBound = true;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && escStack.length) {
          e.preventDefault();
          escStack[escStack.length - 1]();
        }
      });
    }
    return () => {
      const i = escStack.lastIndexOf(fn);
      if (i >= 0) escStack.splice(i, 1);
    };
  }, []);
}

/* ───────── 아이콘 터치 시 세부 내용 (팝오버) ───────── */

interface PopoverState {
  x: number;
  y: number;
  title: string;
  lines: string[];
  swatch?: string;
}
export const popover = signal<PopoverState | null>(null);

export function showPopover(target: Element, title: string, lines: string[] = [], swatch?: string) {
  const r = target.getBoundingClientRect();
  popover.value = { x: r.left + r.width / 2, y: r.bottom + 8, title, lines, swatch };
}

export function PopoverLayer() {
  const p = popover.value;
  useEffect(() => {
    if (!p) return;
    const close = () => (popover.value = null);
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.('.popover')) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [p]);
  if (!p) return null;
  const half = 110;
  const left = Math.min(Math.max(p.x, half + 8), window.innerWidth - half - 8);
  return (
    <div class="popover" role="tooltip" style={{ left: `${left}px`, top: `${p.y}px` }}>
      <div class="popover-title">
        {p.swatch ? <span class="dot" style={{ background: p.swatch }} /> : null}
        {p.title}
      </div>
      {p.lines.map((l) => (
        <div class="popover-line" key={l}>
          {l}
        </div>
      ))}
    </div>
  );
}

/* ───────── 실행 취소 알림 ───────── */

export function ToastLayer() {
  const t = toast.value;
  useEffect(() => {
    if (!t) return;
    const id = setTimeout(
      () => {
        if (toast.value?.seq === t.seq) toast.value = null;
      },
      t.undo ? 6000 : 3200,
    );
    return () => clearTimeout(id);
  }, [t?.seq]);
  if (!t) return null;
  return (
    <div class="toast" role="status" aria-live="polite">
      <span>{t.message}</span>
      {t.undo ? (
        <button
          type="button"
          class="toast-undo"
          onClick={async () => {
            toast.value = null;
            await t.undo?.();
          }}
        >
          실행 취소
        </button>
      ) : null}
    </div>
  );
}

/* ───────── 경고 팝업: 누르면 바로 사라지고, 두어도 잠시 뒤 사라진다 ───────── */

interface WarningState {
  message: string;
  seq: number;
}
export const warning = signal<WarningState | null>(null);
let warnSeq = 0;
/** 입력 창 위에 뜨는 경고. 2.8초 뒤 자동으로 사라진다 */
export const WARNING_MS = 2800;

export function showWarning(message: string) {
  warning.value = { message, seq: ++warnSeq };
}

export function WarningLayer() {
  const w = warning.value;
  useEffect(() => {
    if (!w) return;
    const id = setTimeout(() => {
      if (warning.value?.seq === w.seq) warning.value = null;
    }, WARNING_MS);
    return () => clearTimeout(id);
  }, [w?.seq]);
  if (!w) return null;
  return (
    <div class="warning-layer" role="presentation" onPointerDown={() => (warning.value = null)}>
      <div class="warning-pop" role="alert" aria-live="assertive">
        <span class="warning-icon" aria-hidden="true">
          !
        </span>
        <span>{w.message}</span>
      </div>
    </div>
  );
}

/* ───────── 대화상자 ───────── */

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div
      class="modal-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class={`modal ${wide ? 'is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header class="modal-head">
          <h2>{title}</h2>
          <button type="button" class="icon-btn" aria-label="닫기" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div class="modal-body">{children}</div>
        {footer ? <footer class="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

interface ConfirmState {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}
const confirmState = signal<ConfirmState | null>(null);

export function askConfirm(opts: {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    confirmState.value?.resolve(false);
    confirmState.value = {
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? '확인',
      cancelLabel: opts.cancelLabel ?? '취소',
      danger: opts.danger ?? false,
      resolve,
    };
  });
}

export function ConfirmLayer() {
  const c = confirmState.value;
  if (!c) return null;
  const done = (ok: boolean) => {
    confirmState.value = null;
    c.resolve(ok);
  };
  return (
    <Modal
      title={c.title}
      onClose={() => done(false)}
      footer={
        <>
          <button type="button" class="btn" onClick={() => done(false)}>
            {c.cancelLabel}
          </button>
          <button
            type="button"
            class={`btn ${c.danger ? 'danger' : 'primary'}`}
            data-autofocus
            onClick={() => done(true)}
          >
            {c.confirmLabel}
          </button>
        </>
      }
    >
      {c.message ? <p class="confirm-msg">{c.message}</p> : null}
    </Modal>
  );
}

/* ───────── 입력 시트 (모바일: 아래에서 올라옴 / 그 밖: 오른쪽 패널) ───────── */

export function Sheet({
  title,
  onRequestClose,
  children,
  footer,
}: {
  title: string;
  onRequestClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
}) {
  const bottom = viewport.value === 'mobile';
  useEscape(onRequestClose);
  useEffect(() => {
    document.body.classList.add('no-scroll');
    return () => document.body.classList.remove('no-scroll');
  }, []);
  return (
    <div class={`sheet-layer ${bottom ? 'is-bottom' : 'is-side'}`}>
      <div class="scrim" onClick={onRequestClose} />
      <section class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header class="sheet-head">
          <h2>{title}</h2>
          <button type="button" class="icon-btn" aria-label="닫기" onClick={onRequestClose}>
            <X size={20} />
          </button>
        </header>
        <div class="sheet-body">{children}</div>
        {footer ? <footer class="sheet-foot">{footer}</footer> : null}
      </section>
    </div>
  );
}
