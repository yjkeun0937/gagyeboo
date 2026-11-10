import { useState } from 'preact/hooks';
import { cachedGuestToken } from '../sync/auth';
import {
  acceptInvite,
  convertCopyToOwn,
  discardCopy,
  dropOutboxItem,
  guestBusy,
  guestError,
  guestLink,
  guestOutbox,
  guestStatus,
  KEEP_SENT_DAYS,
  reconnectGuest,
  refreshCopy,
  retryFailed,
  type GuestStatus,
} from '../sync/guest';
import { pickerConfig, pickerReady, setPickerConfig } from '../sync/picker';
import { won } from '../lib/format';
import { showToast } from '../store/store';
import { whenText } from '../lib/when';
import { Ui } from '../ui/icons';
import { openSettings } from '../ui/nav';
import { viewport } from '../ui/viewport';

const when = (t: number | null | undefined) => whenText(t);

const STATUS_TEXT: Record<GuestStatus, string> = {
  ok: '읽기 전용',
  syncing: '받는 중…',
  reconnect: '재연결 필요',
  offline: '오프라인',
  disconnected: '연결이 끊긴 사본',
  error: '받기 오류',
};

/** 상단: 손님 모드 표시 (눌러서 공유받은 가계부 설정으로) */
export function GuestChip() {
  const vp = viewport.value;
  const l = guestLink.value;
  const st = guestStatus.value;
  const cls = st === 'disconnected' || st === 'reconnect' ? 'is-reconnect' : st === 'error' ? 'is-error' : st === 'offline' ? 'is-offline' : 'is-idle';
  const text = l ? `${l.ownerName}님 가계부 · ${STATUS_TEXT[st]}` : STATUS_TEXT[st];
  return (
    <button type="button" class={`account-chip guest-chip ${cls}`} aria-label={text} onClick={() => openSettings('share')}>
      <Ui name="Lock" size={16} />
      {st === 'syncing' ? <Ui name="RefreshCw" size={14} class="spin" /> : null}
      {vp !== 'mobile' ? <span class="account-text">{text}</span> : null}
    </button>
  );
}

/** 화면 맨 위 안내 띠: 지금 보는 것이 누구의 사본인지, 연결이 끊겼는지 */
export function GuestBanner() {
  const l = guestLink.value;
  if (!l) return null;
  const st = guestStatus.value;
  const cut = l.state === 'disconnected';
  return (
    <div class={`stale-banner guest-banner ${cut ? 'is-cut' : ''}`} role="status">
      <span>
        {cut ? (
          <>
            <b>연결이 끊긴 사본</b>입니다. {l.ownerName}님이 공유를 끄거나 이 계정을 해제했습니다. 마지막으로 받은 내용({when(l.publishedAt)})을 읽기만 할 수 있습니다.
          </>
        ) : (
          <>
            <b>{l.ownerName}님의 가계부</b> · 읽기 전용{st === 'reconnect' ? ' · 새 내용을 받으려면 구글에 다시 연결하세요' : ''}
          </>
        )}
      </span>
      <button type="button" class="btn small" onClick={() => openSettings('share')}>
        {cut ? '선택' : '자세히'}
      </button>
    </div>
  );
}

/** 내 가계부 모드의 공유 설정 아래: 초대받은 가계부 열기 */
export function GuestJoin() {
  const [msg, setMsg] = useState<string | null>(null);
  const busy = guestBusy.value;
  const [key, setKey] = useState(pickerConfig().apiKey);
  const [app, setApp] = useState(pickerConfig().appId);
  const [, bump] = useState(0);
  return (
    <div class="guest-join">
      <h3 class="share-h">공유받은 가계부 열기</h3>
      <p class="hint">
        다른 사람이 내 구글 계정으로 가계부를 공유했다면 여기서 엽니다. 구글 로그인 뒤 파일 선택 창에서 「가계부 공유」 폴더 안
        <b> data → mirror.json</b>을 골라 주세요. 내 가계부는 지금 그대로 보관되고, 열린 가계부는 읽기 전용입니다.
      </p>
      {!pickerReady() ? (
        <div class="settings-form">
          <p class="hint">이 앱에는 파일 선택 창용 값이 아직 없습니다. 값을 직접 입력할 수 있습니다(이 기기에만 저장).</p>
          <input class="input" placeholder="API 키" value={key} onInput={(e) => setKey(e.currentTarget.value)} aria-label="API 키" />
          <input class="input" placeholder="프로젝트 번호" value={app} onInput={(e) => setApp(e.currentTarget.value)} aria-label="프로젝트 번호" />
          <button
            type="button"
            class="btn"
            onClick={() => {
              setPickerConfig({ apiKey: key, appId: app });
              bump((n) => n + 1);
            }}
          >
            저장
          </button>
        </div>
      ) : null}
      {msg ? <p class="form-error">{msg}</p> : null}
      <div class="btn-row">
        <button
          type="button"
          class="btn primary"
          disabled={busy || !pickerReady()}
          onClick={async () => {
            setMsg(null);
            const r = await acceptInvite();
            if (!r.ok) setMsg(r.error);
          }}
        >
          <Ui name="Users" size={18} />
          {busy ? '여는 중…' : '공유받은 가계부 열기'}
        </button>
      </div>
    </div>
  );
}

/** 손님 모드의 설정 → 공유받은 가계부 */
export function GuestPage() {
  const l = guestLink.value;
  const st = guestStatus.value;
  const busy = guestBusy.value || st === 'syncing';
  const [msg, setMsg] = useState<string | null>(null);
  if (!l) return null;
  const cut = l.state === 'disconnected';
  const hasToken = !!cachedGuestToken();
  const outbox = guestOutbox.value;
  const sentCount = outbox.filter((x) => x.status === 'sent').length;

  const line =
    st === 'reconnect' || (!hasToken && !cut)
      ? { cls: 'is-reconnect', title: '새 내용을 받으려면 다시 연결', sub: '구글 연결은 1시간쯤 뒤에 풀립니다. 다시 연결하면 최신 내용을 받고, 보내지 못한 제안도 보냅니다. 그동안은 받아 둔 사본을 계속 볼 수 있습니다.' }
      : st === 'offline'
        ? { cls: 'is-reconnect', title: '오프라인', sub: '인터넷에 연결되면 다시 확인합니다.' }
        : st === 'error'
          ? { cls: 'is-error', title: '받기 오류', sub: guestError.value ?? '' }
          : cut
            ? { cls: 'is-reconnect', title: '연결이 끊긴 사본', sub: `${l.ownerName}님이 공유를 끄거나 이 계정을 해제했습니다. 마지막으로 받은 내용을 읽기만 할 수 있고, 제안은 보낼 수 없습니다.` }
            : { cls: 'is-idle', title: '최신 내용을 보고 있습니다', sub: `주인이 올린 시각: ${when(l.publishedAt)} · 마지막 확인: ${when(l.checkedAt)}` };

  return (
    <div class="share-page guest-page">
      <p>
        <b>{l.ownerName}님의 가계부</b>
        {l.ownerEmail ? <span class="muted"> ({l.ownerEmail})</span> : null} — 내용을 볼 수만 있고 바꿀 수 없습니다. 새 지출은 <b>제안</b>으로 보내면 주인이 확인해서 넣습니다.
        <br />
        <small class="muted">내 구글 계정: {l.guestEmail}</small>
      </p>
      <div class={`sync-line ${line.cls}`} role="status">
        <span class={`status-dot ${line.cls}`} aria-hidden="true" />
        <div>
          <b>{line.title}</b>
          {line.sub ? <small class="muted">{line.sub}</small> : null}
        </div>
      </div>
      {!cut ? (
        <p class="hint">
          주인의 기기에서 앱이 열려 있을 때 새 내용이 올라옵니다. 「주인이 올린 시각」이 오래되었다면 주인에게 앱을 열어 달라고 알려 주세요.
        </p>
      ) : null}
      {msg ? <p class="form-error">{msg}</p> : null}

      {cut ? (
        <div class="btn-row">
          <button
            type="button"
            class="btn"
            disabled={busy}
            onClick={async () => {
              setMsg(null);
              const r = hasToken ? await refreshCopy(true) : await reconnectGuest();
              if (!r.ok && guestLink.value?.state === 'disconnected') setMsg('아직 연결할 수 없습니다. 주인이 다시 초대했는지 확인해 주세요');
              else if (!r.ok) setMsg(r.error);
            }}
          >
            <Ui name="RefreshCw" size={18} />
            다시 확인
          </button>
        </div>
      ) : (
        <div class="btn-row">
          {hasToken ? (
            <button
              type="button"
              class="btn primary"
              disabled={busy}
              onClick={async () => {
                setMsg(null);
                const r = await refreshCopy(true);
                // 연결이 끊긴 것으로 확인되면 상태 안내가 대신 나온다
                if (!r.ok && guestLink.value?.state !== 'disconnected') setMsg(r.error);
                else if (r.ok) showToast('최신 내용을 받았습니다');
              }}
            >
              <Ui name="RefreshCw" size={18} />
              지금 새로 받기
            </button>
          ) : (
            <button
              type="button"
              class="btn primary"
              disabled={busy}
              onClick={async () => {
                setMsg(null);
                const r = await reconnectGuest();
                if (!r.ok) setMsg(r.error);
              }}
            >
              <Ui name="RefreshCw" size={18} />
              {busy ? '연결 중…' : '구글 다시 연결'}
            </button>
          )}
        </div>
      )}

      {!cut ? (
        <>
          <h3 class="share-h">내가 보낸 제안</h3>
          {outbox.length === 0 ? (
            <p class="hint">아직 보낸 제안이 없습니다. 「지출 입력」 버튼으로 제안을 보낼 수 있습니다.</p>
          ) : (
            <ul class="list outbox-list">
              {outbox.map((x) => (
                <li key={x.id} class="list-row">
                  <span class="lr-main static">
                    <span class="lr-title">
                      <span class="lr-name">{x.payload.store || x.payload.memo || '(내용 없음)'}</span>
                      <span class="num"> {won(x.payload.amount)}원</span>
                    </span>
                    <small class="lr-meta">
                      {x.payload.date} ·{' '}
                      {x.status === 'sent'
                        ? `보냄 ${when(x.sentAt)}`
                        : x.status === 'pending'
                          ? hasToken
                            ? '보내는 중'
                            : '보내기 대기 — 구글에 다시 연결하면 보냅니다'
                          : (x.error ?? '보내지 못했습니다')}
                    </small>
                  </span>
                  {x.status !== 'sent' ? (
                    <span class="lr-actions">
                      {x.status === 'failed' ? (
                        <button type="button" class="btn small" onClick={() => void retryFailed()}>
                          다시 보내기
                        </button>
                      ) : null}
                      <button type="button" class="btn small" onClick={() => void dropOutboxItem(x.id)}>
                        없애기
                      </button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {sentCount > 0 ? (
            <p class="hint">보낸 제안은 {KEEP_SENT_DAYS}일이 지나면 목록과 주인의 inbox 폴더에서 자동으로 정리됩니다. 주인이 처리했는지는 여기서 알 수 없습니다.</p>
          ) : null}
        </>
      ) : null}

      <h3 class="share-h">{cut ? '이 사본을 어떻게 할까요?' : '손님 모드 닫기'}</h3>
      {cut ? (
        <>
          <p class="hint">
            <b>사본 지우고 새로 시작</b>: 받아 둔 사본을 지우고 이 기기의 내 가계부로 돌아갑니다.
            <br />
            <b>내 가계부로 바꾸기</b>: 이 사본의 내용을 내 가계부로 삼아 직접 편집합니다. 지금의 내 가계부는 먼저 백업 파일로 내려받습니다.
          </p>
          <div class="btn-row">
            <button type="button" class="btn danger" onClick={() => void discardCopy()}>
              사본 지우고 새로 시작
            </button>
            <button type="button" class="btn" onClick={() => void convertCopyToOwn()}>
              내 가계부로 바꾸기
            </button>
          </div>
        </>
      ) : (
        <>
          <p class="hint">받아 둔 사본과 보내지 않은 제안이 이 기기에서 지워지고 내 가계부로 돌아갑니다. 주인이 해제하지 않았다면 언제든 다시 열 수 있습니다.</p>
          <button type="button" class="btn danger" onClick={() => void discardCopy()}>
            손님 모드 닫기
          </button>
        </>
      )}
    </div>
  );
}
