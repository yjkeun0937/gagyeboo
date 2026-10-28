import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addEntry,
  canDelete,
  categories,
  deleteItem,
  entries,
  exportAll,
  importAll,
  initStore,
  moveItem,
  nameTaken,
  payMethods,
  removeEntry,
  resetAll,
  restoreEntry,
  save,
  updateEntry,
  users,
  validateBackup,
} from '../src/store/store';
import { clearSample, hasSample, loadSample } from '../src/lib/sample';
import type { User } from '../src/lib/types';

let n = 0;
beforeEach(async () => {
  await initStore(`test-${++n}`);
});

const base = {
  date: '2026-10-10',
  store: '테스트상점',
  memo: '',
  category: 'cat_01',
  amount: 1000,
  user: null,
  payMethod: null,
  payDetail: null,
};

const person = (id: string, name: string, order = 0): User => ({
  id, name, type: 'person', memberIds: [], icon: null, color: '#222222', order, updatedAt: 0,
});

describe('처음 시작', () => {
  it('기본 분류 17개·지불수단 7개로 시작하고 사용자는 비어 있다', () => {
    expect(categories.value).toHaveLength(17);
    expect(payMethods.value).toHaveLength(7);
    expect(users.value).toHaveLength(0);
    expect(entries.value).toHaveLength(0);
  });
  it('다시 시작해도 기본 항목이 중복되지 않는다', async () => {
    await initStore(`test-${n}`);
    expect(categories.value).toHaveLength(17);
  });
});

describe('내역', () => {
  it('추가·수정·삭제·되돌리기', async () => {
    const e = await addEntry(base);
    expect(entries.value).toHaveLength(1);
    const prev = await updateEntry(e.id, { amount: 2500 });
    expect(entries.value[0].amount).toBe(2500);
    expect(prev?.amount).toBe(1000);
    const removed = await removeEntry(e.id);
    expect(entries.value).toHaveLength(0);
    await restoreEntry(removed!);
    expect(entries.value).toHaveLength(1);
  });
  it('금액을 고치면 [예상]이 풀린다', async () => {
    const e = await addEntry(base, { isEstimate: true });
    await updateEntry(e.id, { memo: '메모만 수정' });
    expect(entries.value[0].isEstimate).toBe(true);
    await updateEntry(e.id, { amount: 1234 });
    expect(entries.value[0].isEstimate).toBe(false);
  });
  it('같은 날 입력 순서가 유지된다', async () => {
    const a = await addEntry({ ...base, store: 'A' });
    const b = await addEntry({ ...base, store: 'B' });
    expect(b.createdAt).toBeGreaterThan(a.createdAt);
  });
});

describe('사용자 규칙', () => {
  it('이름은 개인·그룹을 통틀어 중복될 수 없다 (공백·대소문자 무시)', async () => {
    await save('users', person('u1', 'Kim'));
    expect(nameTaken('users', ' kim ')).toBe(true);
    expect(nameTaken('users', 'Kim', 'u1')).toBe(false);
    expect(nameTaken('users', 'Lee')).toBe(false);
  });
  it('내역에서 쓰이는 사용자와 그룹 구성원은 삭제할 수 없고, 쓰이지 않으면 삭제된다', async () => {
    await save('users', person('u1', 'A', 0));
    await save('users', person('u2', 'B', 1));
    await save('users', { ...person('g1', 'G', 2), type: 'group', memberIds: ['u1', 'u2'] });
    await addEntry({ ...base, user: 'u1' });
    expect(canDelete('users', 'u1')).toBe(false);
    expect(canDelete('users', 'u2')).toBe(false); // 그룹 구성원
    expect(canDelete('users', 'g1')).toBe(true);
    expect(await deleteItem('users', 'u1')).toBe(false);
    expect(await deleteItem('users', 'g1')).toBe(true);
    expect(canDelete('users', 'u2')).toBe(true); // 그룹이 사라지면 삭제 가능
  });
  it('순서 이동은 개인/그룹 구역 안에서만', async () => {
    await save('users', person('u1', 'A', 0));
    await save('users', person('u2', 'B', 1));
    await save('users', { ...person('g1', 'G', 0), type: 'group', memberIds: ['u1', 'u2'] });
    await moveItem('users', 'u2', -1);
    const order = [...users.value].filter((u) => u.type === 'person').sort((a, b) => a.order - b.order);
    expect(order.map((u) => u.id)).toEqual(['u2', 'u1']);
    await moveItem('users', 'g1', -1); // 그룹은 하나뿐이라 변화 없음
    expect(users.value.find((u) => u.id === 'g1')?.order).toBe(0);
  });
});

describe('백업·복원', () => {
  it('내보낸 데이터를 그대로 복원할 수 있다', async () => {
    await save('users', person('u1', 'A'));
    await addEntry({ ...base, user: 'u1', amount: 4200 });
    const backup = await exportAll();
    expect(validateBackup(backup)).toBe(true);
    await resetAll();
    expect(entries.value).toHaveLength(0);
    await importAll(JSON.parse(JSON.stringify(backup)));
    expect(entries.value).toHaveLength(1);
    expect(entries.value[0].amount).toBe(4200);
    expect(users.value[0].name).toBe('A');
  });
  it('형식이 다른 파일은 거부한다', () => {
    expect(validateBackup({})).toBe(false);
    expect(validateBackup({ app: 'gagyeboo', schemaVersion: 99, entries: [], categories: [], users: [], payMethods: [], payDetails: [] })).toBe(false);
    expect(validateBackup(null)).toBe(false);
  });
});

describe('가상 데이터', () => {
  it('넣고 지울 수 있다', async () => {
    expect(hasSample()).toBe(false);
    const count = await loadSample();
    expect(count).toBeGreaterThan(20);
    expect(hasSample()).toBe(true);
    expect(users.value.filter((u) => u.type === 'group').length).toBeGreaterThan(0);
    await clearSample();
    expect(hasSample()).toBe(false);
    expect(entries.value).toHaveLength(0);
    expect(users.value).toHaveLength(0);
  });
});
