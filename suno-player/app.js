"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = t => (isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "0:00");

const audio = $("#audio"), video = $("#video"), full = $("#full"), stage = $("#stage");
const state = { songs: [], view: [], idx: -1, shuffle: false, repeat: "off", tag: "all", q: "", mode: "cover", lrc: null, lines: [], activeLine: -1, tab: "lyrics" };

/* ---------- Helpers: generated covers & colors ---------- */
const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
function genCover(title) {
  const h = hash(title), h1 = h % 360, h2 = (h1 + 50 + (h >> 8) % 90) % 360, a = (h >> 4) % 360;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'><defs><linearGradient id='g' gradientTransform='rotate(${a % 90 + 20})'><stop offset='0' stop-color='hsl(${h1} 80% 55%)'/><stop offset='1' stop-color='hsl(${h2} 85% 40%)'/></linearGradient></defs><rect width='400' height='400' fill='url(#g)'/><circle cx='${80 + h % 240}' cy='${80 + (h >> 6) % 240}' r='${90 + h % 60}' fill='hsl(${h2} 90% 70%)' opacity='.35'/><circle cx='${300 - (h >> 3) % 200}' cy='${320 - (h >> 9) % 160}' r='${60 + h % 50}' fill='hsl(${h1} 90% 75%)' opacity='.3'/><text x='200' y='225' font-size='120' text-anchor='middle' fill='white' opacity='.85' font-family='sans-serif'>♪</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
const accentFor = s => { const h = hash(s.title) % 360; return [`hsl(${h} 80% 60%)`, `hsl(${(h + 60) % 360} 85% 60%)`]; };

function extractColors(img, song) {
  try {
    const c = document.createElement("canvas"); c.width = c.height = 24;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, 24, 24);
    const d = x.getImageData(0, 0, 24, 24).data;
    let best = null, bestScore = -1, second = null;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0, sc = sat * (mx / 255);
      if (sc > bestScore) { second = best; bestScore = sc; best = [r, g, b]; }
    }
    if (best && bestScore > .25) {
      const a = `rgb(${best})`, b = `rgb(${(second || best)})`;
      applyAccent(a, b); return;
    }
  } catch { /* cross-origin canvas: fall back */ }
  applyAccent(...accentFor(song));
}
function applyAccent(a, b) {
  const r = document.documentElement.style;
  r.setProperty("--accent", a); r.setProperty("--accent2", b);
}

/* ---------- Load ---------- */
async function init() {
  let data;
  try { data = await (await fetch("songs.json", { cache: "no-cache" })).json(); }
  catch { $("#grid").innerHTML = `<p class="empty">No se pudo cargar songs.json (¿abres el archivo con doble clic? usa un servidor local, ver README).</p>`; return; }
  const site = data.site || {};
  $("#siteTitle").textContent = site.title || "Mi Música";
  $("#siteSub").textContent = site.subtitle || "";
  document.title = site.title || "Mi Música";
  state.songs = (data.songs || []).map((s, i) => ({ id: s.id || `s${i}`, ...s, cover: s.cover || genCover(s.title || "?"), tags: s.tags || [] }));
  state.view = state.songs.slice();
  buildChips(); render();
  const id = new URLSearchParams(location.search).get("song") || location.hash.slice(1);
  const i = state.songs.findIndex(s => s.id === id);
  if (i >= 0) play(state.view.indexOf(state.songs[i]), false);
}

function buildChips() {
  const tags = [...new Set(state.songs.flatMap(s => s.tags))].sort();
  $("#chips").innerHTML = ["all", ...tags].map(t => `<button data-tag="${esc(t)}" class="${t === state.tag ? "on" : ""}">${t === "all" ? "Todas" : esc(t)}</button>`).join("");
}

function applyFilter() {
  const q = state.q.toLowerCase();
  const cur = state.view[state.idx];
  state.view = state.songs.filter(s => (state.tag === "all" || s.tags.includes(state.tag)) && (!q || (s.title + " " + s.tags.join(" ") + " " + (s.lyrics || "")).toLowerCase().includes(q)));
  state.idx = cur ? state.view.indexOf(cur) : -1;
  render();
}

function render() {
  const g = $("#grid");
  g.innerHTML = state.view.map((s, i) => {
    const [c] = accentFor(s);
    return `<button class="card" style="--i:${Math.min(i, 20)};--c:${c}" data-i="${i}" aria-label="Reproducir ${esc(s.title)}">
      <div class="art"><img loading="lazy" src="${esc(s.cover)}" alt="">${s.video ? `<span class="badge">🎬 Vídeo</span>` : ""}
      <span class="eq"><i></i><i></i><i></i></span><span class="play">▶</span></div>
      <h3>${esc(s.title)}</h3><small>${esc(s.tags.slice(0, 3).join(" · ") || "&nbsp;")}</small></button>`;
  }).join("");
  $("#empty").hidden = state.view.length > 0;
  markCurrent(); renderQueue();
}
function markCurrent() {
  $$(".card").forEach(c => { const on = +c.dataset.i === state.idx; c.classList.toggle("current", on); c.classList.toggle("playing", on && !audio.paused); });
}

/* 3D tilt on cards */
$("#grid").addEventListener("pointermove", e => {
  const c = e.target.closest(".card"); if (!c || e.pointerType !== "mouse") return;
  const r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
  c.style.transform = `translateY(-6px) rotateX(${-y * 8}deg) rotateY(${x * 8}deg)`;
});
$("#grid").addEventListener("pointerout", e => { const c = e.target.closest(".card"); if (c) c.style.transform = ""; });
$("#grid").addEventListener("click", e => {
  const c = e.target.closest(".card"); if (!c) return;
  const i = +c.dataset.i;
  if (i === state.idx) { toggle(); openFull(); } else { play(i); openFull(); }
});

/* ---------- Demo audio (sintetizado, solo para probar la web sin archivos) ---------- */
const demoCache = {};
function demoWav(spec) {
  if (demoCache[spec]) return demoCache[spec];
  const [, bpm, ...notes] = spec.split(":").map(Number), sr = 22050, secs = 32, n = sr * secs, beat = 60 / bpm, pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr, k = Math.floor(t / beat * 2), f = notes[k % notes.length], ph = (t % (beat / 2)) / (beat / 2), b = (t % beat) / beat;
    const lead = (Math.sin(6.2832 * f * t) + .4 * Math.sin(12.566 * f * t)) * Math.exp(-3 * ph);
    const bass = Math.sin(6.2832 * notes[(k >> 2 << 2) % notes.length] / 4 * t) * .5;
    const kick = Math.sin(6.2832 * 60 * t * Math.exp(-8 * b)) * Math.exp(-6 * b) * .9;
    pcm[i] = Math.max(-1, Math.min(1, (lead * .35 + bass * .25 + kick * .4) * Math.min(1, t * 4) * Math.min(1, (secs - t) * 2))) * 20000;
  }
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), w = (o, s) => [...s].forEach((c, j) => v.setUint8(o + j, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return demoCache[spec] = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

/* ---------- Playback ---------- */
function play(i, autoplay = true) {
  if (!state.view.length) return;
  i = (i + state.view.length) % state.view.length;
  const s = state.view[i]; state.idx = i;
  let src = s.audio || s.video;
  if (src && src.startsWith("demo:")) src = demoWav(src);
  if (!src) return;
  audio.src = src; audio.currentTime = 0;
  setupAnalyser(src);
  if (autoplay) audio.play().catch(() => {});
  loadVideo(s); setMeta(s); markCurrent(); renderQueue();
  history.replaceState(null, "", "#" + s.id);
}

function setMeta(s) {
  $("#mini").hidden = false;
  $("#miniCover").src = s.cover; $("#miniTitle").textContent = s.title; $("#miniTags").textContent = s.tags.join(" · ");
  $("#fullTitle").textContent = s.title; $("#fullTags").textContent = s.tags.join(" · ");
  const l = $("#sunoLink"); l.hidden = !s.suno; if (s.suno) l.href = s.suno;
  document.title = `${s.title} · ${$("#siteTitle").textContent}`;

  const swap = () => {
    const fc = $("#fullCover"); fc.src = s.cover;
    const bg = $$(".bg-img"), next = bg.find(b => !b.classList.contains("on")) || bg[0], prev = bg.find(b => b !== next);
    next.style.backgroundImage = `url("${s.cover}")`; next.classList.add("on"); prev.classList.remove("on");
    const probe = new Image(); if (!/^data:|^blob:/.test(s.cover) && new URL(s.cover, location.href).origin !== location.origin) { applyAccent(...accentFor(s)); }
    else { probe.onload = () => extractColors(probe, s); probe.src = s.cover; if (/^data:/.test(s.cover)) applyAccent(...accentFor(s)); }
  };
  document.startViewTransition && full.classList.contains("open") ? document.startViewTransition(swap) : swap();

  const hasVid = !!s.video;
  $$("#modes button").forEach(b => { if (b.dataset.mode === "video") b.disabled = !hasVid; });
  setMode(hasVid ? "video" : (state.mode === "video" ? "cover" : state.mode));
  parseLyrics(s.lyrics || "");
  if ("mediaSession" in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.artist || $("#siteTitle").textContent, artwork: /^data:/.test(s.cover) ? [] : [{ src: s.cover }] });
  }
}

function loadVideo(s) {
  video.pause();
  if (s.video) { video.src = s.video; video.load(); syncVideo(true); } else { video.removeAttribute("src"); video.load(); }
}
function syncVideo(force) {
  if (!video.src || video.readyState < 1) return;
  if (force || Math.abs(video.currentTime - audio.currentTime) > .35) { try { video.currentTime = audio.currentTime; } catch {} }
  if (audio.paused) video.pause(); else if (video.paused) video.play().catch(() => {});
}
video.addEventListener("loadedmetadata", () => {
  stage.classList.toggle("wide", video.videoWidth > video.videoHeight * 1.2 && state.mode === "video");
  syncVideo(true);
});

function toggle() { audio.paused ? audio.play().catch(() => {}) : audio.pause(); }
function next(auto) {
  if (!state.view.length) return;
  if (auto && state.repeat === "one") { audio.currentTime = 0; audio.play(); return; }
  let i = state.idx + 1;
  if (state.shuffle && state.view.length > 1) { do { i = Math.floor(Math.random() * state.view.length); } while (i === state.idx); }
  else if (i >= state.view.length) { if (auto && state.repeat === "off") { audio.pause(); return; } i = 0; }
  play(i);
}
function prev() { if (audio.currentTime > 3) audio.currentTime = 0; else play(state.idx - 1); }

audio.addEventListener("play", onPlayState);
audio.addEventListener("pause", onPlayState);
audio.addEventListener("ended", () => next(true));
audio.addEventListener("seeking", () => syncVideo(true));
audio.addEventListener("loadedmetadata", () => { $("#tDur").textContent = fmt(audio.duration); });
audio.addEventListener("error", () => { const s = state.view[state.idx]; if (s) $("#miniTags").textContent = "⚠ No se pudo cargar el audio"; });
audio.addEventListener("timeupdate", () => {
  const p = audio.duration ? audio.currentTime / audio.duration : 0;
  $("#miniBar").style.width = p * 100 + "%";
  const sk = $("#seek"); if (!seeking) { sk.value = p * 1000; sk.style.setProperty("--p", p * 100 + "%"); }
  $("#tCur").textContent = fmt(audio.currentTime);
  syncVideo(false); updateLyrics();
});
function onPlayState() {
  const p = audio.paused;
  $$('[data-act=toggle]').forEach(b => b.textContent = p ? "▶" : "⏸");
  stage.classList.toggle("playing", !p);
  markCurrent();
  if (!p) { audioCtx && audioCtx.state === "suspended" && audioCtx.resume(); startViz(); }
  syncVideo(false);
  if ("mediaSession" in navigator) navigator.mediaSession.playbackState = p ? "paused" : "playing";
}

let seeking = false;
const seek = $("#seek");
seek.addEventListener("input", () => { seeking = true; seek.style.setProperty("--p", seek.value / 10 + "%"); $("#tCur").textContent = fmt(seek.value / 1000 * audio.duration); });
seek.addEventListener("change", () => { audio.currentTime = seek.value / 1000 * audio.duration; seeking = false; });
const vol = $("#vol");
vol.addEventListener("input", () => { audio.volume = +vol.value; vol.style.setProperty("--p", vol.value * 100 + "%"); });
audio.volume = .9; vol.style.setProperty("--p", "90%");

document.addEventListener("click", e => {
  const a = e.target.closest("[data-act]"); if (!a) return;
  ({ toggle, next: () => next(false), prev })[a.dataset.act]();
});
$("#btnShuffle").onclick = e => { state.shuffle = !state.shuffle; e.currentTarget.classList.toggle("on", state.shuffle); };
$("#btnRepeat").onclick = e => {
  state.repeat = { off: "all", all: "one", one: "off" }[state.repeat];
  e.currentTarget.classList.toggle("on", state.repeat !== "off"); e.currentTarget.textContent = state.repeat === "one" ? "🔂" : "🔁";
};
$("#playAll").onclick = () => { state.shuffle = false; $("#btnShuffle").classList.remove("on"); play(0); openFull(); };
$("#shuffleAll").onclick = () => { state.shuffle = true; $("#btnShuffle").classList.add("on"); play(Math.floor(Math.random() * state.view.length)); openFull(); };

if ("mediaSession" in navigator) {
  const m = navigator.mediaSession;
  m.setActionHandler("play", () => audio.play()); m.setActionHandler("pause", () => audio.pause());
  m.setActionHandler("previoustrack", prev); m.setActionHandler("nexttrack", () => next(false));
  m.setActionHandler("seekto", d => { audio.currentTime = d.seekTime; });
}

/* ---------- Full player open/close ---------- */
function openFull() {
  if (state.idx < 0) return;
  const go = () => { full.hidden = false; requestAnimationFrame(() => full.classList.add("open")); };
  go(); document.body.style.overflow = "hidden"; startViz();
}
function closeFull() {
  if (document.fullscreenElement) document.exitFullscreen();
  full.classList.remove("open"); document.body.style.overflow = "";
  setTimeout(() => { if (!full.classList.contains("open")) full.hidden = true; }, 700);
}
$("#miniOpen").onclick = openFull;
$("#closeFull").onclick = closeFull;
$("#btnFs").onclick = () => document.fullscreenElement ? document.exitFullscreen() : full.requestFullscreen?.();

/* ---------- Modes & tabs ---------- */
function setMode(m) {
  state.mode = m; stage.dataset.mode = m;
  $$("#modes button").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
  stage.classList.toggle("wide", m === "video" && video.videoWidth > video.videoHeight * 1.2);
  if (m === "video") syncVideo(true);
}
$("#modes").addEventListener("click", e => { const b = e.target.closest("button"); if (b && !b.disabled) setMode(b.dataset.mode); });
$("#tabs").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return; state.tab = b.dataset.tab;
  $$("#tabs button").forEach(x => x.classList.toggle("on", x === b));
  $("#lyrics").hidden = state.tab !== "lyrics"; $("#queue").hidden = state.tab !== "queue";
});

function renderQueue() {
  $("#queue").innerHTML = state.view.map((s, i) => `<button class="q ${i === state.idx ? "current" : ""}" data-i="${i}"><img src="${esc(s.cover)}" alt=""><span><b>${esc(s.title)}</b><small>${esc(s.tags.slice(0, 3).join(" · "))}</small></span></button>`).join("");
}
$("#queue").addEventListener("click", e => { const q = e.target.closest(".q"); if (q) play(+q.dataset.i); });

/* ---------- Lyrics (plain or LRC-synced) ---------- */
function parseLyrics(text) {
  const el = $("#lyrics"); state.activeLine = -1; state.lines = [];
  if (!text.trim()) { el.className = "panel"; el.innerHTML = `<p class="none">Sin letra para esta canción.</p>`; return; }
  const re = /\[(\d+):(\d+(?:[.,]\d+)?)\]/g, rows = [];
  let synced = false;
  for (const raw of text.split(/\r?\n/)) {
    const times = [...raw.matchAll(re)].map(m => +m[1] * 60 + parseFloat(m[2].replace(",", ".")));
    const line = raw.replace(re, "").trim();
    if (times.length) { synced = true; times.forEach(t => rows.push({ t, line })); }
    else rows.push({ t: null, line });
  }
  if (synced) {
    const lines = rows.filter(r => r.t !== null && r.line).sort((a, b) => a.t - b.t);
    state.lines = lines.map(l => l.t);
    el.className = "panel synced";
    el.innerHTML = lines.map((l, i) => `<p class="ln" data-i="${i}">${esc(l.line)}</p>`).join("");
    $$(".ln", el).forEach(p => p.onclick = () => { audio.currentTime = state.lines[+p.dataset.i]; });
  } else {
    el.className = "panel plain";
    el.innerHTML = rows.map(r => !r.line ? `<div class="gap"></div>` : /^\[.*\]$/.test(r.line) ? `<div class="sec">${esc(r.line.slice(1, -1))}</div>` : `<p class="ln">${esc(r.line)}</p>`).join("");
  }
  el.scrollTop = 0;
}
function updateLyrics() {
  const el = $("#lyrics"); if (full.hidden) return;
  if (state.lines.length) {
    const t = audio.currentTime + .15; let i = -1;
    for (let k = 0; k < state.lines.length; k++) { if (state.lines[k] <= t) i = k; else break; }
    if (i === state.activeLine) return; state.activeLine = i;
    $$(".ln", el).forEach((p, k) => { p.classList.toggle("active", k === i); p.classList.toggle("past", k < i); });
    const a = el.children[i]; if (a) el.scrollTo({ top: a.offsetTop - el.clientHeight / 2 + a.clientHeight / 2 });
  } else if (audio.duration && el.classList.contains("plain")) {
    el.scrollTop = (audio.currentTime / audio.duration) * (el.scrollHeight - el.clientHeight);
  }
}

/* ---------- Audio visualizer ---------- */
let audioCtx, analyser, freq, useAnalyser = false, raf = 0, connected = false;
function setupAnalyser(src) {
  const same = new URL(src, location.href).origin === location.origin;
  useAnalyser = same;
  if (same && !connected) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const node = audioCtx.createMediaElementSource(audio);
      analyser = audioCtx.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = .82;
      node.connect(analyser); analyser.connect(audioCtx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount); connected = true;
    } catch { useAnalyser = false; }
  }
  if (connected && !same) useAnalyser = false; // ya conectado: no se puede desconectar; se simula
}
const viz = $("#viz"), vx = viz.getContext("2d");
function startViz() { if (!raf) raf = requestAnimationFrame(drawViz); }
function drawViz(t) {
  raf = 0;
  if (full.hidden || (audio.paused && !full.classList.contains("open"))) return;
  const w = viz.width = viz.clientWidth * devicePixelRatio, h = viz.height = viz.clientHeight * devicePixelRatio;
  vx.clearRect(0, 0, w, h);
  const N = 64, vals = new Array(N);
  if (useAnalyser && analyser) { analyser.getByteFrequencyData(freq); for (let i = 0; i < N; i++) vals[i] = freq[Math.floor(Math.pow(i / N, 1.6) * freq.length * .7)] / 255; }
  else for (let i = 0; i < N; i++) vals[i] = audio.paused ? .04 : .25 + .35 * Math.abs(Math.sin(t / 380 + i * .4) * Math.cos(t / 900 + i * .17)) + .1 * Math.random();
  const cs = getComputedStyle(document.documentElement), a = cs.getPropertyValue("--accent"), b = cs.getPropertyValue("--accent2");
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * .24, bass = (vals[1] + vals[2] + vals[3]) / 3;
  const g = vx.createLinearGradient(0, 0, w, h); g.addColorStop(0, a); g.addColorStop(1, b);
  vx.lineCap = "round"; vx.strokeStyle = g; vx.lineWidth = Math.max(3, w / 130);
  for (let i = 0; i < N; i++) {
    const ang = i / N * Math.PI * 2 - Math.PI / 2, len = vals[i] * R * 1.3 + 4;
    vx.beginPath(); vx.moveTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); vx.lineTo(cx + Math.cos(ang) * (R + len), cy + Math.sin(ang) * (R + len)); vx.stroke();
  }
  vx.beginPath(); vx.arc(cx, cy, R * (.92 + bass * .12), 0, 7); vx.fillStyle = "rgba(255,255,255,.08)"; vx.fill(); vx.stroke();
  vx.font = `${R * .8}px sans-serif`; vx.textAlign = "center"; vx.textBaseline = "middle"; vx.fillStyle = "rgba(255,255,255,.9)"; vx.fillText("♪", cx, cy + R * .05);
  if (!full.hidden) raf = requestAnimationFrame(drawViz);
}

/* ---------- Search, chips, keyboard ---------- */
$("#search").addEventListener("input", e => { state.q = e.target.value.trim(); applyFilter(); });
$("#chips").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return; state.tag = b.dataset.tag;
  $$("#chips button").forEach(x => x.classList.toggle("on", x === b)); applyFilter();
});
document.addEventListener("keydown", e => {
  if (e.target.matches("input[type=search]") || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === " " && !e.target.closest("button")) { e.preventDefault(); toggle(); }
  else if (k === "arrowright") audio.currentTime += 5;
  else if (k === "arrowleft") audio.currentTime -= 5;
  else if (k === "n") next(false); else if (k === "p") prev();
  else if (k === "escape" && !document.fullscreenElement) closeFull();
  else if (k === "f") $("#btnFs").click();
  else if (k === "s") $("#btnShuffle").click();
  else if (k === "r") $("#btnRepeat").click();
  else if (k === "l") $('#tabs [data-tab=lyrics]').click();
});

init();
