import { addDays, clampDay, daysInMonth, addMonths } from './dates';
import type { Entry, ID, PayDetail, User } from './types';
import { nextStamp, save, today, users, entries, payDetails } from '../store/store';

/**
 * R1 확인용 가상 데이터. 이름·상호는 모두 지어낸 것이고, ID가 'sample_'로 시작한다.
 * 실제 데이터와 섞이지 않게 '가상 데이터 지우기'로 한 번에 지울 수 있다.
 */
const P = 'sample_';

const SAMPLE_USERS: User[] = [
  { id: `${P}u1`, name: '하늘', type: 'person', memberIds: [], icon: 'lucide:Sun', color: '#E07A1F', order: 100, updatedAt: 0 },
  { id: `${P}u2`, name: '바다', type: 'person', memberIds: [], icon: 'lucide:Droplets', color: '#2F7FB8', order: 101, updatedAt: 0 },
  { id: `${P}u3`, name: '구름', type: 'person', memberIds: [], icon: 'lucide:Cat', color: '#6B5BD2', order: 102, updatedAt: 0 },
  { id: `${P}g1`, name: '우리집', type: 'group', memberIds: [`${P}u1`, `${P}u2`, `${P}u3`], icon: 'lucide:House', color: '#2E9E6B', order: 200, updatedAt: 0 },
  { id: `${P}g2`, name: '어른들', type: 'group', memberIds: [`${P}u1`, `${P}u2`], icon: null, color: '#8C6A3F', order: 201, updatedAt: 0 },
];

const SAMPLE_DETAILS: PayDetail[] = [
  { id: `${P}d1`, name: '샘플카드A', payMethodId: 'pay_02', color: '#D1495B', order: 100, updatedAt: 0 },
  { id: `${P}d2`, name: '샘플카드B', payMethodId: 'pay_02', color: '#E8A400', order: 101, updatedAt: 0 },
  { id: `${P}d3`, name: '지역상품권', payMethodId: 'pay_05', color: '#2E9E6B', order: 102, updatedAt: 0 },
];

interface Tpl {
  store: string;
  memo: string;
  cat: string;
  min: number;
  max: number;
  user: string;
  pay: string;
  detail: string | null;
}

const TPL: Tpl[] = [
  { store: '샘플마트', memo: '장보기', cat: 'cat_01', min: 18000, max: 95000, user: 'g1', pay: 'pay_02', detail: 'd1' },
  { store: '샘플마트', memo: '과일·채소', cat: 'cat_01', min: 9000, max: 32000, user: 'g1', pay: 'pay_02', detail: 'd2' },
  { store: '가상식당', memo: '점심', cat: 'cat_02', min: 8000, max: 24000, user: 'u1', pay: 'pay_03', detail: null },
  { store: '가상식당', memo: '저녁 외식', cat: 'cat_02', min: 22000, max: 61000, user: 'g1', pay: 'pay_02', detail: 'd1' },
  { store: '예시치킨', memo: '배달', cat: 'cat_02', min: 17000, max: 28000, user: 'g1', pay: 'pay_05', detail: null },
  { store: '샘플약국', memo: '약', cat: 'cat_13', min: 3000, max: 18000, user: 'u2', pay: 'pay_01', detail: null },
  { store: '가상의원', memo: '진료', cat: 'cat_13', min: 5000, max: 15000, user: 'u3', pay: 'pay_03', detail: null },
  { store: '예시버스', memo: '교통카드 충전', cat: 'cat_06', min: 10000, max: 30000, user: 'u1', pay: 'pay_03', detail: null },
  { store: '샘플주유소', memo: '주유', cat: 'cat_06', min: 40000, max: 70000, user: 'g2', pay: 'pay_02', detail: 'd2' },
  { store: '가상서점', memo: '도서', cat: 'cat_09', min: 12000, max: 36000, user: 'u3', pay: 'pay_02', detail: 'd1' },
  { store: '샘플영화관', memo: '영화', cat: 'cat_07', min: 11000, max: 28000, user: 'g2', pay: 'pay_02', detail: 'd2' },
  { store: '예시옷가게', memo: '티셔츠', cat: 'cat_03', min: 19000, max: 59000, user: 'u2', pay: 'pay_02', detail: 'd1' },
  { store: '샘플생활', memo: '생활용품', cat: 'cat_04', min: 4000, max: 38000, user: 'g1', pay: 'pay_05', detail: null },
  { store: '동네시장', memo: '반찬', cat: 'cat_01', min: 6000, max: 20000, user: 'g1', pay: 'pay_05', detail: 'd3' },
  { store: '예시모임', memo: '회비', cat: 'cat_08', min: 10000, max: 30000, user: 'u1', pay: 'pay_01', detail: null },
];

/** 같은 입력이면 같은 결과가 나오는 간단한 난수 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hasSample(): boolean {
  return (
    users.value.some((u) => u.id.startsWith(P)) || entries.value.some((e) => e.id.startsWith(P))
  );
}

export async function loadSample(): Promise<number> {
  for (const u of SAMPLE_USERS) await save('users', u);
  for (const d of SAMPLE_DETAILS) await save('payDetails', d);

  const rand = rng(20261028);
  const t = today.value;
  const thisMonth = t.slice(0, 7);
  let n = 0;
  for (const back of [2, 1, 0]) {
    const ym = addMonths(thisMonth, -back);
    const lastDay = back === 0 ? Number(t.slice(8, 10)) : daysInMonth(ym);
    const days: number[] = [];
    for (let d = 1; d <= lastDay; d++) if (rand() < 0.62) days.push(d);
    for (const d of days) {
      const count = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < count; k++) {
        const tpl = TPL[Math.floor(rand() * TPL.length)];
        const raw = tpl.min + rand() * (tpl.max - tpl.min);
        const e: Entry = {
          id: `${P}e${ym}-${d}-${k}`,
          date: clampDay(ym, d),
          store: tpl.store,
          memo: tpl.memo,
          category: tpl.cat,
          amount: Math.round(raw / 100) * 100,
          user: `${P}${tpl.user}`,
          payMethod: tpl.pay,
          payDetail: tpl.detail ? `${P}${tpl.detail}` : null,
          source: 'manual',
          createdAt: nextStamp(),
          updatedAt: 0,
        };
        await save('entries', e);
        n++;
      }
    }
  }

  // 화면 확인용: 오늘 이후 날짜의 [예정] 내역과 [보류][예상] 고정지출 내역
  const future = addDays(t, 3);
  const fixedDate = future.startsWith(thisMonth) ? future : `${thisMonth}-28`;
  await save('entries', {
    id: `${P}e-scheduled`,
    date: future,
    store: '샘플공연',
    memo: '예매 (예정 확인용)',
    category: 'cat_07',
    amount: 66000,
    user: `${P}g2`,
    payMethod: 'pay_02',
    payDetail: `${P}d1`,
    source: 'manual',
    createdAt: nextStamp(),
    updatedAt: 0,
  });
  await save('entries', {
    id: `${P}e-pending`,
    date: fixedDate > t ? fixedDate : addDays(t, 1),
    store: '샘플관리비',
    memo: '보류·예상 확인용',
    category: 'cat_11',
    amount: 300000,
    user: `${P}g1`,
    payMethod: 'pay_01',
    payDetail: null,
    source: 'fixed',
    fixedId: `${P}fx1`,
    fixedYm: thisMonth,
    isEstimate: true,
    createdAt: nextStamp(),
    updatedAt: 0,
  } as Entry);
  return n + 2;
}

export async function clearSample(): Promise<number> {
  let n = 0;
  for (const e of entries.value.filter((x) => x.id.startsWith(P))) {
    await save('entries', { ...e, deleted: true });
    n++;
  }
  for (const d of payDetails.value.filter((x) => x.id.startsWith(P))) {
    await save('payDetails', { ...d, deleted: true });
  }
  for (const u of users.value.filter((x) => x.id.startsWith(P))) {
    await save('users', { ...u, deleted: true });
  }
  return n;
}

export type { ID };
