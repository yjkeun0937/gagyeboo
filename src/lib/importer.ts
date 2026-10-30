import { isValidYmd } from './dates';
import { serialToYmd, type CellValue, type Sheet, type Workbook } from './xlsx';
import type { Category, Entry, PayDetail, PayMethod, User } from './types';

/**
 * 엑셀 가계부의 사용 내역을 앱 내역으로 바꾸는 규칙 (기획서 10.1).
 * 이 파일은 화면·저장소와 무관한 순수 계산만 한다. 저장은 store의 commitImport가 맡는다.
 */

/* ───────── 시트·열 인식 ───────── */

export interface SheetInfo {
  index: number;
  name: string;
  /** 'YYYY-MM' (이름이 `2026-3` 같은 모양일 때) */
  ym: string | null;
  hidden: boolean;
}

const YM_NAME = /^\s*(\d{4})\s*[-./_년 ]\s*(\d{1,2})\s*월?\s*$/;

export function sheetYm(name: string): string | null {
  const m = YM_NAME.exec(name);
  if (!m) return null;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? `${m[1]}-${String(mo).padStart(2, '0')}` : null;
}

export function listSheets(wb: Workbook): SheetInfo[] {
  return wb.sheets.map((s, index) => ({ index, name: s.name, ym: sheetYm(s.name), hidden: s.hidden }));
}

export type FieldKey = 'date' | 'store' | 'memo' | 'category' | 'amount' | 'user' | 'payMethod' | 'payDetail';

export const FIELD_LABEL: Record<FieldKey, string> = {
  date: '날짜',
  store: '사용처',
  memo: '명세',
  category: '분류',
  amount: '금액',
  user: '사용자',
  payMethod: '지불수단',
  payDetail: '결제상세',
};

export const FIELD_ORDER: FieldKey[] = ['date', 'store', 'memo', 'category', 'amount', 'user', 'payMethod', 'payDetail'];

export interface ColumnMap {
  /** 머리글 줄 (0부터) */
  headerRow: number;
  cols: Record<FieldKey, number | null>;
}

const HEADER_SCAN_ROWS = 80;

export const text = (v: CellValue | undefined): string => (v === null || v === undefined ? '' : String(v).trim());
const compact = (v: CellValue | undefined) => text(v).replace(/\s+/g, '');

const emptyCols = (): Record<FieldKey, number | null> => ({
  date: null,
  store: null,
  memo: null,
  category: null,
  amount: null,
  user: null,
  payMethod: null,
  payDetail: null,
});

/** 머리글 줄을 찾아 열을 자동으로 정한다. 못 찾으면 null */
export function detectMapping(sheet: Sheet): ColumnMap | null {
  const limit = Math.min(sheet.rows.length, HEADER_SCAN_ROWS);
  for (let r = 0; r < limit; r++) {
    const row = sheet.rows[r] ?? [];
    const cols = emptyCols();
    row.forEach((cell, c) => {
      const h = compact(cell);
      if (!h) return;
      if (cols.date === null && /^(날짜|일자|일시|date)$/i.test(h)) cols.date = c;
      else if (cols.store === null && /^사용처/.test(h)) {
        cols.store = c;
        // 엑셀 가계부는 `사용처/명세` 머리글이 합쳐져 있고 명세는 바로 오른쪽 칸에 있다
        if (/명세/.test(h) && !compact(row[c + 1])) cols.memo = c + 1;
      } else if (cols.memo === null && /^(명세|메모|내용|비고)$/.test(h)) cols.memo = c;
      else if (cols.category === null && /^(분류|카테고리)$/.test(h)) cols.category = c;
      else if (cols.amount === null && /^(금액|지출액|지출금액)$/.test(h)) cols.amount = c;
      else if (cols.user === null && /^(사용자|이름)$/.test(h)) cols.user = c;
      else if (cols.payMethod === null && /^(지불수단|결제수단)$/.test(h)) {
        cols.payMethod = c;
      } else if (cols.payDetail === null && /^(결제상세|카드|결제수단상세)$/.test(h)) cols.payDetail = c;
    });
    if (cols.date !== null && cols.amount !== null && (cols.store !== null || cols.memo !== null || cols.category !== null)) {
      // 머리글이 없는 결제상세 열: 지불수단 바로 오른쪽 칸
      if (cols.payDetail === null && cols.payMethod !== null && !compact(row[cols.payMethod + 1])) {
        cols.payDetail = cols.payMethod + 1;
      }
      return { headerRow: r, cols };
    }
  }
  return null;
}

/** 시트마다 머리글 줄 위치가 다를 수 있어, 날짜 열에 '날짜'가 있는 줄을 다시 찾는다 */
export function locateHeaderRow(sheet: Sheet, map: ColumnMap): number {
  const c = map.cols.date;
  if (c === null) return map.headerRow;
  const limit = Math.min(sheet.rows.length, HEADER_SCAN_ROWS);
  for (let r = 0; r < limit; r++) if (/^(날짜|일자|일시|date)$/i.test(compact(sheet.rows[r]?.[c]))) return r;
  return map.headerRow;
}

/* ───────── 행 읽기 ───────── */

export interface ImportRow {
  /** 전체 목록에서의 순번 (미리보기 선택을 기억하는 열쇠) */
  idx: number;
  sheet: string;
  /** 시트 이름이 가리키는 달 */
  sheetYm: string | null;
  /** 엑셀의 줄 번호 (1부터) */
  line: number;
  /** 날짜를 알 수 없으면 null */
  date: string | null;
  /** 윗줄 날짜를 이어받음 */
  dateInherited: boolean;
  /** 날짜 칸에 읽을 수 없는 값이 적혀 있음 */
  badDate: string | null;
  store: string;
  memo: string;
  category: string;
  amount: number;
  user: string;
  payMethod: string;
  payDetail: string;
}

export interface ExtractResult {
  rows: Omit<ImportRow, 'idx'>[];
  /** 금액이 비어 건너뛴 줄 (글자만 있는 줄) */
  skippedNoAmount: number;
}

export function parseDateCell(v: CellValue | undefined): { date: string | null; bad: string | null } {
  if (v === null || v === undefined || v === '') return { date: null, bad: null };
  if (typeof v === 'number') {
    const d = v >= 36526 && v <= 80000 ? serialToYmd(v) : null; // 2000년~2119년 사이의 날짜 번호만 날짜로 본다
    return d ? { date: d, bad: null } : { date: null, bad: String(v) };
  }
  const s = v.trim();
  const m = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/.exec(s);
  if (m) {
    const d = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (isValidYmd(d)) return { date: d, bad: null };
  }
  return { date: null, bad: s };
}

export function parseAmountCell(v: CellValue | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/[,\s원₩]/g, '');
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** 한 시트에서 사용 내역 줄을 읽는다. 날짜는 비어 있으면 윗줄 날짜를 이어받는다 */
export function extractRows(sheet: Sheet, map: ColumnMap): ExtractResult {
  const ym = sheetYm(sheet.name);
  const start = locateHeaderRow(sheet, map) + 1;
  const get = (row: CellValue[], k: FieldKey) => (map.cols[k] === null ? undefined : row[map.cols[k]!]);
  const rows: ExtractResult['rows'] = [];
  let skippedNoAmount = 0;
  let curDate: string | null = null;
  for (let r = start; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    if (!row) continue;
    const pd = parseDateCell(get(row, 'date'));
    let date = pd.date;
    let inherited = false;
    if (date) curDate = date;
    else if (!pd.bad && curDate) {
      date = curDate;
      inherited = true;
    }
    const store = text(get(row, 'store'));
    const memo = text(get(row, 'memo'));
    const category = text(get(row, 'category'));
    const user = text(get(row, 'user'));
    const payMethod = text(get(row, 'payMethod'));
    const payDetail = text(get(row, 'payDetail'));
    const amountRaw = get(row, 'amount');
    const amount = parseAmountCell(amountRaw);
    const hasText = !!(store || memo || category || user || payMethod || payDetail);
    if (amount === null) {
      if (hasText) skippedNoAmount++;
      continue;
    }
    rows.push({
      sheet: sheet.name,
      sheetYm: ym,
      line: r + 1,
      date,
      dateInherited: inherited,
      badDate: pd.bad,
      store,
      memo,
      category,
      amount,
      user,
      payMethod,
      payDetail,
    });
  }
  return { rows, skippedNoAmount };
}

/* ───────── 내보낸 파일의 `사용자` 시트 (구분·구성원 제안용) ───────── */

export interface UserSuggestion {
  name: string;
  type: 'person' | 'group';
  members: string[];
}

export function readUserSheet(wb: Workbook): UserSuggestion[] {
  const sh = wb.sheets.find((s) => s.name.trim() === '사용자');
  if (!sh) return [];
  const head = sh.rows.findIndex((r) => compact(r?.[0]) === '이름' && /구분/.test(compact(r?.[1])));
  if (head < 0) return [];
  const out: UserSuggestion[] = [];
  for (let r = head + 1; r < sh.rows.length; r++) {
    const row = sh.rows[r];
    const name = text(row?.[0]);
    if (!name) continue;
    const type = text(row[1]) === '그룹' ? 'group' : 'person';
    const members = text(row[2])
      .split(/[,，、]/)
      .map((x) => x.trim())
      .filter(Boolean);
    out.push({ name, type, members: type === 'group' ? members : [] });
  }
  return out;
}

/* ───────── 사용자 확인 ───────── */

export const normName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

export interface UserRef {
  name: string;
  key: string;
  count: number;
  /** 이미 등록된 사용자와 이름이 같으면 그 ID */
  matchedId: string | null;
}

export interface Lookup {
  users: User[];
  categories: Category[];
  payMethods: PayMethod[];
  payDetails: PayDetail[];
  /** 지금 앱에 있는 (삭제되지 않은) 내역 */
  entries: Entry[];
}

function byName<T extends { id: string; name: string }>(list: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const x of list) if (!m.has(normName(x.name))) m.set(normName(x.name), x);
  return m;
}

export function collectUsers(rows: Pick<ImportRow, 'user'>[], users: User[]): { refs: UserRef[]; blank: number } {
  const known = byName(users);
  const map = new Map<string, UserRef>();
  let blank = 0;
  for (const r of rows) {
    if (!r.user) {
      blank++;
      continue;
    }
    const key = normName(r.user);
    const cur = map.get(key) ?? { name: r.user, key, count: 0, matchedId: known.get(key)?.id ?? null };
    cur.count++;
    map.set(key, cur);
  }
  return { refs: [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko')), blank };
}

export type UserChoice =
  | { kind: 'person' }
  | { kind: 'group'; members: string[] }
  /** 이미 있는 사용자에 합침 */
  | { kind: 'link'; id: string }
  /** 사용자 없이 가져옴 */
  | { kind: 'blank' };

export interface UserSetup {
  /** 이름(normName) → 선택. 이미 등록된 이름은 선택이 필요 없다 */
  choices: Map<string, UserChoice>;
  /** 파일에 없지만 그룹 구성원으로 쓰려고 이 화면에서 더한 개인 */
  extraPersons: string[];
  /** 사용자 칸이 빈 줄에 줄 사용자 (null이면 미지정으로 둠) */
  blankUserId: string | null;
}

/** 다음 단계로 넘어갈 수 없는 이유들 (비어 있으면 통과) */
export function validateUserSetup(refs: UserRef[], setup: UserSetup, users: User[]): string[] {
  const errors: string[] = [];
  const persons = new Set<string>(users.filter((u) => u.type === 'person').map((u) => normName(u.name)));
  for (const e of setup.extraPersons) persons.add(normName(e));
  for (const r of refs) {
    if (r.matchedId) continue;
    const c = setup.choices.get(r.key);
    if (c?.kind === 'person') persons.add(r.key);
  }
  for (const r of refs) {
    if (r.matchedId) continue;
    const c = setup.choices.get(r.key);
    if (!c) {
      errors.push(`「${r.name}」의 구분을 골라 주세요`);
      continue;
    }
    if (c.kind === 'link' && !users.some((u) => u.id === c.id)) errors.push(`「${r.name}」을 연결할 사용자를 골라 주세요`);
    if (c.kind === 'group') {
      const ms = c.members.map(normName);
      if (ms.length < 2) errors.push(`그룹 「${r.name}」의 구성원을 2명 이상 골라 주세요`);
      else if (ms.some((m) => !persons.has(m))) errors.push(`그룹 「${r.name}」의 구성원이 개인으로 등록되어 있지 않습니다`);
    }
  }
  return errors;
}

/* ───────── 미리보기·계획 ───────── */

export type RowFlag = 'undated' | 'baddate' | 'dup' | 'zero';

export const FLAG_LABEL: Record<RowFlag, string> = {
  undated: '날짜 없음',
  baddate: '날짜를 읽을 수 없음',
  dup: '중복 의심',
  zero: '금액 0원',
};

export interface PreviewRow {
  row: ImportRow;
  /** 계획에 넣을 날짜 (날짜 없음 줄을 포함하면 그 달 1일) */
  date: string | null;
  flag: RowFlag | null;
  /** 최종적으로 가져오는가 */
  include: boolean;
  /** 사용자 선택을 바꿀 수 없는 줄 (날짜를 정할 수 없음) */
  locked: boolean;
}

export interface ImportPlan {
  batchId: string;
  entries: Entry[];
  users: User[];
  categories: Category[];
  payMethods: PayMethod[];
  payDetails: PayDetail[];
}

export interface Preview {
  rows: PreviewRow[];
  count: number;
  sum: number;
  bySheet: { sheet: string; count: number; sum: number }[];
  newUsers: { name: string; type: 'person' | 'group' }[];
  newCategories: string[];
  newPayMethods: string[];
  newPayDetails: string[];
  futureCount: number;
  fractionCount: number;
  negativeCount: number;
  /** 시트 이름이 가리키는 달과 날짜의 달이 다른 줄 */
  otherMonthCount: number;
  plan: ImportPlan;
}

export interface PlanContext {
  lookup: Lookup;
  setup: UserSetup;
  today: string;
  /** 새로 만드는 항목에 돌려 쓸 색 */
  colors: string[];
  payIcon: string;
  newId: () => string;
  /** 같은 날 안의 순서를 지키기 위해 늘 증가하는 값을 돌려준다 */
  stamp: () => number;
  batchId: string;
  now: number;
}

const keyOf = (date: string, store: string, memo: string, amount: number, user: string | null, pay: string | null) =>
  `${date}\u0001${store}\u0001${memo}\u0001${amount}\u0001${user ?? ''}\u0001${pay ?? ''}`;

/**
 * 읽은 줄과 사용자 선택으로 가져올 내용을 계산한다.
 * overrides: 확인이 필요한 줄을 사용자가 직접 포함(true)·제외(false)로 바꾼 것
 */
export function makePreview(rows: ImportRow[], ctx: PlanContext, overrides: Map<number, boolean>): Preview {
  const { lookup, setup } = ctx;
  const userByName = byName(lookup.users);
  const catByName = byName(lookup.categories);
  const payByName = byName(lookup.payMethods);
  const detailByName = byName(lookup.payDetails);

  /* 사용자: 이름 → 사용자 ID(기존) | 새로 만들 사용자 | 없음 */
  type Target = { id: string | null };
  const newUsers: User[] = [];
  const target = new Map<string, Target>();
  const orderBase = {
    person: lookup.users.filter((u) => u.type === 'person').reduce((m, u) => Math.max(m, u.order), -1) + 1,
    group: lookup.users.filter((u) => u.type === 'group').reduce((m, u) => Math.max(m, u.order), -1) + 1,
  };
  const colorAt = (n: number) => ctx.colors[n % ctx.colors.length];
  const personIdByKey = new Map<string, string>();
  for (const u of lookup.users) if (u.type === 'person') personIdByKey.set(normName(u.name), u.id);

  const makeUser = (name: string, type: 'person' | 'group', memberIds: string[]): User => {
    const order = orderBase[type]++;
    const u: User = {
      id: ctx.newId(),
      name,
      type,
      memberIds,
      icon: null,
      color: colorAt(lookup.users.length + newUsers.length),
      order,
      updatedAt: ctx.now,
    };
    newUsers.push(u);
    return u;
  };

  const usedKeys = new Map<string, string>(); // key → 표시 이름
  for (const r of rows) if (r.user) usedKeys.set(normName(r.user), usedKeys.get(normName(r.user)) ?? r.user);

  // 개인 먼저, 그다음 그룹 (그룹이 구성원 ID를 참조하므로)
  for (const [key, name] of usedKeys) {
    const known = userByName.get(key);
    if (known) {
      target.set(key, { id: known.id });
      continue;
    }
    const c = setup.choices.get(key);
    if (c?.kind === 'person') {
      const u = makeUser(name, 'person', []);
      personIdByKey.set(key, u.id);
      target.set(key, { id: u.id });
    } else if (c?.kind === 'link') target.set(key, { id: c.id });
    else target.set(key, { id: null });
  }
  for (const extra of setup.extraPersons) {
    const key = normName(extra);
    if (!extra.trim() || personIdByKey.has(key) || userByName.has(key)) continue;
    const u = makeUser(extra.trim(), 'person', []);
    personIdByKey.set(key, u.id);
  }
  for (const [key, name] of usedKeys) {
    if (userByName.has(key)) continue;
    const c = setup.choices.get(key);
    if (c?.kind !== 'group') continue;
    const ids = c.members.map((m) => personIdByKey.get(normName(m))).filter((x): x is string => !!x);
    const u = makeUser(name, 'group', [...new Set(ids)]);
    target.set(key, { id: u.id });
  }
  const userIdOf = (name: string): string | null => (name ? (target.get(normName(name))?.id ?? null) : setup.blankUserId);

  /* 분류·지불수단·결제상세는 쓰인 값만 새로 만든다 */
  const newCategories: Category[] = [];
  const newPayMethods: PayMethod[] = [];
  const newPayDetails: PayDetail[] = [];
  const catId = new Map<string, string>();
  const payId = new Map<string, string>();
  const detailId = new Map<string, string>();
  const resolve = <T extends { id: string }>(
    name: string,
    table: Map<string, T>,
    made: Map<string, string>,
    create: (n: string) => string,
  ): string | null => {
    if (!name) return null;
    const key = normName(name);
    const k = table.get(key);
    if (k) return k.id;
    const m = made.get(key);
    if (m) return m;
    const id = create(name);
    made.set(key, id);
    return id;
  };
  const catOrder = lookup.categories.reduce((m, x) => Math.max(m, x.order), -1) + 1;
  const payOrder = lookup.payMethods.reduce((m, x) => Math.max(m, x.order), -1) + 1;
  const detailOrder = lookup.payDetails.reduce((m, x) => Math.max(m, x.order), -1) + 1;

  /* 줄마다 표시를 달고 포함 여부를 정한다 */
  const existing = new Map<string, number>();
  for (const e of lookup.entries) {
    const k = keyOf(e.date, e.store.trim(), e.memo.trim(), e.amount, e.user, e.payMethod);
    existing.set(k, (existing.get(k) ?? 0) + 1);
  }
  const payIdPre = (name: string) => (name ? (payByName.get(normName(name))?.id ?? null) : null);

  const previewRows: PreviewRow[] = rows.map((row) => {
    let date = row.date;
    let flag: RowFlag | null = null;
    let locked = false;
    if (row.badDate) flag = 'baddate';
    else if (!row.date) flag = 'undated';
    if (flag) {
      // 날짜를 모르는 줄은 그 달 1일로 정해서 포함할 수 있다 (시트 이름에 달이 있을 때만)
      if (row.sheetYm) date = `${row.sheetYm}-01`;
      else locked = true;
    }
    if (!flag && date) {
      const uid = userIdOf(row.user);
      const k = keyOf(date, row.store, row.memo, row.amount, uid, payIdPre(row.payMethod));
      const left = existing.get(k) ?? 0;
      if (left > 0) {
        existing.set(k, left - 1);
        flag = 'dup';
      }
    }
    if (!flag && row.amount === 0) flag = 'zero';
    const def = flag === null;
    const include = !locked && (overrides.get(row.idx) ?? def);
    return { row, date, flag, include, locked };
  });

  /* 가져올 줄로 내역을 만든다 */
  const inc = previewRows.filter((p) => p.include && p.date);
  // 결제상세는 같이 쓰인 지불수단이 가장 많은 쪽에 붙인다
  const detailPay = new Map<string, Map<string, number>>();
  for (const p of inc) {
    if (!p.row.payDetail || !p.row.payMethod) continue;
    const dk = normName(p.row.payDetail);
    const m = detailPay.get(dk) ?? new Map<string, number>();
    const pk = normName(p.row.payMethod);
    m.set(pk, (m.get(pk) ?? 0) + 1);
    detailPay.set(dk, m);
  }

  const entries: Entry[] = [];
  const sheetTotals = new Map<string, { count: number; sum: number }>();
  let futureCount = 0;
  let fractionCount = 0;
  let negativeCount = 0;
  let otherMonthCount = 0;
  for (const p of inc) {
    const r = p.row;
    const category = resolve(r.category, catByName, catId, (n) => {
      const c: Category = { id: ctx.newId(), name: n, color: colorAt(lookup.categories.length + newCategories.length), order: catOrder + newCategories.length, updatedAt: ctx.now };
      newCategories.push(c);
      return c.id;
    });
    const payMethod = resolve(r.payMethod, payByName, payId, (n) => {
      const pm: PayMethod = { id: ctx.newId(), name: n, icon: ctx.payIcon, color: colorAt(lookup.payMethods.length + newPayMethods.length), order: payOrder + newPayMethods.length, updatedAt: ctx.now };
      newPayMethods.push(pm);
      return pm.id;
    });
    const payDetail = resolve(r.payDetail, detailByName, detailId, (n) => {
      const counts = detailPay.get(normName(n));
      let best: string | null = null;
      let bestN = 0;
      for (const [pk, c] of counts ?? []) {
        if (c > bestN) {
          best = pk;
          bestN = c;
        }
      }
      const pd: PayDetail = {
        id: ctx.newId(),
        name: n,
        payMethodId: best ? (payByName.get(best)?.id ?? payId.get(best) ?? null) : null,
        color: colorAt(lookup.payDetails.length + newPayDetails.length),
        order: detailOrder + newPayDetails.length,
        updatedAt: ctx.now,
      };
      newPayDetails.push(pd);
      return pd.id;
    });
    const e: Entry = {
      id: ctx.newId(),
      date: p.date!,
      store: r.store,
      memo: r.memo,
      category,
      amount: r.amount,
      user: userIdOf(r.user),
      payMethod,
      payDetail,
      source: 'import',
      createdAt: ctx.stamp(),
      updatedAt: ctx.now,
      importBatchId: ctx.batchId,
    };
    entries.push(e);
    const t = sheetTotals.get(r.sheet) ?? { count: 0, sum: 0 };
    t.count++;
    t.sum += r.amount;
    sheetTotals.set(r.sheet, t);
    if (e.date > ctx.today) futureCount++;
    if (!Number.isInteger(r.amount)) fractionCount++;
    if (r.amount < 0) negativeCount++;
    if (r.sheetYm && e.date.slice(0, 7) !== r.sheetYm) otherMonthCount++;
  }

  // 새 사용자: 내역에 쓰인 것, 그 그룹의 구성원, 그리고 이 화면에서 직접 더한 개인만 만든다
  const usedNew = new Set(entries.map((e) => e.user));
  const keptGroups = newUsers.filter((u) => u.type === 'group' && usedNew.has(u.id));
  const memberOfKept = new Set(keptGroups.flatMap((u) => u.memberIds));
  const extraKeys = new Set(setup.extraPersons.map(normName));
  const planUsers = newUsers.filter(
    (u) => (u.type === 'group' ? usedNew.has(u.id) : usedNew.has(u.id) || memberOfKept.has(u.id) || extraKeys.has(normName(u.name))),
  );

  return {
    rows: previewRows,
    count: entries.length,
    sum: entries.reduce((a, e) => a + e.amount, 0),
    bySheet: [...sheetTotals].map(([sheet, t]) => ({ sheet, ...t })),
    newUsers: planUsers.map((u) => ({ name: u.name, type: u.type })),
    newCategories: newCategories.map((c) => c.name),
    newPayMethods: newPayMethods.map((c) => c.name),
    newPayDetails: newPayDetails.map((c) => c.name),
    futureCount,
    fractionCount,
    negativeCount,
    otherMonthCount,
    plan: { batchId: ctx.batchId, entries, users: planUsers, categories: newCategories, payMethods: newPayMethods, payDetails: newPayDetails },
  };
}
