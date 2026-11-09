import { signal } from '@preact/signals';

/**
 * 손님 모드: 다른 사람의 가계부 사본을 읽기 전용으로 보는 상태.
 * 앱을 시작할 때 한 번 정해지고(저장소가 내 가계부와 따로 열린다), 켜져 있으면 화면과 저장소 모두에서 쓰기가 막힌다.
 */
export const guestMode = signal(false);

export class ReadOnlyError extends Error {
  constructor() {
    super('읽기 전용 사본에서는 바꿀 수 없습니다');
    this.name = 'ReadOnlyError';
  }
}

/** 쓰기 전에 부른다. 손님 모드이면 던진다 */
export function assertWritable() {
  if (guestMode.value) throw new ReadOnlyError();
}
