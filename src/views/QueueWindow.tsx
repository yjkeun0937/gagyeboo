import { useEffect, useState } from 'preact/hooks';
import { formatMD, formatYm, weekdayKo } from '../lib/dates';
import { won } from '../lib/format';
import { monthsAgo, type QueueItem } from '../lib/queue';
import {
  applyQueue,
  categoriesById,
  payDetailsById,
  payMethodsById,
  queue,
  showToast,
  today,
  undoQueue,
  usersById,
  type QueueAction,
} from '../store/store';
import { CategoryDot, PayGlyph, Ui, UserGlyph } from '../ui/icons';
import { closeQueue } from '../ui/nav';
import { askConfirm, Modal } from '../ui/overlay';
import { Pills } from '../ui/parts';

type Sel = Record<string, QueueAction>;

function Row({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="q-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Detail({ item }: { item: QueueItem }) {
  const t = today.value;
  const cat = item.category ? categoriesById.value.get(item.category) : undefined;
  const u = item.user ? usersById.value.get(item.user) : undefined;
  const m = item.payMethod ? payMethodsById.value.get(item.payMethod) : undefined;
  const d = item.payDetail ? payDetailsById.value.get(item.payDetail) : undefined;
  const ago = monthsAgo(item.ym, t.slice(0, 7));
  const future = item.date > t;
  return (
    <div class="q-card">
      <div class="q-source">
        <span class={`pill ${item.kind === 'fixed' ? 'pill-scheduled' : 'pill-estimate'}`}>
          {item.kind === 'fixed' ? '고정지출' : '손님 제안'}
        </span>
        {item.from ? <span class="q-from">{item.from}</span> : null}
      </div>
      <div class="q-month">
        <strong>{formatYm(item.ym)}</strong>
        <span class="muted">에 입력됩니다</span>
        {ago > 0 ? <span class="pill pill-pending q-ago">{ago}개월 전</span> : null}
      </div>
      <dl class="q-list">
        <Row label="입력일">
          <span class="num">
            {formatMD(item.date)} {weekdayKo(item.date)}
          </span>
          {future ? <Pills status={item.kind === 'fixed' ? 'pending' : 'scheduled'} /> : null}
        </Row>
        <Row label="사용처">
          <span class="q-store">{item.store || '(내용 없음)'}</span>
        </Row>
        <Row label="명세">{item.memo || <span class="muted">-</span>}</Row>
        <Row label="금액">
          <strong class="num">{won(item.amount)}원</strong>
          {item.isEstimate ? <Pills status="normal" estimate /> : null}
        </Row>
        <Row label="분류">
          <CategoryDot color={cat?.color} />
          {cat?.name ?? '미분류'}
        </Row>
        <Row label="사용자">
          {u ? (
            <>
              <UserGlyph user={u} size={20} />
              {u.name}
            </>
          ) : (
            <span class="muted">미지정</span>
          )}
        </Row>
        <Row label="지불수단">
          {m ? (
            <>
              <PayGlyph method={m} detail={d} size={20} />
              {m.name}
              {d ? <span class="muted"> · {d.name}</span> : null}
            </>
          ) : (
            <span class="muted">미지정</span>
          )}
        </Row>
      </dl>
      {item.isEstimate ? <p class="hint">예상 금액으로 입력됩니다. 금액이 정해지면 사용 내역에서 고쳐 주세요.</p> : null}
    </div>
  );
}

/** 입력 대기 창: 항목마다 입력/입력하지 않음을 고른 뒤 「적용」으로 한꺼번에 처리한다 */
export function QueueWindow() {
  const list = queue.value;
  const [index, setIndex] = useState(0);
  const [sel, setSel] = useState<Sel>({});
  const [busy, setBusy] = useState(false);

  // 처리·동기화로 목록이 줄면 위치를 맞춘다
  const cur = Math.min(index, Math.max(0, list.length - 1));
  useEffect(() => {
    if (cur !== index) setIndex(cur);
  }, [cur, index]);

  const keys = new Set(list.map((q) => q.key));
  const chosen = list.filter((q) => sel[q.key]);
  const nEnter = chosen.filter((q) => sel[q.key] === 'enter').length;
  const nSkip = chosen.length - nEnter;

  const close = async () => {
    if (chosen.length) {
      const ok = await askConfirm({
        title: '선택을 버릴까요?',
        message: `「적용」을 누르지 않고 닫으면 지금 고른 ${chosen.length}건의 선택이 사라지고, 모두 입력 대기에 그대로 남습니다.`,
        confirmLabel: '버리고 닫기',
        cancelLabel: '계속 고르기',
      });
      if (!ok) return;
    }
    closeQueue();
  };

  const apply = async () => {
    if (busy || !chosen.length) return;
    setBusy(true);
    try {
      const undo = await applyQueue(chosen.map((item) => ({ item, action: sel[item.key] })));
      closeQueue();
      showToast(`입력 ${nEnter}건 · 입력하지 않음 ${nSkip}건을 적용했습니다`, () => undoQueue(undo));
    } finally {
      setBusy(false);
    }
  };

  const item = list[cur];
  const pick = (action: QueueAction) => {
    if (!item) return;
    setSel((s) => {
      const next = { ...s };
      if (next[item.key] === action) delete next[item.key];
      else next[item.key] = action;
      for (const k of Object.keys(next)) if (!keys.has(k)) delete next[k];
      return next;
    });
  };
  const mine = item ? sel[item.key] : undefined;

  return (
    <Modal title="입력 대기" onClose={close}>
      {!item ? (
        <p class="hint">입력 대기 중인 항목이 없습니다.</p>
      ) : (
        <div class="queue-window">
          <div class="q-top">
            <div class="q-pager" role="group" aria-label="항목 이동">
              <button type="button" class="icon-btn q-prev" aria-label="이전 항목" disabled={cur === 0} onClick={() => setIndex(cur - 1)}>
                <Ui name="ChevronLeft" />
              </button>
              <span class="q-count num" aria-live="polite">
                <b>{cur + 1}</b> / {list.length}
              </span>
              <button
                type="button"
                class="icon-btn q-next"
                aria-label="다음 항목"
                disabled={cur >= list.length - 1}
                onClick={() => setIndex(cur + 1)}
              >
                <Ui name="ChevronRight" />
              </button>
            </div>
            <button type="button" class="btn primary q-apply" disabled={!chosen.length || busy} onClick={apply}>
              적용{chosen.length ? ` (입력 ${nEnter} · 제외 ${nSkip})` : ''}
            </button>
          </div>

          <Detail item={item} />

          <div class="q-actions">
            <button type="button" class={`btn q-enter ${mine === 'enter' ? 'is-on' : ''}`} aria-pressed={mine === 'enter'} onClick={() => pick('enter')}>
              <Ui name="Check" size={16} />
              입력
            </button>
            <button type="button" class={`btn q-skip ${mine === 'skip' ? 'is-on' : ''}`} aria-pressed={mine === 'skip'} onClick={() => pick('skip')}>
              <Ui name="X" size={16} />
              입력하지 않음
            </button>
          </div>
          <p class="hint q-hint">
            고른 내용은 「적용」을 눌러야 반영됩니다. 고르지 않은 항목은 입력 대기에 그대로 남습니다. 내용 수정은 입력한 뒤 사용 내역에서 합니다.
          </p>
        </div>
      )}
    </Modal>
  );
}
