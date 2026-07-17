# ✦ MEET the MAGIC

### A new concept of meetings — anyone can lead the room, in any language.

**Real-time English → Korean live captions for your meetings, with an AI copilot that keeps you a step ahead.**

MEET the MAGIC captures **any English audio** playing on your system — Microsoft Teams, Zoom, Google Meet, YouTube — transcribes it live, translates it to Korean on screen, tells you **who is speaking**, and runs an AI copilot beside you that summarizes, explains, and researches in real time.

> Built for non-native English speakers who need to **understand fast and respond well** in live English meetings.

![status](https://img.shields.io/badge/platform-Windows-blue) ![electron](https://img.shields.io/badge/Electron-31-47848F) ![license](https://img.shields.io/badge/license-MIT-green) ![OpenAI](https://img.shields.io/badge/OpenAI-Realtime%20API-black)

---

## ✨ Features

- 🎧 **System-audio capture** — grabs whatever is playing (Teams / Zoom / Meet / YouTube) via WASAPI loopback. No bot joins your call, no microphone needed. Works with AirPods / Bluetooth output.
- ⚡ **Real-time transcription** — OpenAI Realtime API (`gpt-4o-transcribe`) streams English word-by-word.
- 🇰🇷 **Streaming translation** — English shown inline with Korean in parentheses, translated live token-by-token (`gpt-4.1-nano`).
- 🎙️ **Speaker diarization (up to 4)** — local pitch-based voice fingerprinting labels speakers A/B/C/D, auto-guesses male/female, and lets you rename them in one click.
- 🤖 **JARVIS copilot (parallel panel)** — so you never miss a thing:
  - 🎯 **Auto briefing** — quietly summarizes the flow, key points, jargon, and things to watch (decisions, deadlines, names, numbers).
  - 💬 **Ask anything** — type a question, get an instant answer grounded in the live transcript.
  - 🔍 **Web research** — toggle web search for professional lookups (industry terms, standards, facts).
- 📌 **Always-on-top overlay**, 📋 **one-click copy**, 📝 **built-in notepad**, smart auto-scroll, adjustable font size.

---

## 🖥️ Screenshot

```
┌───────────────────────────────┬─────────────────────────┐
│  Live captions (fast)         │  🤖 JARVIS               │
│  A · M   18:42:03             │  🎯 Key points           │
│  Let's bounce the stems       │  - Discussing stem       │
│  (스템을 렌더링해서 보내자)   │    render & delivery     │
│  B · F   18:42:07             │  📌 Terms                │
│  Send the pre-master by EOD   │  - stem = individual mix │
│  (오늘 안에 프리마스터 전달)  │  ⚡ Watch                │
│                               │  - Deadline: today (EOD) │
│  ‖‖‖‖ (live VU meter)         │  ─────────────────────── │
│                               │  💬 [ask…]        🔍  ▶  │
└───────────────────────────────┴─────────────────────────┘
```

---

## 🚀 Quick Start

### Requirements
- **Windows 10 / 11**
- **Node.js 18+**
- An **[OpenAI API key](https://platform.openai.com/api-keys)** with Realtime API access

### Install

```bash
git clone https://github.com/CRtheHILLS/MEETtheMAGIC.git
cd MEETtheMAGIC
npm install
```

### Configure

Copy the example env file and add your key:

```bash
cp .env.example .env
```

Then edit `.env`:

```
OPENAI_API_KEY=sk-...your key here...
TRANSCRIBE_MODEL=gpt-4o-transcribe
TRANSLATE_MODEL=gpt-4.1-nano
COPILOT_MODEL=gpt-4.1-mini
```

### Run

```bash
npm start
```

Press **▶ Start**, allow audio sharing, and play any English audio. Captions and the JARVIS panel come alive.

> 💡 **Desktop shortcut:** double-click `run.bat` (or make a shortcut to `launch.vbs`) to launch without a console window.

---

## 🎛️ How to use

1. Put your meeting app (Teams / Zoom) on the **left** half of the screen, MEET the MAGIC on the **right**.
2. Hit **▶ Start** — the left side streams live captions, the right side is your JARVIS copilot.
3. Missed something? Type it in the JARVIS box. Need a professional lookup? Toggle **🔍**.
4. Rename speakers in the chips bar; toggle ♂/♀ if the auto-guess is off.
5. **📋** copies the transcript; the JARVIS **📋** copies the briefing + Q&A.

---

## 🧠 How it works

```
System audio (loopback, 24kHz PCM)
   → OpenAI Realtime WebSocket   → live English transcription (deltas)
   → GPT streaming translation   → Korean captions (inline)
   → local pitch analysis (F0)   → speaker clustering A–D + gender
   → GPT briefing / Q&A / web_search → JARVIS copilot panel
```

- **Electron main** holds the API key and all network calls (the key never touches the renderer).
- **Renderer** captures audio, does pitch-based diarization, and renders the UI.
- Speaker diarization is **local** (autocorrelation pitch detection + hysteresis clustering) because OpenAI's realtime API does not yet expose speaker labels.

| Piece | Model / Tech |
|-------|--------------|
| Transcription | OpenAI `gpt-4o-transcribe` (Realtime API, server VAD) |
| Translation | OpenAI `gpt-4.1-nano` (streaming) |
| Copilot / research | OpenAI `gpt-4.1-mini` + `web_search` tool (Responses API) |
| Diarization | Local pitch (F0) autocorrelation + clustering |
| App shell | Electron 31 |

---

## 🔒 Privacy

Audio is streamed to **OpenAI** for transcription and translation, and transcript text is sent to OpenAI for copilot features. Nothing is sent anywhere else. Your API key lives only in your local `.env` (git-ignored). Review [OpenAI's data usage policy](https://openai.com/enterprise-privacy/) before using in confidential meetings.

---

## 🗺️ Roadmap

- [ ] Reverse mode: Korean → spoken English (`gpt-realtime-translate`)
- [ ] One-connection pipeline via `gpt-realtime-translate` (lower latency)
- [ ] macOS / Linux loopback support
- [ ] Suggested-reply cards when a question is directed at you
- [ ] Pre-loadable custom glossary (artist names, song titles, jargon)
- [ ] Export full meeting (transcript + briefing) to file

See [CHANGELOG.md](CHANGELOG.md) for version history.

---

## 🤝 Contributing

PRs and issues welcome! This is an early-stage open-source project — ideas for latency, accuracy, and UX are especially appreciated.

## 📄 License

[MIT](LICENSE) © 2026 CRtheHILLS

---

<sub>Keywords: real-time translation, live captions, speech-to-text, OpenAI Realtime API, English to Korean, meeting assistant, AI copilot, speaker diarization, Electron, live subtitles, Microsoft Teams, Zoom, transcription, voice AI</sub>
