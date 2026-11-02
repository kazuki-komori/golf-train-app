import { SwingDetector, DEFAULT_SETTINGS, LEVELS, rateToVec, simulateSwing } from './engine.js';
import { coachTips, describeShot, describeImpact, sides } from './coach.js';
import { flightFromSwing, shapeOf } from './flight.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'gst.settings.v1';
const HIST_KEY = 'gst.history.v1';

// ---------- 設定 ----------
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s) return { ...DEFAULT_SETTINGS, ...s, checks: { ...DEFAULT_SETTINGS.checks, ...s.checks } };
  } catch {}
  return structuredClone(DEFAULT_SETTINGS);
}
let settings = loadSettings();
const form = $('settings');

function writeForm() {
  form.handed.value = settings.handed;
  form.club.value = settings.club;
  form.level.value = settings.level;
  form.face.checked = settings.checks.face;
  form.tempo.checked = settings.checks.tempo;
  form.plane.checked = settings.checks.plane;
  form.path.checked = settings.checks.path;
  form.targetTempo.value = settings.targetTempo.toFixed(1);
  form.goalStreak.value = settings.goalStreak;
  form.voice.checked = settings.voice;
  form.rhythmGuide.checked = settings.rhythmGuide;
  form.invertFace.checked = settings.invertFace;
}
function readForm() {
  const clamp = (v, a, b, d) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d);
  settings = {
    handed: form.handed.value,
    club: form.club.value,
    level: form.level.value,
    checks: { face: form.face.checked, tempo: form.tempo.checked, plane: form.plane.checked, path: form.path.checked },
    targetTempo: clamp(parseFloat(form.targetTempo.value), 2, 4, 3),
    goalStreak: Math.round(clamp(parseFloat(form.goalStreak.value), 1, 20, 5)),
    voice: form.voice.checked,
    rhythmGuide: form.rhythmGuide.checked,
    invertFace: form.invertFace.checked,
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(settings));
}
writeForm();
form.addEventListener('change', readForm);

// ---------- 音・声・振動 ----------
let ac = null;
function audio() {
  if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
function tone(freq, dur = 0.12, type = 'sine', gain = 0.35, when = 0) {
  const a = audio();
  const t = a.currentTime + when;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const sfx = {
  address: () => tone(1320, 0.1),
  top: () => tone(660, 0.05, 'triangle', 0.2),
  pass: () => { tone(880, 0.12); tone(1175, 0.12, 'sine', 0.35, 0.12); tone(1568, 0.25, 'sine', 0.35, 0.24); },
  fail: () => { tone(160, 0.45, 'sawtooth', 0.4); tone(150, 0.45, 'square', 0.15); },
  goal: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.2, 'sine', 0.3, i * 0.13)),
};
function say(text) {
  if (!settings.voice || !text || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  u.rate = 1.1;
  speechSynthesis.speak(u);
}
const buzz = (p) => navigator.vibrate && navigator.vibrate(p);

let rhythmTimer = null;
function playRhythm() {
  clearTimeout(rhythmTimer);
  const back = 0.75;
  const down = back / settings.targetTempo;
  rhythmTimer = setTimeout(() => {
    tone(880, 0.08, 'triangle', 0.3, 0);
    tone(880, 0.08, 'triangle', 0.3, back);
    tone(1320, 0.1, 'triangle', 0.35, back + down);
  }, 500);
}

// ---------- 画面 ----------
const stage = $('stage');
function setStage(mode, main, sub = '') {
  stage.dataset.mode = mode;
  $('stageMain').textContent = main;
  $('stageSub').textContent = sub;
}

let streak = 0;
let history = loadHistory();
function loadHistory() {
  try {
    const h = JSON.parse(localStorage.getItem(HIST_KEY));
    if (h && h.date === new Date().toDateString()) return h.items;
  } catch {}
  return [];
}
function saveHistory() {
  localStorage.setItem(HIST_KEY, JSON.stringify({ date: new Date().toDateString(), items: history.slice(-200) }));
}

function renderStreak() {
  $('streakNum').textContent = streak;
  $('goalNum').textContent = settings.goalStreak;
}

function renderHistory() {
  const list = $('histList');
  list.innerHTML = '';
  history.slice(-40).forEach((h, i, arr) => {
    const li = document.createElement('li');
    li.className = h.pass ? 'ok' : 'ng';
    li.textContent = history.length - arr.length + i + 1;
    li.title = h.pass ? '合格' : '不合格';
    list.appendChild(li);
  });
  if (!history.length) {
    $('histSummary').textContent = 'まだ記録がありません。構えて素振りしてください。';
    return;
  }
  const n = history.length;
  const ok = history.filter((h) => h.pass).length;
  const avg = (k) => history.reduce((a, h) => a + h[k], 0) / n;
  $('histSummary').textContent =
    `${n}回中 ${ok}回合格（${Math.round((ok / n) * 100)}%）。平均テンポ ${avg('tempo').toFixed(1)}:1、` +
    `平均フェース ${avg('face') >= 0 ? '開き' : '閉じ'}${Math.abs(avg('face')).toFixed(1)}°`;
}

function renderCard(r) {
  $('card').hidden = false;
  const body = $('scoreBody');
  body.innerHTML = '';
  for (const c of r.checks) {
    const tr = document.createElement('tr');
    tr.className = c.pass ? 'ok' : 'ng';
    tr.innerHTML = `<td class="mark">${c.pass ? '○' : '×'}</td>
      <td><span class="name"></span><span class="msg"></span></td>
      <td class="val"><span class="v"></span><span class="lim"></span></td>`;
    tr.querySelector('.name').textContent = c.name;
    tr.querySelector('.msg').textContent = c.msg;
    tr.querySelector('.v').textContent = c.value;
    tr.querySelector('.lim').textContent = c.limit;
    body.appendChild(tr);
  }
  if (!r.checks.length) {
    body.innerHTML = '<tr><td>判定する項目がありません。設定で1つ以上選んでください。</td></tr>';
  }
  const { lead, trail } = sides(settings.handed);
  const lr = (v) => (v > 0 ? trail : lead); // + = 体から離れる側
  const deg = (v) => `${Math.abs(v).toFixed(1)}°`;
  $('xPath').textContent =
    r.clubPath == null ? '-' : Math.abs(r.clubPath) < 0.5 ? 'まっすぐ' : `${r.clubPath > 0 ? 'イン→アウト' : 'アウト→イン'} ${deg(r.clubPath)}`;
  $('xFace').textContent = Math.abs(r.face) < 0.5 ? 'まっすぐ' : `${r.face > 0 ? '開き' : '閉じ'}（${lr(r.face)}向き） ${deg(r.face)}`;
  const f2p = r.flight.curve;
  $('xF2P').textContent = r.clubPath == null ? '-' : `${lr(f2p)}回転 ${deg(f2p)}`;
  $('xAttack').textContent = r.attack == null ? '-' : `${r.attack < 0 ? '上から' : '下から'} ${deg(r.attack)}`;
  $('xHs').textContent = `約 ${Math.round(r.headSpeed)} m/s${r.saturated ? '（計測上限）' : ''}`;
  $('xTempo').textContent = `${r.tempo.toFixed(1)} : 1`;
  $('xBack').textContent = `${r.backTime.toFixed(2)} 秒`;
  $('xDown').textContent = `${r.downTime.toFixed(2)} 秒`;
  drawTrace(r);
  const fl = flightFromSwing(r, settings.club);
  const shape = shapeOf(fl);
  renderFlight(r, fl, shape);
  drawImpact(r);
  renderMatrix(shape);
  colorTiles(r);
  renderTips(r);
  render3D(r);
}

function colorTiles(r) {
  const lv = LEVELS[settings.level] || LEVELS.normal;
  const grade = (v, good, ok) => (v == null ? '' : Math.abs(v) <= good ? 'good' : Math.abs(v) <= ok ? 'warn' : 'bad');
  const g = {
    path: grade(r.clubPath, 2, lv.path),
    face: grade(r.face, 2, lv.face),
    f2p: r.clubPath == null ? '' : grade(r.face - r.clubPath, 2, 5),
    tempo: grade(r.tempo - settings.targetTempo, lv.tempoTol / 2, lv.tempoTol),
  };
  document.querySelectorAll('#tiles > div').forEach((el) => {
    el.classList.remove('good', 'warn', 'bad');
    const c = g[el.dataset.k];
    if (c) el.classList.add(c);
  });
}

function renderFlight(r, fl, shape) {
  $('flightName').textContent = shape.name;
  $('flightText').textContent = describeShot(shape, fl, settings.handed);
  const { lead, trail } = sides(settings.handed);
  $('fCarry').textContent = `${Math.round(fl.carry)} m`;
  $('fTotal').textContent = `${Math.round(fl.total)} m`;
  $('fOff').textContent = Math.abs(fl.offline) < 1 ? '0 m' : `${fl.offline > 0 ? trail : lead} ${Math.round(Math.abs(fl.offline))} m`;
  $('fLaunch').textContent = `${fl.launch.launchV.toFixed(0)}°`;
  $('fSpin').textContent = `${Math.round(fl.launch.spin / 100) * 100}`;
  $('fApex').textContent = `${Math.round(fl.apex)} m`;
  const mirror = r.geo ? r.geo.mirror : settings.handed === 'left' ? -1 : 1;
  loadViews()
    .then(({ flight }) => flight.show(fl, mirror))
    .catch((e) => console.error(e));
}

// 真上から見たインパクト図（目標は上）。角度は見やすいよう2倍にして描く
function drawImpact(r) {
  const cv = $('impactCv');
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  const mx = settings.handed === 'left' ? -1 : 1; // + を画面の右へ（右打ち）
  const EX = 2;
  const cx = W / 2;
  const cy = H * 0.56;
  ctx.clearRect(0, 0, W, H);
  ctx.font = '700 22px "Zen Kaku Gothic New", sans-serif';
  // 目標ライン
  ctx.strokeStyle = '#f2c230';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(cx, H - 20);
  ctx.lineTo(cx, 30);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#f2c230';
  ctx.fillText('目標', cx + 10, 36);
  const dirV = (deg) => {
    const a = (deg * EX * Math.PI) / 180;
    return [Math.sin(a) * mx, -Math.cos(a)];
  };
  const p = r.clubPath ?? 0;
  const f = r.face;
  // フェースと通り道の差（くさび）
  const d = f - p;
  const ap = Math.atan2(dirV(p)[1], dirV(p)[0]);
  const af = Math.atan2(dirV(f)[1], dirV(f)[0]);
  ctx.fillStyle = Math.abs(d) < 2 ? 'rgba(95,211,141,0.35)' : 'rgba(255,107,91,0.4)';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, 150, Math.min(ap, af), Math.max(ap, af));
  ctx.closePath();
  ctx.fill();
  // クラブの通り道（ボールを通る矢印）
  const pv = dirV(p);
  const arrow = (x0, y0, x1, y1, color, w) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const a = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - 22 * Math.cos(a - 0.4), y1 - 22 * Math.sin(a - 0.4));
    ctx.lineTo(x1 - 22 * Math.cos(a + 0.4), y1 - 22 * Math.sin(a + 0.4));
    ctx.closePath();
    ctx.fill();
  };
  arrow(cx - pv[0] * 190, cy - pv[1] * 190, cx + pv[0] * 190, cy + pv[1] * 190, '#8fd3ff', 7);
  ctx.fillStyle = '#8fd3ff';
  ctx.fillText('クラブの通り道', cx - pv[0] * 190 + 12, cy - pv[1] * 190 - 4);
  // フェース（面）とその向き
  const fv = dirV(f);
  const perp = [-fv[1], fv[0]];
  ctx.strokeStyle = '#f7f8f3';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - perp[0] * 55 - fv[0] * 14, cy - perp[1] * 55 - fv[1] * 14);
  ctx.lineTo(cx + perp[0] * 55 - fv[0] * 14, cy + perp[1] * 55 - fv[1] * 14);
  ctx.stroke();
  ctx.lineCap = 'butt';
  arrow(cx, cy, cx + fv[0] * 150, cy + fv[1] * 150, '#f7f8f3', 4);
  ctx.fillStyle = '#f7f8f3';
  ctx.fillText('フェースの向き', cx + fv[0] * 150 + (mx * fv[0] >= 0 ? 10 : -160), cy + fv[1] * 150);
  // ボール
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(247,248,243,0.6)';
  ctx.font = '18px "Zen Kaku Gothic New", sans-serif';
  ctx.fillText('角度は見やすく2倍で表示', 14, H - 14);
  $('impactText').textContent = describeImpact(r, settings.handed);
}

function renderMatrix(shape) {
  const { lead, trail } = sides(settings.handed);
  // 画面の左から順に「左」「まっすぐ」「右」。右打ちでは + が右
  const plus = settings.handed === 'left' ? -1 : 1;
  const order = [-plus, 0, plus];
  const sideName = (v) => (v === 0 ? 'まっすぐ' : v > 0 ? trail : lead);
  $('mcL').textContent = `${sideName(order[0])}へ曲がる`;
  $('mcR').textContent = `${sideName(order[2])}へ曲がる`;
  const body = $('matrixBody');
  body.innerHTML = '';
  const myCurve = Math.sign(shape.curve);
  for (const st of order) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = st === 0 ? 'まっすぐ出る' : `${sideName(st)}へ出る`;
    tr.appendChild(th);
    for (const cu of order) {
      const td = document.createElement('td');
      const pre = st === 0 ? '' : st > 0 ? 'プッシュ' : 'プル';
      const post = cu === 0 ? '' : cu > 0 ? 'スライス' : 'フック';
      td.textContent = pre + post || 'ストレート';
      if (st === shape.start && cu === myCurve) td.classList.add('me');
      if (st === 0 && cu === 0) td.classList.add('ideal');
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

function renderTips(r) {
  const box = $('tips');
  box.innerHTML = '';
  for (const t of coachTips(r, settings)) {
    const div = document.createElement('div');
    div.className = 'tip';
    div.innerHTML = '<h3></h3><p><span class="k">いま</span><span class="a"></span></p><p><span class="k">コツ</span><span class="b"></span></p><p><span class="k">練習</span><span class="c"></span></p>';
    div.querySelector('h3').textContent = t.title;
    div.querySelector('.a').textContent = t.now;
    div.querySelector('.b').textContent = t.fix;
    div.querySelector('.c').textContent = t.drill;
    box.appendChild(div);
  }
}

let viewsPromise = null;
function loadViews() {
  viewsPromise ||= import('./view3d.js').then((m) => {
    const swing = new m.SwingView($('view3d'));
    swing.onEnd = () => ($('playBtn').textContent = 'スロー再生');
    const flight = new m.FlightView($('flight3d'));
    return { swing, flight };
  });
  return viewsPromise;
}
let view = null;
async function render3D(r) {
  const note = $('view3dNote');
  if (!r.geo) {
    note.hidden = false;
    note.textContent = '傾きセンサーの値が取れなかったため、3Dの軌道は表示できません。';
    $('devText').textContent = '';
    return;
  }
  note.hidden = true;
  try {
    view = (await loadViews()).swing;
    view.show(r.geo);
    document.querySelectorAll('.layer-ctrl input').forEach((el) => view.setLayer(el.dataset.layer, el.checked));
  } catch (e) {
    note.hidden = false;
    note.textContent = '3D表示を読み込めませんでした。通信状況を確認してください。';
    console.error(e);
  }
  const d = r.downDev;
  $('devText').textContent =
    Math.abs(d) < 3
      ? '下ろすときも、お手本の面にほぼ乗っています。'
      : `下ろすとき、お手本の面より平均 ${Math.round(Math.abs(d))}cm ${d > 0 ? '外側（上）' : '内側（下）'}を通っています。`;
}
document.querySelectorAll('input[name=cam]').forEach((el) =>
  el.addEventListener('change', () => view && view.setCamera(el.value)),
);
document.querySelectorAll('.layer-ctrl input').forEach((el) =>
  el.addEventListener('change', () => view && view.setLayer(el.dataset.layer, el.checked)),
);
$('playBtn').addEventListener('click', () => {
  if (!view || !view.geo) return;
  view.play(0.35);
  $('playBtn').textContent = '再生中…';
});
document.querySelectorAll('input[name=fcam]').forEach((el) =>
  el.addEventListener('change', () => loadViews().then(({ flight }) => flight.setCamera(el.value))),
);
$('flightPlay').addEventListener('click', () => loadViews().then(({ flight }) => flight.play()));

function drawTrace(r) {
  const cv = $('trace');
  const ctx = cv.getContext('2d');
  const W = cv.width;
  const H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const tr = r.trace;
  const tMax = tr[tr.length - 1].t || 1;
  const sMax = Math.max(90, ...tr.map((p) => Math.abs(p.s)));
  const fMax = Math.max(30, ...tr.map((p) => Math.abs(p.twist)));
  const x = (t) => 10 + (t / tMax) * (W - 20);
  const y = (v, m) => H / 2 - (v / m) * (H / 2 - 12);
  // 基準線
  ctx.strokeStyle = 'rgba(247,248,243,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  // トップ・インパクト
  const mark = (t, label) => {
    const xx = x(t);
    ctx.strokeStyle = 'rgba(247,248,243,0.45)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xx, 0);
    ctx.lineTo(xx, H);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#c9dccd';
    ctx.font = '20px "Zen Kaku Gothic New", sans-serif';
    ctx.fillText(label, xx + 6, 24);
  };
  mark(r.tTop - r.t0, 'トップ');
  mark(r.tImpact - r.t0, 'インパクト');
  const line = (key, m, color, w) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    tr.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p[key], m)) : ctx.moveTo(x(p.t), y(p[key], m))));
    ctx.stroke();
  };
  line('s', sMax, '#f7f8f3', 3);
  line('twist', fMax, '#f2c230', 3);
}

// ---------- 検出器 ----------
let resultShowing = false;
let resultTimer = null;
const detector = new SwingDetector({
  getSettings: () => settings,
  onState: (s) => {
    if (s === 'wait' && !resultShowing) setStage('wait', '構えて静止', 'アドレスの形で1秒止まってください');
  },
  onEvent: (e) => {
    if (e === 'address') {
      resultShowing = false;
      setStage('address', 'どうぞ', 'ゆっくり上げて、振り抜いてください');
      sfx.address();
      buzz(30);
      if (settings.rhythmGuide) playRhythm();
    } else if (e === 'start') {
      setStage('swing', 'スイング中', '');
    } else if (e === 'top') {
      sfx.top();
    }
  },
  onResult: (r) => {
    resultShowing = true;
    clearTimeout(resultTimer);
    resultTimer = setTimeout(() => (resultShowing = false), 2500);
    if (!r.valid) {
      setStage('error', 'もう一度', `${r.reason}。構え直してください`);
      return;
    }
    handleResult(r);
  },
});
function handleResult(r) {
  history.push({ pass: r.pass, tempo: r.tempo, face: r.face, plane: r.planeDev });
  saveHistory();
  renderCard(r);
  renderHistory();
  if (r.pass) {
    streak++;
    renderStreak();
    if (streak >= settings.goalStreak) {
      sfx.goal();
      say(`${streak}回連続で合格です`);
      $('goalBig').textContent = streak;
      $('goal').hidden = false;
      $('goalHarder').hidden = settings.level === 'strict';
      return;
    }
    setStage('pass', '合格', `あと${settings.goalStreak - streak}回続けてください`);
    sfx.pass();
    buzz(60);
    say('ナイス');
  } else {
    const fails = r.checks.filter((c) => !c.pass);
    const lost = streak;
    streak = 0;
    renderStreak();
    setStage('fail', 'やり直し', fails.map((c) => c.msg).join('。') + (lost ? `。連続${lost}回の記録はリセットされました` : ''));
    sfx.fail();
    buzz([200, 80, 200]);
    say(fails.map((c) => c.voice).join('。'));
  }
}

// ---------- センサー ----------
let lastLive = 0;
let gotMotion = false;
function onMotion(e) {
  const rr = e.rotationRate;
  if (!rr || (rr.alpha == null && rr.beta == null && rr.gamma == null)) return;
  gotMotion = true;
  const t = (e.timeStamp || performance.now()) / 1000;
  const w = rateToVec(rr);
  const g = e.accelerationIncludingGravity;
  detector.push(t, w, g && g.x != null ? [g.x, g.y, g.z] : null);
  if (t - lastLive > 0.1) {
    lastLive = t;
    $('live').textContent = `${Math.round(Math.hypot(...w))} deg/s`;
  }
}

async function requestSensors() {
  if (typeof DeviceMotionEvent === 'undefined') return 'unsupported';
  if (typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== 'granted') return 'denied';
    } catch {
      return 'denied';
    }
  }
  window.addEventListener('devicemotion', onMotion);
  return 'ok';
}

let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('train').hidden) keepAwake();
});

// ---------- デモ（センサーがない端末用） ----------
let demoTimer = null;
function runDemo(good) {
  clearInterval(demoTimer);
  const opts = good
    ? { back: 0.8, down: 0.27, face: 0 }
    : { back: 0.45, down: 0.3, face: 6, planeTilt: 12 };
  const still = Array.from({ length: 70 }, (_, i) => ({ t: i / 60, w: [1, -1, 0.5] }));
  opts.dir = settings.handed === 'left' ? 1 : -1;
  if (opts.planeTilt) opts.planeTilt *= opts.dir; // 上から下ろす（アウトサイドイン）にそろえる
  const sw = simulateSwing(opts).slice(1).map((s) => ({ t: 70 / 60 + s.t, w: s.w }));
  const seq = still.concat(sw);
  const t0 = performance.now() / 1000;
  let i = 0;
  demoTimer = setInterval(() => {
    const now = performance.now() / 1000 - t0;
    while (i < seq.length && seq[i].t <= now) {
      detector.push(t0 + seq[i].t, seq[i].w, [4.9, -8.49, 0]);
      i++;
    }
    if (i >= seq.length) clearInterval(demoTimer);
  }, 16);
}
$('demoOk').addEventListener('click', () => runDemo(true));
$('demoBad').addEventListener('click', () => runDemo(false));

// ---------- 画面遷移 ----------
$('startBtn').addEventListener('click', async () => {
  readForm();
  audio();
  if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  const st = await requestSensors();
  let why = 'この端末ではモーションセンサーが使えません。デモで動きを確認できます';
  if (st === 'denied') why = 'モーションセンサーが許可されていません。iPhoneはページを開き直して「許可」を選んでください';
  else if (!window.isSecureContext) why = 'センサーは https のページでしか使えません。README の手順で公開してください';
  $('setup').hidden = true;
  $('train').hidden = false;
  streak = 0;
  renderStreak();
  renderHistory();
  detector.reset();
  keepAwake();
  setTimeout(() => {
    if (!gotMotion) {
      $('demoOk').hidden = false;
      $('demoBad').hidden = false;
      setStage('error', 'センサーなし', why);
    }
  }, 1500);
});

$('backBtn').addEventListener('click', () => {
  $('train').hidden = true;
  $('setup').hidden = false;
  window.scrollTo(0, 0);
});
$('clearBtn').addEventListener('click', () => {
  history = [];
  saveHistory();
  renderHistory();
});
$('goalNext').addEventListener('click', () => {
  $('goal').hidden = true;
  streak = 0;
  renderStreak();
  detector.reset();
});
$('goalHarder').addEventListener('click', () => {
  settings.level = settings.level === 'easy' ? 'normal' : 'strict';
  writeForm();
  readForm();
  $('goal').hidden = true;
  streak = 0;
  renderStreak();
  detector.reset();
  setStage('wait', `「${LEVELS[settings.level].label}」で再挑戦`, 'アドレスの形で1秒止まってください');
});
