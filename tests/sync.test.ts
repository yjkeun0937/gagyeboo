import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { LedgerDB, SCHEMA_VERSION } from '../src/store/db';
import { emptySyncState, previewMerge, syncOnce, SyncError, type SyncState } from '../src/sync/engine';
import type { Entry } from '../src/lib/types';
import { seedCategories } from '../src/lib/seed';
import { MemoryDrive } from './memoryDrive';

let n = 0;
let drive: MemoryDrive;

/** 기기 하나: 자기 IndexedDB와 동기화 상태를 가진다 */
class Device {
  db: LedgerDB;
  state: SyncState = emptySyncState();
  constructor(public name: string) {
    this.db = new LedgerDB(`sync-${++n}-${name}`);
  }
  async seed() {
    await this.db.categories.bulkPut(seedCategories());
    await this.db.meta.put({ key: 'seeded', value: true });
  }
  async put(id: string, patch: Partial<Entry> = {}) {
    const cur = (await this.db.entries.get(id)) as Entry | undefined;
    const row: Entry = {
      id,
      date: '2026-10-05',
      store: '가게',
      memo: '',
      category: 'cat_01',
      amount: 1000,
      user: null,
      payMethod: null,
      payDetail: null,
      source: 'manual',
      createdAt: 1,
      updatedAt: 1,
      ...cur,
      ...patch,
    };
    await this.db.entries.put(row);
    return row;
  }
  async sync(client = drive) {
    const r = await syncOnce(this.db, client, this.state);
    this.state = r.state;
    return r;
  }
  async entry(id: string) {
    return (await this.db.entries.get(id)) as Entry | undefined;
  }
  async liveCount() {
    return (await this.db.entries.toArray()).filter((e) => !e.deleted).length;
  }
}

beforeEach(() => {
  drive = new MemoryDrive();
});

describe('동기화: 기본', () => {
  it('첫 기기가 올리면 meta.json과 연도별 내역 파일이 생기고, 새 기기가 그대로 받는다', async () => {
    const a = new Device('a');
    await a.seed();
    await a.put('e1', { date: '2025-12-31', updatedAt: 10 });
    await a.put('e2', { date: '2026-01-02', updatedAt: 11 });
    const r = await a.sync();
    expect(r.pushedFiles).toBe(3);
    expect(drive.byName('meta.json')).toHaveLength(1);
    expect(drive.json('entries-2025.json').entries.map((e: Entry) => e.id)).toEqual(['e1']);
    expect(drive.json('entries-2026.json').entries.map((e: Entry) => e.id)).toEqual(['e2']);

    const b = new Device('b');
    const rb = await b.sync();
    expect(rb.pulled).toBeGreaterThan(0);
    expect(await b.liveCount()).toBe(2);
    expect((await b.db.categories.count())).toBe(seedCategories().length);
    expect(rb.pushedFiles).toBe(0);
  });

  it('바뀐 게 없으면 두 번째 동기화는 아무것도 읽거나 올리지 않는다', async () => {
    const a = new Device('a');
    await a.put('e1');
    await a.sync();
    const before = { ...drive.calls };
    const r = await a.sync();
    expect(r.pushedFiles).toBe(0);
    expect(r.pulled).toBe(0);
    expect(drive.calls.read).toBe(before.read);
    expect(drive.calls.create).toBe(before.create);
    expect(drive.calls.update).toBe(before.update);
  });

  it('로컬만 바뀌면 그 연도 파일만 올린다', async () => {
    const a = new Device('a');
    await a.put('e1', { date: '2025-03-01' });
    await a.put('e2', { date: '2026-03-01' });
    await a.sync();
    const u0 = drive.calls.update;
    await a.put('e2', { amount: 5, updatedAt: 99 });
    const r = await a.sync();
    expect(r.pushedFiles).toBe(1);
    expect(drive.calls.update - u0).toBe(1);
    expect(drive.json('entries-2026.json').entries[0].amount).toBe(5);
  });
});

describe('동기화: 병합 규칙', () => {
  it('같은 기록은 updatedAt이 최신인 쪽이 이긴다 (양쪽 기기에서 같은 결과)', async () => {
    const a = new Device('a');
    const b = new Device('b');
    await a.put('e1', { store: '처음', updatedAt: 10 });
    await a.sync();
    await b.sync();
    await a.put('e1', { store: 'A가 고침', updatedAt: 20 });
    await b.put('e1', { store: 'B가 고침', updatedAt: 30 });
    await a.sync();
    await b.sync();
    await a.sync();
    expect((await a.entry('e1'))!.store).toBe('B가 고침');
    expect((await b.entry('e1'))!.store).toBe('B가 고침');
  });

  it('삭제 표시가 다른 기기로 전파된다', async () => {
    const a = new Device('a');
    const b = new Device('b');
    await a.put('e1', { updatedAt: 10 });
    await a.sync();
    await b.sync();
    expect(await b.liveCount()).toBe(1);
    await a.put('e1', { deleted: true, updatedAt: 20 });
    await a.sync();
    await b.sync();
    expect((await b.entry('e1'))!.deleted).toBe(true);
    expect(await b.liveCount()).toBe(0);
  });

  it('서로 다른 기록은 모두 남는다', async () => {
    const a = new Device('a');
    const b = new Device('b');
    await a.put('a1', { updatedAt: 10 });
    await b.put('b1', { updatedAt: 11 });
    await a.sync();
    await b.sync();
    await a.sync();
    expect(await a.liveCount()).toBe(2);
    expect(await b.liveCount()).toBe(2);
  });

  it('내역의 날짜를 다른 해로 옮겨도 최신 기록이 이긴다', async () => {
    const a = new Device('a');
    const b = new Device('b');
    await a.put('e1', { date: '2025-12-30', updatedAt: 10 });
    await a.sync();
    await b.sync();
    await b.put('e1', { date: '2026-01-02', updatedAt: 20 });
    await b.sync();
    await a.sync();
    expect((await a.entry('e1'))!.date).toBe('2026-01-02');
    // 옛 연도 파일에 남은 낡은 사본이 되살아나지 않는다
    await a.sync();
    await b.sync();
    expect((await b.entry('e1'))!.date).toBe('2026-01-02');
  });

  it('seed 분류의 이름을 바꾸면 새 기기의 seed(updatedAt 0)보다 우선한다', async () => {
    const a = new Device('a');
    await a.seed();
    await a.db.categories.put({ ...seedCategories()[0], name: '내가 바꾼 이름', updatedAt: 50 });
    await a.sync();
    const b = new Device('b');
    await b.seed(); // 새 기기도 기본 분류를 만든 상태
    await b.sync();
    expect((await b.db.categories.get('cat_01'))!.name).toBe('내가 바꾼 이름');
  });

  it('seed 분류를 한 기기에서 지우면(삭제 표시) 다른 기기의 seed 사본이 되살리지 못한다', async () => {
    const a = new Device('a');
    await a.seed();
    await a.db.categories.put({ ...seedCategories()[2], deleted: true, updatedAt: 60 });
    await a.sync();
    const b = new Device('b');
    await b.seed();
    await b.sync();
    await b.sync();
    expect((await b.db.categories.get('cat_03'))!.deleted).toBe(true);
  });
});

describe('동기화: 설정·처음 쓴 달', () => {
  it('월간 목표·미래 내역 표시는 공유되고, 화면 취향(테마 등)은 기기마다 따로다', async () => {
    const a = new Device('a');
    const b = new Device('b');
    await a.db.meta.put({ key: 'settings', value: { theme: 'dark', fontScale: 120, monthlyGoal: 1500000, futureDisplay: 'hide' } });
    await a.db.meta.put({ key: 'settingsAt', value: 100 });
    await b.db.meta.put({ key: 'settings', value: { theme: 'light', fontScale: 100, monthlyGoal: null, futureDisplay: 'all' } });
    await a.sync();
    const r = await b.sync();
    expect(r.changed).toBe(true);
    const s = (await b.db.meta.get('settings'))!.value as Record<string, unknown>;
    expect(s.monthlyGoal).toBe(1500000);
    expect(s.futureDisplay).toBe('hide');
    expect(s.theme).toBe('light');
    expect(s.fontScale).toBe(100);
  });

  it('더 나중에 바꾼 설정이 이긴다', async () => {
    const a = new Device('a');
    const b = new Device('b');
    await a.db.meta.put({ key: 'settings', value: { monthlyGoal: 100 } });
    await a.db.meta.put({ key: 'settingsAt', value: 100 });
    await a.sync();
    await b.sync();
    await b.db.meta.put({ key: 'settings', value: { monthlyGoal: 200 } });
    await b.db.meta.put({ key: 'settingsAt', value: 200 });
    await b.sync();
    await a.sync();
    expect(((await a.db.meta.get('settings'))!.value as { monthlyGoal: number }).monthlyGoal).toBe(200);
  });

  it('처음 쓴 달은 더 이른 쪽으로 맞춘다', async () => {
    const a = new Device('a');
    const b = new Device('b');
    await a.db.meta.put({ key: 'firstUseYm', value: '2026-03' });
    await b.db.meta.put({ key: 'firstUseYm', value: '2026-10' });
    await a.sync();
    await b.sync();
    expect((await b.db.meta.get('firstUseYm'))!.value).toBe('2026-03');
    await a.sync();
    expect((await a.db.meta.get('firstUseYm'))!.value).toBe('2026-03');
  });

  it('고정지출 항목과 처리 상태도 전달된다', async () => {
    const a = new Device('a');
    const b = new Device('b');
    await a.db.fixedItems.put({ id: 'fx1', name: '통신비', updatedAt: 5 } as never);
    await a.db.fixedRuns.put({ id: 'run_2026-10', ym: '2026-10', status: 'done', updatedAt: 6 } as never);
    await a.sync();
    await b.sync();
    expect((await b.db.fixedItems.get('fx1'))!.id).toBe('fx1');
    expect((await b.db.fixedRuns.get('run_2026-10'))!.id).toBe('run_2026-10');
  });
});

describe('동기화: 동시 사용·복구', () => {
  it('올리는 도중 다른 기기가 먼저 올리면 다시 읽어 합친 뒤 올린다', async () => {
    const a = new Device('a');
    const b = new Device('b');
    await a.put('a1', { updatedAt: 10 });
    await a.sync();
    await b.sync();
    // B가 올리려는 순간, A가 새 기록을 먼저 올린다
    await b.put('b1', { updatedAt: 20 });
    drive.beforeStat = () => {
      const f = [...drive.files.values()].find((x) => x.name === 'entries-2026.json')!;
      const doc = JSON.parse(f.content);
      doc.entries.push({ ...doc.entries[0], id: 'a2', updatedAt: 15 });
      f.content = JSON.stringify(doc);
      f.version++;
    };
    await b.sync();
    expect((await b.entry('a2'))!.id).toBe('a2');
    expect(drive.json('entries-2026.json').entries.map((e: Entry) => e.id).sort()).toEqual(['a1', 'a2', 'b1']);
  });

  it('한 기기의 변경이 덮어쓰기로 사라져도 다음 동기화에서 다시 올라간다', async () => {
    const a = new Device('a');
    const b = new Device('b');
    await a.put('a1', { updatedAt: 10 });
    await a.sync();
    await b.sync();
    await a.put('a2', { updatedAt: 20 });
    await a.sync();
    // B가 A의 변경을 모른 채 자기 내용으로 통째로 덮어쓴 상황
    const f = [...drive.files.values()].find((x) => x.name === 'entries-2026.json')!;
    f.content = JSON.stringify({ app: 'gagyeboo', kind: 'entries', schemaVersion: SCHEMA_VERSION, year: '2026', entries: [(await a.entry('a1'))!] });
    f.version++;
    expect(drive.json('entries-2026.json').entries).toHaveLength(1);
    await a.sync();
    expect(drive.json('entries-2026.json').entries.map((e: Entry) => e.id).sort()).toEqual(['a1', 'a2']);
  });

  it('같은 이름 파일이 둘 생기면(동시 생성) 합쳐서 하나로 정리한다', async () => {
    const a = new Device('a');
    const b = new Device('b');
    await a.put('a1', { updatedAt: 10 });
    await b.put('b1', { updatedAt: 11 });
    // 둘이 동시에 첫 업로드를 해서 파일이 두 개 생김
    const doc = (ids: string[]) =>
      JSON.stringify({ app: 'gagyeboo', kind: 'entries', schemaVersion: SCHEMA_VERSION, year: '2026', entries: ids.map((id, i) => ({ id, date: '2026-10-05', amount: 1, updatedAt: 10 + i })) });
    await drive.create('entries-2026.json', doc(['a1']));
    await drive.create('entries-2026.json', doc(['b1']));
    await a.sync();
    expect(drive.byName('entries-2026.json')).toHaveLength(1);
    expect(drive.json('entries-2026.json').entries.map((e: Entry) => e.id).sort()).toEqual(['a1', 'b1']);
    expect(await a.liveCount()).toBe(2);
  });

  it('드라이브 파일이 사라지면 내 기록으로 다시 만든다', async () => {
    const a = new Device('a');
    await a.put('e1', { updatedAt: 10 });
    await a.sync();
    drive.files.clear();
    await a.sync();
    expect(drive.json('entries-2026.json').entries).toHaveLength(1);
  });

  it('다른 기기의 앱이 더 새 스키마로 올렸으면 동기화를 멈추고 알린다', async () => {
    await drive.create(
      'meta.json',
      JSON.stringify({ app: 'gagyeboo', kind: 'meta', schemaVersion: SCHEMA_VERSION + 1 }),
    );
    const a = new Device('a');
    await expect(a.sync()).rejects.toMatchObject({ code: 'newer-version' });
    await expect(a.sync()).rejects.toBeInstanceOf(SyncError);
  });

  it('이 앱 파일이 아니면 건드리지 않고 오류를 낸다', async () => {
    await drive.create('meta.json', '{"hello":1}');
    const a = new Device('a');
    await expect(a.sync()).rejects.toMatchObject({ code: 'bad-data' });
  });
});

describe('로그인 직후 병합 미리보기', () => {
  it('이 기기·드라이브·합친 뒤 건수를 센다 (삭제된 것 제외, 같은 기록은 한 번)', async () => {
    const a = new Device('a');
    await a.put('x1', { updatedAt: 10 });
    await a.put('x2', { updatedAt: 10 });
    await a.put('x3', { updatedAt: 10, deleted: true });
    await a.sync();
    const b = new Device('b');
    await b.put('x2', { updatedAt: 5 }); // 같은 기록 (드라이브가 더 최신)
    await b.put('y1', { updatedAt: 6 });
    const p = await previewMerge(b.db, drive);
    expect(p).toEqual({ local: 2, remote: 2, merged: 3 });
  });
});
