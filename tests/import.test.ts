import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  collectUsers,
  detectMapping,
  extractRows,
  listSheets,
  makePreview,
  readUserSheet,
  validateUserSetup,
  type ImportRow,
  type PlanContext,
  type UserChoice,
  type UserSetup,
} from '../src/lib/importer';
import { buildCsv, buildExportSheets, type ExportData } from '../src/lib/exporter';
import { readXlsx, writeXlsx, ymdToSerial, type WInput, type WSheet } from '../src/lib/xlsx';
import {
  addEntry,
  categories,
  commitImport,
  entries,
  findLastImport,
  initStore,
  payDetails,
  payMethods,
  save,
  undoImport,
  users,
} from '../src/store/store';
import type { User } from '../src/lib/types';

/** 엑셀 가계부 월 시트와 같은 배치의 가상 파일 (이름·상호는 모두 지어낸 것) */
function ledgerSheet(ym: string, lines: (string | number | null)[][]): WSheet {
  const d = (day: number) => ({ v: ymdToSerial(`${ym}-${String(day).padStart(2, '0')}`), s: 'date' as const });
  const rows: WInput[][] = [
    [d(1)],
    ['금액합계', 12345, '하루평균지출금액', 400],
    ['사용자별 합계', null, 12345, 'OK'],
    ['하늘', 100, '우리집', 200],
    [],
    ['날짜', '사용처/명세', null, null, '분류', '금액', '사용자', '지불수단', null],
    ...lines.map((l) => l.map((v, i) => (i === 0 && typeof v === 'number' ? d(v) : v)) as WInput[]),
  ];
  return { name: ym.replace(/-0/, '-'), rows };
}

// 열: 날짜, 사용처, 명세, (병합 빈 칸), 분류, 금액, 사용자, 지불수단, 결제상세
const MARCH = ledgerSheet('2026-03', [
  [null, '용돈', '하늘', null, '용돈', 100000, '하늘', '현금', null], // 날짜 없이 시작하는 줄
  [1, '마트', '장보기', null, '집밥', 30000, '우리집', '신용', '샘플카드'],
  [null, '마트', '과일', null, '집밥', 9000, '우리집', '신용', '샘플카드'],
  [null, '식당', '점심', null, '외식', 12000.5, '바다', '체크', null],
  [2, '약국', '약', null, '의료건강비용', 0, '구름', '현금', null],
  [null, '메모만', '있는 줄', null, null, null, null, null, null],
  [3, '버스', '충전', null, '교통비', 20000, null, '현금', null],
]);

function userSetup(over: Partial<UserSetup> = {}): UserSetup {
  return { choices: new Map(), extraPersons: [], blankUserId: null, ...over };
}

function ctxFor(lookup: PlanContext['lookup'], setup: UserSetup): PlanContext {
  let id = 0;
  let st = 1000;
  return {
    lookup,
    setup,
    today: '2026-10-30',
    colors: ['#111111', '#222222'],
    payIcon: 'lucide:Wallet',
    newId: () => `n${++id}`,
    stamp: () => ++st,
    batchId: 'imp_1',
    now: 5000,
  };
}

const emptyLookup = (over: Partial<PlanContext['lookup']> = {}): PlanContext['lookup'] => ({
  users: [],
  categories: [{ id: 'cat_01', name: '집밥', color: '#000', order: 0, updatedAt: 0 }],
  payMethods: [{ id: 'pay_01', name: '현금', icon: 'x', color: '#000', order: 0, updatedAt: 0 }],
  payDetails: [],
  entries: [],
  ...over,
});

function rowsOf(sheet: WSheet): { rows: ImportRow[]; skipped: number } {
  const wb = readXlsx(writeXlsx([sheet]));
  const map = detectMapping(wb.sheets[0])!;
  const ex = extractRows(wb.sheets[0], map);
  return { rows: ex.rows.map((r, idx) => ({ ...r, idx })), skipped: ex.skippedNoAmount };
}

describe('열 인식·줄 읽기', () => {
  it('엑셀 가계부 배치를 인식한다 (사용처/명세 → 사용처+명세, 머리글 없는 결제상세 열)', () => {
    const wb = readXlsx(writeXlsx([MARCH]));
    expect(listSheets(wb)[0].ym).toBe('2026-03');
    const m = detectMapping(wb.sheets[0])!;
    expect(m.headerRow).toBe(5);
    expect(m.cols).toEqual({ date: 0, store: 1, memo: 2, category: 4, amount: 5, user: 6, payMethod: 7, payDetail: 8 });
  });

  it('날짜 이어받기·금액 없는 줄 건너뛰기·날짜 없는 첫 줄', () => {
    const { rows, skipped } = rowsOf(MARCH);
    expect(skipped).toBe(1); // 글자만 있는 줄
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ date: null, store: '용돈', amount: 100000 });
    expect(rows[1]).toMatchObject({ date: '2026-03-01', dateInherited: false, payDetail: '샘플카드' });
    expect(rows[2]).toMatchObject({ date: '2026-03-01', dateInherited: true });
    expect(rows[3].amount).toBe(12000.5);
    expect(rows[4].amount).toBe(0);
    expect(rows[5]).toMatchObject({ date: '2026-03-03', user: '' });
  });

  it('머리글을 못 찾으면 null', () => {
    const wb = readXlsx(writeXlsx([{ name: 'x', rows: [['가', '나'], [1, 2]] }]));
    expect(detectMapping(wb.sheets[0])).toBeNull();
  });
});

describe('사용자 확인', () => {
  const { rows } = rowsOf(MARCH);

  it('값을 모아 건수를 세고, 이미 있는 이름은 자동 연결한다', () => {
    const known: User = { id: 'u1', name: ' 하늘 ', type: 'person', memberIds: [], icon: null, color: '#000', order: 0, updatedAt: 0 };
    const { refs, blank } = collectUsers(rows, [known]);
    expect(blank).toBe(1);
    expect(refs.find((r) => r.name === '하늘')!.matchedId).toBe('u1');
    expect(refs.find((r) => r.name === '우리집')!.count).toBe(2);
    expect(refs.find((r) => r.name === '바다')!.matchedId).toBeNull();
  });

  it('고르기 전에는 넘어갈 수 없고, 그룹은 구성원 2명 이상이 필요하다', () => {
    const { refs } = collectUsers(rows, []);
    expect(validateUserSetup(refs, userSetup(), []).length).toBe(4);
    const choices = new Map<string, UserChoice>([
      ['하늘', { kind: 'person' }],
      ['바다', { kind: 'person' }],
      ['구름', { kind: 'blank' }],
      ['우리집', { kind: 'group', members: ['하늘'] }],
    ]);
    expect(validateUserSetup(refs, userSetup({ choices }), [])).toEqual(['그룹 「우리집」의 구성원을 2명 이상 골라 주세요']);
    choices.set('우리집', { kind: 'group', members: ['하늘', '바다'] });
    expect(validateUserSetup(refs, userSetup({ choices }), [])).toEqual([]);
    choices.set('우리집', { kind: 'group', members: ['하늘', '없는사람'] });
    expect(validateUserSetup(refs, userSetup({ choices }), [])[0]).toMatch(/개인으로 등록/);
  });
});

describe('미리보기·계획', () => {
  const { rows } = rowsOf(MARCH);
  const choices = new Map<string, UserChoice>([
    ['하늘', { kind: 'person' }],
    ['바다', { kind: 'person' }],
    ['구름', { kind: 'person' }],
    ['우리집', { kind: 'group', members: ['하늘', '바다', '구름'] }],
  ]);

  it('기본값: 날짜 없음·금액 0은 제외, 나머지는 포함. 새 사용자·분류·지불수단·결제상세를 만든다', () => {
    const p = makePreview(rows, ctxFor(emptyLookup(), userSetup({ choices })), new Map());
    expect(p.rows.map((r) => r.flag)).toEqual(['undated', null, null, null, 'zero', null]);
    expect(p.count).toBe(4);
    expect(p.sum).toBe(30000 + 9000 + 12000.5 + 20000);
    expect(p.fractionCount).toBe(1);
    expect(p.newCategories).toEqual(['외식', '교통비']); // 쓰인 값 중 목록에 없는 것만 (용돈·의료건강비용은 제외된 줄에만 있음)
    expect(p.newPayMethods).toEqual(['신용', '체크']);
    expect(p.newPayDetails).toEqual(['샘플카드']);
    expect(p.plan.payDetails[0].payMethodId).toBe(p.plan.payMethods.find((m) => m.name === '신용')!.id);
    // 쓰인 사용자만 만들고, 그룹 구성원은 함께 만든다 (하늘은 제외된 줄에만 있지만 그룹 구성원이라 만들어짐)
    expect(p.newUsers.map((u) => `${u.type}:${u.name}`).sort()).toEqual(['group:우리집', 'person:구름', 'person:바다', 'person:하늘']);
    const grp = p.plan.users.find((u) => u.type === 'group')!;
    expect(grp.memberIds).toHaveLength(3);
    // 같은 날 안의 입력 순서가 유지된다
    const e = p.plan.entries;
    expect(e[0].createdAt).toBeLessThan(e[1].createdAt);
    expect(e.every((x) => x.source === 'import' && x.importBatchId === 'imp_1')).toBe(true);
    expect(e[2].user).toBe(p.plan.users.find((u) => u.name === '바다')!.id);
    expect(e[3].user).toBeNull(); // 사용자 칸이 빈 줄 = 미지정
  });

  it('날짜 없는 줄을 포함하면 그 달 1일로, 0원 줄도 선택으로 포함한다', () => {
    const p = makePreview(rows, ctxFor(emptyLookup(), userSetup({ choices })), new Map([[0, true], [4, true]]));
    expect(p.count).toBe(6);
    expect(p.plan.entries.find((x) => x.store === '용돈')!.date).toBe('2026-03-01');
  });

  it('이미 있는 내역과 같으면 중복 의심으로 제외한다 (같은 파일을 다시 가져올 때)', () => {
    const first = makePreview(rows, ctxFor(emptyLookup(), userSetup({ choices })), new Map());
    // 첫 가져오기 결과가 앱에 들어간 상태를 흉내
    const lookup = emptyLookup({
      users: first.plan.users,
      categories: [...emptyLookup().categories, ...first.plan.categories],
      payMethods: [...emptyLookup().payMethods, ...first.plan.payMethods],
      payDetails: first.plan.payDetails,
      entries: first.plan.entries,
    });
    const again = makePreview(rows, ctxFor(lookup, userSetup({ choices })), new Map());
    expect(again.rows.filter((r) => r.flag === 'dup')).toHaveLength(4);
    expect(again.count).toBe(0);
    // 사용자가 중복이 아니라고 판단하면 포함할 수 있다
    const forced = makePreview(rows, ctxFor(lookup, userSetup({ choices })), new Map([[1, true]]));
    expect(forced.count).toBe(1);
  });

  it('파일 안의 정상적인 중복 입력은 앱에 없으면 그대로 가져온다', () => {
    const twice = [rows[1], { ...rows[1], idx: 99 }];
    const p = makePreview(twice, ctxFor(emptyLookup(), userSetup({ choices })), new Map());
    expect(p.count).toBe(2);
  });

  it('기존 사용자에 연결·빈 칸에 일괄 지정', () => {
    const existing: User = { id: 'u_home', name: '가족', type: 'group', memberIds: [], icon: null, color: '#000', order: 0, updatedAt: 0 };
    const c = new Map<string, UserChoice>([
      ['하늘', { kind: 'blank' }],
      ['바다', { kind: 'link', id: 'u_home' }],
      ['구름', { kind: 'blank' }],
      ['우리집', { kind: 'link', id: 'u_home' }],
    ]);
    const p = makePreview(rows, ctxFor(emptyLookup({ users: [existing] }), userSetup({ choices: c, blankUserId: 'u_home' })), new Map());
    expect(p.plan.users).toHaveLength(0);
    expect(p.plan.entries.every((e) => e.user === 'u_home')).toBe(true);
  });

  it('오늘 이후 날짜·시트와 다른 달 날짜를 알려 준다', () => {
    const r: ImportRow[] = [
      { ...rows[1], idx: 0, date: '2026-12-25' },
      { ...rows[1], idx: 1, date: '2026-04-02' },
    ];
    const p = makePreview(r, ctxFor(emptyLookup(), userSetup({ choices })), new Map());
    expect(p.futureCount).toBe(1);
    expect(p.otherMonthCount).toBe(2);
  });
});

describe('저장·되돌리기', () => {
  let n = 0;
  beforeEach(async () => {
    await initStore(`import-${++n}`);
  });

  it('확정하면 한꺼번에 저장되고, 되돌리면 내역과 새로 만든 목록이 사라진다', async () => {
    const { rows } = rowsOf(MARCH);
    const choices = new Map<string, UserChoice>([
      ['하늘', { kind: 'person' }],
      ['바다', { kind: 'person' }],
      ['구름', { kind: 'person' }],
      ['우리집', { kind: 'group', members: ['하늘', '바다'] }],
    ]);
    const mine = await addEntry({ date: '2026-03-01', store: '내 입력', memo: '', category: 'cat_01', amount: 1, user: null, payMethod: null, payDetail: null });
    const prePay = payMethods.value.length;
    const preCat = categories.value.length;
    const lookup = { users: users.value, categories: categories.value, payMethods: payMethods.value, payDetails: payDetails.value, entries: entries.value };
    const p = makePreview(rows, { ...ctxFor(lookup, userSetup({ choices })), now: Date.now(), batchId: `imp_${Date.now()}` }, new Map());
    await commitImport(p.plan, 'test.xlsx');
    expect(entries.value.filter((e) => e.source === 'import')).toHaveLength(4);
    expect(users.value.filter((u) => u.type === 'group')).toHaveLength(1);
    expect(payMethods.value.length).toBe(prePay); // 신용·체크는 기본 목록에 이미 있음
    expect(payDetails.value).toHaveLength(1);

    const last = await findLastImport();
    expect(last?.count).toBe(4);
    const r = await undoImport(last!.id, true);
    expect(r.entries).toBe(4);
    expect(entries.value.map((e) => e.id)).toEqual([mine.id]); // 직접 입력한 내역은 그대로
    expect(users.value).toHaveLength(0);
    expect(payMethods.value.length).toBe(prePay);
    expect(categories.value.length).toBe(preCat);
    expect(payDetails.value).toHaveLength(0);
    expect(await findLastImport()).toBeNull();
  });

  it('되돌릴 때 다른 곳에서 쓰는 새 목록은 남긴다', async () => {
    const { rows } = rowsOf(MARCH);
    const choices = new Map<string, UserChoice>([['하늘', { kind: 'person' }], ['바다', { kind: 'person' }], ['구름', { kind: 'person' }], ['우리집', { kind: 'person' }]]);
    const lookup = { users: users.value, categories: categories.value, payMethods: payMethods.value, payDetails: payDetails.value, entries: entries.value };
    const p = makePreview(rows, { ...ctxFor(lookup, userSetup({ choices })), now: Date.now(), batchId: `imp_${Date.now()}` }, new Map());
    await commitImport(p.plan, 'a.xlsx');
    const bar = users.value.find((u) => u.name === '바다')!;
    await addEntry({ date: '2026-03-09', store: '직접', memo: '', category: null, amount: 5, user: bar.id, payMethod: null, payDetail: null });
    const last = await findLastImport();
    await undoImport(last!.id, true);
    expect(users.value.map((u) => u.name)).toEqual(['바다']);
  });

  it('여러 번 가져오면 가장 나중 묶음이 마지막이다', async () => {
    const { rows } = rowsOf(MARCH);
    const choices = new Map<string, UserChoice>([['하늘', { kind: 'blank' }], ['바다', { kind: 'blank' }], ['구름', { kind: 'blank' }], ['우리집', { kind: 'blank' }]]);
    const mk = async (id: string, at: number) => {
      const lookup = { users: users.value, categories: categories.value, payMethods: payMethods.value, payDetails: payDetails.value, entries: [] };
      const p = makePreview(rows.slice(1, 2), { ...ctxFor(lookup, userSetup({ choices })), now: at, batchId: id }, new Map());
      await commitImport(p.plan, id);
    };
    await mk('imp_1000', Date.now() - 5000);
    await mk('imp_2000', Date.now());
    expect((await findLastImport())!.id).toBe('imp_2000');
    await save('entries', { ...entries.value.find((e) => e.importBatchId === 'imp_2000')!, deleted: true });
    expect((await findLastImport())!.id).toBe('imp_1000');
  });
});

describe('내보내기', () => {
  const U = (id: string, name: string, type: 'person' | 'group', memberIds: string[] = [], order = 0): User => ({ id, name, type, memberIds, icon: null, color: '#000', order, updatedAt: 0 });
  const data: ExportData = {
    today: '2026-10-30',
    users: [U('u1', '하늘', 'person'), U('u2', '바다', 'person', [], 1), U('g1', '우리집', 'group', ['u1', 'u2'])],
    categories: [{ id: 'c1', name: '집밥', color: '#000', order: 0, updatedAt: 0 }, { id: 'c2', name: '외식', color: '#000', order: 1, updatedAt: 0 }],
    payMethods: [{ id: 'p1', name: '신용', icon: 'x', color: '#000', order: 0, updatedAt: 0 }],
    payDetails: [{ id: 'd1', name: '샘플카드', payMethodId: 'p1', color: '#000', order: 0, updatedAt: 0 }],
    entries: [
      { id: 'e1', date: '2026-03-02', store: '마트, "큰"', memo: '장보기', category: 'c1', amount: 30000, user: 'g1', payMethod: 'p1', payDetail: 'd1', source: 'manual', createdAt: 2, updatedAt: 0 },
      { id: 'e2', date: '2026-03-02', store: '식당', memo: '', category: 'c2', amount: 12000, user: 'u1', payMethod: 'p1', payDetail: null, source: 'manual', createdAt: 1, updatedAt: 0 },
      { id: 'e3', date: '2026-04-01', store: '마트', memo: '', category: 'c1', amount: 5000, user: null, payMethod: null, payDetail: null, source: 'manual', createdAt: 3, updatedAt: 0 },
      { id: 'e4', date: '2026-11-15', store: '관리비', memo: '', category: 'c1', amount: 300000, user: 'g1', payMethod: null, payDetail: null, source: 'fixed', isEstimate: true, createdAt: 4, updatedAt: 0 },
      { id: 'e5', date: '2026-03-03', store: '삭제됨', memo: '', category: 'c1', amount: 1, user: null, payMethod: null, payDetail: null, source: 'manual', createdAt: 5, updatedAt: 0, deleted: true },
    ],
  };

  it('월별 시트 형식: 월마다 시트, 연간 분류별, 사용자 시트. 다시 가져오면 같은 내용', () => {
    const sheets = buildExportSheets(data, { format: 'monthly', range: { kind: 'all' }, includePending: true });
    expect(sheets.map((s) => s.name)).toEqual(['2026-03', '2026-04', '2026-11', '2026 분류별', '사용자']);
    const wb = readXlsx(writeXlsx(sheets));
    const march = wb.sheets[0];
    const map = detectMapping(march)!;
    const ex = extractRows(march, map);
    expect(ex.rows.map((r) => [r.date, r.store, r.amount, r.user])).toEqual([
      ['2026-03-02', '식당', 12000, '하늘'], // 같은 날은 입력 순
      ['2026-03-02', '마트, "큰"', 30000, '우리집'],
    ]);
    expect(ex.rows[1]).toMatchObject({ memo: '장보기', category: '집밥', payMethod: '신용', payDetail: '샘플카드' });
    // 월 요약은 계산된 값으로 들어 있다
    expect(march.rows.flat()).toContain(42000);
    // 사용자 시트로 개인·그룹 제안
    expect(readUserSheet(wb)).toEqual([
      { name: '하늘', type: 'person', members: [] },
      { name: '바다', type: 'person', members: [] },
      { name: '우리집', type: 'group', members: ['하늘', '바다'] },
    ]);
    // 연간 요약: 11월 [보류]는 제외
    const year = wb.sheets.find((s) => s.name === '2026 분류별')!;
    expect(year.rows[0].slice(0, 3)).toEqual(['분류', '1월', '2월']);
    expect(year.rows.find((r) => r[0] === '합계')!.at(-2)).toBe(47000);
  });

  it('보류 제외 옵션·기간 범위·상태 표시', () => {
    const all = buildExportSheets(data, { format: 'list', range: { kind: 'all' }, includePending: true });
    const rows = all[0].rows.slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[3][8]).toBe('보류·예상');
    const noPending = buildExportSheets(data, { format: 'list', range: { kind: 'period', from: '2026-03-01', to: '2026-12-31' }, includePending: false });
    expect(noPending[0].rows.slice(1)).toHaveLength(3);
    const year = buildExportSheets(data, { format: 'list', range: { kind: 'year', year: 2025 }, includePending: true });
    expect(year[0].rows.slice(1)).toHaveLength(0);
  });

  it('CSV: BOM, 쉼표·따옴표 이스케이프', () => {
    const csv = buildCsv(data, { format: 'list', range: { kind: 'year', year: 2026 }, includePending: false });
    expect(csv.startsWith('﻿날짜,사용처')).toBe(true);
    expect(csv).toContain('2026-03-02,"마트, ""큰""",장보기,집밥,30000,우리집,신용,샘플카드,');
    expect(csv.trim().split('\r\n')).toHaveLength(4);
  });
});
