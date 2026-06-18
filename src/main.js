'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { app, BrowserWindow, session, desktopCapturer, ipcMain } = require('electron');
const WebSocket = require('ws');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TRANSCRIBE_MODEL = process.env.TRANSCRIBE_MODEL || 'gpt-4o-transcribe';
const TRANSLATE_MODEL = process.env.TRANSLATE_MODEL || 'gpt-4.1-mini';

let mainWindow = null;
let realtimeWS = null;
let wsReady = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 920,
    minWidth: 420,
    minHeight: 500,
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
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 200,
              silence_duration_ms: 300
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
  'You are a professional real-time interpreter for a music industry meeting (composers, A&R). ' +
  'Translate the English (often an unfinished, mid-sentence fragment) into natural Korean. ' +
  'Translate whatever is given even if incomplete, do not wait for a full sentence. ' +
  'Output ONLY the Korean translation, no quotes, no notes. Keep proper nouns, brand and song names as-is.';

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

// ---------- IPC ----------

ipcMain.on('start-capture', () => {
  openRealtime();
});

ipcMain.on('stop-capture', () => {
  closeRealtime();
  sendToRenderer('status', { state: 'stopped', message: '정지됨' });
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
