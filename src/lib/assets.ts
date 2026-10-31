/**
 * 재산상황: 분류별 입력 항목, 합계, 변경 이력 비교, 만기 표시, 총액 추이.
 * 화면과 저장소에서 떨어진 순수 계산만 둔다.
 */
import { todayKST } from './dates';
import type {
  Asset,
  AssetCategory,
  AssetChange,
  AssetLog,
  AssetState,
  AssetTax,
  EndReason,
  ID,
} from './types';

export const STATE_ORDER: AssetState[] = ['active', 'ended', 'trash'];
export const STATE_LABEL: Record<AssetState, string> = { active: '보유', ended: '종료', trash: '휴지통' };
export const END_REASON_LABEL: Record<EndReason, string> = {
  matured: '만기',
  terminated: '해지',
  sold: '매각',
  other: '기타',
};
export const TAX_LABEL: Record<AssetTax, string> = { taxable: '과세', taxfree: '비과세' };

/** 입력 창에 나오는 선택 항목 */
export type OptionalField = 'payStatus' | 'coverage' | 'term' | 'rate' | 'maturity' | 'tax';

export interface CategoryDef {
  id: AssetCategory;
  label: string;
  /** 이름 칸의 이름표 */
  nameLabel: string;
  kinds: string[];
  /** 금액을 꼭 적어야 하는가 (보험은 미정 가능) */
  amountRequired: boolean;
  /** '현금' 합계에 넣는 기본값 */
  inCash: boolean;
  fields: OptionalField[];
}

export const ASSET_CATEGORIES: CategoryDef[] = [
  { id: 'insurance', label: '보험', nameLabel: '보험사', kinds: ['종신', '보장성', '실비', '연금보험', '기타'], amountRequired: false, inCash: false, fields: ['payStatus', 'coverage'] },
  { id: 'realestate', label: '부동산', nameLabel: '자산 이름', kinds: ['아파트', '토지', '건물', '기타'], amountRequired: true, inCash: false, fields: [] },
  { id: 'pension', label: '연금', nameLabel: '금융기관', kinds: ['저축성', '퇴직연금', '국민연금', '기타'], amountRequired: true, inCash: false, fields: ['payStatus'] },
  { id: 'deposit', label: '예금·계좌', nameLabel: '금융기관', kinds: ['정기예금', '적금', '입출금', '청약저축', '출자금', '기타'], amountRequired: true, inCash: true, fields: ['term', 'rate', 'maturity', 'tax'] },
  { id: 'securities', label: '증권', nameLabel: '증권사', kinds: ['주식계좌', '펀드', '기타'], amountRequired: true, inCash: true, fields: [] },
  { id: 'other', label: '기타', nameLabel: '이름', kinds: [], amountRequired: true, inCash: false, fields: [] },
];

export const categoryDef = (id: AssetCategory): CategoryDef => ASSET_CATEGORIES.find((c) => c.id === id) ?? ASSET_CATEGORIES[5];
const catIndex = (id: AssetCategory) => Math.max(0, ASSET_CATEGORIES.findIndex((c) => c.id === id));

/** 기간·이율·만기는 정기예금·적금에서만 쓴다 */
export const isTermKind = (kind: string) => kind === '정기예금' || kind === '적금';

/** 이 분류·종류에서 입력 창에 보여 줄 선택 항목 */
export function fieldsFor(category: AssetCategory, kind: string): OptionalField[] {
  const def = categoryDef(category);
  if (category === 'deposit') return def.fields.filter((f) => ['tax'].includes(f) || isTermKind(kind));
  return def.fields;
}

/** 입력 내용에서 이 분류·종류와 상관없는 칸은 비운다 */
export function normalizeAsset<T extends Pick<Asset, 'category' | 'kind' | OptionalField>>(a: T): T {
  const keep = new Set(fieldsFor(a.category, a.kind));
  return {
    ...a,
    payStatus: keep.has('payStatus') ? a.payStatus.trim() : '',
    coverage: keep.has('coverage') ? a.coverage.trim() : '',
    term: keep.has('term') ? a.term.trim() : '',
    rate: keep.has('rate') ? a.rate : null,
    maturity: keep.has('maturity') ? a.maturity : null,
    tax: keep.has('tax') ? a.tax : null,
  };
}

/* ───────── 합계 ───────── */

export interface AssetSummary {
  count: number;
  total: number;
  cash: number;
  /** 금액이 미정이라 합계에서 빠진 건수 */
  unknown: number;
}

export function summarize(list: Pick<Asset, 'amount' | 'inCash'>[]): AssetSummary {
  const s: AssetSummary = { count: list.length, total: 0, cash: 0, unknown: 0 };
  for (const a of list) {
    if (a.amount == null) {
      s.unknown++;
      continue;
    }
    s.total += a.amount;
    if (a.inCash) s.cash += a.amount;
  }
  return s;
}

export function sortAssets(list: Asset[]): Asset[] {
  return [...list].sort(
    (a, b) =>
      catIndex(a.category) - catIndex(b.category) ||
      a.name.localeCompare(b.name, 'ko') ||
      (a.maturity ?? '9999').localeCompare(b.maturity ?? '9999') ||
      a.createdAt - b.createdAt,
  );
}

/** 상태별로 나누고 각 상태 안에서는 분류별로 나눈다 */
export interface StateGroup {
  state: AssetState;
  items: Asset[];
  summary: AssetSummary;
  byCategory: { category: AssetCategory; items: Asset[]; summary: AssetSummary }[];
}

export function groupByState(list: Asset[], states: AssetState[]): StateGroup[] {
  const out: StateGroup[] = [];
  for (const st of STATE_ORDER) {
    if (!states.includes(st)) continue;
    const items = sortAssets(list.filter((a) => a.state === st));
    const byCategory = ASSET_CATEGORIES.map((c) => {
      const its = items.filter((a) => a.category === c.id);
      return { category: c.id, items: its, summary: summarize(its) };
    }).filter((g) => g.items.length);
    out.push({ state: st, items, summary: summarize(items), byCategory });
  }
  return out;
}

/* ───────── 만기 ───────── */

export const MATURITY_SOON_DAYS = 30;

export function daysBetween(from: string, to: string): number {
  const f = from.split('-').map(Number);
  const t = to.split('-').map(Number);
  return Math.round((Date.UTC(t[0], t[1] - 1, t[2]) - Date.UTC(f[0], f[1] - 1, f[2])) / 86_400_000);
}

export interface MaturityInfo {
  level: 'soon' | 'over';
  /** soon: 남은 일수(0이면 오늘), over: 지난 일수 */
  days: number;
}

/** 보유 중인 예금·계좌의 만기가 30일 안이거나 지났으면 알려 준다 */
export function maturityInfo(a: Pick<Asset, 'state' | 'category' | 'maturity'>, today: string): MaturityInfo | null {
  if (a.state !== 'active' || a.category !== 'deposit' || !a.maturity) return null;
  const d = daysBetween(today, a.maturity);
  if (d < 0) return { level: 'over', days: -d };
  if (d <= MATURITY_SOON_DAYS) return { level: 'soon', days: d };
  return null;
}

/* ───────── 변경 이력 ───────── */

/** 이력에 남기는 항목 (순서가 화면 순서) */
export const TRACKED: { field: keyof Asset; label: string }[] = [
  { field: 'category', label: '분류' },
  { field: 'name', label: '이름·기관' },
  { field: 'kind', label: '종류' },
  { field: 'owner', label: '소유자' },
  { field: 'amount', label: '금액' },
  { field: 'payStatus', label: '납입 상태' },
  { field: 'coverage', label: '보장·조건' },
  { field: 'term', label: '기간' },
  { field: 'rate', label: '이율' },
  { field: 'maturity', label: '만기일' },
  { field: 'tax', label: '과세' },
  { field: 'inCash', label: '현금 포함' },
  { field: 'memo', label: '비고' },
  { field: 'state', label: '상태' },
  { field: 'endReason', label: '종료 사유' },
  { field: 'endedOn', label: '종료일' },
];
export const FIELD_LABEL: Record<string, string> = Object.fromEntries(TRACKED.map((t) => [t.field, t.label]));

const blank = (v: unknown) => v === null || v === undefined || v === '';
const same = (a: unknown, b: unknown) => (blank(a) && blank(b)) || a === b;

type Snap = Partial<Record<keyof Asset, unknown>>;

/** 바뀐 항목만 골라낸다. prev가 없으면 등록: 값이 있는 항목을 모두 담는다 */
export function diffAsset(prev: Snap | null, next: Snap): AssetChange[] {
  const out: AssetChange[] = [];
  for (const { field } of TRACKED) {
    const to = next[field] ?? null;
    const from = prev ? (prev[field] ?? null) : null;
    if (prev) {
      if (!same(from, to)) out.push({ field, from: blank(from) ? null : from, to: blank(to) ? null : to });
    } else if (!blank(to) || typeof to === 'boolean') {
      out.push({ field, from: null, to });
    }
  }
  return out;
}

export interface FormatCtx {
  userName: (id: ID) => string;
}

export function formatValue(field: string, v: unknown, ctx: FormatCtx): string {
  if (blank(v)) return '없음';
  switch (field) {
    case 'category':
      return categoryDef(v as AssetCategory).label;
    case 'owner':
      return ctx.userName(v as ID);
    case 'amount':
      return `${new Intl.NumberFormat('ko-KR').format(v as number)}원`;
    case 'rate':
      return `${v}%`;
    case 'tax':
      return TAX_LABEL[v as AssetTax] ?? String(v);
    case 'inCash':
      return v ? '포함' : '제외';
    case 'state':
      return STATE_LABEL[v as AssetState] ?? String(v);
    case 'endReason':
      return END_REASON_LABEL[v as EndReason] ?? String(v);
    default:
      return String(v);
  }
}

/** 금액 변화 문구: "+3,000,000원" / "−500원" (둘 다 금액이 있을 때만) */
export function amountDelta(c: AssetChange): string | null {
  if (c.field !== 'amount' || typeof c.from !== 'number' || typeof c.to !== 'number') return null;
  const d = c.to - c.from;
  if (d === 0) return null;
  return `${d > 0 ? '+' : '−'}${new Intl.NumberFormat('ko-KR').format(Math.abs(d))}원`;
}

/* ───────── 총액 추이 ───────── */

export interface TrendPoint {
  date: string;
  total: number;
  cash: number;
}

/**
 * 변경 이력을 처음부터 되짚어, 하루가 끝났을 때의 보유 합계를 구한다.
 * 금액·현금 포함·상태가 바뀐 날에만 점이 생기고, 완전 삭제한 항목은 이력과 함께 빠진다.
 */
export function buildTrend(logs: Pick<AssetLog, 'assetId' | 'at' | 'id' | 'changes'>[]): TrendPoint[] {
  const sorted = [...logs].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  const cur = new Map<ID, { amount: number | null; inCash: boolean; state: AssetState }>();
  const points: TrendPoint[] = [];
  const flush = (date: string) => {
    let total = 0;
    let cash = 0;
    for (const s of cur.values()) {
      if (s.state !== 'active' || s.amount == null) continue;
      total += s.amount;
      if (s.inCash) cash += s.amount;
    }
    points.push({ date, total, cash });
  };
  let day = '';
  for (const l of sorted) {
    const d = todayKST(new Date(l.at));
    if (day && d !== day) flush(day);
    day = d;
    const s = cur.get(l.assetId) ?? { amount: null, inCash: false, state: 'active' as AssetState };
    for (const c of l.changes) {
      if (c.field === 'amount') s.amount = typeof c.to === 'number' ? c.to : null;
      else if (c.field === 'inCash') s.inCash = !!c.to;
      else if (c.field === 'state') s.state = c.to as AssetState;
    }
    cur.set(l.assetId, s);
  }
  if (day) flush(day);
  return points;
}

/** 'YYYY-MM-DD HH:mm' (한국 시각) */
export function formatAt(ms: number): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}
