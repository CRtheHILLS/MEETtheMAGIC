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
const speakerChips = document.getElementById('speaker-chips');
const ontopBtn = document.getElementById('ontop-btn');
const copyBtn = document.getElementById('copy-btn');
const jumpBtn = document.getElementById('jump-btn');

let running = false;
let audioContext = null;
let mediaStream = null;
let processor = null;
let sourceNode = null;
let level = 0;        // 0..1 RMS for VU meter
let curPitch = 0;     // last voiced fundamental frequency (Hz)
let liveItemId = null; // item currently receiving audio/transcription

const SAMPLE_RATE = 24000;

// itemId -> { card, whoEl, koEl, enEl, en, reqSeq, curSeq, koText, timer, lastSent, pitches, spk }
const items = new Map();

// ---------- Speakers ----------
const SPK_LABELS = ['A', 'B', 'C', 'D'];
const speakers = []; // {idx, name, gender:'M'|'F'|'?', manualGender:bool, mean:Hz, n}
const GENDER_PITCH_BOUNDARY = 165; // Hz: below=male, above=female

function genderKo(g) { return g === 'M' ? '남' : g === 'F' ? '여' : ''; }
function genderIcon(g) { return g === 'M' ? '♂' : g === 'F' ? '♀' : '?'; }
function classifyGender(p) { return p <= 0 ? '?' : (p < GENDER_PITCH_BOUNDARY ? 'M' : 'F'); }
function spkClass(s) { return s.idx < 4 ? 'spk-' + s.idx : 'spk-x'; }
function spkDisplayName(s) {
  if (s.name) return s.name;
  const g = genderKo(s.gender);
  return SPK_LABELS[s.idx] || '?' + (g ? '' : '');
}
function spkAvatarText(s) { return SPK_LABELS[s.idx] || '?'; }

function newSpeaker(pitch) {
  const idx = speakers.length;
  const s = { idx, name: '', gender: classifyGender(pitch), manualGender: false, mean: pitch > 0 ? pitch : 0, n: pitch > 0 ? 1 : 0 };
  speakers.push(s);
  renderChips();
  return s;
}

let lastSpeaker = null; // mild hysteresis toward the previous speaker

// Tolerances (Hz). Dense per-frame pitch sampling makes the per-utterance median
// stable, so a moderate SAME_THRESH separates distinct voices while a small
// hysteresis bias keeps one person's intonation from flickering between clusters.
// Validated by simulation: 1 speaker stays 1; 2-3 distinct voices separate correctly.
const SAME_THRESH = 42;      // within this of a cluster mean -> same speaker
const HYST = 10;             // distance bonus for the previous speaker (anti-flicker)
const MIN_SAMPLES_NEW = 8;   // need this many voiced frames before creating a new speaker

function updateMean(s, p) {
  s.mean = (s.mean * s.n + p) / (s.n + 1);
  s.n += 1;
  if (!s.manualGender) s.gender = classifyGender(s.mean);
}

// Commit a speaker for an utterance using its median pitch (clusters, max 4).
function commitSpeaker(it) {
  const p = medianPitch(it.pitches);
  const samples = it.pitches.length;
  let spk = null;

  if (p <= 0 || samples < 5) {
    // Not enough voice info -> keep the previous speaker (avoid spurious splits).
    spk = lastSpeaker || speakers[0] || newSpeaker(0);
  } else {
    let best = null, bd = 1e9;
    for (const s of speakers) {
      if (s.n === 0) continue;
      let d = Math.abs(s.mean - p);
      if (s === lastSpeaker) d -= HYST; // bias toward continuity
      if (d < bd) { bd = d; best = s; }
    }
    if (best && bd <= SAME_THRESH) {
      spk = best; updateMean(spk, p);
    } else if (speakers.length < 4 && samples >= MIN_SAMPLES_NEW) {
      spk = newSpeaker(p);
    } else {
      spk = best || newSpeaker(p);
      if (best) updateMean(spk, p);
    }
  }

  lastSpeaker = spk;
  it.spk = spk;
  paintCardSpeaker(it);
  renderChips();
}

function medianPitch(arr) {
  if (!arr || arr.length === 0) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

// ---------- Pitch detection (autocorrelation) ----------
function detectPitch(buf) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.01) return 0; // too quiet / unvoiced

  const minLag = Math.floor(SAMPLE_RATE / 300); // 80
  const maxLag = Math.floor(SAMPLE_RATE / 70);  // 342
  let c0 = 0;
  for (let i = 0; i < buf.length; i++) c0 += buf[i] * buf[i];
  let bestLag = -1, bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    const lim = buf.length - lag;
    for (let i = 0; i < lim; i++) corr += buf[i] * buf[i + lag];
    corr /= (c0 + 1e-9);
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  if (bestLag < 0 || bestCorr < 0.5) return 0;
  return SAMPLE_RATE / bestLag;
}

// ---------- Empty hint ----------
function showEmptyHint() {
  feed.innerHTML =
    '<div class="empty-hint">' +
    '<div class="big">▶ 시작 버튼을 누르세요</div>' +
    '미팅 소리(영어)가 들리면 화자별로<br/>실시간 한국어가 따라 올라옵니다.' +
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

    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
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
      level = Math.sqrt(sum / input.length);
      const p = detectPitch(input);
      if (p > 0) {
        curPitch = p;
        // Densely sample pitch into the currently-speaking item for a stable voiceprint.
        if (liveItemId) {
          const it = items.get(liveItemId);
          if (it) it.pitches.push(p);
        }
      }
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
  level = 0; curPitch = 0;
}

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
function setStatus(state, text) { statusEl.className = 'status ' + state; statusText.textContent = text; }

// Smart auto-scroll: follow newest text, but pause when the user scrolls up
// to read/copy. Resume on scroll-to-bottom or after 5s of no manual scroll.
let autoFollow = true;
let scrollIdleTimer = null;
function autoScroll() { if (autoFollow) feed.scrollTop = feed.scrollHeight; }
feed.addEventListener('scroll', () => {
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
  if (atBottom) {
    autoFollow = true;
    jumpBtn.classList.add('hidden');
  } else {
    autoFollow = false;
    jumpBtn.classList.remove('hidden');
    if (scrollIdleTimer) clearTimeout(scrollIdleTimer);
    scrollIdleTimer = setTimeout(() => { autoFollow = true; jumpBtn.classList.add('hidden'); feed.scrollTop = feed.scrollHeight; }, 5000);
  }
});
jumpBtn.addEventListener('click', () => { autoFollow = true; jumpBtn.classList.add('hidden'); feed.scrollTop = feed.scrollHeight; });

function nowClock() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function ensureItem(itemId) {
  if (items.has(itemId)) return items.get(itemId);
  const card = document.createElement('div');
  card.className = 'card live-card';

  const who = document.createElement('div');
  who.className = 'who';
  who.innerHTML = '<span class="av">·</span><span class="nm">…</span><span class="ts">' + nowClock() + '</span>';

  // Format: English text followed by Korean translation in parentheses, inline.
  const line = document.createElement('div');
  line.className = 'line';
  const enEl = document.createElement('span');
  enEl.className = 'en';
  const koEl = document.createElement('span');
  koEl.className = 'ko pending';
  koEl.textContent = '';
  line.appendChild(enEl);
  line.appendChild(document.createTextNode(' '));
  line.appendChild(koEl);

  card.appendChild(who);
  card.appendChild(line);
  feed.appendChild(card);
  autoScroll();

  const it = {
    card, whoEl: who, koEl, enEl,
    en: '', reqSeq: 0, curSeq: 0, koText: '', timer: null, lastSent: '',
    pitches: [], spk: null
  };
  items.set(itemId, it);
  return it;
}

function paintCardSpeaker(it) {
  if (!it.spk) return;
  const s = it.spk;
  it.card.classList.remove('spk-0', 'spk-1', 'spk-2', 'spk-3', 'spk-x');
  it.card.classList.add(spkClass(s));
  const av = it.whoEl.querySelector('.av');
  const nm = it.whoEl.querySelector('.nm');
  av.textContent = spkAvatarText(s);
  const g = genderKo(s.gender);
  nm.textContent = (s.name || ('화자 ' + SPK_LABELS[s.idx])) + (g ? ' · ' + g : '');
}

function refreshAllCards() {
  for (const it of items.values()) if (it.spk) paintCardSpeaker(it);
}

// ---------- Speaker chips ----------
function renderChips() {
  speakerChips.innerHTML = '';
  speakers.forEach((s) => {
    const chip = document.createElement('div');
    chip.className = 'chip ' + spkClass(s);
    chip.style.borderLeftColor = 'var(--spk)';

    const av = document.createElement('span');
    av.className = 'av';
    av.textContent = spkAvatarText(s);

    const gender = document.createElement('span');
    gender.className = 'gender';
    gender.textContent = genderIcon(s.gender);
    gender.title = '클릭하여 남/여 변경';
    gender.addEventListener('click', () => {
      s.manualGender = true;
      s.gender = s.gender === 'M' ? 'F' : s.gender === 'F' ? '?' : 'M';
      renderChips();
      refreshAllCards();
    });

    const name = document.createElement('input');
    name.className = 'name';
    name.placeholder = '이름 입력';
    name.value = s.name;
    name.addEventListener('input', () => { s.name = name.value; refreshAllCards(); });

    chip.appendChild(av);
    chip.appendChild(gender);
    chip.appendChild(name);
    speakerChips.appendChild(chip);
  });
}

// ---------- Debounced streaming translation ----------
function scheduleTranslate(itemId, isFinal) {
  const it = items.get(itemId);
  if (!it) return;
  if (it.timer) clearTimeout(it.timer);
  const fire = () => {
    if (!isFinal && it.en === it.lastSent) return;
    it.lastSent = it.en;
    it.reqSeq += 1;
    window.magic.requestTranslate({ itemId, text: it.en, seq: it.reqSeq, isFinal: !!isFinal });
  };
  if (isFinal) fire(); else it.timer = setTimeout(fire, 150);
}

// ---------- IPC events ----------
window.magic.onStatus((p) => setStatus(p.state, p.message));

window.magic.onSpeech((p) => {
  if (p.active) live.classList.add('speaking');
  else setTimeout(() => live.classList.remove('speaking'), 300);
});

window.magic.onTranscriptDelta((p) => {
  const it = ensureItem(p.itemId);
  liveItemId = p.itemId; // route dense pitch sampling to this item
  it.en += p.delta;
  it.enEl.textContent = it.en;
  // Tentative speaker (commit happens on final).
  if (!it.spk && speakers.length > 0) {
    const pm = medianPitch(it.pitches);
    if (pm > 0) {
      let best = null, bd = 1e9;
      for (const s of speakers) { if (s.n === 0) continue; const d = Math.abs(s.mean - pm); if (d < bd) { bd = d; best = s; } }
      if (best) { it.spk = best; paintCardSpeaker(it); }
    }
  }
  autoScroll();
  scheduleTranslate(p.itemId, false);
});

window.magic.onTranscriptFinal((p) => {
  const it = ensureItem(p.itemId);
  it.en = p.text;
  it.enEl.textContent = it.en;
  it.card.classList.remove('live-card');
  commitSpeaker(it); // final voice-based speaker assignment
  scheduleTranslate(p.itemId, true);
});

window.magic.onTranslationStart((p) => {
  const it = items.get(p.itemId);
  if (!it || p.seq < it.curSeq) return;
});
window.magic.onTranslationDelta((p) => {
  const it = items.get(p.itemId);
  if (!it || p.seq < it.curSeq) return;
  if (p.seq > it.curSeq) { it.curSeq = p.seq; it.koText = ''; }
  it.koText += p.delta;
  it.koEl.textContent = '(' + it.koText + ')';
  it.koEl.classList.remove('pending');
  autoScroll();
});
window.magic.onTranslationDone(() => {});

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

// ---------- Always-on-top ----------
ontopBtn.addEventListener('click', async () => {
  const on = await window.magic.toggleOnTop();
  ontopBtn.classList.toggle('active', !!on);
  ontopBtn.title = on ? '항상 위에 표시: 켜짐' : '항상 위에 표시 (오버레이)';
});

// ---------- Copy all transcript ----------
copyBtn.addEventListener('click', async () => {
  const lines = [];
  for (const it of items.values()) {
    if (!it.en) continue;
    const who = it.spk ? (it.spk.name || ('화자 ' + SPK_LABELS[it.spk.idx])) : '';
    const ko = it.koText ? ' (' + it.koText + ')' : '';
    lines.push((who ? who + ': ' : '') + it.en + ko);
  }
  const text = lines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    const old = copyBtn.textContent;
    copyBtn.textContent = '✓';
    setTimeout(() => { copyBtn.textContent = old; }, 1200);
  } catch (e) { /* clipboard may be unavailable */ }
});
