import { useState } from 'preact/hooks';
import { cachedShareToken } from '../sync/auth';
import { account, reconnect, signingIn } from '../sync/controller';
import {
  disableSharing,
  enableSharing,
  importProposals,
  proposalBusy,
  proposalCheckedAt,
  proposalError,
  proposalIgnored,
  inviteGuest,
  MAX_GUESTS,
  publishMirror,
  removeGuest,
  shareBusy,
  shareConfig,
  shareError,
  sharePublishedAt,
  shareStale,
  type ShareResult,
} from '../sync/share';
import { proposals, showToast } from '../store/store';
import { Ui } from '../ui/icons';
import { accountModal, openQueue } from '../ui/nav';
import { askConfirm } from '../ui/overlay';

function when(t: number | null): string {
  if (!t) return '아직 올린 적이 없습니다';
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return '방금 전';
  if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
  const d = new Date(t);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sec < 86400 ? `오늘 ${hm}` : `${d.getMonth() + 1}월 ${d.getDate()}일 ${hm}`;
}

const day = (t: number) => {
  const d = new Date(t);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

export function SharePage() {
  const acc = account.value;
  const cfg = shareConfig.value;
  const busy = shareBusy.value || signingIn.value;
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [, bump] = useState(0);

  const done = (r: ShareResult, okText?: string) => {
    bump((n) => n + 1);
    if (r.ok) {
      setMsg(null);
      if (okText) showToast(okText);
    } else setMsg(r.error);
  };

  if (!acc) {
    return (
      <div class="share-page">
        <p class="hint">
          다른 사람(손님)에게 내 가계부를 읽기 전용으로 보여 주려면 먼저 구글 계정으로 로그인해야 합니다. 공유 내용은 내 구글 드라이브에
          저장됩니다.
        </p>
        <button type="button" class="btn primary" onClick={() => (accountModal.value = true)}>
          <Ui name="LogIn" size={18} />
          로그인하러 가기
        </button>
      </div>
    );
  }

  if (!cfg) {
    return (
      <div class="share-page">
        <p>
          손님을 초대하면 손님은 내 가계부를 <b>읽기만</b> 할 수 있고, 새 지출을 <b>제안</b>할 수 있습니다. 제안은 내 「입력 대기」에 쌓이며,
          실제로 가계부에 넣는 것은 항상 나만 합니다. 손님은 내용을 고치거나 지울 수 없습니다.
        </p>
        <ul class="share-points">
          <li>손님이 볼 수 있는 것: 사용 내역, 고정지출, 목표·예산, 재산상황 등 가계부의 모든 내용</li>
          <li>공유 내용은 내 구글 드라이브의 「가계부 공유」 폴더에 올라가고, 내용이 바뀌면 자동으로 갱신됩니다</li>
          <li>손님은 언제든 내가 해제할 수 있고, 해제해도 손님 기기에 이미 받은 내용은 남습니다</li>
        </ul>
        <div class="notice">
          <Ui name="TriangleAlert" size={18} />
          <div>
            <p>
              공유를 켜면 구글이 <b>드라이브 전체 접근 권한</b>을 한 번 더 확인합니다. 이 앱은 「가계부 공유」 폴더와 앱 전용 폴더만 사용합니다.
              「Google에서 확인하지 않은 앱」 화면이 뜨면 「고급」 → 「이동」으로 계속하세요. (공유를 쓰지 않는 로그인에는 이 권한을 요청하지 않습니다.)
            </p>
          </div>
        </div>
        {msg ? <p class="form-error">{msg}</p> : null}
        <button
          type="button"
          class="btn primary"
          disabled={busy}
          onClick={async () => done(await enableSharing(), '계정 공유를 켰습니다')}
        >
          <Ui name="Users" size={18} />
          {busy ? '준비 중…' : '공유 켜기'}
        </button>
      </div>
    );
  }

  const hasToken = !!cachedShareToken();
  const stale = shareStale.value;
  const full = cfg.guests.length >= MAX_GUESTS;

  return (
    <div class="share-page">
      <div class={`sync-line ${hasToken && !stale ? 'is-idle' : 'is-reconnect'}`} role="status">
        <span class={`status-dot ${hasToken && !stale ? 'is-idle' : 'is-reconnect'}`} aria-hidden="true" />
        <div>
          <b>{!hasToken ? '다시 연결 필요' : stale ? '공유 내용 올리는 중' : '손님에게 최신 내용이 공유되어 있습니다'}</b>
          <small class="muted">
            {!hasToken
              ? '구글 연결이 만료되었거나 공유 권한이 없는 상태입니다. 다시 연결하면 바뀐 내용을 올립니다. 그동안 손님은 마지막으로 올린 내용을 봅니다.'
              : `마지막으로 올린 시각: ${when(sharePublishedAt.value)}`}
          </small>
        </div>
      </div>
      {shareError.value ? <p class="form-error">{shareError.value}</p> : null}
      {msg ? <p class="form-error">{msg}</p> : null}
      <div class="btn-row">
        {!hasToken ? (
          <button
            type="button"
            class="btn primary"
            disabled={busy}
            onClick={async () => {
              const ok = await reconnect();
              if (ok) {
                done(await publishMirror({ force: true, allowPrompt: false }), '공유 내용을 올렸습니다');
                void importProposals();
              }
              else bump((n) => n + 1);
            }}
          >
            <Ui name="RefreshCw" size={18} />
            {busy ? '연결 중…' : '구글 다시 연결'}
          </button>
        ) : (
          <button
            type="button"
            class="btn primary"
            disabled={busy}
            onClick={async () => done(await publishMirror({ force: true, allowPrompt: true }), '공유 내용을 올렸습니다')}
          >
            <Ui name="RefreshCw" size={18} />
            지금 공유 내용 갱신
          </button>
        )}
        <a class="btn" href={`https://drive.google.com/drive/folders/${cfg.folderId}`} target="_blank" rel="noopener noreferrer">
          <Ui name="ExternalLink" size={18} />
          드라이브에서 열기
        </a>
      </div>

      <h3 class="share-h">손님 제안</h3>
      <p class="hint">
        손님이 보낸 제안은 자동으로 「입력 대기」에 들어옵니다(앱을 열 때와 5분마다 확인). 실제로 가계부에 넣을지는 입력 대기에서 정합니다.
      </p>
      {proposalError.value ? <p class="form-error">{proposalError.value}</p> : null}
      <div class="btn-row">
        <button
          type="button"
          class="btn"
          disabled={busy || proposalBusy.value || !hasToken}
          onClick={async () => {
            const r = await importProposals();
            if (r.ok && r.added === 0) showToast('새 제안이 없습니다');
            if (!r.ok) setMsg(r.error);
            else setMsg(null);
            bump((n) => n + 1);
          }}
        >
          <Ui name="RefreshCw" size={18} />
          {proposalBusy.value ? '확인 중…' : '지금 제안 확인'}
        </button>
        {proposals.value.length > 0 ? (
          <button type="button" class="btn primary" onClick={openQueue}>
            입력 대기 열기 ({proposals.value.length}건 제안)
          </button>
        ) : null}
      </div>
      <p class="hint">
        마지막 확인: {proposalCheckedAt.value ? when(proposalCheckedAt.value) : '아직 확인하지 않았습니다'}
        {proposalIgnored.value > 0 ? ` · 건너뛴 파일 ${proposalIgnored.value}개(형식이 맞지 않거나 초대하지 않은 계정이 올린 것)` : ''}
      </p>

      <h3 class="share-h">손님 ({cfg.guests.length}/{MAX_GUESTS})</h3>
      {cfg.guests.length === 0 ? (
        <p class="hint">아직 초대한 손님이 없습니다. 손님의 구글 계정 이메일을 입력해 초대하세요.</p>
      ) : (
        <ul class="list share-guests">
          {cfg.guests.map((g) => (
            <li key={g.email} class="list-row">
              <span class="lr-main static">
                <span class="lr-title">
                  <span class="lr-name">{g.email}</span>
                </span>
                <small class="lr-meta">{day(g.addedAt)}에 초대</small>
              </span>
              <span class="lr-actions">
                <button
                  type="button"
                  class="btn small"
                  disabled={busy}
                  onClick={async () => {
                    const ok = await askConfirm({
                      title: '손님을 해제할까요?',
                      message: `${g.email} 계정은 더 이상 공유 내용을 받거나 제안을 보낼 수 없습니다. 이미 받아 간 내용은 손님 기기에 남습니다.`,
                      confirmLabel: '해제',
                      danger: true,
                    });
                    if (ok) done(await removeGuest(g.email), '손님을 해제했습니다');
                  }}
                >
                  해제
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        class="share-invite"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await inviteGuest(email);
          if (r.ok) setEmail('');
          done(r, '손님을 초대했습니다');
        }}
      >
        <input
          id="share-email"
          class="input"
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="손님의 구글 이메일 주소"
          value={email}
          disabled={busy || full}
          onInput={(e) => setEmail(e.currentTarget.value)}
          aria-label="손님의 구글 이메일 주소"
        />
        <button type="submit" class="btn primary" disabled={busy || full || !email.trim()}>
          초대
        </button>
      </form>
      {full ? <p class="hint">손님은 최대 {MAX_GUESTS}명까지 초대할 수 있습니다.</p> : null}
      <p class="hint">
        초대하면 손님에게 읽기 권한이 부여됩니다(알림 메일은 가지 않으니 직접 알려 주세요). 손님은 설정 → 계정 공유 → 「공유받은 가계부 열기」에서 파일 선택 창으로 <b>가계부 공유 → data → mirror.json</b>을 고르면 열립니다.
      </p>

      <h3 class="share-h">공유 끄기</h3>
      <p class="hint">모든 손님의 권한을 해제하고 드라이브의 「가계부 공유」 폴더를 휴지통으로 옮깁니다. 내 가계부 데이터는 그대로입니다.</p>
      <button
        type="button"
        class="btn danger"
        disabled={busy}
        onClick={async () => {
          const ok = await askConfirm({
            title: '계정 공유를 끌까요?',
            message: '모든 손님의 접근이 막히고 공유 폴더가 휴지통으로 이동합니다. 손님 기기에 이미 받은 내용은 남습니다. 나중에 다시 켤 수 있습니다.',
            confirmLabel: '공유 끄기',
            danger: true,
          });
          if (ok) done(await disableSharing(), '계정 공유를 껐습니다');
        }}
      >
        공유 끄기
      </button>
    </div>
  );
}
