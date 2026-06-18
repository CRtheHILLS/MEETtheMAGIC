'use strict';

const startBtn = document.getElementById('start-btn');
const memoToggle = document.getElementById('memo-toggle');
const fontBtn = document.getElementById('font-btn');
const memoPane = document.getElementById('memo-pane');
const memo = document.getElementById('memo');
const statusEl = document.getElementById('status');
const statusText = document.getElementById('status-text');
const feed = document.getElementById('feed');
const live = document.getElementById('live');
const liveText = document.getElementById('live-text');
const idleBars = document.getElementById('idle-bars');
const bars = Array.from(idleBars.querySelectorAll('span'));

let running = false;
let audioContext = null;
let mediaStream = null;
let processor = null;
let sourceNode = null;
let level = 0; // 0..1 audio level for VU meter

// Per-utterance state: itemId -> { card, koEl, enEl, en, seq, applied, timer }
const items = new Map();
let order = 0;

function showEmptyHint() {
  feed.innerHTML =
    '<div class="empty-hint">' +
    '<div class="big">▶ 시작 버튼을 누르세요</div>' +
    '미팅 소리(영어)가 들리면<br/>실시간으로 한국어가 따라 올라옵니다.' +
    '</div>';
}
showEmptyHint();

// ---------- Audio capture ----------
async function startCapture() {
  try {
    mediaStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    mediaStream.getVideoTracks().forEach((t) => t.stop());

    const audioTracks = mediaStream.getAudioTracks();
    if (audioTracks.length === 0) {
      setStatus('error', '시스템 소리를 캡처하지 못했습니다 (소리 공유 허용 필요)');
      return false;
    }

    audioContext = new AudioContext({ sampleRate: 24000 });
    if (audioContext.state === 'suspended') await audioContext.resume();
    sourceNode = audioContext.createMediaStreamSource(new MediaStream(audioTracks));

    processor = audioContext.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (e) => {
      if (!running) return;
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0;
      const pcm16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        let s = Math.max(-1, Math.min(1, input[i]));
        sum += s * s;
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      level = Math.sqrt(sum / input.length); // RMS
      window.magic.sendAudio(pcm16.buffer);
    };

    const sink = audioContext.createGain();
    sink.gain.value = 0;
    sourceNode.connect(processor);
    processor.connect(sink);
    sink.connect(audioContext.destination);

    idleBars.classList.add('meter');
    animateMeter();
    return true;
  } catch (err) {
    setStatus('error', '오디오 캡처 실패: ' + err.message);
    return false;
  }
}

function stopCapture() {
  if (processor) { try { processor.disconnect(); } catch (e) {} processor = null; }
  if (sourceNode) { try { sourceNode.disconnect(); } catch (e) {} sourceNode = null; }
  if (audioContext) { try { audioContext.close(); } catch (e) {} audioContext = null; }
  if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }
  idleBars.classList.remove('meter');
  bars.forEach((b) => (b.style.height = ''));
  level = 0;
}

// VU meter — real audio level drives the bars (also confirms capture works).
function animateMeter() {
  if (!running) return;
  const base = Math.min(1, level * 6);
  bars.forEach((b, i) => {
    const center = 1 - Math.abs(i - (bars.length - 1) / 2) / (bars.length / 2);
    const h = 8 + base * 26 * (0.5 + center) * (0.7 + Math.random() * 0.6);
    b.style.height = Math.min(34, h) + 'px';
  });
  requestAnimationFrame(animateMeter);
}

// ---------- Start / stop ----------
async function toggleRun() {
  if (!running) {
    setStatus('connecting', '연결 중...');
    window.magic.startCapture();
    running = true;
    const ok = await startCapture();
    if (!ok) { running = false; window.magic.stopCapture(); return; }
    startBtn.textContent = '■ 정지';
    startBtn.classList.add('recording');
    feed.innerHTML = '';
    items.clear();
    liveText.textContent = '';
  } else {
    running = false;
    stopCapture();
    window.magic.stopCapture();
    startBtn.textContent = '▶ 시작';
    startBtn.classList.remove('recording');
    live.classList.remove('speaking');
    liveText.textContent = '';
    setStatus('stopped', '정지됨');
  }
}
startBtn.addEventListener('click', toggleRun);

// ---------- UI helpers ----------
function setStatus(state, text) {
  statusEl.className = 'status ' + state;
  statusText.textContent = text;
}
function autoScroll() { feed.scrollTop = feed.scrollHeight; }

function ensureItem(itemId) {
  if (items.has(itemId)) return items.get(itemId);
  const card = document.createElement('div');
  card.className = 'card live-card';
  const koEl = document.createElement('div');
  koEl.className = 'ko pending';
  koEl.textContent = '…';
  const enEl = document.createElement('div');
  enEl.className = 'en';
  card.appendChild(koEl);
  card.appendChild(enEl);
  feed.appendChild(card);
  autoScroll();
  const it = { card, koEl, enEl, en: '', reqSeq: 0, curSeq: 0, koText: '', timer: null, lastSent: '' };
  items.set(itemId, it);
  return it;
}

// Debounced incremental translation (fast: ~250ms; final fires immediately).
function scheduleTranslate(itemId, isFinal) {
  const it = items.get(itemId);
  if (!it) return;
  if (it.timer) clearTimeout(it.timer);
  const fire = () => {
    if (!isFinal && it.en === it.lastSent) return; // skip if nothing new
    it.lastSent = it.en;
    it.reqSeq += 1;
    window.magic.requestTranslate({ itemId, text: it.en, seq: it.reqSeq, isFinal: !!isFinal });
  };
  if (isFinal) { fire(); } else { it.timer = setTimeout(fire, 250); }
}

// ---------- IPC events ----------
window.magic.onStatus((p) => setStatus(p.state, p.message));

window.magic.onSpeech((p) => {
  if (p.active) live.classList.add('speaking');
  else setTimeout(() => live.classList.remove('speaking'), 300);
});

// Live English as it is spoken — immediate, shows where the speaker is.
window.magic.onTranscriptDelta((p) => {
  const it = ensureItem(p.itemId);
  it.en += p.delta;
  it.enEl.textContent = it.en;
  autoScroll();
  scheduleTranslate(p.itemId, false);
});

window.magic.onTranscriptFinal((p) => {
  const it = ensureItem(p.itemId);
  it.en = p.text; // authoritative final transcript
  it.enEl.textContent = it.en;
  it.card.classList.remove('live-card');
  scheduleTranslate(p.itemId, true);
});

// Streaming translation — Korean appears character-by-character, near real-time.
window.magic.onTranslationStart((p) => {
  const it = items.get(p.itemId);
  if (!it || p.seq < it.curSeq) return;
});
window.magic.onTranslationDelta((p) => {
  const it = items.get(p.itemId);
  if (!it || p.seq < it.curSeq) return;
  if (p.seq > it.curSeq) { it.curSeq = p.seq; it.koText = ''; } // newer translation supersedes
  it.koText += p.delta;
  it.koEl.textContent = it.koText;
  it.koEl.classList.remove('pending');
  autoScroll();
});
window.magic.onTranslationDone(() => { /* nothing required */ });

// ---------- Memo ----------
memo.value = localStorage.getItem('magic-memo') || '';
memo.addEventListener('input', () => localStorage.setItem('magic-memo', memo.value));
memoToggle.addEventListener('click', () => {
  memoPane.classList.toggle('hidden');
  memoToggle.classList.toggle('active', !memoPane.classList.contains('hidden'));
});

// ---------- Font size ----------
const sizes = [24, 30, 38, 46];
let sizeIdx = parseInt(localStorage.getItem('magic-fontidx') || '1', 10);
function applyFont() {
  document.documentElement.style.setProperty('--cap-size', sizes[sizeIdx] + 'px');
  localStorage.setItem('magic-fontidx', String(sizeIdx));
}
applyFont();
fontBtn.addEventListener('click', () => { sizeIdx = (sizeIdx + 1) % sizes.length; applyFont(); });
