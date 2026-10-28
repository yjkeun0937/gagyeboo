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

export interface AppSettings {
  theme: ThemeSetting;
  iconMode: IconModeSetting;
  fontScale: 100 | 110 | 120;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  iconMode: 'auto',
  fontScale: 100,
};

export type TableName = 'entries' | 'categories' | 'users' | 'payMethods' | 'payDetails';

export interface EntryFilter {
  text: string;
  categoryId: ID | null;
  /** ID, 'none'(미지정), null(전체) */
  userId: ID | 'none' | null;
  payMethodId: ID | null;
  payDetailId: ID | null;
  /** 개인을 고를 때 그 개인이 속한 그룹 내역도 포함 */
  includeGroups: boolean;
}

export const EMPTY_FILTER: EntryFilter = {
  text: '',
  categoryId: null,
  userId: null,
  payMethodId: null,
  payDetailId: null,
  includeGroups: false,
};
