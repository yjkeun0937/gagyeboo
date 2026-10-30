/**
 * 휴대폰에서 글자 입력란을 누르면 화상 키보드가 올라와 입력란을 가린다.
 * 입력란(과 그 이름표)이 보이는 영역의 맨 위쪽에 오도록 스크롤해 준다.
 *
 * - index.html의 viewport에 interactive-widget=resizes-content가 있어, 키보드가 올라오면 화면(레이아웃)
 *   높이 자체가 줄어든다. 그래서 아래에서 올라오는 입력창·대화상자는 키보드 위에 붙는다.
 * - 스크롤 가능한 영역의 끝에 입력란이 있으면 더 올릴 수 없으므로, 입력 중에는 html에 kb-open
 *   클래스를 붙여 아래쪽 여백을 넓힌다 (app.css).
 */

const TEXT_FIELD =
  'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=file]):not([type=color]), textarea, select';

const MARGIN = 12;

function isTouchLike(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/** 입력란을 보이는 영역의 맨 위로 올린다. 이름표가 있으면 이름표부터 보이게 한다 */
export function scrollFieldToTop(el: HTMLElement): void {
  const vv = window.visualViewport;
  const anchor = el.closest<HTMLElement>('.field, .search-row, .budget-row') ?? el;
  const sp = scrollParent(el);
  const aTop = anchor.getBoundingClientRect().top;
  let desired: number;
  if (sp) {
    desired = sp.getBoundingClientRect().top + MARGIN;
  } else {
    const header = document.querySelector<HTMLElement>('.top');
    desired = (vv?.offsetTop ?? 0) + (header ? header.getBoundingClientRect().bottom : 0) + MARGIN;
  }
  // 이름표+입력란 묶음이 너무 크면(보이는 높이의 절반 초과) 입력란 자체를 기준으로 한다
  const room = vv?.height ?? window.innerHeight;
  const useAnchor = anchor.getBoundingClientRect().height < room / 2;
  const top = useAnchor ? aTop : el.getBoundingClientRect().top;
  const delta = top - desired;
  if (Math.abs(delta) < 2) return;
  const scroller = sp ?? document.scrollingElement ?? document.documentElement;
  scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: 'auto' });
}

export function installKeyboardScroll(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  let current: HTMLElement | null = null;
  let timers: number[] = [];

  const clear = () => {
    timers.forEach((t) => clearTimeout(t));
    timers = [];
  };
  const run = () => {
    if (current && document.activeElement === current) scrollFieldToTop(current);
  };
  const schedule = () => {
    clear();
    // 키보드가 올라오는 동안 높이가 몇 번 바뀌므로, 몇 차례에 걸쳐 다시 맞춘다
    for (const ms of [60, 220, 450]) timers.push(window.setTimeout(run, ms));
  };

  document.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement | null;
    if (!el || !el.matches?.(TEXT_FIELD) || !isTouchLike()) return;
    current = el;
    root.classList.add('kb-open');
    schedule();
  });
  document.addEventListener('focusout', () => {
    // 다른 입력란으로 옮겨 가는 경우에는 닫지 않는다
    setTimeout(() => {
      const a = document.activeElement as HTMLElement | null;
      if (a && a.matches?.(TEXT_FIELD)) return;
      current = null;
      clear();
      root.classList.remove('kb-open');
    }, 120);
  });
  // 키보드가 올라오거나 내려가면(화면 높이 변화) 다시 맞춘다
  const onResize = () => {
    if (current) schedule();
  };
  window.visualViewport?.addEventListener('resize', onResize);
  window.addEventListener('resize', onResize);
}
