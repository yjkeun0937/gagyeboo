import { useMemo, useRef, useState } from 'preact/hooks';
import { suggestStores } from '../lib/calc';
import { isValidYmd, ymOf } from '../lib/dates';
import { digitsOnly, won } from '../lib/format';
import type { Entry, ID } from '../lib/types';
import {
  addEntry,
  categoriesSorted,
  entries,
  groupsSorted,
  nameTaken,
  nextOrder,
  payDetails,
  payDetailsSorted,
  payMethodsSorted,
  personsSorted,
  removeEntry,
  restoreEntry,
  save,
  showToast,
  storeIndex,
  today,
  updateEntry,
  users,
  viewMonth,
} from '../store/store';
import { uid } from '../lib/format';
import { CategoryDot, COLOR_CHOICES, PayGlyph, Ui, UserGlyph } from '../ui/icons';
import { closeSheet, openCopy, sheet } from '../ui/nav';
import { askConfirm, Sheet } from '../ui/overlay';

interface Form {
  date: string;
  store: string;
  memo: string;
  category: ID | null;
  amount: string; // 숫자만
  user: ID | null;
  payMethod: ID | null;
  payDetail: ID | null;
  isEstimate: boolean;
}

function initialForm(): { form: Form; entry?: Entry } {
  const s = sheet.value!;
  if (s.mode === 'edit') {
    const e = s.entry;
    return {
      entry: e,
      form: {
        date: e.date,
        store: e.store,
        memo: e.memo,
        category: e.category,
        amount: String(e.amount),
        user: e.user,
        payMethod: e.payMethod,
        payDetail: e.payDetail,
        isEstimate: !!e.isEstimate,
      },
    };
  }
  if (s.mode === 'copy') {
    const e = s.entry;
    return {
      form: {
        date: today.value,
        store: e.store,
        memo: e.memo,
        category: e.category,
        amount: String(e.amount),
        user: e.user,
        payMethod: e.payMethod,
        payDetail: e.payDetail,
        isEstimate: false,
      },
    };
  }
  const persons = personsSorted.value;
  return {
    form: {
      date: s.date ?? today.value,
      store: '',
      memo: '',
      category: null,
      amount: '',
      user: persons.length === 1 ? persons[0].id : null,
      payMethod: null,
      payDetail: null,
      isEstimate: false,
    },
  };
}

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: preact.ComponentChildren;
  title?: string;
}) {
  return (
    <button type="button" class="chip" aria-pressed={active} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

/** 사용자 선택: 개인 줄 / 그룹 줄, 그리고 바로 개인 추가 */
function UserPicker({ value, onChange }: { value: ID | null; onChange: (v: ID | null) => void }) {
  const persons = personsSorted.value;
  const groups = groupsSorted.value.filter((g) => !g.hidden);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    if (nameTaken('users', n)) {
      setErr('이미 있는 이름입니다');
      return;
    }
    const u = await save('users', {
      id: uid(),
      updatedAt: 0,
      name: n,
      type: 'person',
      memberIds: [],
      icon: null,
      color: COLOR_CHOICES[personsSorted.value.length % COLOR_CHOICES.length],
      order: nextOrder(users.value.filter((x) => x.type === 'person')),
    });
    onChange(u.id);
    setName('');
    setAdding(false);
    setErr('');
  };

  return (
    <div class="picker">
      <div class="chips">
        <Chip active={value === null} onClick={() => onChange(null)}>
          미지정
        </Chip>
        {persons
          .filter((u) => !u.hidden || u.id === value)
          .map((u) => (
            <Chip key={u.id} active={value === u.id} onClick={() => onChange(u.id)}>
              <UserGlyph user={u} size={20} />
              {u.name}
            </Chip>
          ))}
        {!adding ? (
          <button type="button" class="chip chip-add" onClick={() => setAdding(true)}>
            <Ui name="Plus" size={14} />
            개인 추가
          </button>
        ) : null}
      </div>
      {groups.length ? (
        <div class="chips">
          {groups
            .filter((u) => !u.hidden || u.id === value)
            .map((u) => (
              <Chip
                key={u.id}
                active={value === u.id}
                onClick={() => onChange(u.id)}
                title={u.memberIds.map((id) => users.value.find((x) => x.id === id)?.name).join(', ')}
              >
                <UserGlyph user={u} size={20} />
                {u.name}
              </Chip>
            ))}
        </div>
      ) : null}
      {adding ? (
        <div class="inline-add">
          <input
            class="input"
            placeholder="새 개인 이름"
            value={name}
            maxLength={20}
            aria-label="새 개인 이름"
            onInput={(e) => {
              setName(e.currentTarget.value);
              setErr('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
          />
          <button type="button" class="btn small primary" onClick={add}>
            추가
          </button>
          <button
            type="button"
            class="btn small"
            onClick={() => {
              setAdding(false);
              setErr('');
            }}
          >
            취소
          </button>
          {err ? <span class="field-error">{err}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function PayDetailPicker({
  methodId,
  value,
  onChange,
}: {
  methodId: ID | null;
  value: ID | null;
  onChange: (v: ID | null) => void;
}) {
  const method = payMethodsSorted.value.find((m) => m.id === methodId) ?? null;
  const list = payDetailsSorted.value.filter(
    (d) => (!d.hidden || d.id === value) && (d.payMethodId === null || d.payMethodId === methodId),
  );
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLOR_CHOICES[0]);
  const [err, setErr] = useState('');

  if (!method) return <p class="hint">지불수단을 먼저 고르면 카드사·상품권 등을 고를 수 있습니다.</p>;

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    if (nameTaken('payDetails', n)) {
      setErr('이미 있는 이름입니다');
      return;
    }
    const d = await save('payDetails', {
      id: uid(),
      updatedAt: 0,
      name: n,
      payMethodId: method.id,
      color,
      order: nextOrder(payDetails.value),
    });
    onChange(d.id);
    setName('');
    setAdding(false);
    setErr('');
  };

  return (
    <div class="picker">
      <div class="chips">
        <Chip active={value === null} onClick={() => onChange(null)}>
          선택 안 함
        </Chip>
        {list.map((d) => (
          <Chip key={d.id} active={value === d.id} onClick={() => onChange(d.id)}>
            <PayGlyph method={method} detail={d} size={20} />
            {d.name}
          </Chip>
        ))}
        {!adding ? (
          <button type="button" class="chip chip-add" onClick={() => setAdding(true)}>
            <Ui name="Plus" size={14} />
            {method.name} 상세 추가
          </button>
        ) : null}
      </div>
      {adding ? (
        <div class="inline-add stack">
          <div class="inline-add">
            <input
              class="input"
              placeholder="이름 (예: 카드사)"
              value={name}
              maxLength={20}
              aria-label="결제상세 이름"
              onInput={(e) => {
                setName(e.currentTarget.value);
                setErr('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
            />
            <button type="button" class="btn small primary" onClick={add}>
              추가
            </button>
            <button
              type="button"
              class="btn small"
              onClick={() => {
                setAdding(false);
                setErr('');
              }}
            >
              취소
            </button>
          </div>
          <div class="swatches" role="radiogroup" aria-label="색상">
            {COLOR_CHOICES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                class="swatch"
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          {err ? <span class="field-error">{err}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

export function EntrySheet() {
  const s = sheet.value!;
  const init = useMemo(initialForm, [s]);
  const [form, setForm] = useState<Form>(init.form);
  const [error, setError] = useState('');
  const [focusStore, setFocusStore] = useState(false);
  const [busy, setBusy] = useState(false);
  const storeRef = useRef<HTMLInputElement>(null);
  const initialJson = useRef(JSON.stringify(init.form));
  const mode = s.mode;
  const editing = init.entry;

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== initialJson.current;

  const requestClose = async () => {
    if (dirty && mode !== 'edit') {
      const ok = await askConfirm({
        title: '입력 중인 내용을 닫을까요?',
        message: '저장하지 않은 내용은 사라집니다.',
        confirmLabel: '닫기',
        cancelLabel: '계속 입력',
        danger: true,
      });
      if (!ok) return;
    } else if (dirty) {
      const ok = await askConfirm({
        title: '수정한 내용을 버릴까요?',
        confirmLabel: '버리기',
        cancelLabel: '계속 수정',
        danger: true,
      });
      if (!ok) return;
    }
    closeSheet();
  };

  const suggestions = useMemo(
    () => (focusStore ? suggestStores(storeIndex.value, form.store, 6) : []),
    [focusStore, form.store, storeIndex.value],
  );

  /** 이전에 쓴 사용처이면, 비어 있는 칸을 마지막 내역 값으로 채운다. */
  const autofill = (store: string) => {
    if (mode === 'edit') return;
    const hit = storeIndex.value.find((x) => x.store === store.trim());
    if (!hit) return;
    const l = hit.last;
    setForm((f) => ({
      ...f,
      store: hit.store,
      memo: f.memo || l.memo,
      category: f.category ?? l.category,
      amount: f.amount || String(l.amount),
      user: f.user ?? l.user,
      payMethod: f.payMethod ?? l.payMethod,
      payDetail: f.payMethod ? f.payDetail : (l.payMethod ? l.payDetail : f.payDetail),
    }));
  };

  const amountNum = Number(form.amount || 0);

  const submit = async (keepOpen: boolean) => {
    if (busy) return;
    if (!isValidYmd(form.date)) return setError('날짜를 확인해 주세요');
    if (!form.store.trim() && !form.memo.trim()) return setError('사용처나 명세 중 하나는 적어 주세요');
    if (!(amountNum > 0)) return setError('금액을 입력해 주세요');
    setError('');

    if (form.date > today.value && (!editing || editing.date !== form.date)) {
      const ok = await askConfirm({
        title: '오늘 이후 날짜입니다',
        message: '[예정]으로 표시되며, 합계에는 포함됩니다. 이대로 저장할까요?',
        confirmLabel: '저장',
      });
      if (!ok) return;
    }

    setBusy(true);
    try {
      const input = {
        date: form.date,
        store: form.store.trim(),
        memo: form.memo.trim(),
        category: form.category,
        amount: amountNum,
        user: form.user,
        payMethod: form.payMethod,
        payDetail: form.payMethod ? form.payDetail : null,
      };
      if (editing) {
        const prev = await updateEntry(editing.id, input);
        viewMonth.value = ymOf(form.date);
        showToast('수정했습니다', prev ? () => restoreEntry(prev) : undefined);
        closeSheet();
        return;
      }
      const created = await addEntry({ ...input, isEstimate: form.isEstimate });
      viewMonth.value = ymOf(form.date);
      showToast('저장했습니다', async () => {
        await removeEntry(created.id);
      });
      if (keepOpen) {
        const next: Form = {
          ...form,
          store: '',
          memo: '',
          category: null,
          amount: '',
          isEstimate: false,
        };
        initialJson.current = JSON.stringify(next);
        setForm(next);
        setTimeout(() => storeRef.current?.focus(), 0);
      } else {
        closeSheet();
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    const ok = await askConfirm({
      title: '이 내역을 삭제할까요?',
      message: `${editing.store || editing.memo} · ${won(editing.amount)}원`,
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    const prev = await removeEntry(editing.id);
    showToast('삭제했습니다', prev ? () => restoreEntry(prev) : undefined);
    closeSheet();
  };

  const title = mode === 'edit' ? '내역 수정' : mode === 'copy' ? '복사해서 새로 입력' : '지출 입력';
  const exists = entries.value.length > 0;

  return (
    <Sheet
      title={title}
      onRequestClose={requestClose}
      footer={
        <>
          {editing ? (
            <>
              <button type="button" class="btn danger-ghost" onClick={remove}>
                <Ui name="Trash2" size={16} />
                삭제
              </button>
              <button
                type="button"
                class="btn"
                onClick={() => {
                  openCopy(editing);
                }}
              >
                <Ui name="Copy" size={16} />
                복사
              </button>
              <span class="grow" />
            </>
          ) : (
            <button type="button" class="btn" disabled={busy} onClick={() => submit(true)}>
              저장 후 계속 입력
            </button>
          )}
          <button type="button" class="btn primary" disabled={busy} onClick={() => submit(false)}>
            저장
          </button>
        </>
      }
    >
      <form
        class="entry-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <div class="field">
          <label for="f-date">날짜</label>
          <input
            id="f-date"
            class="input"
            type="date"
            value={form.date}
            onInput={(e) => set({ date: e.currentTarget.value })}
          />
          {isValidYmd(form.date) && form.date > today.value ? (
            <span class="hint">오늘 이후 날짜 — [예정]으로 표시됩니다</span>
          ) : null}
        </div>

        <div class="field suggest-wrap">
          <label for="f-store">사용처</label>
          <input
            id="f-store"
            ref={storeRef}
            class="input"
            type="text"
            value={form.store}
            autoComplete="off"
            maxLength={60}
            placeholder={exists ? '예: 마트, 식당 이름' : '사용처'}
            onInput={(e) => set({ store: e.currentTarget.value })}
            onFocus={() => setFocusStore(true)}
            onBlur={() => {
              setFocusStore(false);
              autofill(form.store);
            }}
            // 모바일에서도 처음 입력 시 바로 쓸 수 있도록
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus={mode !== 'edit'}
          />
          {suggestions.length ? (
            <ul class="suggest" role="listbox" aria-label="사용처 후보">
              {suggestions.map((x) => (
                <li
                  key={x.store}
                  role="option"
                  aria-selected={false}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setFocusStore(false);
                    set({ store: x.store });
                    autofill(x.store);
                  }}
                >
                  <span>{x.store}</span>
                  <small>
                    {x.count}회 · 마지막 {won(x.last.amount)}원
                  </small>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div class="field">
          <label for="f-memo">명세</label>
          <input
            id="f-memo"
            class="input"
            type="text"
            value={form.memo}
            maxLength={100}
            placeholder="선택"
            onInput={(e) => set({ memo: e.currentTarget.value })}
          />
        </div>

        <div class="field">
          <span class="label">분류</span>
          <div class="chips">
            <Chip active={form.category === null} onClick={() => set({ category: null })}>
              미분류
            </Chip>
            {categoriesSorted.value
              .filter((c) => !c.hidden || c.id === form.category)
              .map((c) => (
                <Chip key={c.id} active={form.category === c.id} onClick={() => set({ category: c.id })}>
                  <CategoryDot color={c.color} />
                  {c.name}
                </Chip>
              ))}
          </div>
        </div>

        <div class="field">
          <label for="f-amount">
            금액 <small class="unit">원</small>
            {form.isEstimate ? <span class="pill pill-estimate">예상</span> : null}
          </label>
          <input
            id="f-amount"
            class="input amount-input num"
            inputMode="numeric"
            type="text"
            value={form.amount ? won(Number(form.amount)) : ''}
            placeholder="0"
            autoComplete="off"
            onInput={(e) => {
              const d = digitsOnly(e.currentTarget.value).slice(0, 10);
              set({ amount: d.replace(/^0+(?=\d)/, ''), isEstimate: false });
            }}
          />
          <div class="quick">
            {[1000, 10000, 50000].map((n) => (
              <button
                key={n}
                type="button"
                class="btn small"
                onClick={() => set({ amount: String(amountNum + n), isEstimate: false })}
              >
                +{won(n)}
              </button>
            ))}
            <button type="button" class="btn small" onClick={() => set({ amount: '' })}>
              지우기
            </button>
          </div>
        </div>

        <div class="field">
          <span class="label">사용자</span>
          <UserPicker value={form.user} onChange={(v) => set({ user: v })} />
        </div>

        <div class="field">
          <span class="label">지불수단</span>
          <div class="chips">
            <Chip
              active={form.payMethod === null}
              onClick={() => set({ payMethod: null, payDetail: null })}
            >
              미지정
            </Chip>
            {payMethodsSorted.value
              .filter((m) => !m.hidden || m.id === form.payMethod)
              .map((m) => (
                <Chip
                  key={m.id}
                  active={form.payMethod === m.id}
                  onClick={() => {
                    const keep =
                      form.payDetail &&
                      payDetails.value.find((d) => d.id === form.payDetail)?.payMethodId === m.id;
                    set({ payMethod: m.id, payDetail: keep ? form.payDetail : null });
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
          <PayDetailPicker
            methodId={form.payMethod}
            value={form.payDetail}
            onChange={(v) => set({ payDetail: v })}
          />
        </div>

        {editing?.source === 'fixed' ? (
          <p class="hint">고정지출에서 만들어진 내역입니다.</p>
        ) : null}
        {error ? (
          <p class="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {/* Enter로 저장되게 하는 숨은 제출 버튼 */}
        <button type="submit" class="visually-hidden" tabIndex={-1}>
          저장
        </button>
      </form>
    </Sheet>
  );
}
