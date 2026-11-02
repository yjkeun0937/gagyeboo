import { useState } from 'preact/hooks';
import { getClientId } from '../sync/auth';
import * as L from '../sync/sharelab';

/**
 * 계정 공유 시험 화면 (개발용, 주소 끝에 #share-lab). 일반 사용 화면·내 데이터와 연결되어 있지 않다.
 * 소유자 계정과 손님 계정으로 차례로 로그인하며, 각 단계의 구글 응답을 그대로 기록한다.
 */
const LS = 'gagyeboo.sharelab';
interface Saved {
  clientId: string;
  scope: L.LabScope;
  apiKey: string;
  appId: string;
  guestEmail: string;
  rootId: string;
  dataId: string;
  inboxId: string;
  proposalId: string;
}
const EMPTY: Saved = { clientId: '', scope: 'drive.file', apiKey: '', appId: '', guestEmail: '', rootId: '', dataId: '', inboxId: '', proposalId: '' };

function loadSaved(): Saved {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(LS) ?? '{}'), clientId: '' };
  } catch {
    return { ...EMPTY };
  }
}

const brief = (c: L.LabCall) => `HTTP ${c.status}${c.ok ? ' 성공' : ' 실패'} ${typeof c.data === 'string' ? c.data.slice(0, 300) : JSON.stringify(c.data)?.slice(0, 900)}`;

type FileRow = {
  id: string;
  name: string;
  mimeType?: string;
  owners?: { emailAddress?: string }[];
  lastModifyingUser?: { emailAddress?: string };
  capabilities?: Record<string, boolean>;
};
const rows = (c: L.LabCall): FileRow[] => ((c.data as { files?: FileRow[] } | null)?.files ?? []) as FileRow[];
const fmtRow = (f: FileRow) =>
  `  - ${f.name} [${f.mimeType === L.FOLDER ? '폴더' : '파일'}] id=${f.id} 소유=${f.owners?.[0]?.emailAddress ?? '?'} 마지막수정=${f.lastModifyingUser?.emailAddress ?? '?'} 권한=${JSON.stringify(f.capabilities ?? {})}`;

export function ShareLab() {
  const [s, setS] = useState<Saved>(() => ({ ...loadSaved(), clientId: getClientId() }));
  const [owner, setOwner] = useState<L.LabSession | null>(null);
  const [guest, setGuest] = useState<L.LabSession | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const put = (patch: Partial<Saved>) =>
    setS((x) => {
      const n = { ...x, ...patch };
      try {
        const { clientId: _c, ...rest } = n;
        localStorage.setItem(LS, JSON.stringify(rest));
      } catch {
        /* ignore */
      }
      return n;
    });
  const out = (line: string) => setLog((l) => [...l, `[${new Date().toLocaleTimeString('ko-KR')}] ${line}`]);

  const run = async (title: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    out(`▶ ${title}`);
    try {
      await fn();
    } catch (e) {
      out(`  오류: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const need = (who: 'owner' | 'guest'): L.LabSession => {
    const x = who === 'owner' ? owner : guest;
    if (!x) throw new Error(`${who === 'owner' ? '소유자' : '손님'} 계정으로 먼저 로그인해 주세요`);
    return x;
  };

  const signIn = (who: 'owner' | 'guest') =>
    run(`${who === 'owner' ? '소유자' : '손님'} 계정 로그인 (${s.scope})`, async () => {
      if (!s.clientId) throw new Error('클라이언트 ID가 없습니다');
      const ses = await L.labSignIn(s.clientId, s.scope);
      (who === 'owner' ? setOwner : setGuest)(ses);
      out(`  로그인: ${ses.email}\n  허용된 범위: ${ses.grantedScope}`);
      if (who === 'guest' && !s.guestEmail) put({ guestEmail: ses.email });
    });

  /* ───── 소유자 ───── */
  const createAll = () =>
    run('폴더 만들기: 공유 시험 / data / inbox + data/hello.json', async () => {
      const t = need('owner').token;
      const root = await L.createFolder(t, `가계부 공유 시험 ${new Date().toISOString().slice(0, 16)}`);
      out(`  루트: ${brief(root)}`);
      const rid = (root.data as { id?: string })?.id;
      if (!rid) return;
      const data = await L.createFolder(t, 'data', rid);
      const inbox = await L.createFolder(t, 'inbox', rid);
      const did = (data.data as { id?: string })?.id ?? '';
      const iid = (inbox.data as { id?: string })?.id ?? '';
      out(`  data: ${did}\n  inbox: ${iid}`);
      const f = await L.createJson(t, 'hello.json', did, JSON.stringify({ hello: '소유자가 올린 파일', at: new Date().toISOString() }));
      out(`  hello.json: ${brief(f)}`);
      put({ rootId: rid, dataId: did, inboxId: iid });
    });

  const shareAll = () =>
    run('공유 설정: 루트=읽기, inbox=쓰기 (손님 이메일)', async () => {
      const t = need('owner').token;
      if (!s.guestEmail) throw new Error('손님 이메일을 입력해 주세요');
      out(`  루트 읽기: ${brief(await L.share(t, s.rootId, s.guestEmail, 'reader'))}`);
      out(`  inbox 쓰기: ${brief(await L.share(t, s.inboxId, s.guestEmail, 'writer'))}`);
    });

  const ownerListInbox = () =>
    run('소유자: inbox 목록·내용 읽기 (손님이 올린 파일이 보이는가)', async () => {
      const t = need('owner').token;
      const l = await L.listChildren(t, s.inboxId);
      out(`  목록: HTTP ${l.status}`);
      const fs = rows(l);
      if (!fs.length) out('  (보이는 파일 없음)');
      for (const f of fs) {
        out(fmtRow(f));
        const r = await L.readText(t, f.id);
        out(`    내용: ${brief(r)}`);
      }
      if (fs[0]) put({ proposalId: fs[0].id });
    });

  const ownerPickInbox = () =>
    run('소유자: Picker로 inbox 안 파일 고르기', async () => {
      const t = need('owner').token;
      const p = await L.pick(t, s.apiKey, s.appId, 'file');
      out(p ? `  선택: ${p.name} (${p.id})` : '  선택 취소');
      if (p) put({ proposalId: p.id });
    });

  const ownerTrash = () =>
    run('소유자: 손님 제안 파일 삭제 시도', async () => {
      const t = need('owner').token;
      if (!s.proposalId) throw new Error('대상 파일 ID가 없습니다 (inbox 읽기 후 자동 입력)');
      out(`  영구 삭제(DELETE): ${brief(await L.remove(t, s.proposalId))}`);
      out(`  휴지통 이동(PATCH trashed): ${brief(await L.trash(t, s.proposalId))}`);
    });

  const ownerRevoke = () =>
    run('소유자: 손님 공유 해제 (루트·inbox)', async () => {
      const t = need('owner').token;
      for (const id of [s.rootId, s.inboxId]) {
        const l = await L.listPermissions(t, id);
        const ps = ((l.data as { permissions?: { id: string; emailAddress?: string; role: string }[] })?.permissions ?? []).filter(
          (p) => p.emailAddress?.toLowerCase() === s.guestEmail.toLowerCase(),
        );
        if (!ps.length) out(`  ${id}: 해당 손님의 권한이 없음 (${brief(l)})`);
        for (const p of ps) out(`  ${id} ${p.role} 해제: ${brief(await L.removePermission(t, id, p.id))}`);
      }
    });

  /* ───── 손님 ───── */
  const guestShared = () =>
    run('손님: "나와 공유" 목록 조회 (Picker 없이 폴더가 보이는가)', async () => {
      const c = await L.sharedWithMe(need('guest').token);
      out(`  HTTP ${c.status}`);
      const fs = rows(c);
      if (!fs.length) out('  (보이는 항목 없음)');
      fs.forEach((f) => out(fmtRow(f)));
    });

  const guestPick = () =>
    run('손님: Picker로 공유받은 폴더 고르기', async () => {
      const p = await L.pick(need('guest').token, s.apiKey, s.appId, 'folder');
      out(p ? `  선택: ${p.name} (${p.id})` : '  선택 취소');
      if (p) put({ rootId: p.id });
    });

  const guestOpenRoot = () =>
    run('손님: 폴더 ID로 직접 조회 + 하위 목록', async () => {
      const t = need('guest').token;
      const r = await L.getFile(t, s.rootId);
      out(`  폴더 정보: ${brief(r)}`);
      const l = await L.listChildren(t, s.rootId);
      out(`  하위 목록: HTTP ${l.status}`);
      const fs = rows(l);
      if (!fs.length) out('  (보이는 항목 없음)');
      for (const f of fs) {
        out(fmtRow(f));
        if (f.name === 'data') put({ dataId: f.id });
        if (f.name === 'inbox') put({ inboxId: f.id });
      }
    });

  const guestReadData = () =>
    run('손님: data 폴더 목록 + 파일 읽기', async () => {
      const t = need('guest').token;
      const l = await L.listChildren(t, s.dataId);
      out(`  목록: HTTP ${l.status}`);
      for (const f of rows(l)) {
        out(fmtRow(f));
        out(`    내용: ${brief(await L.readText(t, f.id))}`);
      }
    });

  const guestUpload = () =>
    run('손님: inbox에 제안 파일 올리기', async () => {
      const t = need('guest');
      const c = await L.createJson(t.token, `proposal-${Date.now()}.json`, s.inboxId, JSON.stringify({ store: '시험 사용처', amount: 1234, from: '손님이 쓴 값' }));
      out(`  ${brief(c)}`);
      const id = (c.data as { id?: string })?.id;
      if (id) {
        put({ proposalId: id });
        out(`  올린 파일의 소유자·수정자 확인: ${brief(await L.getFile(t.token, id))}`);
      }
    });

  const guestTamper = () =>
    run('손님: 소유자의 파일 수정·삭제 시도 (모두 거부되어야 정상)', async () => {
      const t = need('guest').token;
      const l = await L.listChildren(t, s.dataId);
      const f = rows(l)[0];
      if (!f) return out('  data 안에 보이는 파일이 없어 시험할 수 없습니다');
      out(`  수정(${f.name}): ${brief(await L.updateText(t, f.id, '{"hacked":true}'))}`);
      out(`  삭제(${f.name}): ${brief(await L.remove(t, f.id))}`);
    });

  const guestOwnFile = () =>
    run('손님: 자기가 올린 제안 파일 수정·삭제 시도', async () => {
      const t = need('guest').token;
      if (!s.proposalId) throw new Error('대상 파일 ID가 없습니다');
      out(`  수정: ${brief(await L.updateText(t, s.proposalId, '{"edited":"손님이 수정"}'))}`);
      out(`  삭제: ${brief(await L.remove(t, s.proposalId))}`);
    });

  const copy = async () => {
    const text = [`범위=${s.scope}`, `소유자=${owner?.email ?? '-'}`, `손님=${guest?.email ?? '-'}`, '', ...log].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      out('결과를 복사했습니다');
    } catch {
      out('복사하지 못했습니다. 아래 기록을 직접 선택해 복사해 주세요');
    }
  };

  const Btn = (p: { label: string; on: () => void; who?: 'owner' | 'guest' }) => (
    <button type="button" class="btn small" disabled={busy || (p.who === 'owner' ? !owner : p.who === 'guest' ? !guest : false)} onClick={p.on}>
      {p.label}
    </button>
  );
  const Field = (p: { label: string; k: keyof Saved; ph?: string }) => (
    <label class="lab-field">
      <span>{p.label}</span>
      <input class="input" value={s[p.k]} placeholder={p.ph} onInput={(e) => put({ [p.k]: e.currentTarget.value.trim() } as Partial<Saved>)} />
    </label>
  );

  return (
    <div class="lab">
      <h1>계정 공유 시험 (개발용)</h1>
      <p class="hint">
        가계부 데이터와 연결되지 않은 시험 화면입니다. 구글 드라이브에 「가계부 공유 시험…」 폴더를 만들고, 다른 계정에 공유해 읽기·쓰기·삭제가
        어떻게 동작하는지 확인합니다. 위에서 아래로 차례로 눌러 주세요.
      </p>

      <section class="lab-sec">
        <h2>0. 설정</h2>
        <Field label="OAuth 클라이언트 ID" k="clientId" />
        <label class="lab-field">
          <span>권한 범위</span>
          <select class="input" value={s.scope} onChange={(e) => put({ scope: e.currentTarget.value as L.LabScope })}>
            <option value="drive.file">drive.file (비민감 · 앱이 만들었거나 사용자가 고른 파일만)</option>
            <option value="drive">drive (전체 · 제한 범위, 미검증 앱 경고 화면이 뜹니다)</option>
          </select>
        </label>
        <Field label="API 키 (Picker용, 선택)" k="apiKey" />
        <Field label="프로젝트 번호 (Picker용, 선택)" k="appId" />
        <Field label="손님 구글 이메일" k="guestEmail" ph="guest@gmail.com" />
      </section>

      <section class="lab-sec">
        <h2>1. 소유자 계정 {owner ? `— ${owner.email}` : ''}</h2>
        <div class="btn-row">
          <Btn label="소유자로 로그인" on={() => signIn('owner')} />
          <Btn label="폴더·파일 만들기" on={createAll} who="owner" />
          <Btn label="손님에게 공유" on={shareAll} who="owner" />
        </div>
      </section>

      <section class="lab-sec">
        <h2>2. 손님 계정 {guest ? `— ${guest.email}` : ''}</h2>
        <div class="btn-row">
          <Btn label="손님으로 로그인" on={() => signIn('guest')} />
          <Btn label="나와 공유 목록 조회" on={guestShared} who="guest" />
          <Btn label="Picker로 폴더 고르기" on={guestPick} who="guest" />
          <Btn label="폴더 ID로 조회" on={guestOpenRoot} who="guest" />
          <Btn label="data 읽기" on={guestReadData} who="guest" />
          <Btn label="inbox에 제안 올리기" on={guestUpload} who="guest" />
          <Btn label="소유자 파일 변조 시도" on={guestTamper} who="guest" />
          <Btn label="내가 올린 파일 수정·삭제" on={guestOwnFile} who="guest" />
        </div>
      </section>

      <section class="lab-sec">
        <h2>3. 소유자: 제안 받기·정리</h2>
        <div class="btn-row">
          <Btn label="inbox 읽기" on={ownerListInbox} who="owner" />
          <Btn label="Picker로 inbox 파일 고르기" on={ownerPickInbox} who="owner" />
          <Btn label="제안 파일 삭제" on={ownerTrash} who="owner" />
        </div>
      </section>

      <section class="lab-sec">
        <h2>4. 공유 해제 후 확인</h2>
        <div class="btn-row">
          <Btn label="손님 공유 해제" on={ownerRevoke} who="owner" />
          <span class="hint">해제한 뒤 손님 쪽의 「폴더 ID로 조회」「data 읽기」「inbox에 제안 올리기」를 다시 눌러 보세요.</span>
        </div>
      </section>

      <section class="lab-sec">
        <h2>현재 ID</h2>
        <Field label="루트 폴더 ID" k="rootId" />
        <Field label="data 폴더 ID" k="dataId" />
        <Field label="inbox 폴더 ID" k="inboxId" />
        <Field label="대상 제안 파일 ID" k="proposalId" />
      </section>

      <section class="lab-sec">
        <div class="btn-row">
          <h2 style="margin:0">기록</h2>
          <span class="grow" />
          <button type="button" class="btn small" onClick={copy}>
            결과 복사
          </button>
          <button type="button" class="btn small" onClick={() => setLog([])}>
            지우기
          </button>
        </div>
        <pre class="lab-log">{log.join('\n') || '(아직 기록이 없습니다)'}</pre>
      </section>
    </div>
  );
}
