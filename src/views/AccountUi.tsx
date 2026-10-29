import { useEffect, useState } from 'preact/hooks';
import { builtInClientId, getClientId, preloadGis, setClientId } from '../sync/auth';
import { account, clientIdTick, lastSyncAt, reconnect, signIn, signingIn, signOut, syncError, syncNow, syncStatus, type SyncStatus } from '../sync/controller';
import { Ui } from '../ui/icons';
import { accountModal, logoutDialog, openSettings } from '../ui/nav';
import { Modal } from '../ui/overlay';
import { viewport } from '../ui/viewport';

/* ───────── 표시용 도우미 ───────── */

function agoText(t: number | null): string {
  if (!t) return '아직 동기화한 적이 없습니다';
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return '방금 전에 동기화했습니다';
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전에 동기화했습니다`;
  const d = new Date(t);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sec < 86400 ? `오늘 ${hm}에 동기화했습니다` : `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}에 동기화했습니다`;
}

const STATUS_TEXT: Record<SyncStatus, string> = {
  local: '이 기기에만 저장 중',
  idle: '동기화됨',
  syncing: '동기화 중…',
  offline: '오프라인 (대기 중)',
  reconnect: '재연결 필요',
  error: '동기화 오류',
};

function Avatar({ size = 24 }: { size?: number }) {
  const a = account.value;
  const [broken, setBroken] = useState(false);
  if (!a) return null;
  return a.picture && !broken ? (
    <img class="avatar" src={a.picture} alt="" width={size} height={size} referrerpolicy="no-referrer" onError={() => setBroken(true)} />
  ) : (
    <span class="avatar is-initial" style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true">
      {(a.name || a.email || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

/* ───────── 상단 계정 칩 ───────── */

export function AccountChip() {
  const vp = viewport.value;
  const acc = account.value;
  const st = syncStatus.value;
  const label = acc ? `${STATUS_TEXT[st]} · ${acc.email}` : '이 기기에만 저장 중. 눌러서 구글 로그인';
  const text = !acc
    ? vp === 'desktop'
      ? '로그인하면 다른 기기와 동기화'
      : vp === 'tablet'
        ? '로그인'
        : ''
    : vp === 'mobile'
      ? ''
      : STATUS_TEXT[st];
  return (
    <button
      type="button"
      class={`account-chip is-${st}`}
      aria-label={label}
      onPointerEnter={preloadGis}
      onFocus={preloadGis}
      onClick={() => (accountModal.value = true)}
    >
      {acc ? (
        <span class="chip-avatar">
          <Avatar size={22} />
          <span class={`status-dot is-${st}`} aria-hidden="true" />
        </span>
      ) : (
        <Ui name="CloudOff" size={16} />
      )}
      {st === 'syncing' ? <Ui name="RefreshCw" size={14} class="spin" /> : null}
      {text ? <span class="account-text">{text}</span> : null}
    </button>
  );
}

/* ───────── 계정 패널 (창과 설정 화면에서 공통) ───────── */

export function AccountPanel({ inModal }: { inModal?: boolean }) {
  clientIdTick.value; // 클라이언트 ID가 바뀌면 다시 그린다
  const acc = account.value;
  const st = syncStatus.value;
  const hasId = !!getClientId();
  const busy = signingIn.value;

  if (!acc) {
    return (
      <div class="account-panel">
        <p>
          지금은 <b>이 기기의 브라우저에만</b> 저장되고 있습니다. 구글 계정으로 로그인하면 같은 계정으로 로그인한 다른 기기와 데이터가
          맞춰지고, 기기를 바꾸거나 잃어버려도 구글 드라이브에서 되살릴 수 있습니다.
        </p>
        {hasId ? (
          <button type="button" class="btn primary" disabled={busy} onClick={() => void signIn()}>
            <Ui name="LogIn" size={18} />
            {busy ? '로그인 중…' : '구글 계정으로 로그인'}
          </button>
        ) : (
          <div class="notice">
            <Ui name="TriangleAlert" size={18} />
            <div>
              <p>로그인을 쓰려면 구글 클라이언트 ID를 한 번 설정해야 합니다.</p>
              <button
                type="button"
                class="btn small"
                onClick={() => {
                  accountModal.value = false;
                  openSettings('account');
                }}
              >
                설정 방법 보기
              </button>
            </div>
          </div>
        )}
        <p class="hint">
          데이터는 내 구글 드라이브의 <b>이 앱 전용 숨김 폴더</b>에만 저장됩니다. 드라이브의 다른 파일은 볼 수 없고, 별도의 서버를 거치지
          않습니다. 로그인하지 않아도 모든 기능을 쓸 수 있습니다.
        </p>
      </div>
    );
  }

  return (
    <div class="account-panel">
      <div class="account-row">
        <Avatar size={44} />
        <div class="account-who">
          <strong>{acc.name}</strong>
          <small class="muted">{acc.email}</small>
        </div>
      </div>
      <div class={`sync-line is-${st}`} role="status">
        <span class={`status-dot is-${st}`} aria-hidden="true" />
        <div>
          <b>{STATUS_TEXT[st]}</b>
          <small class="muted">
            {st === 'reconnect'
              ? '구글 연결이 만료되었습니다. 다시 연결하면 밀린 변경이 자동으로 반영됩니다. 그동안의 입력은 이 기기에 안전하게 저장됩니다.'
              : st === 'offline'
                ? '인터넷에 연결되면 자동으로 동기화합니다. 그동안의 입력은 이 기기에 저장됩니다.'
                : st === 'error'
                  ? (syncError.value ?? '알 수 없는 오류입니다')
                  : agoText(lastSyncAt.value)}
          </small>
        </div>
      </div>
      <div class="btn-row">
        {st === 'reconnect' ? (
          <button type="button" class="btn primary" disabled={busy} onClick={() => void reconnect()}>
            <Ui name="RefreshCw" size={18} />
            {busy ? '연결 중…' : '구글 다시 연결'}
          </button>
        ) : (
          <button type="button" class="btn primary" disabled={st === 'syncing'} onClick={() => void syncNow('manual')}>
            <Ui name="RefreshCw" size={18} class={st === 'syncing' ? 'spin' : undefined} />
            지금 동기화
          </button>
        )}
        <button type="button" class="btn" onClick={() => (logoutDialog.value = true)}>
          <Ui name="LogOut" size={18} />
          로그아웃
        </button>
      </div>
      {inModal ? (
        <button
          type="button"
          class="link-btn"
          onClick={() => {
            accountModal.value = false;
            openSettings('account');
          }}
        >
          계정·동기화 설정 열기
        </button>
      ) : null}
    </div>
  );
}

export function AccountModal() {
  useEffect(() => preloadGis(), []);
  return (
    <Modal title="계정·동기화" onClose={() => (accountModal.value = false)}>
      <AccountPanel inModal />
    </Modal>
  );
}

/* ───────── 로그아웃 확인 ───────── */

export function LogoutDialog() {
  const [busy, setBusy] = useState(false);
  const close = () => (logoutDialog.value = false);
  const run = async (keepLocal: boolean) => {
    setBusy(true);
    try {
      await signOut(keepLocal);
      accountModal.value = false;
      close();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="로그아웃"
      onClose={close}
      footer={
        <>
          <button type="button" class="btn" onClick={close} disabled={busy}>
            취소
          </button>
          <span class="grow" />
          <button type="button" class="btn danger" onClick={() => void run(false)} disabled={busy}>
            이 기기 데이터도 삭제
          </button>
          <button type="button" class="btn primary" data-autofocus onClick={() => void run(true)} disabled={busy}>
            데이터는 남기고 로그아웃
          </button>
        </>
      }
    >
      <p>로그아웃하면 이 기기는 다시 <b>로컬 모드</b>가 되어 다른 기기와 동기화되지 않습니다. 구글 드라이브에 저장된 데이터는 지워지지 않습니다.</p>
      <p class="hint">
        「데이터는 남기고 로그아웃」은 이 기기의 내역을 그대로 둡니다. 다른 사람이 쓰는 기기이거나 이 기기에서 지우고 싶다면 「이 기기 데이터도 삭제」를 고르세요
        (드라이브의 데이터는 그대로이며, 다시 로그인하면 돌아옵니다).
      </p>
    </Modal>
  );
}

/* ───────── 설정 > 계정·동기화 ───────── */

export function AccountPage() {
  const [id, setId] = useState(() => (typeof localStorage === 'undefined' ? '' : (localStorage.getItem('gagyeboo.clientId') ?? '')));
  const built = builtInClientId();
  const origin = location.origin;
  const looksOk = !id.trim() || /^[\w-]+\.apps\.googleusercontent\.com$/.test(id.trim()) || /^\d+-[\w]+\.apps\.googleusercontent\.com$/.test(id.trim());
  return (
    <div class="settings-form">
      <section class="card-block">
        <h3>계정</h3>
        <AccountPanel />
      </section>
      <section class="card-block">
        <h3>구글 로그인 설정</h3>
        <p class="hint">
          구글 로그인은 앱마다 <b>OAuth 클라이언트 ID</b>가 있어야 동작합니다. 개인 구글 계정으로 한 번만 만들면 되고 비용은 들지 않습니다.
          {built ? ' 이 앱에는 이미 클라이언트 ID가 들어 있어서 아래 칸은 비워 두어도 됩니다.' : ''}
        </p>
        <div class="field">
          <label for="cid">클라이언트 ID</label>
          <input
            id="cid"
            class="input"
            placeholder="123456789-abc….apps.googleusercontent.com"
            value={id}
            autocomplete="off"
            spellcheck={false}
            onInput={(e) => setId(e.currentTarget.value)}
          />
          {!looksOk ? <p class="hint warn">보통 「…apps.googleusercontent.com」으로 끝나는 값입니다. 다시 확인해 주세요.</p> : null}
        </div>
        <div class="btn-row is-center">
          <button
            type="button"
            class="btn primary"
            onClick={() => {
              setClientId(id);
              clientIdTick.value++;
              preloadGis();
            }}
          >
            저장
          </button>
          <span class="hint">이 기기의 브라우저에만 저장됩니다. 다른 기기에서도 쓰려면 아래 「모든 기기에 적용」을 보세요.</span>
        </div>
        <details class="guide">
          <summary>클라이언트 ID 만드는 방법</summary>
          <ol>
            <li>
              <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener">
                구글 클라우드 콘솔
              </a>
              에서 새 프로젝트를 만듭니다 (이름 예: 가계부).
            </li>
            <li>
              「API 및 서비스 → 라이브러리」에서 <b>Google Drive API</b>를 찾아 <b>사용</b>을 누릅니다.
            </li>
            <li>
              「Google Auth Platform(OAuth 동의 화면)」에서 사용자 유형을 <b>외부</b>로 하고 앱 이름(예: 가계부)과 내 이메일을 입력합니다. 데이터 액세스(범위)에는{' '}
              <code>openid</code>, <code>email</code>, <code>profile</code>, <code>…/auth/drive.appdata</code>를 추가합니다.
            </li>
            <li>
              게시 상태를 <b>프로덕션으로 게시</b>합니다. <b>테스트 상태로 두면 7일마다 로그인이 만료</b>됩니다. 이 앱이 쓰는 범위는 민감하지 않은 범위라 별도 심사 없이 쓸 수 있는 경우가 많지만, 콘솔의 안내가 우선입니다.
            </li>
            <li>
              「사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID」에서 유형을 <b>웹 애플리케이션</b>으로 하고, <b>승인된 JavaScript 원본</b>에 이 주소를 넣습니다:
              <code class="copy">{origin}</code>
              (주소 뒤에 경로나 슬래시를 붙이지 않습니다. 컴퓨터에서 직접 개발·시험하는 경우에는 <code>http://localhost:4173</code>도 추가합니다.)
            </li>
            <li>만들어진 <b>클라이언트 ID</b>를 위 칸에 붙여 넣고 저장한 뒤, 「구글 계정으로 로그인」을 누릅니다.</li>
          </ol>
          <p class="hint">
            <b>모든 기기에 적용하려면:</b> GitHub 저장소의 Settings → Secrets and variables → Actions → <b>Variables</b>에{' '}
            <code>GOOGLE_CLIENT_ID</code> 변수를 만들고 클라이언트 ID를 넣은 뒤 다시 배포하면, 어느 기기에서 열어도 입력 없이 바로 로그인할 수 있습니다. 클라이언트 ID는 비밀번호가 아니라 공개되어도 되는 값입니다.
          </p>
        </details>
      </section>
      <section class="card-block">
        <h3>동기화 방식</h3>
        <ul class="plain-list">
          <li>입력은 항상 이 기기에 먼저 저장되고, 몇 초 뒤 묶어서 드라이브로 올라갑니다. 인터넷이 없어도 입력할 수 있습니다.</li>
          <li>앱을 열 때, 다른 화면에 갔다가 돌아올 때, 켜 둔 동안 가끔 드라이브의 변경을 받아 옵니다.</li>
          <li>같은 내역을 두 기기에서 고쳤다면 더 나중에 고친 쪽이 남습니다. 삭제도 다른 기기에 전달됩니다.</li>
          <li>월간 목표와 오늘 이후 내역 표시 방식은 기기 간에 공유하고, 테마·글자 크기·정렬 방식은 기기마다 따로 둡니다.</li>
          <li>구글 로그인은 약 1시간 뒤 만료됩니다. 만료되면 상단의 「재연결 필요」를 한 번 누르면 이어서 동기화합니다.</li>
        </ul>
        <p class="hint">
          <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noopener">
            개인정보처리방침
          </a>
        </p>
      </section>
    </div>
  );
}
