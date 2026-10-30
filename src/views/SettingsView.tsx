import { useEffect, useRef, useState } from 'preact/hooks';
import { digitsOnly, won } from '../lib/format';
import type { FutureDisplay } from '../lib/types';
import { clearSample, hasSample, loadSample } from '../lib/sample';
import { todayKST } from '../lib/dates';
import {
  entries,
  exportAll,
  findLastImport,
  undoImport,
  type LastImport,
  importAll,
  resetAll,
  settings,
  showToast,
  updateSettings,
  validateBackup,
} from '../store/store';
import { SCHEMA_VERSION } from '../store/db';
import { Ui } from '../ui/icons';
import { settingsPage, type SettingsPage } from '../ui/nav';
import { askConfirm } from '../ui/overlay';
import { viewport } from '../ui/viewport';
import { FixedPage } from './FixedPage';
import { AccountPage } from './AccountUi';
import { ListsManager } from './ListsManager';
import { ExportDialog } from './ExportDialog';
import { ImportWizard } from './ImportWizard';

const MENU: { id: SettingsPage; label: string; desc: string; icon: 'CalendarDays' | 'ListChecks' | 'Palette' | 'Cloud' | 'Database' | 'Info' | 'Target' }[] = [
  { id: 'fixed', label: '고정지출', desc: '매달 반복되는 지출 등록', icon: 'CalendarDays' },
  { id: 'lists', label: '목록 관리', desc: '사용자·지불수단·결제상세·분류', icon: 'ListChecks' },
  { id: 'goal', label: '월간 목표', desc: '월간 목표 지출액과 초과 경고', icon: 'Target' },
  { id: 'display', label: '화면', desc: '테마·아이콘 표시·글자 크기', icon: 'Palette' },
  { id: 'account', label: '계정·동기화', desc: '구글 로그인과 기기 간 동기화', icon: 'Cloud' },
  { id: 'data', label: '데이터 관리', desc: '엑셀 가져오기·내보내기, 백업·복원, 초기화', icon: 'Database' },
  { id: 'about', label: '앱 정보', desc: '버전과 저장 방식', icon: 'Info' },
];

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div class="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function GoalPage() {
  const cur = settings.value.monthlyGoal;
  const [v, setV] = useState(cur ? String(cur) : '');
  const n = Number(v || 0);
  const changed = (cur ?? 0) !== n;
  const add = (x: number) => setV(String(n + x));
  return (
    <div class="settings-form">
      <section class="card-block">
        <h3>월간 목표 지출액</h3>
        <p class="hint">
          한 달에 쓰려는 금액의 상한입니다. 사용 내역의 <b>예상 월지출</b>이 이 금액을 넘을 것으로 계산되면 빨간 느낌표가 표시됩니다. 모든 달에 같은 금액이 적용됩니다.
        </p>
        <div class="field">
          <label for="goal-in">
            목표 금액 <small class="unit">원</small>
          </label>
          <input
            id="goal-in"
            class="input amount-input num"
            inputMode="numeric"
            placeholder="목표 없음"
            value={v ? won(n) : ''}
            onInput={(e) => setV(digitsOnly(e.currentTarget.value).slice(0, 10).replace(/^0+(?=\d)/, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (document.getElementById('goal-save') as HTMLButtonElement | null)?.click();
              }
            }}
          />
          <div class="quick">
            <button type="button" class="btn small" onClick={() => add(10000)}>
              +10,000
            </button>
            <button type="button" class="btn small" onClick={() => add(100000)}>
              +100,000
            </button>
            <button type="button" class="btn small" onClick={() => setV('')}>
              지우기
            </button>
          </div>
        </div>
        <div class="btn-row">
          <button
            id="goal-save"
            type="button"
            class="btn primary"
            disabled={!changed}
            onClick={async () => {
              await updateSettings({ monthlyGoal: n > 0 ? n : null });
              showToast(n > 0 ? `월간 목표를 ${won(n)}원으로 정했습니다` : '월간 목표를 해제했습니다');
            }}
          >
            {n > 0 ? '저장' : cur ? '목표 해제' : '저장'}
          </button>
        </div>
        <p class="hint">
          현재 목표: <b>{cur ? `${won(cur)}원` : '없음'}</b>. 예상 월지출은 엑셀과 같은 계산(하루평균 × 그 달 일수)이라, 월초에 큰 지출이 있으면 실제보다 크게 계산돼 경고가 일찍 뜰 수 있습니다.
        </p>
      </section>
    </div>
  );
}

function DisplayPage() {
  const s = settings.value;
  return (
    <div class="settings-form">
      <div class="field">
        <span class="label">테마</span>
        <Segmented
          label="테마"
          value={s.theme}
          options={[
            { value: 'system', label: '기기 설정 따름' },
            { value: 'light', label: '밝게' },
            { value: 'dark', label: '어둡게' },
          ]}
          onChange={(v) => updateSettings({ theme: v })}
        />
      </div>
      <div class="field">
        <span class="label">사용자·지불수단 표시</span>
        <Segmented
          label="표시 방식"
          value={s.iconMode}
          options={[
            { value: 'auto', label: '자동' },
            { value: 'full', label: '아이콘 + 이름' },
            { value: 'icon', label: '아이콘만' },
          ]}
          onChange={(v) => updateSettings({ iconMode: v })}
        />
        <p class="hint">자동: 휴대폰은 아이콘만(누르면 이름 표시), 태블릿은 아이콘 + 짧은 이름, 컴퓨터는 아이콘 + 이름.</p>
      </div>
      <div class="field">
        <span class="label">오늘 이후 항목 (보류·예정)</span>
        <Segmented<FutureDisplay>
          label="오늘 이후 항목 표시"
          value={s.futureDisplay}
          options={[
            { value: 'all', label: '모든 내역 표시' },
            { value: 'count', label: '건수만 표시' },
            { value: 'hide', label: '표시하지 않음' },
          ]}
          onChange={(v) => updateSettings({ futureDisplay: v })}
        />
        <p class="hint">
          {s.futureDisplay === 'all'
            ? '날짜가 오늘 이후인 내역도 목록에 모두 보입니다.'
            : s.futureDisplay === 'count'
              ? '목록에서는 숨기고, 월 요약에 건수만 보여 줍니다. 건수를 누르면 잠시 펼쳐 볼 수 있습니다.'
              : '목록에서 숨기고 건수도 보이지 않습니다.'}{' '}
          검색·필터 결과에는 항상 나타납니다. <b>집계에는 영향이 없습니다.</b> 보류는 합계에서 빠지고 예정은 포함됩니다.
        </p>
      </div>
      <div class="field">
        <span class="label">글자 크기</span>
        <Segmented
          label="글자 크기"
          value={s.fontScale}
          options={[
            { value: 100, label: '보통' },
            { value: 110, label: '크게' },
            { value: 120, label: '아주 크게' },
          ]}
          onChange={(v) => updateSettings({ fontScale: v })}
        />
      </div>
    </div>
  );
}

function DataPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const sample = hasSample();
  const count = entries.value.length;
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [lastImport, setLastImport] = useState<LastImport | null>(null);
  const importedCount = entries.value.filter((e) => e.importBatchId).length;
  // 가져오기를 마쳤거나 되돌린 뒤, 또는 다른 기기에서 동기화로 내역이 바뀐 뒤에 다시 찾는다
  useEffect(() => {
    void findLastImport().then(setLastImport);
  }, [importedCount, importOpen]);

  const undo = async () => {
    if (!lastImport) return;
    const when = new Date(lastImport.at);
    const label = lastImport.at ? `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}` : '';
    const hasNew = !!lastImport.meta && lastImport.meta.users.length + lastImport.meta.categories.length + lastImport.meta.payMethods.length + lastImport.meta.payDetails.length > 0;
    const ok = await askConfirm({
      title: '마지막 가져오기를 되돌릴까요?',
      message:
        `${label ? label + '에 ' : ''}가져온 내역 ${lastImport.count}건을 모두 삭제합니다. 가져온 뒤 고친 내역도 함께 지워지며, 직접 입력한 내역은 그대로입니다.` +
        (hasNew ? ' 그때 새로 등록한 사용자·분류·지불수단·결제상세는 다른 내역에서 쓰이지 않는 것만 함께 지웁니다.' : ''),
      confirmLabel: '되돌리기',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await undoImport(lastImport.id, true);
      showToast(`가져온 내역 ${r.entries}건을 지웠습니다${r.lists ? ` (목록 ${r.lists}건 포함)` : ''}`);
      setLastImport(await findLastImport());
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    const data = await exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gagyeboo-backup-${todayKST()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('백업 파일을 내려받았습니다');
  };

  const restore = async (file: File) => {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      showToast('올바른 백업 파일이 아닙니다');
      return;
    }
    if (!validateBackup(data)) {
      showToast('이 앱에서 만든 백업 파일이 아니거나 형식이 맞지 않습니다');
      return;
    }
    const ok = await askConfirm({
      title: '백업으로 복원할까요?',
      message: `현재 데이터(내역 ${count}건)는 모두 백업 내용으로 바뀝니다. 먼저 현재 데이터를 백업해 두는 것을 권합니다.`,
      confirmLabel: '복원',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await importAll(data);
      showToast(`복원했습니다 (내역 ${data.entries.filter((e) => !e.deleted).length}건)`);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    const ok = await askConfirm({
      title: '모든 데이터를 지울까요?',
      message: '내역·사용자·결제상세와 설정이 모두 삭제되고, 분류와 지불수단은 기본값으로 돌아갑니다. 되돌릴 수 없습니다.',
      confirmLabel: '모두 지우기',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await resetAll();
      showToast('초기화했습니다');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="settings-form">
      <section class="card-block">
        <h3>엑셀</h3>
        <p class="hint">엑셀 가계부의 월 시트를 가져오거나, 지금 내역을 엑셀로 내보냅니다. 파일은 이 기기의 브라우저 안에서만 처리됩니다.</p>
        <div class="btn-row">
          <button type="button" class="btn" disabled={busy} onClick={() => setImportOpen(true)}>
            <Ui name="Upload" size={16} />
            엑셀에서 가져오기
          </button>
          <button type="button" class="btn" disabled={busy} onClick={() => setExportOpen(true)}>
            <Ui name="Download" size={16} />
            엑셀로 내보내기
          </button>
        </div>
        {lastImport ? (
          <div class="wz-last">
            <p class="hint">
              마지막 가져오기: 남아 있는 내역 <b class="num">{lastImport.count}건</b>
              {lastImport.meta?.label ? ` · ${lastImport.meta.label}` : ''}
            </p>
            <button type="button" class="btn danger small" disabled={busy} onClick={undo}>
              <Ui name="Undo2" size={14} />
              마지막 가져오기 되돌리기
            </button>
          </div>
        ) : null}
      </section>

      {importOpen ? <ImportWizard onClose={() => setImportOpen(false)} /> : null}
      {exportOpen ? <ExportDialog onClose={() => setExportOpen(false)} /> : null}

      <section class="card-block">
        <h3>백업·복원</h3>
        <p class="hint">모든 데이터는 이 기기의 브라우저에 저장됩니다. 기기를 바꾸거나 브라우저 데이터를 지우기 전에 백업해 두세요.</p>
        <div class="btn-row">
          <button type="button" class="btn" onClick={backup}>
            <Ui name="Download" size={16} />
            백업 파일 받기
          </button>
          <button type="button" class="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Ui name="Upload" size={16} />
            백업에서 복원
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            class="visually-hidden"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (f) restore(f);
            }}
          />
        </div>
      </section>

      <section class="card-block">
        <h3>가상 데이터로 둘러보기</h3>
        <p class="hint">화면을 확인해 볼 수 있도록 가상의 이름·내역을 넣습니다. 실제 데이터와 구분되어 있어 언제든 한 번에 지울 수 있습니다.</p>
        <div class="btn-row">
          <button
            type="button"
            class="btn"
            disabled={busy || sample}
            onClick={async () => {
              const n = await loadSample();
              showToast(`가상 데이터 ${n}건을 넣었습니다`);
            }}
          >
            가상 데이터 넣기
          </button>
          <button
            type="button"
            class="btn"
            disabled={busy || !sample}
            onClick={async () => {
              const ok = await askConfirm({
                title: '가상 데이터를 지울까요?',
                message: '가상 데이터로 넣은 사용자와 내역만 삭제됩니다. 직접 입력한 내용은 그대로 둡니다.',
                confirmLabel: '지우기',
              });
              if (!ok) return;
              const n = await clearSample();
              showToast(`가상 데이터 ${n}건을 지웠습니다`);
            }}
          >
            가상 데이터 지우기
          </button>
        </div>
      </section>

      <section class="card-block danger-zone">
        <h3>초기화</h3>
        <p class="hint">내역과 목록, 설정을 모두 지우고 처음 상태로 되돌립니다.</p>
        <div class="btn-row">
          <button type="button" class="btn danger" disabled={busy} onClick={reset}>
            <Ui name="Trash2" size={16} />
            모든 데이터 지우기
          </button>
        </div>
      </section>
    </div>
  );
}

function AboutPage() {
  return (
    <div class="settings-form">
      <section class="card-block">
        <h3>가계부</h3>
        <dl class="kv">
          <dt>릴리스</dt>
          <dd>R4 (엑셀 가져오기·내보내기)</dd>
          <dt>저장 위치</dt>
          <dd>이 기기의 브라우저(IndexedDB). 구글 로그인을 하면 내 구글 드라이브의 앱 전용 폴더에도 저장됩니다.</dd>
          <dt>데이터 형식</dt>
          <dd>v{SCHEMA_VERSION}</dd>
        </dl>
      </section>
    </div>
  );
}

function Page({ id }: { id: SettingsPage }) {
  switch (id) {
    case 'fixed':
      return <FixedPage />;
    case 'goal':
      return <GoalPage />;
    case 'lists':
      return <ListsManager />;
    case 'display':
      return <DisplayPage />;
    case 'account':
      return <AccountPage />;
    case 'data':
      return <DataPage />;
    case 'about':
      return <AboutPage />;
  }
}

export function SettingsView() {
  const vp = viewport.value;
  const cur = settingsPage.value;
  const mobile = vp === 'mobile';
  const page = cur ?? (mobile ? null : 'lists');
  const item = MENU.find((m) => m.id === page);

  if (mobile && !page) {
    return (
      <div class="settings">
        <h2 class="page-title">설정</h2>
        <ul class="menu-list">
          {MENU.map((m) => (
            <li key={m.id}>
              <button type="button" class="menu-item" onClick={() => (settingsPage.value = m.id)}>
                <Ui name={m.icon} size={20} />
                <span class="mi-text">
                  <b>{m.label}</b>
                  <small>{m.desc}</small>
                </span>
                <Ui name="ChevronRight" size={18} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div class={`settings ${mobile ? 'is-detail' : 'is-split'}`}>
      {!mobile ? (
        <nav class="side-menu" aria-label="설정 메뉴">
          {MENU.map((m) => (
            <button
              key={m.id}
              type="button"
              class="side-item"
              aria-current={page === m.id ? 'page' : undefined}
              onClick={() => (settingsPage.value = m.id)}
            >
              <Ui name={m.icon} size={18} />
              {m.label}
            </button>
          ))}
        </nav>
      ) : null}
      <section class="settings-detail">
        {mobile ? (
          <button type="button" class="back-btn" onClick={() => (settingsPage.value = null)}>
            <Ui name="ChevronLeft" size={18} />
            설정
          </button>
        ) : null}
        <h2 class="page-title">{item?.label}</h2>
        {page ? <Page id={page} /> : null}
      </section>
    </div>
  );
}
