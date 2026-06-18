# NEXT — MEET the MAGIC

실시간 영어→한글 자막 데스크톱 앱 (Microsoft Teams 미팅용). Electron + OpenAI Realtime(gpt-4o-transcribe) + GPT-4.1-mini 스트리밍 번역.

## 실행
- 바탕화면 **MEET the MAGIC** 아이콘 클릭 → ▶ 시작
- 시스템 출력 소리(루프백)를 캡처 → 영어 필사 → 한글 스트리밍 번역
- 핵심: `ELECTRON_RUN_AS_NODE` 환경변수가 1이면 안 켜짐 → `run.bat`이 해제 후 실행

## 현재 상태 (2026-06-18 기준 동작 확인됨)
- ✅ 바탕화면 아이콘 실행
- ✅ OpenAI GA Realtime 핸드셰이크 (Beta API 종료 → GA `session.update` 형식 사용)
- ✅ 스트리밍 번역 (한글 토큰 단위 출력)
- ✅ 실제 소리 VU 미터(막대) — 캡처 여부 즉시 확인용
- 화면: 좌(Teams) / 우(이 앱), 앱 내부에 메모장 토글 패널 = 3분할 느낌

## 내일 업그레이드 후보 (요청: 더 빠른 실시간성)
1. **번역 모델 `gpt-4.1-mini` → `gpt-4.1-nano`** 로 교체 (`.env`의 TRANSLATE_MODEL) — 지연 더 감소
2. 번역 디바운스 `250ms → 150ms` ([renderer.js](src/renderer.js) scheduleTranslate)
3. **ElevenLabs Scribe v2 Realtime** 백업 엔진 옵션화 (키는 `.env` ELEVENLABS_API_KEY에 저장됨, 현재 미사용)
4. 자막 폰트/투명도/항상-위(always-on-top) 옵션
5. 미팅 종료 후 전체 대화록(영문+한글) 저장/내보내기

## 보안 ⚠️
- 채팅으로 노출된 **OpenAI 키 폐기(rotate) 후 새 키 발급** 권장 → `.env` 갱신
- `.env`는 gitignore 처리됨 (커밋 안 됨)

## 구조
- [src/main.js](src/main.js) — Electron 메인 + OpenAI WS + 스트리밍 번역
- [src/preload.js](src/preload.js) — IPC 다리
- [src/renderer.js](src/renderer.js) — 오디오 캡처 + 화면 렌더 + VU 미터
- [src/index.html](src/index.html) / [src/styles.css](src/styles.css) — UI (다크 테마)
- [run.bat](run.bat) / [launch.vbs](launch.vbs) — 런처
