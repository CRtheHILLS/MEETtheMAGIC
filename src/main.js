'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron');
const WebSocket = require('ws');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || 'gpt-4o-transcribe';
const TRANSLATE_MODEL = process.env.TRANSLATE_MODEL || 'gpt-4.1-nano';
const COPILOT_MODEL = process.env.COPILOT_MODEL || 'gpt-4.1-mini';

let mainWindow = null;
let realtimeWS = null;
let wsReady = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 940,
    minWidth: 720,
    minHeight: 520,
    title: 'MEET the MAGIC',
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // System audio loopback capture support (Windows).
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        // Provide a screen source for video (ignored by renderer) + loopback audio.
        callback({ video: sources[0], audio: 'loopback' });
      }).catch(() => {
        callback({});
      });
    },
    { useSystemPicker: false }
  );

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
    closeRealtime();
  });
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ---------- OpenAI Realtime transcription ----------

function openRealtime() {
  if (!OPENAI_API_KEY) {
    sendToRenderer('status', { state: 'error', message: 'OPENAI_API_KEY가 설정되지 않았습니다 (.env 확인)' });
    return;
  }

  closeRealtime();
  wsReady = false;
  sendToRenderer('status', { state: 'connecting', message: '음성 인식 서버 연결 중...' });

  // GA Realtime API: no OpenAI-Beta header.
  realtimeWS = new WebSocket(
    'wss://api.openai.com/v1/realtime?intent=transcription',
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`
      }
    }
  );

  realtimeWS.on('open', () => {
    // GA transcription session shape.
    const sessionConfig = {
      type: 'session.update',
      session: {
        type: 'transcription',
        audio: {
          input: {
            format: { type: 'audio/pcm', rate: 24000 },
            transcription: {
              model: TRANSCRIBE_MODEL,
              language: 'en'
            },
            // server_vad with a SHORT silence window: commit a segment at every
            // small pause so captions come out one short line at a time, fast,
            // instead of semantic_vad batching several sentences (which causes
            // dead air in a live meeting). 250ms = snappy without shredding words.
            turn_detection: {
              type: 'server_vad',
              threshold: 0.45,
              prefix_padding_ms: 200,
              silence_duration_ms: 250
            },
            noise_reduction: { type: 'near_field' }
          }
        }
      }
    };
    realtimeWS.send(JSON.stringify(sessionConfig));
    wsReady = true;
    sendToRenderer('status', { state: 'listening', message: '듣는 중' });
  });

  realtimeWS.on('message', (data) => {
    let evt;
    try {
      evt = JSON.parse(data.toString());
    } catch (e) {
      return;
    }
    handleRealtimeEvent(evt);
  });

  realtimeWS.on('error', (err) => {
    sendToRenderer('status', { state: 'error', message: '연결 오류: ' + (err && err.message ? err.message : 'unknown') });
  });

  realtimeWS.on('close', () => {
    wsReady = false;
    sendToRenderer('status', { state: 'stopped', message: '연결 종료됨' });
  });
}

function handleRealtimeEvent(evt) {
  switch (evt.type) {
    case 'conversation.item.input_audio_transcription.delta': {
      // Interim partial text for the current utterance.
      if (evt.delta) {
        sendToRenderer('transcript-delta', { itemId: evt.item_id, delta: evt.delta });
      }
      break;
    }
    case 'conversation.item.input_audio_transcription.completed': {
      const text = (evt.transcript || '').trim();
      if (text) {
        // Renderer drives translation (partial + final) for real-time following.
        sendToRenderer('transcript-final', { itemId: evt.item_id, text });
      }
      break;
    }
    case 'input_audio_buffer.speech_started': {
      sendToRenderer('speech', { active: true });
      break;
    }
    case 'input_audio_buffer.speech_stopped': {
      sendToRenderer('speech', { active: false });
      break;
    }
    case 'error': {
      const msg = evt.error && evt.error.message ? evt.error.message : 'realtime error';
      sendToRenderer('status', { state: 'error', message: msg });
      break;
    }
    default:
      break;
  }
}

function closeRealtime() {
  if (realtimeWS) {
    try { realtimeWS.removeAllListeners(); realtimeWS.close(); } catch (e) {}
    realtimeWS = null;
  }
  wsReady = false;
}

// ---------- Translation (EN -> KO) ----------

const TRANSLATE_SYS =
  'Interpret English (music-industry meeting; may be a mid-sentence fragment) into natural Korean. ' +
  'Translate whatever is given even if incomplete. Output ONLY Korean, no notes. Keep proper nouns/song names as-is.';

async function translate(text, itemId, seq, isFinal) {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: TRANSLATE_MODEL,
        temperature: 0.2,
        stream: true,
        max_tokens: 200,
        messages: [
          { role: 'system', content: TRANSLATE_SYS },
          { role: 'user', content: text }
        ]
      })
    });

    if (!res.ok || !res.body) {
      sendToRenderer('translation-done', { itemId, seq, isFinal });
      return;
    }

    sendToRenderer('translation-start', { itemId, seq, isFinal });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (d) sendToRenderer('translation-delta', { itemId, seq, delta: d });
        } catch (e) { /* ignore partial json */ }
      }
    }
    sendToRenderer('translation-done', { itemId, seq, isFinal });
  } catch (e) {
    sendToRenderer('translation-done', { itemId, seq, isFinal });
  }
}

// ---------- JARVIS Copilot ----------

// Stream a chat-completions answer, forwarding deltas on the given channel.
async function streamChat(messages, { model, id, channel, temperature = 0.3, maxTokens = 700 }) {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model, temperature, max_tokens: maxTokens, stream: true, messages })
    });
    if (!res.ok || !res.body) {
      sendToRenderer(channel + '-done', { id, error: 'http ' + res.status });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (d) sendToRenderer(channel + '-delta', { id, delta: d });
        } catch (e) { /* ignore */ }
      }
    }
    sendToRenderer(channel + '-done', { id });
  } catch (e) {
    sendToRenderer(channel + '-done', { id, error: e.message });
  }
}

// Stream a Responses-API answer with the built-in web_search tool.
async function streamWebResearch(input, { id, channel }) {
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: COPILOT_MODEL,
        tools: [{ type: 'web_search' }],
        stream: true,
        input
      })
    });
    if (!res.ok || !res.body) {
      sendToRenderer(channel + '-done', { id, error: 'http ' + res.status });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let searched = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          if (j.type === 'response.output_text.delta' && j.delta) {
            sendToRenderer(channel + '-delta', { id, delta: j.delta });
          } else if (j.type && j.type.indexOf('web_search') >= 0 && !searched) {
            searched = true;
            sendToRenderer(channel + '-delta', { id, delta: '🔍 웹 검색 중...\n\n' });
          }
        } catch (e) { /* ignore */ }
      }
    }
    sendToRenderer(channel + '-done', { id });
  } catch (e) {
    sendToRenderer(channel + '-done', { id, error: e.message });
  }
}

const BRIEF_SYS =
  '너는 한국 음악 프로듀서의 실시간 회의 비서(JARVIS)다. 아래 영어 회의 대화록을 보고 ' +
  '한국어로 아주 간결하게, 사용자가 회의를 빠르게 이해하도록 브리핑하라. 형식(해당 없으면 그 줄 생략):\n' +
  '🎯 핵심\n- (지금 무슨 얘기 중인지 2~3개, 짧게)\n' +
  '📌 용어\n- term = 뜻 (방금 나온 전문용어/은어/약어만, 없으면 생략)\n' +
  '⚡ 주목\n- (사용자에게 온 질문, 결정사항, 마감·숫자·이름 등 놓치면 안 되는 것. 없으면 생략)\n' +
  '군더더기 없이. 새로 나온 내용 위주로.';

const ASK_SYS =
  '너는 한국 음악 프로듀서의 실시간 회의 비서다. 아래 회의 대화록을 참고해 사용자의 질문에 ' +
  '한국어로 간결하고 정확하게 답하라. 영어 전문용어/은어는 풀어서 설명. 대화록에 없는 일반 지식도 활용하되, ' +
  '확실하지 않으면 모른다고 말하라.';

// ---------- IPC ----------

ipcMain.on('copilot-brief', (_event, payload) => {
  const transcript = (payload && payload.transcript || '').trim();
  if (!transcript) { sendToRenderer('brief-done', {}); return; }
  streamChat(
    [{ role: 'system', content: BRIEF_SYS }, { role: 'user', content: '회의 대화록:\n' + transcript }],
    { model: COPILOT_MODEL, id: 'brief', channel: 'brief', temperature: 0.3, maxTokens: 500 }
  );
});

ipcMain.on('copilot-ask', (_event, payload) => {
  const id = payload && payload.id;
  const question = (payload && payload.question || '').trim();
  const transcript = (payload && payload.transcript || '').trim();
  if (!question) { sendToRenderer('ask-done', { id }); return; }
  if (payload && payload.web) {
    const input =
      ASK_SYS + '\n\n[회의 대화록]\n' + (transcript || '(없음)') +
      '\n\n[질문]\n' + question +
      '\n\n필요하면 웹 검색으로 최신·전문 정보를 찾아 한국어로 답하라.';
    streamWebResearch(input, { id, channel: 'ask' });
  } else {
    streamChat(
      [
        { role: 'system', content: ASK_SYS },
        { role: 'user', content: '[회의 대화록]\n' + (transcript || '(없음)') + '\n\n[질문]\n' + question }
      ],
      { model: COPILOT_MODEL, id, channel: 'ask', temperature: 0.3, maxTokens: 800 }
    );
  }
});

ipcMain.on('start-capture', () => {
  openRealtime();
});

ipcMain.on('stop-capture', () => {
  closeRealtime();
  sendToRenderer('status', { state: 'stopped', message: '정지됨' });
});

ipcMain.handle('toggle-on-top', () => {
  if (!mainWindow) return false;
  const v = !mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(v, 'screen-saver');
  return v;
});

ipcMain.on('request-translate', (_event, payload) => {
  if (!payload || !payload.text) return;
  translate(payload.text, payload.itemId, payload.seq, payload.isFinal);
});

ipcMain.on('audio-chunk', (_event, arrayBuffer) => {
  if (!realtimeWS || !wsReady || realtimeWS.readyState !== WebSocket.OPEN) return;
  const b64 = Buffer.from(arrayBuffer).toString('base64');
  realtimeWS.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
});

// ---------- App lifecycle ----------

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  closeRealtime();
  if (process.platform !== 'darwin') app.quit();
});
