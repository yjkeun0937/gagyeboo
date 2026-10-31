import { describe, expect, it } from 'vitest';
import { buildExportSheets } from '../src/lib/exporter';
import type { Asset, AssetLog } from '../src/lib/types';

const base: Asset = {
  id: 'a1', category: 'deposit', name: '가상은행', kind: '정기예금', owner: 'u1', amount: 3000, payStatus: '', coverage: '',
  term: '12개월', rate: 3.5, maturity: '2026-12-01', tax: 'taxable', memo: '', inCash: true, state: 'active',
  endReason: null, endedOn: null, createdAt: 1, updatedAt: 100,
};
const assets: Asset[] = [
  base,
  { ...base, id: 'a2', name: '가상증권', kind: '주식', amount: 2000, inCash: false, owner: null, maturity: '', state: 'ended', endReason: 'sold', endedOn: '2026-09-01', updatedAt: 200 },
  { ...base, id: 'a3', name: '지워진항목', deleted: true },
];
const logs: AssetLog[] = [
  { id: 'l1', assetId: 'a1', at: 100, kind: 'create', changes: [{ field: 'amount', from: null, to: 3000 }], note: '', updatedAt: 100 },
  { id: 'l2', assetId: 'a3', at: 50, kind: 'create', changes: [{ field: 'amount', from: null, to: 1 }], note: '', updatedAt: 50 },
];
const data = {
  entries: [], users: [{ id: 'u1', name: '가나', type: 'person' as const, memberIds: [], icon: 'User', color: '#000', order: 0, updatedAt: 1 }],
  categories: [], payMethods: [], payDetails: [], today: '2026-10-01', assets, assetLogs: logs,
};
const o = { format: 'list' as const, range: { kind: 'all' as const }, includePending: true };

describe('엑셀 내보내기: 재산상황', () => {
  it('옵션이 켜져 있고 항목이 있으면 재산상황·재산 이력 시트가 들어간다', () => {
    const names = buildExportSheets(data, { ...o, includeAssets: true }).map((s) => s.name);
    expect(names).toContain('재산상황');
    expect(names).toContain('재산 이력');
    expect(buildExportSheets(data, o).map((s) => s.name)).not.toContain('재산상황');
  });
  it('지운 항목은 빠지고, 총계는 보유 항목만 더한다', () => {
    const sheets = buildExportSheets(data, { ...o, includeAssets: true });
    const sh = sheets.find((s) => s.name === '재산상황')!;
    const flat = JSON.stringify(sh.rows);
    expect(flat).not.toContain('지워진항목');
    expect(flat).toContain('가상은행');
    expect(flat).toContain('가상증권');
    const total = sh.rows.find((r) => r[0] && typeof r[0] === 'object' && (r[0] as { v: string }).v === '보유 총계')!;
    expect((total[5] as { v: number }).v).toBe(3000);
    const lg = sheets.find((s) => s.name === '재산 이력')!;
    expect(lg.rows).toHaveLength(2); // 머리글 + a1 한 줄
  });
});
