import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  ASSET_CATEGORIES,
  END_REASON_LABEL,
  FIELD_LABEL,
  STATE_LABEL,
  STATE_ORDER,
  TAX_LABEL,
  amountDelta,
  categoryDef,
  fieldsFor,
  formatAt,
  formatValue,
} from '../lib/assets';
import { isValidYmd } from '../lib/dates';
import { digitsOnly, won } from '../lib/format';
import type { Asset, AssetCategory, AssetLog, AssetState, AssetTax, EndReason, ID } from '../lib/types';
import {
  addAsset,
  assetLogs,
  assets,
  groupsSorted,
  personsSorted,
  purgeAsset,
  setAssetState,
  showToast,
  today,
  undoAssetChange,
  updateAsset,
  usersById,
} from '../store/store';
import { Ui, UserGlyph } from '../ui/icons';
import { closeAssetSheet, assetSheet } from '../ui/nav';
import { askConfirm, Sheet } from '../ui/overlay';
import { Chip } from './EntrySheet';

interface Form {
  category: AssetCategory;
  name: string;
  kind: string;
  owner: ID | null;
  amount: string; // 숫자만
  payStatus: string;
  coverage: string;
  term: string;
  rate: string;
  maturity: string;
  tax: AssetTax | null;
  memo: string;
  inCash: boolean;
}

const fromAsset = (a: Asset): Form => ({
  category: a.category,
  name: a.name,
  kind: a.kind,
  owner: a.owner,
  amount: a.amount == null ? '' : String(a.amount),
  payStatus: a.payStatus,
  coverage: a.coverage,
  term: a.term,
  rate: a.rate == null ? '' : String(a.rate),
  maturity: a.maturity ?? '',
  tax: a.tax,
  memo: a.memo,
  inCash: a.inCash,
});

function initialForm(): { form: Form; asset?: Asset } {
  const s = assetSheet.value!;
  if (s.mode === 'add') {
    const category = s.category ?? 'deposit';
    return {
      form: {
        category,
        name: '',
        kind: '',
        owner: null,
        amount: '',
        payStatus: '',
        coverage: '',
        term: '',
        rate: '',
        maturity: '',
        tax: null,
        memo: '',
        inCash: categoryDef(category).inCash,
      },
    };
  }
  const a = assets.value.find((x) => x.id === s.id);
  if (!a) return { form: initialForm.empty() };
  return { form: fromAsset(a), asset: a };
}
initialForm.empty = (): Form => ({
  category: 'other',
  name: '',
  kind: '',
  owner: null,
  amount: '',
  payStatus: '',
  coverage: '',
  term: '',
  rate: '',
  maturity: '',
  tax: null,
  memo: '',
  inCash: false,
});

const ownerName = (id: ID) => usersById.value.get(id)?.name ?? '(삭제된 사용자)';

/** 변경 이력 한 줄 */
function LogItem({ l }: { l: AssetLog }) {
  const ctx = { userName: ownerName };
  const label = l.kind === 'create' ? '등록' : l.kind === 'state' ? '상태 변경' : '수정';
  return (
    <li class="log-item">
      <div class="log-head">
        <b>{label}</b>
        <time class="num">{formatAt(l.at)}</time>
      </div>
      <ul class="log-changes">
        {l.changes.map((c) => {
          const delta = amountDelta(c);
          return (
            <li key={c.field}>
              <span class="log-field">{FIELD_LABEL[c.field] ?? c.field}</span>
              {l.kind === 'create' ? (
                <span>{formatValue(c.field, c.to, ctx)}</span>
              ) : (
                <span>
                  {formatValue(c.field, c.from, ctx)} → <b>{formatValue(c.field, c.to, ctx)}</b>
                  {delta ? <small class="num"> ({delta})</small> : null}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {l.note ? <p class="log-note">메모: {l.note}</p> : null}
    </li>
  );
}

export function AssetSheet() {
  const s = assetSheet.value!;
  const init = useMemo(initialForm, [s]);
  const editing = s.mode === 'edit' ? init.asset : undefined;
  const mode = s.mode;
  const [form, setForm] = useState<Form>(init.form);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cashTouched, setCashTouched] = useState(mode !== 'add');
  const [customKind, setCustomKind] = useState(() => !!init.form.kind && !categoryDef(init.form.category).kinds.includes(init.form.kind));
  const [endPanel, setEndPanel] = useState<{ reason: EndReason; endedOn: string } | null>(null);
  const initialJson = useRef(JSON.stringify(init.form));
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  // 새 항목은 이름부터, 수정은 금액부터 (금액만 바꾸는 경우가 가장 많다)
  useEffect(() => {
    (mode === 'edit' ? amountRef.current : nameRef.current)?.focus();
  }, []);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== initialJson.current || note.trim() !== '';

  const def = categoryDef(form.category);
  const optional = fieldsFor(form.category, form.kind);
  const names = useMemo(
    () => [...new Set(assets.value.filter((a) => a.category === form.category).map((a) => a.name))].sort((a, b) => a.localeCompare(b, 'ko')),
    [assets.value, form.category],
  );
  const logs = useMemo(
    () => (editing ? assetLogs.value.filter((l) => l.assetId === editing.id).sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1)) : []),
    [assetLogs.value, editing?.id],
  );

  if (mode !== 'add' && !init.asset) {
    // 열려 있는 동안 다른 기기에서 지워진 경우
    queueMicrotask(closeAssetSheet);
    return null;
  }

  const requestClose = async () => {
    if (dirty) {
      const ok = await askConfirm({
        title: mode === 'edit' ? '수정한 내용을 버릴까요?' : '입력 중인 내용을 닫을까요?',
        message: mode === 'edit' ? undefined : '저장하지 않은 내용은 사라집니다.',
        confirmLabel: mode === 'edit' ? '버리기' : '닫기',
        cancelLabel: '계속 입력',
        danger: true,
      });
      if (!ok) return;
    }
    closeAssetSheet();
  };

  const pickCategory = (c: AssetCategory) => {
    if (c === form.category) return;
    const d = categoryDef(c);
    setCustomKind(false);
    setForm((f) => ({ ...f, category: c, kind: '', inCash: cashTouched ? f.inCash : d.inCash }));
  };

  const submit = async () => {
    if (busy) return;
    const name = form.name.trim();
    if (!name) return setError(`${def.nameLabel}을(를) 적어 주세요`);
    let amount: number | null = null;
    if (form.amount) amount = Number(form.amount);
    else if (def.amountRequired) return setError('금액을 입력해 주세요');
    let rate: number | null = null;
    if (optional.includes('rate') && form.rate.trim()) {
      rate = Number(form.rate.trim());
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) return setError('이율은 0~100 사이 숫자로 적어 주세요');
    }
    if (optional.includes('maturity') && form.maturity && !isValidYmd(form.maturity)) return setError('만기일을 확인해 주세요');
    setError('');
    const input = {
      category: form.category,
      name,
      kind: form.kind.trim(),
      owner: form.owner,
      amount,
      payStatus: form.payStatus,
      coverage: form.coverage,
      term: form.term,
      rate,
      maturity: form.maturity || null,
      tax: form.tax,
      memo: form.memo.trim(),
      inCash: form.inCash,
    };
    setBusy(true);
    try {
      if (editing) {
        const u = await updateAsset(editing.id, input, note);
        showToast(u ? '수정했습니다' : '바뀐 내용이 없습니다', u ? () => undoAssetChange(u) : undefined);
      } else {
        const created = await addAsset(input, note);
        showToast('추가했습니다', () => purgeAsset(created.id));
      }
      closeAssetSheet();
    } finally {
      setBusy(false);
    }
  };

  const moveTo = async (to: AssetState, opts?: { reason?: EndReason; endedOn?: string }) => {
    if (!editing || busy) return;
    setBusy(true);
    try {
      const u = await setAssetState(editing.id, to, opts);
      if (u) showToast(`${STATE_LABEL[to]}(으)로 옮겼습니다`, () => undoAssetChange(u));
      closeAssetSheet();
    } finally {
      setBusy(false);
    }
  };

  const purge = async () => {
    if (!editing) return;
    const ok = await askConfirm({
      title: '완전히 삭제할까요?',
      message: `「${editing.name}」과(와) 변경 이력(${logs.length}건)이 모두 지워지고 되돌릴 수 없습니다. 다시 볼 필요가 없을 때만 삭제하세요.`,
      confirmLabel: '완전 삭제',
      danger: true,
    });
    if (!ok) return;
    await purgeAsset(editing.id);
    showToast('완전히 삭제했습니다');
    closeAssetSheet();
  };

  const title = mode === 'edit' ? `${STATE_LABEL[editing!.state]} 항목` : mode === 'copy' ? '복사해서 새로 등록' : '재산 항목 추가';
  const owners = [...personsSorted.value, ...groupsSorted.value].filter((u) => !u.hidden || u.id === form.owner);

  return (
    <Sheet
      title={title}
      onRequestClose={requestClose}
      footer={
        <>
          {editing ? (
            <>
              <button type="button" class="btn danger-ghost" onClick={purge}>
                <Ui name="Trash2" size={16} />
                완전 삭제
              </button>
              <span class="grow" />
            </>
          ) : null}
          <button type="button" class="btn primary" disabled={busy} onClick={submit}>
            저장
          </button>
        </>
      }
    >
      <form
        class="entry-form asset-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div class="field">
          <span class="label">분류</span>
          <div class="chips">
            {ASSET_CATEGORIES.map((c) => (
              <Chip key={c.id} active={form.category === c.id} onClick={() => pickCategory(c.id)}>
                {c.label}
              </Chip>
            ))}
          </div>
        </div>

        <div class="field">
          <label for="a-name">{def.nameLabel}</label>
          <input
            id="a-name"
            ref={nameRef}
            class="input"
            type="text"
            list="asset-names"
            value={form.name}
            maxLength={40}
            autoComplete="off"
            placeholder={def.nameLabel}
            onInput={(e) => set({ name: e.currentTarget.value })}
          />
          <datalist id="asset-names">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>

        <div class="field">
          <span class="label">종류</span>
          {def.kinds.length ? (
            <div class="chips">
              {def.kinds.map((k) => (
                <Chip
                  key={k}
                  active={!customKind && form.kind === k}
                  onClick={() => {
                    setCustomKind(false);
                    set({ kind: form.kind === k ? '' : k });
                  }}
                >
                  {k}
                </Chip>
              ))}
              <Chip
                active={customKind}
                onClick={() => {
                  setCustomKind(true);
                  if (def.kinds.includes(form.kind)) set({ kind: '' });
                }}
              >
                직접 입력
              </Chip>
            </div>
          ) : null}
          {customKind || !def.kinds.length ? (
            <input
              class="input"
              type="text"
              value={form.kind}
              maxLength={30}
              aria-label="종류 직접 입력"
              placeholder="종류 (예: 정기예금)"
              onInput={(e) => set({ kind: e.currentTarget.value })}
            />
          ) : null}
        </div>

        <div class="field">
          <label for="a-amount">
            금액 <small class="unit">원</small>
            {!def.amountRequired ? <small class="unit"> (모르면 비워 두세요)</small> : null}
          </label>
          <input
            id="a-amount"
            ref={amountRef}
            class="input amount-input num"
            inputMode="numeric"
            type="text"
            value={form.amount ? won(Number(form.amount)) : ''}
            placeholder={def.amountRequired ? '0' : '미정'}
            autoComplete="off"
            onInput={(e) => set({ amount: digitsOnly(e.currentTarget.value).slice(0, 13).replace(/^0+(?=\d)/, '') })}
            onFocus={(e) => mode === 'edit' && e.currentTarget.select()}
          />
        </div>

        <div class="field">
          <span class="label">소유자</span>
          <div class="chips">
            <Chip active={form.owner === null} onClick={() => set({ owner: null })}>
              선택 안 함
            </Chip>
            {owners.map((u) => (
              <Chip key={u.id} active={form.owner === u.id} onClick={() => set({ owner: u.id })}>
                <UserGlyph user={u} size={20} />
                {u.name}
              </Chip>
            ))}
          </div>
        </div>

        {optional.includes('payStatus') ? (
          <div class="field">
            <label for="a-pay">납입 상태</label>
            <div class="chips">
              {['납입중', '납입완료'].map((p) => (
                <Chip key={p} active={form.payStatus === p} onClick={() => set({ payStatus: form.payStatus === p ? '' : p })}>
                  {p}
                </Chip>
              ))}
            </div>
            <input id="a-pay" class="input" type="text" value={form.payStatus} maxLength={30} placeholder="직접 입력도 가능" onInput={(e) => set({ payStatus: e.currentTarget.value })} />
          </div>
        ) : null}
        {optional.includes('coverage') ? (
          <div class="field">
            <label for="a-cov">보장·조건</label>
            <input id="a-cov" class="input" type="text" value={form.coverage} maxLength={60} placeholder="예: 100세 보장" onInput={(e) => set({ coverage: e.currentTarget.value })} />
          </div>
        ) : null}
        {optional.includes('term') ? (
          <div class="field">
            <label for="a-term">기간</label>
            <input id="a-term" class="input" type="text" value={form.term} maxLength={20} placeholder="예: 1년, 23개월" onInput={(e) => set({ term: e.currentTarget.value })} />
          </div>
        ) : null}
        {optional.includes('rate') ? (
          <div class="field">
            <label for="a-rate">
              이율 <small class="unit">%</small>
            </label>
            <input id="a-rate" class="input num" inputMode="decimal" type="text" value={form.rate} maxLength={6} placeholder="예: 3.2" onInput={(e) => set({ rate: e.currentTarget.value.replace(/[^\d.]/g, '') })} />
          </div>
        ) : null}
        {optional.includes('maturity') ? (
          <div class="field">
            <label for="a-mat">만기일</label>
            <input id="a-mat" class="input" type="date" value={form.maturity} onInput={(e) => set({ maturity: e.currentTarget.value })} />
          </div>
        ) : null}
        {optional.includes('tax') ? (
          <div class="field">
            <span class="label">과세</span>
            <div class="chips">
              <Chip active={form.tax === null} onClick={() => set({ tax: null })}>
                선택 안 함
              </Chip>
              {(['taxable', 'taxfree'] as const).map((t) => (
                <Chip key={t} active={form.tax === t} onClick={() => set({ tax: t })}>
                  {TAX_LABEL[t]}
                </Chip>
              ))}
            </div>
          </div>
        ) : null}

        <div class="field">
          <span class="label">현금 총계</span>
          <label class="check">
            <input
              type="checkbox"
              checked={form.inCash}
              onChange={(e) => {
                setCashTouched(true);
                set({ inCash: e.currentTarget.checked });
              }}
            />
            현금 총계에 포함
          </label>
        </div>

        <div class="field">
          <label for="a-memo">비고</label>
          <input id="a-memo" class="input" type="text" value={form.memo} maxLength={100} placeholder="선택 (용도 등)" onInput={(e) => set({ memo: e.currentTarget.value })} />
        </div>

        {mode !== 'copy' ? (
          <div class="field">
            <label for="a-note">변경 메모 <small class="unit">(선택, 이력에 남습니다)</small></label>
            <input id="a-note" class="input" type="text" value={note} maxLength={100} placeholder={editing ? '예: 이자 입금' : '예: 신규 가입'} onInput={(e) => setNote(e.currentTarget.value)} />
          </div>
        ) : null}

        {error ? (
          <p class="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" class="visually-hidden" tabIndex={-1}>
          저장
        </button>

        {editing ? (
          <>
            <div class="field asset-state-box">
              <span class="label">상태</span>
              <p class="asset-state-now">
                현재 <b>{STATE_LABEL[editing.state]}</b>
                {editing.state === 'ended'
                  ? ` · ${editing.endReason ? END_REASON_LABEL[editing.endReason] : '종료'} ${editing.endedOn ?? ''}`
                  : ''}
              </p>
              {dirty ? <p class="hint">수정한 내용을 먼저 저장하면 상태를 바꿀 수 있습니다.</p> : null}
              <div class="chips">
                {STATE_ORDER.filter((st) => st !== editing.state).map((st) => (
                  <button
                    key={st}
                    type="button"
                    class="btn small"
                    disabled={dirty || busy}
                    onClick={() => {
                      if (st === 'ended') setEndPanel(endPanel ? null : { reason: 'matured', endedOn: today.value });
                      else moveTo(st);
                    }}
                  >
                    {STATE_LABEL[st]}
                    {st === 'active' ? '로 되돌리기' : st === 'ended' ? '로 옮기기…' : '으로 옮기기'}
                  </button>
                ))}
              </div>
              {endPanel && !dirty ? (
                <div class="asset-end-panel">
                  <span class="small-label">종료 사유</span>
                  <div class="chips">
                    {(Object.keys(END_REASON_LABEL) as EndReason[]).map((r) => (
                      <Chip key={r} active={endPanel.reason === r} onClick={() => setEndPanel({ ...endPanel, reason: r })}>
                        {END_REASON_LABEL[r]}
                      </Chip>
                    ))}
                  </div>
                  <label class="small-label" for="a-endon">종료일</label>
                  <input id="a-endon" class="input" type="date" value={endPanel.endedOn} onInput={(e) => setEndPanel({ ...endPanel, endedOn: e.currentTarget.value })} />
                  <button
                    type="button"
                    class="btn primary"
                    disabled={busy || !isValidYmd(endPanel.endedOn)}
                    onClick={() => moveTo('ended', { reason: endPanel.reason, endedOn: endPanel.endedOn })}
                  >
                    종료 처리
                  </button>
                </div>
              ) : null}
            </div>

            <details class="acc asset-history">
              <summary>변경 이력 ({logs.length}건)</summary>
              <div class="acc-body">
                {logs.length ? (
                  <ol class="log-list">
                    {logs.map((l) => (
                      <LogItem key={l.id} l={l} />
                    ))}
                  </ol>
                ) : (
                  <p class="hint">이력이 없습니다.</p>
                )}
              </div>
            </details>
          </>
        ) : null}
      </form>
    </Sheet>
  );
}
