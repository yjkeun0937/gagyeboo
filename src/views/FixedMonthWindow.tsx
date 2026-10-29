import { useEffect, useMemo, useState } from 'preact/hooks';
import { describeSchedule, planMonth } from '../lib/fixed';
import { addMonths, formatMD, formatYm, ymOf } from '../lib/dates';
import { digitsOnly, won } from '../lib/format';
import {
  addFixedEntries,
  categoriesById,
  clearMonthRun,
  entries,
  fixedItemsSorted,
  fixedRuns,
  markMonth,
  payDetailsById,
  payMethodsById,
  pendingFixed,
  removeEntry,
  showToast,
  today,
  usersById,
} from '../store/store';
import { CategoryDot, PayGlyph, Ui, UserGlyph } from '../ui/icons';
import { fixedPromptShown, fixedWindow } from '../ui/nav';
import { Modal } from '../ui/overlay';
import { Pills } from '../ui/parts';

interface MonthSel {
  checked: Record<string, boolean>;
  amount: Record<string, string>;
}

/** 월초 고정지출 입력 창 (기획서 5.2): 해당 항목을 모두 체크해 두고, 원하는 것만 남겨 추가한다. */
export function FixedMonthWindow() {
  const req = fixedWindow.value!;
  const pending = pendingFixed.value;
  const [ym, setYm] = useState(req.ym ?? pending[0] ?? ymOf(today.value));
  const [sels, setSels] = useState<Record<string, MonthSel>>({});
  const [busy, setBusy] = useState(false);

  const plan = useMemo(
    () => planMonth(fixedItemsSorted.value, entries.value, ym),
    [fixedItemsSorted.value, entries.value, ym],
  );
  const run = fixedRuns.value.find((r) => r.ym === ym);

  const sel: MonthSel = sels[ym] ?? { checked: {}, amount: {} };
  const isChecked = (id: string, added: boolean) => !added && (sel.checked[id] ?? true);
  const amountOf = (id: string, fallback: number) => sel.amount[id] ?? String(fallback);
  const update = (patch: Partial<MonthSel>) => setSels((x) => ({ ...x, [ym]: { ...sel, ...patch } }));

  const close = () => {
    fixedPromptShown.value = true;
    fixedWindow.value = null;
  };
  useEffect(() => {
    fixedPromptShown.value = true;
  }, []);

  const picks = plan.due.filter((r) => isChecked(r.item.id, r.added));

  const afterProcessed = (done: string) => {
    // 이어서 처리할 달이 남았으면 그 달로, 없으면 닫는다
    const rest = pendingFixed.value.filter((m) => m !== done);
    if (rest.length) setYm(rest[0]);
    else close();
  };

  const add = async () => {
    if (busy || !picks.length) return;
    setBusy(true);
    try {
      const made = await addFixedEntries(
        ym,
        picks.map((r) => {
          const n = Number(digitsOnly(amountOf(r.item.id, r.item.amount)) || 0);
          return { itemId: r.item.id, amount: n > 0 ? n : r.item.amount };
        }),
      );
      const month = ym;
      showToast(`${formatYm(month)} 고정지출 ${made.length}건을 추가했습니다`, async () => {
        for (const id of made) await removeEntry(id);
        await clearMonthRun(month);
      });
      afterProcessed(month);
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    if (busy) return;
    const month = ym;
    await markMonth(month, 'skipped');
    showToast(`${formatYm(month)}은 건너뛰었습니다`, () => clearMonthRun(month));
    afterProcessed(month);
  };

  const allAdded = plan.due.length > 0 && plan.due.every((r) => r.added);
  const t = today.value;

  return (
    <Modal
      wide
      title={`${formatYm(ym)} 고정지출 추가`}
      onClose={close}
      footer={
        <>
          <button type="button" class="btn" onClick={skip}>
            이번 달 건너뜀
          </button>
          <span class="grow" />
          <button type="button" class="btn" onClick={close}>
            나중에
          </button>
          <button type="button" class="btn primary" disabled={!picks.length || busy} onClick={add}>
            선택 항목 추가{picks.length ? ` (${picks.length})` : ''}
          </button>
        </>
      }
    >
      <div class="fw-months">
        <button type="button" class="icon-btn" aria-label="이전 달" onClick={() => setYm(addMonths(ym, -1))}>
          <Ui name="ChevronLeft" />
        </button>
        <strong>{formatYm(ym)}</strong>
        <button type="button" class="icon-btn" aria-label="다음 달" onClick={() => setYm(addMonths(ym, 1))}>
          <Ui name="ChevronRight" />
        </button>
        {run ? (
          <span class={`pill ${run.status === 'done' ? 'pill-scheduled' : 'pill-estimate'}`}>
            {run.status === 'done' ? '처리함' : '건너뜀'}
          </span>
        ) : null}
      </div>

      {pending.length > 1 || (pending.length === 1 && pending[0] !== ym) ? (
        <div class="chips fw-pending" aria-label="처리하지 않은 달">
          <span class="small-label">처리하지 않은 달</span>
          {pending.map((m) => (
            <button key={m} type="button" class="chip" aria-pressed={m === ym} onClick={() => setYm(m)}>
              {formatYm(m)}
            </button>
          ))}
        </div>
      ) : null}

      {plan.due.length === 0 ? (
        <p class="hint">
          {fixedItemsSorted.value.some((f) => f.active)
            ? '이 달에 해당하는 고정지출이 없습니다.'
            : '사용 중인 고정지출 항목이 없습니다. 설정 > 고정지출에서 먼저 등록해 주세요.'}
        </p>
      ) : (
        <ul class="fw-list">
          {plan.due.map(({ item, date, added }) => {
            const checked = isChecked(item.id, added);
            const shown = amountOf(item.id, item.amount);
            const changed = Number(shown || 0) !== item.amount;
            const cat = item.category ? categoriesById.value.get(item.category) : undefined;
            const u = item.user ? usersById.value.get(item.user) : undefined;
            const m = item.payMethod ? payMethodsById.value.get(item.payMethod) : undefined;
            const d = item.payDetail ? payDetailsById.value.get(item.payDetail) : undefined;
            return (
              <li key={item.id} class={`fw-row ${added ? 'is-added' : ''}`}>
                <label class="fw-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={added}
                    aria-label={`${item.name} 선택`}
                    onChange={(e) => update({ checked: { ...sel.checked, [item.id]: e.currentTarget.checked } })}
                  />
                </label>
                <div class="fw-main">
                  <div class="fw-name">
                    {date > t ? <Pills status="pending" /> : null}
                    {item.amountMode === 'estimate' && !changed ? <Pills status="normal" estimate /> : null}
                    <span>{item.name}</span>
                    {added ? <span class="pill pill-estimate">추가됨</span> : null}
                  </div>
                  <div class="fw-meta">
                    <span class="num">{formatMD(date)}</span>
                    <CategoryDot color={cat?.color} />
                    <span>{cat?.name ?? '미분류'}</span>
                    {u ? <UserGlyph user={u} size={18} /> : null}
                    {m ? <PayGlyph method={m} detail={d} size={18} /> : null}
                  </div>
                </div>
                <div class="fw-amount">
                  <input
                    class="input num"
                    inputMode="numeric"
                    aria-label={`${item.name} 금액`}
                    disabled={added}
                    value={shown ? won(Number(digitsOnly(shown) || 0)) : ''}
                    onInput={(e) =>
                      update({ amount: { ...sel.amount, [item.id]: digitsOnly(e.currentTarget.value).slice(0, 10) } })
                    }
                  />
                  <small class="muted">원</small>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {allAdded ? <p class="hint">이 달 항목은 모두 추가되어 있습니다.</p> : null}

      {plan.others.length ? (
        <details class="fw-others">
          <summary>그 외 등록 항목 (이 달 해당 없음) {plan.others.length}개</summary>
          <ul>
            {plan.others.map((i) => (
              <li key={i.id}>
                <span>{i.name}</span>
                <small class="muted">{describeSchedule(i.schedule)}</small>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <p class="hint">
        체크한 항목이 지정일 날짜로 추가됩니다. 지정일이 아직 오지 않았으면 [보류]로 표시되고 합계에서 빠졌다가, 그날이 되면 자동으로 집계에 들어옵니다.
      </p>
    </Modal>
  );
}
