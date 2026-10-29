/// <reference types="vite/client" />
interface ImportMetaEnv {
  /** 구글 OAuth 웹 클라이언트 ID (공개되는 값). 배포 시 GitHub 저장소 변수 GOOGLE_CLIENT_ID로 넣는다 */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}
