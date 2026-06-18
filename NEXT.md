# NEXT — MEET the MAGIC

실시간 영어→한글 자막 데스크톱 앱 (Microsoft Teams 미팅용). Electron + OpenAI Realtime(gpt-4o-transcribe) + GPT-4.1-nano 스트리밍 번역 + 피치 기반 화자분리.

## 실행
- 바탕화면 **MEET the MAGIC** 아이콘 클릭 → ▶ 시작
- 시스템 출력 소리(루프백) 캡처 → 영어 필사 → 화자별 한글 스트리밍 번역
- `ELECTRON_RUN_AS_NODE`가 1이면 안 켜짐 → `run.bat`이 해제 후 실행

## 현재 상태 (2026-06-19 동작 확인됨)
- ✅ 바탕화면 아이콘 실행
- ✅ OpenAI GA Realtime, **semantic_vad + eagerness:high** (가장 빠른 확정, 단어 안 잘림)
- ✅ **gpt-4.1-nano** 스트리밍 번역 (TTFT ~0.5s), max_tokens 200, 짧은 시스템 프롬프트
- ✅ 표시 방식: **English (한글)** 한 줄 인라인, 실시간
- ✅ **피치(F0) 기반 화자분리** 최대 4명 A·B·C·D + 남/여 자동추정 + 칩에서 이름/성별 수정
  - 군집 로직: 촘촘한 피치 샘플의 median + 히스테리시스(SAME_THRESH=42, HYST=10)
  - 시뮬레이션 검증: 1명→1명 유지, 2~3명 정확 분리. (4명 비슷한 음색은 합쳐질 수 있음→수동 보정)
- ✅ 인터페이스: 📌 항상 위에(오버레이), 📋 전체 복사, 스마트 자동스크롤(위로 보면 멈춤+"최신으로"), 텍스트 드래그 복사, 폰트크기, 메모장

## 내일 실제 회의 후 미세조정 포인트 ⭐
- **VAD 끊김 타이밍**: 현재 `server_vad` `silence_duration_ms: 250` ([main.js](src/main.js)). 사용자는 "뭉쳐서 한꺼번에 말고, 짧게 끊어 빨리빨리"를 선호.
  - 아직 여러 문장이 묶여 나오면 → 더 낮춤(200)
  - 문장 중간에 잘게 쪼개지면 → 올림(300~350)
  - `semantic_vad`는 여러 문장을 모았다가 한꺼번에 출력해서 회의 중 "마"가 떠 부적합 → server_vad 유지
- 실시간성: 말하는 도중 영어 델타 흐름 + 한글 0.15s 디바운스 번역은 유지 중.

## 다음 업그레이드 후보
1. **화자분리 정확도 향상** — 피치만으로는 음색 비슷한 4명 한계. speaker embedding(예: 경량 모델) 또는 OpenAI `gpt-4o-transcribe-diarize`(현재 조직 권한 없음→접근 신청 시 전환) 검토.
2. **speculative translation** — completed 안 기다리고 delta 5~8단어마다 번역 시작 (지연 더↓). 현재는 250ms 디바운스.
3. 자막 2줄 오버레이 모드(반투명 배경 rgba(0,0,0,0.75), Noto Sans KR) — BBC/FCC 가이드.
4. 미팅 종료 후 전체 대화록 파일 저장(.txt/.md) 내보내기.
5. interim(델타) 텍스트 흐리게(55% 흰색), 확정 텍스트 풀 화이트로 시각 구분.

## 보안 ⚠️
- 채팅 노출된 **OpenAI 키 폐기(rotate) 후 새 키** 권장 → `.env` 갱신
- ElevenLabs 키도 `.env`에 백업 저장됨(미사용)
- `.env`는 gitignore (커밋 안 됨)

## 구조
- [src/main.js](src/main.js) — Electron 메인 + OpenAI WS + 스트리밍 번역 + 항상위 IPC
- [src/preload.js](src/preload.js) — IPC 다리
- [src/renderer.js](src/renderer.js) — 오디오 캡처 + 피치검출/화자군집 + 렌더 + 스마트스크롤
- [src/index.html](src/index.html) / [src/styles.css](src/styles.css) — UI (다크 테마)
- [run.bat](run.bat) / [launch.vbs](launch.vbs) — 런처
