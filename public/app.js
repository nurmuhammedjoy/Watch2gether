'use strict';

const socket = io();

// ── State ──────────────────────────────────────────────
let myRoomId   = null;
let myName     = 'Guest';
let isSyncing  = false;   // suppress re-emit while applying remote events
let lastSeekT  = -1;      // deduplicate our own seek broadcasts
let ctrlTimer  = null;

// ── DOM ────────────────────────────────────────────────
const $id = id => document.getElementById(id);

const lobbyEl      = $id('lobby');
const roomEl       = $id('room');
const video        = $id('video');
const emptyState   = $id('empty-state');
const playerWrap   = $id('player-wrap');
const progressWrap = $id('progress-wrap');
const progressFill = $id('progress-fill');
const progressBuf  = $id('progress-buf');
const progressThumb= $id('progress-thumb');
const btnPlay      = $id('btn-play');
const iconPlay     = $id('icon-play');
const iconPause    = $id('icon-pause');
const btnMute      = $id('btn-mute');
const iconVol      = $id('icon-vol');
const iconMute     = $id('icon-mute');
const volSlider    = $id('volume');
const timeCur      = $id('time-cur');
const timeDur      = $id('time-dur');
const syncPill     = $id('sync-pill');
const chatFeed     = $id('chat-feed');
const chatInput    = $id('chat-input');
const memberCount  = $id('member-count');
const roomIdLabel  = $id('room-id-label');
const videoUrlInput= $id('video-url');

// ── Helpers ────────────────────────────────────────────
function fmt(sec) {
  if (!isFinite(sec) || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = String(Math.floor(sec % 60)).padStart(2, '0');
  return `${m}:${s}`;
}

function toast(msg, cls = '') {
  const el = document.createElement('div');
  el.className = `toast${cls ? ' ' + cls : ''}`;
  el.textContent = msg;
  $id('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function normalizeVideoUrl(input) {
  const candidates = input.split(/[\s,]+/).filter(Boolean);
  for (const candidate of candidates) {
    try {
      return new URL(candidate).toString();
    } catch {}
  }
  return '';
}

let pillTimer;
function pill(msg) {
  syncPill.textContent = msg;
  syncPill.classList.add('show');
  clearTimeout(pillTimer);
  pillTimer = setTimeout(() => syncPill.classList.remove('show'), 2200);
}

function setScreen(name) {
  lobbyEl.classList.toggle('active', name === 'lobby');
  roomEl.classList.toggle('active',  name === 'room');
}

function setPlayUI(playing) {
  iconPlay.style.display  = playing ? 'none'  : 'block';
  iconPause.style.display = playing ? 'block' : 'none';
}

function setVolUI() {
  const muted = video.muted || video.volume === 0;
  iconVol.style.display  = muted ? 'none'  : 'block';
  iconMute.style.display = muted ? 'block' : 'none';
}

// ── Lobby tabs ─────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $id(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ── Create room ────────────────────────────────────────
$id('btn-create').addEventListener('click', async () => {
  const name = $id('create-name').value.trim() || 'Guest';
  const res  = await fetch('/api/rooms', { method: 'POST' });
  const { roomId } = await res.json();
  joinRoom(roomId, name);
});

// ── Join room ──────────────────────────────────────────
$id('btn-join').addEventListener('click', () => {
  const name = $id('join-name').value.trim() || 'Guest';
  const rid  = $id('join-room-id').value.trim().toUpperCase();
  if (!rid) { toast('Enter a Room ID'); return; }
  joinRoom(rid, name);
});

// ── Enter room ─────────────────────────────────────────
function joinRoom(roomId, name) {
  myRoomId = roomId;
  myName   = name;
  roomIdLabel.textContent = roomId;
  setScreen('room');
  socket.emit('join-room', { roomId, name });
}

// ── Invite link in URL ─────────────────────────────────
(function checkUrl() {
  const rid = new URLSearchParams(location.search).get('room');
  if (rid) {
    $id('join-room-id').value = rid.toUpperCase();
    document.querySelector('[data-tab="join"]').click();
  }
})();

// ── Copy invite link ───────────────────────────────────
$id('btn-copy-link').addEventListener('click', () => {
  navigator.clipboard.writeText(`${location.origin}?room=${myRoomId}`)
    .then(() => toast('Invite link copied', 'ok'));
});

// ── Leave ──────────────────────────────────────────────
$id('btn-leave').addEventListener('click', () => { location.href = '/'; });

// Load videos
$id('btn-load-video').addEventListener('click', loadVideo);
videoUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') loadVideo(); });

function loadVideo() {
  const raw = videoUrlInput.value.trim();
  if (!raw) return;
  const url = normalizeVideoUrl(raw);
  if (!url) {
    toast('Paste a direct video URL (.mp4, .webm, .mov)');
    return;
  }
  socket.emit('set-video', { url });
  applyVideo(url, 0);
}

function applyVideo(url, startTime) {
  videoUrlInput.value = url;
  emptyState.classList.add('hidden');
  video.classList.remove('ready');

  // Reset state
  video.pause();
  video.removeAttribute('src');
  video.load();

  video.src = url;
  video.load();

  const setReady = () => {
    video.classList.add('ready');
  };

  const onMeta = () => {
    if (startTime > 0) video.currentTime = startTime;
    timeDur.textContent = fmt(video.duration);
    setReady();
  };

  const onError = () => {
    emptyState.classList.remove('hidden');
    video.classList.remove('ready');
    setPlayUI(false);
    toast('Video failed to load. Make sure the URL is public and CORS-enabled.');
  };

  if (video.readyState >= 1) onMeta();
  else video.addEventListener('loadedmetadata', onMeta, { once: true });

  if (video.readyState >= 2) setReady();
  else video.addEventListener('loadeddata', setReady, { once: true });

  video.addEventListener('error', onError, { once: true });
}

// ── Socket: room state on join ─────────────────────────
socket.on('room-state', ({ videoUrl, playing, currentTime, isHost, memberCount: count }) => {
  memberCount.textContent = count;
  sysMsg(isHost ? 'You created this room' : 'Joined the room');

  if (videoUrl) {
    applyVideo(videoUrl, currentTime);
    if (playing) {
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(() => {});
        setPlayUI(true);
      }, { once: true });
    }
  }
});

socket.on('promoted-to-host', () => toast('You are now the host', 'ok'));

socket.on('video-changed', ({ url }) => {
  applyVideo(url, 0);
  setPlayUI(false);
  sysMsg('Video updated');
});

// Remote play — only apply to other users (isSyncing guard)
socket.on('play', ({ currentTime }) => {
  isSyncing = true;
  if (Math.abs(video.currentTime - currentTime) > 1.5) video.currentTime = currentTime;
  video.play().catch(() => {});
  setPlayUI(true);
  pill('▶ Playing');
  setTimeout(() => { isSyncing = false; }, 400);
});

socket.on('pause', ({ currentTime }) => {
  isSyncing = true;
  video.currentTime = currentTime;
  video.pause();
  setPlayUI(false);
  pill('⏸ Paused');
  setTimeout(() => { isSyncing = false; }, 400);
});

socket.on('seek', ({ currentTime }) => {
  isSyncing = true;
  video.currentTime = currentTime;
  pill(`⏩ ${fmt(currentTime)}`);
  setTimeout(() => { isSyncing = false; }, 400);
});

socket.on('sync-response', ({ currentTime, playing }) => {
  const drift = Math.abs(video.currentTime - currentTime);
  if (drift > 2) {
    video.currentTime = currentTime;
    pill(`Synced · ${drift.toFixed(1)}s drift`);
  } else {
    pill('In sync ✓');
  }
  if (playing && video.paused)   video.play().catch(() => {});
  if (!playing && !video.paused) video.pause();
});

socket.on('member-count', ({ count }) => { memberCount.textContent = count; });

socket.on('user-joined', ({ name, memberCount: c }) => {
  sysMsg(`${name} joined`);
  memberCount.textContent = c;
});
socket.on('user-left', ({ name, memberCount: c }) => {
  sysMsg(`${name} left`);
  memberCount.textContent = c;
});
socket.on('chat', ({ name, message, time }) => addMsg(name, message, time));

// ── Video → socket (only if we triggered it) ──────────
video.addEventListener('play', () => {
  setPlayUI(true);
  if (isSyncing) return;
  socket.emit('play', { currentTime: video.currentTime });
});

video.addEventListener('pause', () => {
  setPlayUI(false);
  if (isSyncing) return;
  socket.emit('pause', { currentTime: video.currentTime });
});

video.addEventListener('seeked', () => {
  if (isSyncing) return;
  const t = video.currentTime;
  if (Math.abs(t - lastSeekT) < 0.5) return;
  lastSeekT = t;
  socket.emit('seek', { currentTime: t });
});

video.addEventListener('timeupdate', updateProgress);
video.addEventListener('loadedmetadata', () => { timeDur.textContent = fmt(video.duration); });
video.addEventListener('progress', updateBuffer);

// ── Playback controls ──────────────────────────────────
btnPlay.addEventListener('click', togglePlay);
playerWrap.addEventListener('click', e => {
  // don't trigger on progress bar or buttons
  if (e.target.closest('.controls')) return;
  togglePlay();
});

function togglePlay() {
  if (video.paused) video.play().catch(() => {});
  else video.pause();
}

// Mute
btnMute.addEventListener('click', () => {
  video.muted = !video.muted;
  setVolUI();
});
volSlider.addEventListener('input', () => {
  video.volume = volSlider.value;
  video.muted  = video.volume === 0;
  setVolUI();
});

// ── Progress bar ───────────────────────────────────────
function updateProgress() {
  if (!video.duration) return;
  const pct = video.currentTime / video.duration;
  progressFill.style.width  = `${pct * 100}%`;
  progressThumb.style.left  = `${pct * 100}%`;
  timeCur.textContent = fmt(video.currentTime);
}

function updateBuffer() {
  if (!video.duration || !video.buffered.length) return;
  const end = video.buffered.end(video.buffered.length - 1);
  progressBuf.style.width = `${(end / video.duration) * 100}%`;
}

// Seek on progress bar click/drag
let seeking = false;

progressWrap.addEventListener('mousedown',  e => { seeking = true; doSeek(e); e.stopPropagation(); });
progressWrap.addEventListener('touchstart', e => { seeking = true; doSeek(e); e.stopPropagation(); }, { passive: true });

document.addEventListener('mousemove',  e => { if (seeking) doSeek(e); });
document.addEventListener('touchmove',  e => { if (seeking) doSeek(e); }, { passive: true });
document.addEventListener('mouseup',    () => { seeking = false; });
document.addEventListener('touchend',   () => { seeking = false; });

function doSeek(e) {
  const rect  = progressWrap.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const pct   = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  video.currentTime = pct * video.duration;
  updateProgress();
}

// ── Fullscreen ─────────────────────────────────────────
$id('btn-fs').addEventListener('click', toggleFs);

function toggleFs() {
  if (!document.fullscreenElement) playerWrap.requestFullscreen();
  else document.exitFullscreen();
}

document.addEventListener('fullscreenchange', () => {
  const fs = !!document.fullscreenElement;
  $id('icon-expand').style.display   = fs ? 'none'  : 'block';
  $id('icon-compress').style.display = fs ? 'block' : 'none';
});

// ── Re-sync button ─────────────────────────────────────
$id('btn-sync').addEventListener('click', () => {
  socket.emit('sync-request');
  pill('Syncing…');
});

// ── Auto-hide controls ─────────────────────────────────
playerWrap.addEventListener('mousemove', showCtrl);
playerWrap.addEventListener('touchstart', showCtrl, { passive: true });

function showCtrl() {
  playerWrap.classList.add('show-ctrl');
  clearTimeout(ctrlTimer);
  ctrlTimer = setTimeout(() => {
    if (!video.paused) playerWrap.classList.remove('show-ctrl');
  }, 2800);
}

video.addEventListener('pause', () => playerWrap.classList.add('show-ctrl'));
video.addEventListener('play',  showCtrl);

// ── Keyboard ───────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (!myRoomId) return;
  if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key === ' ')           { e.preventDefault(); togglePlay(); }
  if (e.key === 'ArrowRight')  { video.currentTime += 5; }
  if (e.key === 'ArrowLeft')   { video.currentTime -= 5; }
  if (e.key === 'm' || e.key === 'M') { btnMute.click(); }
  if (e.key === 'f' || e.key === 'F') { toggleFs(); }
});

// ── Chat ───────────────────────────────────────────────
$id('btn-send').addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

function sendChat() {
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit('chat', { message: msg });
  chatInput.value = '';
}

function addMsg(name, text, time) {
  const el = document.createElement('div');
  el.className = 'msg';
  el.innerHTML = `
    <div class="msg-meta">
      <span class="msg-name">${esc(name)}</span>
      <span class="msg-time">${time}</span>
    </div>
    <div class="msg-text">${esc(text)}</div>`;
  chatFeed.appendChild(el);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function sysMsg(text) {
  const el = document.createElement('div');
  el.className = 'msg sys';
  el.textContent = text;
  chatFeed.appendChild(el);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Periodic background sync (every 12 s while playing) ──
setInterval(() => {
  if (myRoomId && !video.paused) socket.emit('sync-request');
}, 12000);
