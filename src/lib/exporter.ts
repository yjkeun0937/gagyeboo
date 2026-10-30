import { entryStatus, compareEntries, summarize } from './calc';
import { monthNum, ymOf } from './dates';
import { yearStats } from './stats';
import type { Category, Entry, ID, PayDetail, PayMethod, User } from './types';
import { ymdToSerial, type WInput, type WSheet } from './xlsx';

/** 엑셀·CSV 내보내기 (기획서 10.2). 화면과 무관한 순수 계산만 한다. */

export type ExportFormat = 'monthly' | 'list';

export type ExportRange =
  | { kind: 'all' }
  | { kind: 'year'; year: number }
  | { kind: 'period'; from: string; to: string };

export interface ExportOptions {
  format: ExportFormat;
  range: ExportRange;
  /** [보류] 내역을 목록에 넣을지 (요약 합계는 항상 앱과 같이 보류를 뺀다) */
  includePending: boolean;
}

export interface ExportData {
  entries: Entry[];
  users: User[];
  categories: Category[];
  payMethods: PayMethod[];
  payDetails: PayDetail[];
  today: string;
}

export const LIST_HEADERS = ['날짜', '사용처', '명세', '분류', '금액', '사용자', '지불수단', '결제상세', '상태'] as const;

export function inRange(date: string, r: ExportRange): boolean {
  if (r.kind === 'all') return true;
  if (r.kind === 'year') return date.startsWith(`${r.year}-`);
  return date >= r.from && date <= r.to;
}

export function rangeLabel(r: ExportRange): string {
  if (r.kind === 'all') return 'all';
  if (r.kind === 'year') return `${r.year}`;
  return `${r.from}_${r.to}`;
}

/** 내보낼 내역 (날짜·입력 순) */
export function selectEntries(d: ExportData, o: ExportOptions): Entry[] {
  return d.entries
    .filter((e) => !e.deleted && inRange(e.date, o.range))
    .filter((e) => o.includePending || entryStatus(e, d.today) !== 'pending')
    .sort(compareEntries);
}

function statusText(e: Entry, today: string): string {
  const st = entryStatus(e, today);
  const parts: string[] = [];
  if (st === 'pending') parts.push('보류');
  if (st === 'scheduled') parts.push('예정');
  if (e.isEstimate) parts.push('예상');
  return parts.join('·');
}

interface Names {
  user: (id: ID | null) => string;
  category: (id: ID | null) => string;
  pay: (id: ID | null) => string;
  detail: (id: ID | null) => string;
}

function namesOf(d: ExportData): Names {
  const mk = (list: { id: ID; name: string }[]) => {
    const m = new Map(list.map((x) => [x.id, x.name]));
    return (id: ID | null) => (id ? (m.get(id) ?? '') : '');
  };
  return { user: mk(d.users), category: mk(d.categories), pay: mk(d.payMethods), detail: mk(d.payDetails) };
}

function entryRow(e: Entry, n: Names, today: string): WInput[] {
  return [
    { v: ymdToSerial(e.date), s: 'date' },
    e.store,
    e.memo,
    n.category(e.category),
    { v: e.amount, s: 'num' },
    n.user(e.user),
    n.pay(e.payMethod),
    n.detail(e.payDetail),
    statusText(e, today),
  ];
}

const LIST_WIDTHS = [12, 22, 32, 18, 12, 12, 12, 16, 10];

function header(): WInput[] {
  return LIST_HEADERS.map((h) => ({ v: h, s: 'head' as const }));
}

/** `사용자` 시트: 이름·구분·그룹 구성원. 이 파일을 다시 가져올 때 구분과 구성원을 미리 채우는 데 쓴다 */
export function userSheet(d: ExportData): WSheet {
  const byId = new Map(d.users.map((u) => [u.id, u.name]));
  const sorted = [...d.users].filter((u) => !u.deleted).sort((a, b) => (a.type === b.type ? a.order - b.order : a.type === 'person' ? -1 : 1));
  return {
    name: '사용자',
    freezeRows: 1,
    widths: [16, 8, 40],
    rows: [
      [{ v: '이름', s: 'head' }, { v: '구분', s: 'head' }, { v: '구성원', s: 'head' }],
      ...sorted.map((u) => [u.name, u.type === 'group' ? '그룹' : '개인', u.type === 'group' ? u.memberIds.map((id) => byId.get(id) ?? '').filter(Boolean).join(', ') : ''] as WInput[]),
    ],
  };
}

/** 합계를 (이름, 금액) 짝으로 늘어놓은 줄들. 한 줄에 perRow짝 */
function pairRows(label: string, pairs: [string, number][], perRow: number): WInput[][] {
  if (!pairs.length) return [[{ v: label, s: 'bold' }, '없음']];
  const rows: WInput[][] = [];
  for (let i = 0; i < pairs.length; i += perRow) {
    const row: WInput[] = [i === 0 ? { v: label, s: 'bold' } : null];
    for (const [name, amt] of pairs.slice(i, i + perRow)) row.push(name, { v: amt, s: 'num' });
    rows.push(row);
  }
  return rows;
}

function monthSheet(ym: string, es: Entry[], d: ExportData, n: Names): WSheet {
  const sum = summarize(es, ym, d.today);
  const pick = <T extends { id: ID; name: string; order?: number }>(list: T[], map: Map<ID | null, number>, unnamed = '(미지정)') => {
    const out: [string, number][] = [];
    for (const x of list) {
      const v = map.get(x.id);
      if (v) out.push([x.name, v]);
    }
    const none = map.get(null);
    if (none) out.push([unnamed, none]);
    return out;
  };
  const sortOrd = <T extends { order: number }>(l: T[]) => [...l].filter((x) => !(x as { deleted?: boolean }).deleted).sort((a, b) => a.order - b.order);
  const top: WInput[][] = [
    [{ v: `${ym.slice(0, 4)}년 ${monthNum(ym)}월`, s: 'title' }],
    [
      { v: '금액합계', s: 'bold' },
      { v: Math.round(sum.total), s: 'boldnum' },
      { v: '하루평균지출', s: 'bold' },
      { v: Math.round(sum.dailyAvg), s: 'boldnum' },
      { v: '예상월지출', s: 'bold' },
      { v: Math.round(sum.projected), s: 'boldnum' },
    ],
    ...pairRows('사용자별', pick(sortOrd(d.users), sum.byUser), 6),
    ...pairRows('지불수단별', pick(sortOrd(d.payMethods), sum.byPayMethod), 6),
    ...pairRows('분류별', pick(sortOrd(d.categories), sum.byCategory), 6),
    [{ v: '※ 합계는 앱과 같이 [보류] 내역을 뺀 값입니다', s: 'mute' }],
    [],
    header(),
  ];
  const freeze = top.length;
  return {
    name: ym,
    freezeRows: freeze,
    widths: LIST_WIDTHS,
    rows: [...top, ...es.map((e) => entryRow(e, n, d.today))],
  };
}

function yearSheet(year: number, es: Entry[], d: ExportData): WSheet {
  const order = [...d.categories].filter((c) => !c.deleted).sort((a, b) => a.order - b.order).map((c) => c.id);
  const ys = yearStats(es, year, d.today, order);
  const catName = new Map(d.categories.map((c) => [c.id, c.name]));
  const head: WInput[] = ['분류', ...Array.from({ length: 12 }, (_, i) => `${i + 1}월`), '합계', '월평균'].map((h) => ({ v: h, s: 'head' as const }));
  const rows: WInput[][] = ys.rows.map((r) => [
    r.category ? (catName.get(r.category) ?? '') : '(미분류)',
    ...r.months.map((v) => ({ v: v || null, s: 'num' as const })),
    { v: r.total, s: 'boldnum' as const },
    { v: Math.round(r.avg), s: 'num' as const },
  ]);
  rows.push([
    { v: '합계', s: 'bold' },
    ...ys.monthTotals.map((v) => ({ v: v || null, s: 'boldnum' as const })),
    { v: ys.total, s: 'boldnum' },
    { v: Math.round(ys.avg), s: 'boldnum' },
  ]);
  return {
    name: `${year} 분류별`,
    freezeRows: 1,
    widths: [18, ...Array(12).fill(11), 13, 12],
    rows: [head, ...rows, [], [{ v: '※ [보류] 내역은 제외한 값입니다', s: 'mute' }]],
  };
}

/** 엑셀 파일로 만들 시트들 */
export function buildExportSheets(d: ExportData, o: ExportOptions): WSheet[] {
  const es = selectEntries(d, o);
  const n = namesOf(d);
  const sheets: WSheet[] = [];
  if (o.format === 'list') {
    sheets.push({
      name: '내역',
      freezeRows: 1,
      widths: LIST_WIDTHS,
      rows: [header(), ...es.map((e) => entryRow(e, n, d.today))],
    });
  } else {
    const byMonth = new Map<string, Entry[]>();
    for (const e of es) {
      const ym = ymOf(e.date);
      (byMonth.get(ym) ?? byMonth.set(ym, []).get(ym)!).push(e);
    }
    for (const ym of [...byMonth.keys()].sort()) sheets.push(monthSheet(ym, byMonth.get(ym)!, d, n));
    const years = [...new Set(es.map((e) => Number(e.date.slice(0, 4))))].sort();
    for (const y of years) sheets.push(yearSheet(y, es, d));
  }
  sheets.push(userSheet(d));
  return sheets;
}

/* ───────── CSV ───────── */

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 단순 목록 CSV (엑셀에서 한글이 깨지지 않도록 앞에 BOM을 붙인다) */
export function buildCsv(d: ExportData, o: ExportOptions): string {
  const n = namesOf(d);
  const lines = [LIST_HEADERS.join(',')];
  for (const e of selectEntries(d, o)) {
    lines.push(
      [e.date, e.store, e.memo, n.category(e.category), e.amount, n.user(e.user), n.pay(e.payMethod), n.detail(e.payDetail), statusText(e, d.today)]
        .map(csvCell)
        .join(','),
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
