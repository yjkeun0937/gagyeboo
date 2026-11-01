import { useEffect, useState } from 'preact/hooks';
import { describeSchedule, emptyScheduleFor, nextDue } from '../lib/fixed';
import { monthNum, ymOf } from '../lib/dates';
import { digitsOnly, won } from '../lib/format';
import type { FixedItem, FixedSchedule } from '../lib/types';
import {
  addFixedItem,
  categoriesSorted,
  categoriesById,
  deleteFixedItem,
  fixedItemsSorted,
  moveItem,
  payDetails,
  payMethodsById,
  payMethodsSorted,
  queue,
  save,
  showToast,
  today,
  updateFixedItem,
  usersById,
} from '../store/store';
import { CategoryDot, PayGlyph, Ui } from '../ui/icons';
import { fixedDraft, openQueue, type FixedDraft } from '../ui/nav';
import { askConfirm, Modal, popover, showPopover } from '../ui/overlay';
import { Pills } from '../ui/parts';
import { Chip, PayDetailPicker, UserPicker } from './EntrySheet';

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function FixedEditor({ initial, draft, onClose }: { initial?: FixedItem; draft?: FixedDraft; onClose: () => void }) {
  const t = today.value;
  const [name, setName] = useState(initial?.name ?? draft?.name ?? '');
  const [memo, setMemo] = useState(initial?.memo ?? draft?.memo ?? '');
  const [amount, setAmount] = useState(initial ? String(initial.amount) : draft ? String(draft.amount) : '');
  const [mode, setMode] = useState<'fixed' | 'estimate'>(initial?.amountMode ?? 'fixed');
  const [schedule, setSchedule] = useState<FixedSchedule>(
    initial?.schedule ?? { kind: 'monthly', day: draft?.day ?? 1 },
  );
  const [category, setCategory] = useState(initial?.category ?? draft?.category ?? null);
  const [user, setUser] = useState(initial?.user ?? draft?.user ?? null);
  const [payMethod, setPayMethod] = useState(initial?.payMethod ?? draft?.payMethod ?? null);
  const [payDetail, setPayDetail] = useState(initial?.payDetail ?? draft?.payDetail ?? null);
  const [active, setActive] = useState(initial?.active ?? true);
  const [err, setErr] = useState('');

  const amountNum = Number(amount || 0);
  const next = nextDue(schedule, t);
  const hiddenUser = user ? usersById.value.get(user)?.hidden : false;

  const dayValue = schedule.day === 'last' ? 'last' : String(schedule.day);
  const setDay = (v: string) => setSchedule({ ...schedule, day: v === 'last' ? 'last' : Number(v) } as FixedSchedule);

  const submit = async () => {
    if (!name.trim()) return setErr('항목 이름을 입력해 주세요');
    if (!(amountNum > 0)) return setErr('금액을 입력해 주세요 (금액이 정해지지 않았다면 예상 금액을 적고 [예상]으로 두세요)');
    if (schedule.kind === 'months' && schedule.months.length === 0) return setErr('해당하는 월을 하나 이상 골라 주세요');
    const data = {
      name: name.trim(),
      memo: memo.trim(),
      amount: amountNum,
      amountMode: mode,
      schedule,
      category,
      user,
      payMethod,
      payDetail: payMethod ? payDetail : null,
      active,
    };
    if (initial) await updateFixedItem(initial.id, data);
    else await addFixedItem(data);
    onClose();
  };

  const remove = async () => {
    if (!initial) return;
    const ok = await askConfirm({
      title: `'${initial.name}' 항목을 삭제할까요?`,
      message: '이미 추가된 내역은 그대로 남습니다.',
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    await deleteFixedItem(initial.id);
    showToast('삭제했습니다');
    onClose();
  };

  return (
    <Modal
      wide
      title={`고정지출 ${initial ? '수정' : '등록'}`}
      onClose={onClose}
      footer={
        <>
          {initial ? (
            <button type="button" class="btn danger-ghost" onClick={remove}>
              <Ui name="Trash2" size={16} />
              삭제
            </button>
          ) : null}
          <span class="grow" />
          <button type="button" class="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" class="btn primary" onClick={submit}>
            저장
          </button>
        </>
      }
    >
      <div class="field">
        <label for="fx-name">항목 이름 (내역의 사용처로 들어갑니다)</label>
        <input id="fx-name" class="input" value={name} maxLength={40} data-autofocus onInput={(e) => { setName(e.currentTarget.value); setErr(''); }} />
      </div>
      <div class="field">
        <label for="fx-memo">명세</label>
        <input id="fx-memo" class="input" value={memo} maxLength={100} placeholder="선택" onInput={(e) => setMemo(e.currentTarget.value)} />
      </div>
      <div class="field">
        <label for="fx-amount">
          금액 <small class="unit">원</small>
        </label>
        <input
          id="fx-amount"
          class="input amount-input num"
          inputMode="numeric"
          value={amount ? won(Number(amount)) : ''}
          placeholder="0"
          onInput={(e) => {
            setAmount(digitsOnly(e.currentTarget.value).slice(0, 10).replace(/^0+(?=\d)/, ''));
            setErr('');
          }}
        />
        <div class="segmented" role="group" aria-label="금액 종류">
          <button type="button" aria-pressed={mode === 'fixed'} onClick={() => setMode('fixed')}>
            확정 금액
          </button>
          <button type="button" aria-pressed={mode === 'estimate'} onClick={() => setMode('estimate')}>
            예상 금액
          </button>
        </div>
        <p class="hint">
          {mode === 'estimate'
            ? '매번 금액이 달라지는 항목입니다. 추가된 내역에 [예상]이 붙고, 내역에서 금액을 고치면 확정됩니다.'
            : '금액이 정해져 있는 항목입니다.'}
        </p>
      </div>

      <div class="field">
        <span class="label">반복</span>
        <div class="segmented" role="group" aria-label="반복 방식">
          {(
            [
              ['monthly', '매월'],
              ['months', '특정 월'],
              ['every', 'N개월마다'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={schedule.kind === k}
              onClick={() => schedule.kind !== k && setSchedule(emptyScheduleFor(k, ymOf(t)))}
            >
              {label}
            </button>
          ))}
        </div>

        {schedule.kind === 'months' ? (
          <div class="chips" role="group" aria-label="해당 월">
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <Chip
                key={m}
                active={schedule.months.includes(m)}
                onClick={() =>
                  setSchedule({
                    ...schedule,
                    months: schedule.months.includes(m)
                      ? schedule.months.filter((x) => x !== m)
                      : [...schedule.months, m].sort((a, b) => a - b),
                  })
                }
              >
                {m}월
              </Chip>
            ))}
          </div>
        ) : null}

        {schedule.kind === 'every' ? (
          <div class="inline-add">
            <select
              class="input"
              aria-label="몇 개월마다"
              value={schedule.every}
              onChange={(e) => setSchedule({ ...schedule, every: Number(e.currentTarget.value) })}
            >
              {Array.from({ length: 11 }, (_, i) => i + 2).map((n) => (
                <option key={n} value={n}>
                  {n}개월마다
                </option>
              ))}
            </select>
            <label class="small-label" for="fx-base">
              기준 월
            </label>
            <input
              id="fx-base"
              class="input"
              type="month"
              value={schedule.baseYm}
              onInput={(e) => e.currentTarget.value && setSchedule({ ...schedule, baseYm: e.currentTarget.value })}
            />
          </div>
        ) : null}

        <div class="inline-add">
          <label class="small-label" for="fx-day">
            지정일
          </label>
          <select id="fx-day" class="input" value={dayValue} onChange={(e) => setDay(e.currentTarget.value)}>
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d}일
              </option>
            ))}
            <option value="last">말일</option>
          </select>
        </div>
        <p class="hint">
          {describeSchedule(schedule)}
          {schedule.day !== 'last' && schedule.day > 28 ? ' · 해당 월에 그 날짜가 없으면 마지막 날로 입력됩니다' : ''}
          {next ? ` · 다음 지정일 ${next}` : ''}
        </p>
        {!initial ? (
          <p class="hint fx-notice">
            등록하면 <b>이번 달({monthNum(ymOf(t))}월)부터</b> 입력 대기에 추가됩니다(지난 달은 추가되지 않습니다). 이번 달에 원하지 않으면 입력 대기에서
            「입력하지 않음」으로 제외할 수 있습니다.
          </p>
        ) : null}
      </div>

      <div class="field">
        <span class="label">분류</span>
        <div class="chips">
          <Chip active={category === null} onClick={() => setCategory(null)}>
            미분류
          </Chip>
          {categoriesSorted.value
            .filter((c) => !c.hidden || c.id === category)
            .map((c) => (
              <Chip key={c.id} active={category === c.id} onClick={() => setCategory(c.id)}>
                <CategoryDot color={c.color} />
                {c.name}
              </Chip>
            ))}
        </div>
      </div>
      <div class="field">
        <span class="label">사용자</span>
        <UserPicker value={user} onChange={setUser} />
        {hiddenUser ? <p class="hint warn">숨김 처리된 사용자입니다. 추가되는 내역에는 그대로 기록됩니다.</p> : null}
      </div>
      <div class="field">
        <span class="label">지불수단</span>
        <div class="chips">
          <Chip active={payMethod === null} onClick={() => { setPayMethod(null); setPayDetail(null); }}>
            미지정
          </Chip>
          {payMethodsSorted.value
            .filter((m) => !m.hidden || m.id === payMethod)
            .map((m) => (
              <Chip
                key={m.id}
                active={payMethod === m.id}
                onClick={() => {
                  const keep = payDetail && payDetails.value.find((d) => d.id === payDetail)?.payMethodId === m.id;
                  setPayMethod(m.id);
                  setPayDetail(keep ? payDetail : null);
                }}
              >
                <PayGlyph method={m} size={20} />
                {m.name}
              </Chip>
            ))}
        </div>
      </div>
      <div class="field">
        <span class="label">결제상세</span>
        <PayDetailPicker methodId={payMethod} value={payDetail} onChange={setPayDetail} />
      </div>
      <label class="check">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.currentTarget.checked)} />
        사용 중 (끄면 입력 대기에 나타나지 않습니다)
      </label>
      {err ? (
        <p class="form-error" role="alert">
          {err}
        </p>
      ) : null}
    </Modal>
  );
}

export function FixedPage() {
  const items = fixedItemsSorted.value;
  const [editor, setEditor] = useState<{ item?: FixedItem; draft?: FixedDraft } | null>(null);
  // 사용 내역에서 넘어온 내용이 있으면 바로 등록 창을 연다
  useEffect(() => {
    const d = fixedDraft.value;
    if (d) {
      fixedDraft.value = null;
      setEditor({ draft: d });
    }
  }, [fixedDraft.value]);
  const fixedWaiting = queue.value.filter((q) => q.kind === 'fixed');
  const months = [...new Set(fixedWaiting.map((q) => q.ym))];
  const thisYm = ymOf(today.value);

  return (
    <div class="settings-form">
      <section class="card-block">
        <h3>입력 대기</h3>
        <p>
          {fixedWaiting.length ? (
            <>
              <span class="pill pill-pending">대기 {fixedWaiting.length}건</span>
              {months.length > 1 || months[0] !== thisYm ? ` ${months.map((m) => `${monthNum(m)}월`).join(', ')}분` : ''}
            </>
          ) : (
            <span class="pill pill-estimate">{items.some((i) => i.active) ? '대기 중인 항목 없음' : '등록된 항목 없음'}</span>
          )}
        </p>
        <div class="btn-row">
          <button type="button" class="btn primary" disabled={queue.value.length === 0} onClick={openQueue}>
            <Ui name="CalendarDays" size={16} />
            입력 대기 열기{queue.value.length ? ` (${queue.value.length}건)` : ''}
          </button>
        </div>
        <p class="hint">
          매달 지정일이 되는 고정지출은 그 달부터 「입력 대기」에 쌓입니다. 화면 위쪽(휴대폰은 오른쪽 아래)의 「입력 대기」 버튼에서
          항목마다 「입력」 또는 「입력하지 않음」을 골라 한 번에 적용합니다.
        </p>
      </section>

      <div class="list-head">
        <h3>등록 항목</h3>
        <button type="button" class="btn small primary" onClick={() => setEditor({})}>
          <Ui name="Plus" size={16} />
          항목 추가
        </button>
      </div>
      {items.length === 0 ? (
        <p class="empty-line">등록된 고정지출이 없습니다. 매달 반복되는 지출을 등록해 두면 매달 입력 대기에 올라와 골라서 한 번에 추가할 수 있습니다.</p>
      ) : (
        <ul class="list">
          {items.map((f, i) => {
            const cat = f.category ? categoriesById.value.get(f.category) : undefined;
            const u = f.user ? usersById.value.get(f.user) : undefined;
            const m = f.payMethod ? payMethodsById.value.get(f.payMethod) : undefined;
            const d = f.payDetail ? payDetails.value.find((x) => x.id === f.payDetail) : undefined;
            const tip = (active: boolean) =>
              active ? ['사용 중', '누르면 사용 안 함으로 바꿈'] : ['미사용', '누르면 사용 중으로 바꿈'];
            return (
              <li key={f.id} class={`list-row ${f.active ? '' : 'is-hidden'}`}>
                <span class="lr-glyph">{m ? <PayGlyph method={m} size={30} /> : <CategoryDot color={cat?.color} />}</span>
                <button type="button" class="lr-main" onClick={() => setEditor({ item: f })} aria-label={`${f.name} 수정`}>
                  <span class="lr-title">
                    <span class="lr-name">{f.name}</span>
                    {f.memo ? <span class="lr-memo">{f.memo}</span> : null}
                    <span class="lr-amount num">
                      {won(f.amount)}원
                    </span>
                    {f.amountMode === 'estimate' ? <Pills status="normal" estimate /> : <span class="pill pill-fixed">확정</span>}
                    {!f.active ? <span class="pill pill-estimate">사용 안 함</span> : null}
                  </span>
                  <small class="lr-meta">
                    {[
                      describeSchedule(f.schedule),
                      cat?.name ?? '분류 없음',
                      u ? u.name : '사용자 미지정',
                      m ? m.name : null,
                      d ? d.name : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </button>
                <span class="lr-actions">
                  <button type="button" class="icon-btn" aria-label="위로" disabled={i === 0} onClick={() => moveItem('fixedItems', f.id, -1)}>
                    <Ui name="ArrowUp" size={16} />
                  </button>
                  <button type="button" class="icon-btn" aria-label="아래로" disabled={i === items.length - 1} onClick={() => moveItem('fixedItems', f.id, 1)}>
                    <Ui name="ArrowDown" size={16} />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={tip(f.active).join(', ')}
                    aria-pressed={f.active}
                    onPointerEnter={(e) => {
                      if (e.pointerType === 'mouse') showPopover(e.currentTarget, tip(f.active)[0], [tip(f.active)[1]]);
                    }}
                    onPointerLeave={() => (popover.value = null)}
                    onClick={(e) => {
                      const el = e.currentTarget;
                      const next = !f.active;
                      save('fixedItems', { ...f, active: next });
                      // 마우스로 누른 경우 바뀐 상태의 설명으로 바로 갱신한다
                      if ((e as unknown as PointerEvent).pointerType === 'mouse' || el.matches(':hover'))
                        showPopover(el, tip(next)[0], [tip(next)[1]]);
                    }}
                  >
                    <Ui name={f.active ? 'Eye' : 'EyeOff'} size={16} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {editor ? <FixedEditor initial={editor.item} draft={editor.draft} onClose={() => setEditor(null)} /> : null}
    </div>
  );
}
