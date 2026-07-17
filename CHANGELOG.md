# Changelog

All notable changes to MEET the MAGIC are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-06-19

First public release. 🎉

### Added
- **Real-time English → Korean captions** from system loopback audio (Teams / Zoom / Meet / YouTube).
- **OpenAI Realtime transcription** (`gpt-4o-transcribe`, GA API) over WebSocket with server VAD.
- **Streaming translation** (`gpt-4.1-nano`) — inline `English (한글)` format, token-by-token.
- **Speaker diarization (up to 4)** — local pitch (F0) autocorrelation + hysteresis clustering, automatic male/female estimation, one-click rename and gender override.
- **JARVIS copilot panel** (parallel):
  - Auto briefing (key points / jargon / watch-items), throttled to stay calm.
  - Ask-anything, grounded in the live transcript (streaming).
  - Web research via the Responses API `web_search` tool.
- **UX:** always-on-top overlay, one-click copy (transcript + copilot), built-in notepad, smart auto-scroll, adjustable font size, live VU meter.
- Windows desktop launcher (`run.bat` / `launch.vbs`) that clears `ELECTRON_RUN_AS_NODE`.

### Notes
- Latency tuned with `server_vad` (250 ms silence) for snappy, sentence-by-sentence captions.
- Speaker diarization is local because OpenAI's Realtime API does not yet expose speaker labels.

[1.0.0]: https://github.com/CRtheHILLS/MEETtheMAGIC/releases/tag/v1.0.0
