import { DateField } from '../ui/DateField';
import { useMemo, useState } from 'preact/hooks';
import { buildCsv, buildExportSheets, rangeLabel, selectEntries, type ExportData, type ExportFormat, type ExportOptions, type ExportRange } from '../lib/exporter';
import { todayKST } from '../lib/dates';
import { writeXlsx } from '../lib/xlsx';
import { assetLogs, assets, categories, entries, payDetails, payMethods, showToast, users } from '../store/store';
import { downloadFile, XLSX_MIME } from '../ui/download';
import { Ui } from '../ui/icons';
import { Modal } from '../ui/overlay';

type RangeKind = 'all' | 'year' | 'period';

function data(): ExportData {
  return {
    entries: entries.value,
    users: users.value,
    categories: categories.value,
    payMethods: payMethods.value,
    payDetails: payDetails.value,
    today: todayKST(),
    assets: assets.value,
    assetLogs: assetLogs.value,
  };
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const live = entries.value.filter((e) => !e.deleted);
  const years = useMemo(() => [...new Set(live.map((e) => Number(e.date.slice(0, 4))))].sort((a, b) => b - a), [live.length]);
  const dates = live.map((e) => e.date).sort();
  const [format, setFormat] = useState<ExportFormat>('monthly');
  const [kind, setKind] = useState<RangeKind>(years.length > 1 ? 'year' : 'all');
  const [year, setYear] = useState(years[0] ?? Number(todayKST().slice(0, 4)));
  const [from, setFrom] = useState(dates[0] ?? todayKST());
  const [to, setTo] = useState(dates[dates.length - 1] ?? todayKST());
  const [pending, setPending] = useState(true);
  const hasAssets = assets.value.length > 0;
  const [withAssets, setWithAssets] = useState(true);

  const range: ExportRange = kind === 'all' ? { kind: 'all' } : kind === 'year' ? { kind: 'year', year } : { kind: 'period', from, to };
  const opts: ExportOptions = { format, range, includePending: pending, includeAssets: hasAssets && withAssets };
  const periodBad = kind === 'period' && (!from || !to || from > to);
  const count = periodBad ? 0 : selectEntries(data(), opts).length;
  const name = (ext: string) => `gagyeboo-${rangeLabel(range)}-${format === 'monthly' ? 'monthly' : 'list'}-${todayKST()}.${ext}`;

  const makeXlsx = () => {
    const sheets = buildExportSheets(data(), opts);
    downloadFile(name('xlsx'), writeXlsx(sheets), XLSX_MIME);
    showToast(`엑셀 파일을 만들었습니다 (${count}건)`);
    onClose();
  };
  const makeCsv = () => {
    downloadFile(name('csv'), buildCsv(data(), { ...opts, format: 'list' }), 'text/csv;charset=utf-8');
    showToast(`CSV 파일을 만들었습니다 (${count}건)`);
    onClose();
  };

  return (
    <Modal
      title="엑셀로 내보내기"
      onClose={onClose}
      footer={
        <>
          <button type="button" class="btn" onClick={onClose}>
            취소
          </button>
          <span class="grow" />
          <button type="button" class="btn" disabled={!count} onClick={makeCsv} title="단순 목록을 CSV로">
            CSV
          </button>
          <button type="button" class="btn primary" data-autofocus disabled={!count} onClick={makeXlsx}>
            <Ui name="Download" size={16} />
            엑셀 파일 만들기
          </button>
        </>
      }
    >
      <div class="field">
        <span class="label">범위</span>
        <div class="segmented" role="group" aria-label="내보낼 범위">
          {(
            [
              ['all', '전체'],
              ['year', '연도'],
              ['period', '기간'],
            ] as [RangeKind, string][]
          ).map(([k, l]) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {l}
            </button>
          ))}
        </div>
        {kind === 'year' ? (
          <select class="input" aria-label="연도" value={year} onChange={(e) => setYear(Number(e.currentTarget.value))}>
            {(years.length ? years : [year]).map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
        ) : null}
        {kind === 'period' ? (
          <div class="ex-period">
            <DateField strict label="시작일" value={from} onChange={setFrom} />
            <span>~</span>
            <DateField strict label="종료일" value={to} onChange={setTo} />
          </div>
        ) : null}
        {periodBad ? <p class="form-error">시작일과 종료일을 확인해 주세요</p> : null}
      </div>

      <div class="field">
        <span class="label">형식</span>
        <div class="segmented" role="group" aria-label="파일 형식">
          <button type="button" aria-pressed={format === 'monthly'} onClick={() => setFormat('monthly')}>
            월별 시트
          </button>
          <button type="button" aria-pressed={format === 'list'} onClick={() => setFormat('list')}>
            단순 목록
          </button>
        </div>
        <p class="hint">
          {format === 'monthly'
            ? '월마다 시트를 만들고 위쪽에 월 요약(합계·사용자별·지불수단별·분류별)을 둡니다. 연간 「분류별」 시트도 함께 만듭니다.'
            : '모든 내역을 한 시트의 표로 내보냅니다. 필터·피벗 표로 분석하기 좋습니다.'}
        </p>
      </div>

      <label class="check">
        <input type="checkbox" checked={pending} onChange={(e) => setPending(e.currentTarget.checked)} />
        [보류] 내역도 목록에 포함 (요약 합계는 항상 보류를 뺍니다)
      </label>

      {hasAssets ? (
        <label class="check">
          <input type="checkbox" checked={withAssets} onChange={(e) => setWithAssets(e.currentTarget.checked)} />
          재산상황·재산 이력 시트도 포함 (엑셀 파일만)
        </label>
      ) : null}

      <p class="hint">
        <b class="num">{count}건</b>을 내보냅니다. 사용자 구분(개인·그룹·구성원)은 <code>사용자</code> 시트에 함께 들어가, 이 파일을 다시 가져올 때 미리 채워집니다.
        파일은 이 기기에서 만들어지며 어디로도 보내지 않습니다.
      </p>
    </Modal>
  );
}
