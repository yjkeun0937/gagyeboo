/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** 구글 OAuth 웹 클라이언트 ID (공개되는 값). 배포 시 GitHub 저장소 변수 GOOGLE_CLIENT_ID로 넣는다 */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** 손님이 공유 파일을 고르는 구글 Picker용 API 키·프로젝트 번호 (공개되는 값). 저장소 변수 GOOGLE_API_KEY / GOOGLE_APP_ID */
  readonly VITE_GOOGLE_API_KEY?: string;
  readonly VITE_GOOGLE_APP_ID?: string;
}

/** 빌드 식별 문구 (커밋 번호 · 빌드 시각, 한국 시간). vite.config.ts에서 채운다 */
declare const __BUILD_ID__: string;
