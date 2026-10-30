import { useMemo, useRef, useState } from 'preact/hooks';
import {
  FIELD_LABEL,
  FIELD_ORDER,
  FLAG_LABEL,
  collectUsers,
  detectMapping,
  extractRows,
  listSheets,
  makePreview,
  normName,
  readUserSheet,
  text,
  validateUserSetup,
  type ColumnMap,
  type FieldKey,
  type ImportRow,
  type RowFlag,
  type SheetInfo,
  type UserChoice,
  type UserSetup,
} from '../lib/importer';
import { uid, won } from '../lib/format';
import { colLetter, readXlsx, type Workbook } from '../lib/xlsx';
import { commitImport, categories, entries, nextStamp, payDetails, payMethods, showToast, users, usersSorted } from '../store/store';
import { COLOR_CHOICES, PAY_ICON_CHOICES, Ui } from '../ui/icons';
import { Modal } from '../ui/overlay';
import { todayKST } from '../lib/dates';

type Step = 'file' | 'sheets' | 'users' | 'preview' | 'done';

const STEP_NO: Record<Step, number> = { file: 1, sheets: 2, users: 3, preview: 4, done: 4 };
const STEP_NAME: Record<Step, string> = { file: '파일 선택', sheets: '시트와 열', users: '사용자 확인', preview: '미리보기', done: '완료' };

interface Loaded {
  name: string;
  wb: Workbook;
  infos: SheetInfo[];
}

const emptyMap = (): ColumnMap => ({
  headerRow: 0,
  cols: { date: null, store: null, memo: null, category: null, amount: null, user: null, payMethod: null, payDetail: null },
});

function mapProblem(m: ColumnMap | null): string | null {
  if (!m) return '열을 정해 주세요';
  if (m.cols.date === null) return '날짜 열을 정해 주세요';
  if (m.cols.amount === null) return '금액 열을 정해 주세요';
  if (m.cols.store === null && m.cols.memo === null && m.cols.category === null) return '사용처·명세·분류 중 하나 이상의 열을 정해 주세요';
  const used = Object.values(m.cols).filter((x): x is number => x !== null);
  if (new Set(used).size !== used.length) return '같은 열을 두 항목에 지정할 수 없습니다';
  return null;
}

export function ImportWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('file');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [mapEdit, setMapEdit] = useState<ColumnMap | null>(null);
  const [setup, setSetup] = useState<UserSetup>({ choices: new Map(), extraPersons: [], blankUserId: null });
  const [overrides, setOverrides] = useState<Map<number, boolean>>(new Map());
  const [showAllFlags, setShowAllFlags] = useState(false);
  const [result, setResult] = useState<{ count: number; sum: number; lists: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const batchId = useRef(`imp_${Date.now()}`);

  /* 읽은 시트 → 열 인식 → 줄 */
  const selectedList = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);
  const autoMap = useMemo(() => {
    if (!loaded) return null;
    for (const i of selectedList) {
      const m = detectMapping(loaded.wb.sheets[i]);
      if (m) return m;
    }
    return null;
  }, [loaded, selectedList]);
  const map = mapEdit ?? autoMap;
  const problem = mapProblem(map);

  const extracted = useMemo(() => {
    const out = { rows: [] as ImportRow[], skipped: 0, per: new Map<number, { count: number; sum: number }>() };
    if (!loaded || !map || mapProblem(map)) return out;
    for (const i of selectedList) {
      const ex = extractRows(loaded.wb.sheets[i], map);
      out.skipped += ex.skippedNoAmount;
      out.per.set(i, { count: ex.rows.length, sum: ex.rows.reduce((a, r) => a + r.amount, 0) });
      for (const r of ex.rows) out.rows.push({ ...r, idx: out.rows.length });
    }
    return out;
  }, [loaded, map, selectedList]);
  const rows = extracted.rows;

  const userInfo = useMemo(() => collectUsers(rows, users.value), [rows, users.value]);
  const userErrors = validateUserSetup(userInfo.refs, setup, users.value);

  const preview = useMemo(() => {
    if (step !== 'preview') return null;
    return makePreview(
      rows,
      {
        lookup: {
          users: users.value,
          categories: categories.value,
          payMethods: payMethods.value,
          payDetails: payDetails.value,
          entries: entries.value,
        },
        setup,
        today: todayKST(),
        colors: COLOR_CHOICES,
        payIcon: PAY_ICON_CHOICES[0],
        newId: uid,
        stamp: nextStamp,
        batchId: batchId.current,
        now: Date.now(),
      },
      overrides,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step === 'preview', rows, setup, overrides]);

  /* ───── 파일 읽기 ───── */
  const pick = async (file: File) => {
    setErr('');
    if (/\.xls$/i.test(file.name)) {
      setErr('.xls(옛 형식)은 읽을 수 없습니다. 엑셀에서 .xlsx로 저장해 다시 선택해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const wb = readXlsx(new Uint8Array(await file.arrayBuffer()));
      const infos = listSheets(wb);
      if (!infos.length) throw new Error('시트가 없는 파일입니다');
      let sel = infos.filter((i) => i.ym && !i.hidden).map((i) => i.index);
      if (!sel.length) sel = infos.filter((i) => i.name.trim() === '내역').map((i) => i.index);
      setLoaded({ name: file.name, wb, infos });
      setSelected(new Set(sel));
      setMapEdit(null);
      setOverrides(new Map());
      setSetup({ choices: new Map(), extraPersons: [], blankUserId: null });
      setStep('sheets');
    } catch (e) {
      setErr(e instanceof Error ? e.message : '파일을 읽지 못했습니다');
    } finally {
      setBusy(false);
    }
  };

  /* ───── 사용자 단계 준비: 내보낸 파일의 `사용자` 시트가 있으면 구분·구성원을 제안한다 ───── */
  const toUsers = () => {
    if (!userInfo.refs.length && !userInfo.blank) return setStep('preview');
    const sug = loaded ? readUserSheet(loaded.wb) : [];
    const choices = new Map(setup.choices);
    const extra = [...setup.extraPersons];
    const known = new Set(users.value.map((u) => normName(u.name)));
    for (const r of userInfo.refs) {
      if (r.matchedId || choices.has(r.key)) continue;
      const s = sug.find((x) => normName(x.name) === r.key);
      if (!s) continue;
      if (s.type === 'person') choices.set(r.key, { kind: 'person' });
      else {
        choices.set(r.key, { kind: 'group', members: s.members });
        for (const m of s.members) {
          const k = normName(m);
          if (!known.has(k) && !userInfo.refs.some((x) => x.key === k) && !extra.some((x) => normName(x) === k)) extra.push(m);
        }
      }
    }
    // 제안된 그룹 구성원이 파일 안의 다른 값이면 개인으로 둔다 (제안이 있을 때만)
    for (const r of userInfo.refs) {
      if (r.matchedId || choices.has(r.key)) continue;
      const isMember = [...choices.values()].some((c) => c.kind === 'group' && c.members.some((m) => normName(m) === r.key));
      if (isMember) choices.set(r.key, { kind: 'person' });
    }
    setSetup({ ...setup, choices, extraPersons: extra });
    setStep('users');
  };

  const confirm = async () => {
    if (!preview || preview.count === 0 || busy) return;
    setBusy(true);
    try {
      await commitImport(preview.plan, loaded?.name ?? '');
      const lists = preview.plan.users.length + preview.plan.categories.length + preview.plan.payMethods.length + preview.plan.payDetails.length;
      setResult({ count: preview.count, sum: preview.sum, lists });
      setStep('done');
    } catch (e) {
      showToast(`가져오지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  /* ───── 화면 ───── */
  const goBack = () => {
    if (step === 'sheets') setStep('file');
    else if (step === 'users') setStep('sheets');
    else if (step === 'preview') setStep(userInfo.refs.length || userInfo.blank ? 'users' : 'sheets');
  };

  let footer;
  if (step === 'done') {
    footer = (
      <button type="button" class="btn primary" data-autofocus onClick={onClose}>
        닫기
      </button>
    );
  } else {
    footer = (
      <>
        {step !== 'file' ? (
          <button type="button" class="btn" onClick={goBack} disabled={busy}>
            이전
          </button>
        ) : (
          <button type="button" class="btn" onClick={onClose}>
            취소
          </button>
        )}
        <span class="grow" />
        {step === 'sheets' ? (
          <button type="button" class="btn primary" disabled={!rows.length || !!problem} onClick={toUsers}>
            다음: {userInfo.refs.length || userInfo.blank ? '사용자 확인' : '미리보기'}
          </button>
        ) : null}
        {step === 'users' ? (
          <button type="button" class="btn primary" disabled={userErrors.length > 0} onClick={() => setStep('preview')}>
            다음: 미리보기
          </button>
        ) : null}
        {step === 'preview' ? (
          <button type="button" class="btn primary" disabled={busy || !preview || preview.count === 0} onClick={confirm}>
            {preview ? `${won(preview.count)}건 가져오기` : '가져오기'}
          </button>
        ) : null}
      </>
    );
  }

  return (
    <Modal title="엑셀에서 가져오기" onClose={onClose} wide footer={footer}>
      <p class="wz-step">
        <b>
          {STEP_NO[step]} / 4
        </b>{' '}
        {STEP_NAME[step]}
      </p>

      {step === 'file' ? (
        <div class="wz-pane">
          <p>엑셀 가계부(.xlsx)의 <b>사용 내역</b>을 가져옵니다. 파일은 이 기기의 브라우저 안에서만 읽고 어디로도 보내지 않습니다.</p>
          <ul class="plain-list">
            <li>월 시트(예: <code>2026-3</code>)의 날짜·사용처·명세·분류·금액·사용자·지불수단·결제상세를 가져옵니다.</li>
            <li>시트 위쪽의 요약, 고정지출 표, 재산·용돈 같은 다른 시트는 가져오지 않습니다.</li>
            <li>이 앱에서 내보낸 엑셀 파일도 다시 가져올 수 있습니다.</li>
            <li>가져오기 직후에는 설정 → 데이터 관리에서 통째로 되돌릴 수 있습니다.</li>
          </ul>
          {err ? (
            <p class="form-error" role="alert">
              {err}
            </p>
          ) : null}
          <div class="btn-row">
            <button type="button" class="btn primary" data-autofocus disabled={busy} onClick={() => fileRef.current?.click()}>
              <Ui name="Upload" size={16} />
              {busy ? '읽는 중…' : '엑셀 파일 선택'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              class="visually-hidden"
              tabIndex={-1}
              data-testid="import-file"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (f) void pick(f);
              }}
            />
          </div>
        </div>
      ) : null}

      {step === 'sheets' && loaded ? (
        <SheetsStep
          loaded={loaded}
          selected={selected}
          setSelected={(s) => {
            setSelected(s);
            setOverrides(new Map());
          }}
          map={map}
          autoMap={autoMap}
          edited={mapEdit !== null}
          setMap={(m) => {
            setMapEdit(m);
            setOverrides(new Map());
          }}
          problem={problem}
          per={extracted.per}
          skipped={extracted.skipped}
          total={rows.length}
        />
      ) : null}

      {step === 'users' ? <UsersStep info={userInfo} setup={setup} setSetup={setSetup} errors={userErrors} /> : null}

      {step === 'preview' && preview ? (
        <PreviewStep
          preview={preview}
          skipped={extracted.skipped}
          overrides={overrides}
          setOverrides={setOverrides}
          showAll={showAllFlags}
          setShowAll={setShowAllFlags}
        />
      ) : null}

      {step === 'done' && result ? (
        <div class="wz-pane">
          <p class="wz-done">
            <Ui name="Check" size={18} />
            <b>{won(result.count)}건</b>을 가져왔습니다 (합계 {won(result.sum)}원).
          </p>
          {result.lists ? <p class="hint">새로 등록한 사용자·분류·지불수단·결제상세 {result.lists}건은 설정 → 목록 관리에서 아이콘·색을 정할 수 있습니다.</p> : null}
          <p class="hint">잘못 가져왔다면 설정 → 데이터 관리의 「마지막 가져오기 되돌리기」로 통째로 지울 수 있습니다. 로그인한 상태라면 다른 기기에도 곧 반영됩니다.</p>
        </div>
      ) : null}
    </Modal>
  );
}

/* ───────── 2단계: 시트와 열 ───────── */

function SheetsStep({
  loaded,
  selected,
  setSelected,
  map,
  autoMap,
  edited,
  setMap,
  problem,
  per,
  skipped,
  total,
}: {
  loaded: Loaded;
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
  map: ColumnMap | null;
  autoMap: ColumnMap | null;
  edited: boolean;
  setMap: (m: ColumnMap | null) => void;
  problem: string | null;
  per: Map<number, { count: number; sum: number }>;
  skipped: number;
  total: number;
}) {
  const monthly = loaded.infos.filter((i) => i.ym);
  const others = loaded.infos.filter((i) => !i.ym);
  const first = [...selected].sort((a, b) => a - b)[0];
  const sample = first === undefined ? null : loaded.wb.sheets[first];
  const headerRow = map?.headerRow ?? 0;
  const ncols = Math.min(
    40,
    Math.max(8, ...(sample?.rows.slice(0, 80).map((r) => r?.length ?? 0) ?? [0])),
  );
  const toggle = (i: number) => {
    const s = new Set(selected);
    if (s.has(i)) s.delete(i);
    else s.add(i);
    setSelected(s);
  };
  const cur = map ?? emptyMap();
  const setCol = (k: FieldKey, v: string) => setMap({ ...cur, cols: { ...cur.cols, [k]: v === '' ? null : Number(v) } });

  const sheetRow = (i: SheetInfo) => {
    const p = per.get(i.index);
    return (
      <label class="wz-sheet" key={i.index}>
        <input type="checkbox" checked={selected.has(i.index)} onChange={() => toggle(i.index)} />
        <span class="wz-sheet-name">
          {i.name}
          {i.hidden ? <span class="hint"> (숨김)</span> : null}
        </span>
        <span class="wz-sheet-meta num">{p ? `${won(p.count)}건 · ${won(p.sum)}원` : ''}</span>
      </label>
    );
  };

  return (
    <div class="wz-pane">
      <p class="hint">
        {loaded.name} · 시트 {loaded.infos.length}개
      </p>
      <div class="field">
        <span class="label">가져올 시트</span>
        <div class="wz-sheets">{monthly.length ? monthly.map(sheetRow) : <p class="hint">월 시트(예: 2026-3)를 찾지 못했습니다. 아래 「그 밖의 시트」에서 직접 고르세요.</p>}</div>
        {others.length ? (
          <details class="wz-others" open={!monthly.length}>
            <summary>그 밖의 시트 {others.length}개 (직접 고르기)</summary>
            <div class="wz-sheets">{others.map(sheetRow)}</div>
          </details>
        ) : null}
      </div>

      {selected.size === 0 ? <p class="form-error">가져올 시트를 하나 이상 고르세요</p> : null}

      {selected.size > 0 ? (
        <details class="wz-cols" open={!!problem}>
          <summary>
            열 구성 {problem ? <span class="form-error">· {problem}</span> : <span class="hint">· {edited ? '직접 지정' : '자동 인식'}</span>}
          </summary>
          <p class="hint">
            {map && !problem
              ? '첫 번째로 고른 시트의 머리글을 읽어 열을 정했습니다. 맞지 않으면 바꿔 주세요.'
              : '머리글(날짜·금액 등)을 자동으로 찾지 못했습니다. 아래에서 열과 머리글 줄을 직접 지정하세요.'}
          </p>
          <div class="wz-map">
            <label class="wz-map-row">
              <span>머리글 줄</span>
              <input
                class="input num"
                type="number"
                min={1}
                value={headerRow + 1}
                onChange={(e) => setMap({ ...cur, headerRow: Math.max(0, Number(e.currentTarget.value || 1) - 1) })}
              />
            </label>
            {FIELD_ORDER.map((k) => (
              <label class="wz-map-row" key={k}>
                <span>
                  {FIELD_LABEL[k]}
                  {k === 'date' || k === 'amount' ? ' *' : ''}
                </span>
                <select class="input" value={cur.cols[k] === null ? '' : String(cur.cols[k])} onChange={(e) => setCol(k, e.currentTarget.value)}>
                  <option value="">(없음)</option>
                  {Array.from({ length: ncols }, (_, c) => {
                    const h = text(sample?.rows[headerRow]?.[c]);
                    return (
                      <option key={c} value={c}>
                        {colLetter(c)}열{h ? ` · ${h}` : ''}
                      </option>
                    );
                  })}
                </select>
              </label>
            ))}
          </div>
          {edited ? (
            <button type="button" class="link-btn" onClick={() => setMap(null)} disabled={!autoMap}>
              자동 인식으로 되돌리기
            </button>
          ) : null}
        </details>
      ) : null}

      {!problem && selected.size > 0 ? (
        <p class="wz-total">
          선택한 시트에서 <b>{won(total)}건</b>을 읽었습니다.
          {skipped ? <span class="hint"> 금액이 비어 건너뛴 줄 {skipped}건</span> : null}
        </p>
      ) : null}
    </div>
  );
}

/* ───────── 3단계: 사용자 확인 ───────── */

const KIND_LABEL: { kind: 'person' | 'group' | 'link' | 'blank'; label: string; title: string }[] = [
  { kind: 'person', label: '개인', title: '새 개인으로 등록' },
  { kind: 'group', label: '그룹', title: '새 그룹으로 등록 (구성원 선택)' },
  { kind: 'link', label: '기존에 연결', title: '이미 등록된 사용자와 같은 사람(별칭 등)' },
  { kind: 'blank', label: '비움', title: '사용자 없이 가져오기' },
];

function UsersStep({
  info,
  setup,
  setSetup,
  errors,
}: {
  info: ReturnType<typeof collectUsers>;
  setup: UserSetup;
  setSetup: (s: UserSetup) => void;
  errors: string[];
}) {
  const [newName, setNewName] = useState('');
  const matched = info.refs.filter((r) => r.matchedId);
  const todo = info.refs.filter((r) => !r.matchedId);
  const existing = usersSorted.value;

  const setChoice = (key: string, c: UserChoice | null) => {
    const choices = new Map(setup.choices);
    if (c) choices.set(key, c);
    else choices.delete(key);
    setSetup({ ...setup, choices });
  };
  const kindOf = (key: string) => setup.choices.get(key)?.kind ?? null;

  // 그룹 구성원으로 고를 수 있는 개인: 이미 등록된 개인, 개인으로 지정한 값, 이 화면에서 더한 개인
  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCand = (n: string) => {
    const k = normName(n);
    if (!seen.has(k)) {
      seen.add(k);
      candidates.push(n);
    }
  };
  existing.filter((u) => u.type === 'person').forEach((u) => addCand(u.name));
  todo.filter((r) => kindOf(r.key) === 'person').forEach((r) => addCand(r.name));
  setup.extraPersons.forEach(addCand);

  const addExtra = () => {
    const n = newName.trim();
    if (!n) return;
    if (!seen.has(normName(n))) setSetup({ ...setup, extraPersons: [...setup.extraPersons, n] });
    setNewName('');
  };

  return (
    <div class="wz-pane">
      <p>
        파일에서 사용자 <b>{info.refs.length}종</b>을 찾았고, 그중 <b>{todo.length}종</b>이 아직 등록되어 있지 않습니다.
        개인인지 그룹인지는 앱이 추측하지 않으니 직접 골라 주세요.
      </p>

      {todo.map((r) => {
        const c = setup.choices.get(r.key);
        return (
          <section class="wz-user" key={r.key}>
            <div class="wz-user-head">
              <b>{r.name}</b>
              <span class="hint num">{won(r.count)}건</span>
            </div>
            <div class="segmented wz-kinds" role="group" aria-label={`${r.name} 구분`}>
              {KIND_LABEL.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  title={k.title}
                  aria-pressed={c?.kind === k.kind}
                  disabled={k.kind === 'link' && existing.length === 0}
                  onClick={() => {
                    if (k.kind === 'person') setChoice(r.key, { kind: 'person' });
                    else if (k.kind === 'group') setChoice(r.key, { kind: 'group', members: c?.kind === 'group' ? c.members : [] });
                    else if (k.kind === 'link') setChoice(r.key, c?.kind === 'link' ? c : { kind: 'link', id: '' });
                    else setChoice(r.key, { kind: 'blank' });
                  }}
                >
                  {k.label}
                </button>
              ))}
            </div>
            {c?.kind === 'link' ? (
              <select class="input" value={c.id} aria-label={`${r.name}과 같은 사용자`} onChange={(e) => setChoice(r.key, { kind: 'link', id: e.currentTarget.value })}>
                <option value="">연결할 사용자 고르기</option>
                {existing.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.type === 'group' ? '그룹' : '개인'})
                  </option>
                ))}
              </select>
            ) : null}
            {c?.kind === 'group' ? (
              <div class="wz-members">
                <span class="small-label">구성원 (개인 2명 이상)</span>
                <div class="chips">
                  {candidates.length ? (
                    candidates.map((n) => {
                      const on = c.members.some((m) => normName(m) === normName(n));
                      return (
                        <button
                          key={n}
                          type="button"
                          class="chip"
                          aria-pressed={on}
                          onClick={() =>
                            setChoice(r.key, {
                              kind: 'group',
                              members: on ? c.members.filter((m) => normName(m) !== normName(n)) : [...c.members, n],
                            })
                          }
                        >
                          {n}
                        </button>
                      );
                    })
                  ) : (
                    <span class="hint">먼저 다른 값을 「개인」으로 지정하거나 아래에서 개인을 추가하세요</span>
                  )}
                </div>
              </div>
            ) : null}
          </section>
        );
      })}

      {todo.some((r) => kindOf(r.key) === 'group') || setup.extraPersons.length ? (
        <div class="wz-extra">
          <span class="small-label">그룹 구성원으로 쓸 개인 추가 (파일에 없는 사람)</span>
          <div class="wz-extra-row">
            <input
              class="input"
              value={newName}
              placeholder="이름"
              onInput={(e) => setNewName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addExtra();
                }
              }}
            />
            <button type="button" class="btn" onClick={addExtra} disabled={!newName.trim()}>
              추가
            </button>
          </div>
          {setup.extraPersons.length ? (
            <div class="chips">
              {setup.extraPersons.map((n) => (
                <button key={n} type="button" class="chip" aria-pressed={true} title="누르면 뺍니다" onClick={() => setSetup({ ...setup, extraPersons: setup.extraPersons.filter((x) => x !== n) })}>
                  {n} ✕
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {matched.length ? (
        <div class="wz-matched">
          {matched.map((r) => (
            <span class="hint" key={r.key}>
              ✓ {r.name} <span class="num">({won(r.count)}건)</span> 이미 등록됨
            </span>
          ))}
        </div>
      ) : null}

      {info.blank ? (
        <div class="field">
          <span class="label">
            사용자 칸이 빈 내역 <span class="num">{won(info.blank)}건</span>
          </span>
          <select class="input" value={setup.blankUserId ?? ''} onChange={(e) => setSetup({ ...setup, blankUserId: e.currentTarget.value || null })}>
            <option value="">사용자 없음(미지정)으로 가져오기</option>
            {existing.map((u) => (
              <option key={u.id} value={u.id}>
                모두 「{u.name}」으로
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {errors.length ? (
        <ul class="wz-errors" role="status">
          {errors.slice(0, 4).map((e) => (
            <li key={e}>{e}</li>
          ))}
          {errors.length > 4 ? <li>… 외 {errors.length - 4}건</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

/* ───────── 4단계: 미리보기 ───────── */

function PreviewStep({
  preview,
  skipped,
  overrides,
  setOverrides,
  showAll,
  setShowAll,
}: {
  preview: NonNullable<ReturnType<typeof makePreview>>;
  skipped: number;
  overrides: Map<number, boolean>;
  setOverrides: (m: Map<number, boolean>) => void;
  showAll: boolean;
  setShowAll: (b: boolean) => void;
}) {
  const flagged = preview.rows.filter((r) => r.flag);
  const flags = (['dup', 'undated', 'baddate', 'zero'] as RowFlag[]).filter((f) => flagged.some((r) => r.flag === f));
  const LIMIT = 60;
  const shown = showAll ? flagged : flagged.slice(0, LIMIT);
  const setFlag = (flag: RowFlag, on: boolean) => {
    const m = new Map(overrides);
    for (const r of flagged) if (r.flag === flag && !r.locked) m.set(r.row.idx, on);
    setOverrides(m);
  };
  const newLists: [string, string[]][] = [
    ['사용자', preview.newUsers.map((u) => `${u.name}${u.type === 'group' ? ' (그룹)' : ''}`)],
    ['분류', preview.newCategories],
    ['지불수단', preview.newPayMethods],
    ['결제상세', preview.newPayDetails],
  ];
  const hasNew = newLists.some(([, l]) => l.length);

  return (
    <div class="wz-pane">
      <p class="wz-total">
        <b>{won(preview.count)}건</b> · 합계 <b class="num">{won(preview.sum)}원</b>을 가져옵니다.
      </p>

      {preview.bySheet.length ? (
        <div class="table-scroll">
          <table class="mini-table is-nowrap">
            <thead>
              <tr>
                <th>시트</th>
                <th class="r">건수</th>
                <th class="r">합계(원)</th>
              </tr>
            </thead>
            <tbody>
              {preview.bySheet.map((s) => (
                <tr key={s.sheet}>
                  <td>{s.sheet}</td>
                  <td class="r num">{won(s.count)}</td>
                  <td class="r num">{won(s.sum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {hasNew ? (
        <div class="wz-new">
          <span class="label">새로 등록되는 항목</span>
          {newLists.map(([label, list]) =>
            list.length ? (
              <p key={label} class="wz-new-row">
                <b>{label}</b> {list.join(', ')}
              </p>
            ) : null,
          )}
          <p class="hint">내역에 쓰인 값만 등록합니다. 아이콘·색은 가져온 뒤 설정에서 정할 수 있습니다.</p>
        </div>
      ) : null}

      {preview.futureCount || preview.fractionCount || preview.negativeCount || preview.otherMonthCount || skipped ? (
        <ul class="plain-list wz-notes">
          {preview.futureCount ? <li>오늘 이후 날짜 {preview.futureCount}건은 <b>[예정]</b> 내역이 되어 합계에 포함됩니다.</li> : null}
          {preview.fractionCount ? <li>금액에 소수점이 있는 내역 {preview.fractionCount}건이 있습니다 (그대로 가져옵니다).</li> : null}
          {preview.negativeCount ? <li>금액이 음수인 내역 {preview.negativeCount}건이 있습니다 (환불 등).</li> : null}
          {preview.otherMonthCount ? <li>시트 이름의 달과 다른 날짜의 내역 {preview.otherMonthCount}건이 있습니다 (날짜 그대로 가져옵니다).</li> : null}
          {skipped ? <li>금액이 비어 있는 줄 {skipped}건은 건너뜁니다.</li> : null}
        </ul>
      ) : null}

      {flagged.length ? (
        <div class="wz-flags">
          <span class="label">확인이 필요한 {won(flagged.length)}건</span>
          <p class="hint">체크한 줄만 가져옵니다. 중복 의심·금액 0원·날짜 없음은 기본으로 빠져 있습니다.</p>
          {flags.map((f) => (
            <div class="wz-flag-bulk" key={f}>
              <span>
                {FLAG_LABEL[f]} {won(flagged.filter((r) => r.flag === f).length)}건
              </span>
              <span class="wz-flag-btns">
                <button type="button" class="btn small" onClick={() => setFlag(f, true)}>
                  모두 포함
                </button>
                <button type="button" class="btn small" onClick={() => setFlag(f, false)}>
                  모두 제외
                </button>
              </span>
            </div>
          ))}
          <ul class="wz-flag-list">
            {shown.map((r) => (
              <li key={r.row.idx}>
                <label>
                  <input
                    type="checkbox"
                    checked={r.include}
                    disabled={r.locked}
                    onChange={(e) => setOverrides(new Map(overrides).set(r.row.idx, e.currentTarget.checked))}
                  />
                  <span class="wz-flag-text">
                    <span class="pill">{FLAG_LABEL[r.flag!]}</span>{' '}
                    <b>{r.row.store || r.row.memo || '(내용 없음)'}</b>
                    {r.row.store && r.row.memo ? ` · ${r.row.memo}` : ''}
                    <span class="hint">
                      {' '}
                      {r.row.sheet} {r.row.line}줄 · {r.date ?? '날짜 없음'}
                      {r.row.badDate ? ` ("${r.row.badDate}")` : ''}
                      {r.locked ? ' · 날짜를 정할 수 없어 가져올 수 없습니다' : r.flag === 'undated' || r.flag === 'baddate' ? ' · 포함하면 그 달 1일로' : ''}
                    </span>
                  </span>
                  <span class="num wz-flag-amt">{won(r.row.amount)}원</span>
                </label>
              </li>
            ))}
          </ul>
          {!showAll && flagged.length > LIMIT ? (
            <button type="button" class="link-btn" onClick={() => setShowAll(true)}>
              나머지 {flagged.length - LIMIT}건 모두 보기
            </button>
          ) : null}
        </div>
      ) : null}

      {preview.count === 0 ? <p class="form-error">가져올 내역이 없습니다. 위에서 포함할 줄을 체크하거나 이전 단계에서 시트를 다시 고르세요.</p> : null}
    </div>
  );
}
