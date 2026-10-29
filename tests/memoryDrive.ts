import type { DriveClient, RemoteFile } from '../src/sync/engine';

/** 테스트용 가짜 드라이브 (메모리) */
export class MemoryDrive implements DriveClient {
  files = new Map<string, { name: string; content: string; version: number }>();
  private seq = 0;
  calls = { list: 0, read: 0, create: 0, update: 0, remove: 0, stat: 0 };
  /** stat 호출 직전에 실행할 훅 (다른 기기가 끼어드는 상황을 흉내 낼 때 사용) */
  beforeStat?: () => void;

  private info(id: string): RemoteFile {
    const f = this.files.get(id)!;
    return { id, name: f.name, version: String(f.version) };
  }
  async list() {
    this.calls.list++;
    return [...this.files.keys()].map((id) => this.info(id));
  }
  async read(id: string) {
    this.calls.read++;
    const f = this.files.get(id);
    if (!f) throw new Error('not found');
    return f.content;
  }
  async create(name: string, content: string) {
    this.calls.create++;
    const id = `f${String(++this.seq).padStart(4, '0')}`;
    this.files.set(id, { name, content, version: 1 });
    return this.info(id);
  }
  async update(id: string, content: string) {
    this.calls.update++;
    const f = this.files.get(id);
    if (!f) throw new Error('not found');
    f.content = content;
    f.version++;
    return this.info(id);
  }
  async remove(id: string) {
    this.calls.remove++;
    this.files.delete(id);
  }
  async stat(id: string) {
    this.calls.stat++;
    const hook = this.beforeStat;
    this.beforeStat = undefined;
    hook?.();
    return this.files.has(id) ? this.info(id) : null;
  }
  byName(name: string) {
    return [...this.files.values()].filter((f) => f.name === name);
  }
  json(name: string) {
    return JSON.parse(this.byName(name)[0].content);
  }
}
