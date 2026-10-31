export type ID = string;

/** 모든 기록의 공통 필드. 기기 간 동기화(R3)를 위해 수정 시각과 삭제 표시를 가진다. */
export interface Base {
  id: ID;
  updatedAt: number;
  deleted?: boolean;
}

export type EntrySource = 'manual' | 'fixed' | 'import';

export interface Entry extends Base {
  /** YYYY-MM-DD (Asia/Seoul 기준) */
  date: string;
  store: string;
  memo: string;
  category: ID | null;
  amount: number;
  user: ID | null;
  payMethod: ID | null;
  payDetail: ID | null;
  source: EntrySource;
  /** 같은 날짜 안의 입력 순서 */
  createdAt: number;
  fixedId?: ID;
  fixedYm?: string;
  /** 금액 미확정(임의 금액) → [예상] */
  isEstimate?: boolean;
  importBatchId?: string;
}

export interface Category extends Base {
  name: string;
  color: string;
  icon?: string;
  order: number;
  hidden?: boolean;
  /** 월 예산 한도(원). 없으면 한도 없음. 모든 달에 같은 금액이 적용된다 */
  budget?: number | null;
}

export interface User extends Base {
  name: string;
  type: 'person' | 'group';
  /** 그룹일 때만. 구성원인 개인의 ID */
  memberIds: ID[];
  /** null이면 개인은 이름 이니셜, 그룹은 기본 그룹 아이콘 */
  icon: string | null;
  color: string;
  order: number;
  hidden?: boolean;
}

export interface PayMethod extends Base {
  name: string;
  icon: string;
  color: string;
  order: number;
  hidden?: boolean;
}

/** 카드사·상품권 등. 모양은 상위 지불수단 아이콘을 따르고 색만 다르다. */
export interface PayDetail extends Base {
  name: string;
  payMethodId: ID | null;
  color: string;
  order: number;
  hidden?: boolean;
}

export type ThemeSetting = 'system' | 'light' | 'dark';
export type IconModeSetting = 'auto' | 'full' | 'icon';

/** 내역 목록의 날짜 정렬: desc = 최신 먼저(기본) */
export type DateSort = 'desc' | 'asc';
/** 오늘 이후([보류]·[예정]) 항목의 목록 표시: 모두 / 건수만 / 표시 안 함 */
export type FutureDisplay = 'all' | 'count' | 'hide';
/** 사용 내역 화면의 기본 보기 */
export type DefaultView = 'list' | 'calendar';

export interface AppSettings {
  theme: ThemeSetting;
  iconMode: IconModeSetting;
  fontScale: 100 | 110 | 120;
  dateSort: DateSort;
  /** 월간 목표 지출액(원). null이면 목표 없음 */
  monthlyGoal: number | null;
  futureDisplay: FutureDisplay;
  defaultView: DefaultView;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  iconMode: 'auto',
  fontScale: 100,
  dateSort: 'desc',
  monthlyGoal: null,
  futureDisplay: 'all',
  defaultView: 'list',
};

export type TableName =
  | 'entries'
  | 'categories'
  | 'users'
  | 'payMethods'
  | 'payDetails'
  | 'fixedItems'
  | 'fixedRuns'
  | 'assets'
  | 'assetLogs';

/** 설정 > 목록 관리에서 다루는 목록 */
export type ListTableName = 'categories' | 'users' | 'payMethods' | 'payDetails';

/** 고정지출 반복 규칙. day는 1~31 또는 'last'(말일). 없는 일자는 그 달 마지막 날로 보정 */
export type FixedSchedule =
  | { kind: 'monthly'; day: number | 'last' }
  | { kind: 'months'; months: number[]; day: number | 'last' }
  | { kind: 'every'; every: number; baseYm: string; day: number | 'last' };

/** 설정에 등록해 두는 고정지출 항목 */
export interface FixedItem extends Base {
  name: string;
  memo: string;
  amount: number;
  /** estimate이면 추가된 내역에 [예상] 알약 */
  amountMode: 'fixed' | 'estimate';
  schedule: FixedSchedule;
  category: ID | null;
  user: ID | null;
  payMethod: ID | null;
  payDetail: ID | null;
  active: boolean;
  order: number;
}

/** 월별 처리 상태. 이 기록이 있으면 월초 입력 창이 자동으로 다시 뜨지 않는다. id = run_YYYY-MM */
export interface FixedMonthRun extends Base {
  ym: string;
  status: 'done' | 'skipped';
}

export interface EntryFilter {
  text: string;
  categoryId: ID | null;
  /** ID, 'none'(미지정), null(전체) */
  userId: ID | 'none' | null;
  payMethodId: ID | null;
  payDetailId: ID | null;
  /** 개인을 고를 때 그 개인이 속한 그룹 내역도 포함 */
  includeGroups: boolean;
  /** [예상] 금액 미확정 내역만 */
  estimateOnly: boolean;
  /** 금액 범위 (원, 양끝 포함). null이면 제한 없음 */
  minAmount: number | null;
  maxAmount: number | null;
  /** 날짜 범위 YYYY-MM-DD (양끝 포함). 전체 기간 검색에서 쓴다 */
  dateFrom: string | null;
  dateTo: string | null;
}

export const EMPTY_FILTER: EntryFilter = {
  text: '',
  categoryId: null,
  userId: null,
  payMethodId: null,
  payDetailId: null,
  includeGroups: false,
  estimateOnly: false,
  minAmount: null,
  maxAmount: null,
  dateFrom: null,
  dateTo: null,
};

/* ───────── 재산상황 ───────── */

export type AssetCategory = 'insurance' | 'realestate' | 'pension' | 'deposit' | 'securities' | 'other';
/** 보유 / 종료(만기·해지·매각 등) / 휴지통 */
export type AssetState = 'active' | 'ended' | 'trash';
export type EndReason = 'matured' | 'terminated' | 'sold' | 'other';
export type AssetTax = 'taxable' | 'taxfree';

export interface Asset extends Base {
  category: AssetCategory;
  /** 금융기관·보험사·자산 이름 */
  name: string;
  /** 종류 (정기예금, 종신, 아파트 …). 직접 적을 수도 있다 */
  kind: string;
  /** 소유자(사용자). null이면 선택 안 함 */
  owner: ID | null;
  /** 원. null이면 금액 미정 (합계에서 빠진다) */
  amount: number | null;
  /** 납입 상태 (보험·연금) */
  payStatus: string;
  /** 보장·조건 (보험) */
  coverage: string;
  /** 기간 (정기예금·적금) */
  term: string;
  /** 이율 % (정기예금·적금) */
  rate: number | null;
  /** 만기일 YYYY-MM-DD (정기예금·적금) */
  maturity: string | null;
  tax: AssetTax | null;
  memo: string;
  /** '현금' 합계에 넣는가 */
  inCash: boolean;
  state: AssetState;
  /** state가 ended일 때만 */
  endReason: EndReason | null;
  endedOn: string | null;
  createdAt: number;
}

export interface AssetChange {
  field: string;
  from: unknown;
  to: unknown;
}

/** 항목 하나의 변경 이력 한 줄. 한 번 쓰면 고치지 않는다 */
export interface AssetLog extends Base {
  assetId: ID;
  /** 변경 시각(ms) */
  at: number;
  kind: 'create' | 'edit' | 'state';
  changes: AssetChange[];
  note: string;
}
