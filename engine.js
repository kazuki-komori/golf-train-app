// スイング解析エンジン（UI非依存・Nodeでもテスト可能）
//
// 座標系: DeviceMotionEvent の端末座標（x=画面右, y=画面上端方向, z=画面の表）
// rotationRate: alpha=z軸回り, beta=x軸回り, gamma=y軸回り（deg/s）
// スマホの長辺(y軸) = シャフト。上端をヘッド側（地面側）に向けて握る想定。

export const LEVELS = {
  easy: { label: 'やさしい', face: 15, tempoTol: 0.6, plane: 25, path: 8 },
  normal: { label: '標準', face: 10, tempoTol: 0.4, plane: 18, path: 5 },
  strict: { label: '厳しい', face: 6, tempoTol: 0.25, plane: 12, path: 3 },
};

// 3D推定の体のモデル(m)。胸の中心から腕、その先にクラブ。
// 腕の回転はクラブの回転の一部（残りは手首のコック）とみなす
export const ARM = 0.65;
export const CLUB = 1.0;
export const ARM_SHARE = 0.6;

export const DEFAULT_SETTINGS = {
  handed: 'right',
  club: 'driver',
  level: 'normal',
  targetTempo: 3.0,
  goalStreak: 5,
  checks: { face: true, tempo: true, plane: true, path: true },
  rhythmGuide: false,
  voice: true,
  invertFace: false,
};

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ---------- ベクトル・クォータニオン ----------
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a) => {
  const n = norm(a);
  return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
};
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
// 軸 n（単位ベクトル）回りに v を rad 回転（ロドリゲス）
function rotAxis(v, n, rad) {
  const c = Math.cos(rad);
  const sn = Math.sin(rad);
  return add(add(scale(v, c), scale(cross(n, v), sn)), scale(n, dot(n, v) * (1 - c)));
}
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(normalize(a), normalize(b))))) * R2D;

// q = [w, x, y, z]
export function qmul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
const qconj = (q) => [q[0], -q[1], -q[2], -q[3]];
function qnormalize(q) {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
export function qFromAxisAngle(axis, rad) {
  const s = Math.sin(rad / 2);
  return [Math.cos(rad / 2), axis[0] * s, axis[1] * s, axis[2] * s];
}
export function qRotate(q, v) {
  const r = qmul(qmul(q, [0, v[0], v[1], v[2]]), qconj(q));
  return [r[1], r[2], r[3]];
}
// 端末座標の角速度(deg/s)で dt 秒積分（端末座標系 = 右から掛ける）
function integrate(q, wDeg, dt) {
  const w = [wDeg[0] * D2R, wDeg[1] * D2R, wDeg[2] * D2R];
  const n = norm(w);
  if (n * dt < 1e-9) return q;
  const dq = qFromAxisAngle([w[0] / n, w[1] / n, w[2] / n], n * dt);
  return qnormalize(qmul(q, dq));
}
// y軸（シャフト）回りのねじれ角（swing-twist分解）
function twistY(q) {
  let a = 2 * Math.atan2(q[2], q[0]) * R2D;
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

// rotationRate → 端末座標ベクトル [x, y, z]
export const rateToVec = (rr) => [rr.beta || 0, rr.gamma || 0, rr.alpha || 0];

// ---------- オフライン解析 ----------
// samples: [{ t: 秒, w: [x,y,z] deg/s }]  先頭はアドレス静止時のサンプル
// gravity: アドレス時の重力ベクトル（端末座標, 任意）
export function analyzeSwing(samples, settings = DEFAULT_SETTINGS, gravity = null) {
  const n = samples.length;
  if (n < 8) return { valid: false, reason: 'データが少なすぎます' };

  // 1) 姿勢を積分
  const qs = [[1, 0, 0, 0]];
  for (let k = 1; k < n; k++) {
    const dt = Math.min(0.05, Math.max(0, samples[k].t - samples[k - 1].t));
    qs.push(integrate(qs[k - 1], samples[k].w, dt));
  }
  const shaft = qs.map((q) => qRotate(q, [0, 1, 0])); // アドレス座標系でのシャフト方向
  const twist = qs.map(twistY);
  // 腕の向き: シャフト回りのねじれを除いた回転の ARM_SHARE 倍だけ回す
  const armDir = [[0, 1, 0]];
  const armW = [[0, 0, 0]]; // 腕の角速度（アドレス座標系, deg/s）
  {
    let qa = [1, 0, 0, 0];
    for (let k = 1; k < n; k++) {
      const dt = Math.min(0.05, Math.max(0, samples[k].t - samples[k - 1].t));
      // この区間の回転軸（アドレス座標系）は区間はじめの姿勢で変換したもの
      const wW = qRotate(qs[k - 1], samples[k].w);
      const mid = normalize(add(shaft[k - 1], shaft[k]));
      const wp = sub(wW, scale(mid, dot(wW, mid)));
      armW.push(scale(wp, ARM_SHARE));
      const m = norm(wp) * D2R * dt * ARM_SHARE;
      if (m > 1e-9) qa = qnormalize(qmul(qFromAxisAngle(normalize(wp), m), qa));
      armDir.push(qRotate(qa, [0, 1, 0]));
    }
  }
  // 胸の中心から見たヘッドの位置（アドレス座標系）
  const headRel = shaft.map((sv, k) => add(scale(armDir[k], ARM), scale(sv, CLUB)));

  // 2) スイング主軸 → スイング角 s(t)
  const sumW = (from, to) => {
    const acc = [0, 0, 0];
    for (let k = from; k <= to; k++) {
      const wW = qRotate(qs[k], samples[k].w); // アドレス座標系の角速度
      acc[0] += wW[0];
      acc[1] += wW[1];
      acc[2] += wW[2];
    }
    return acc;
  };
  const t0 = samples[0].t;
  let early = 1;
  while (early < n - 1 && samples[early].t - t0 < 0.2) early++;
  let axis = normalize(sumW(1, early));

  const computeS = (ax) => {
    const s = [0];
    const ws = [0];
    for (let k = 1; k < n; k++) {
      const dt = Math.min(0.05, Math.max(0, samples[k].t - samples[k - 1].t));
      const wp = dot(qRotate(qs[k], samples[k].w), ax);
      ws.push(wp);
      s.push(s[k - 1] + wp * dt);
    }
    return { s, ws };
  };
  let { s, ws } = computeS(axis);
  let kTop = argmax(s);
  if (kTop > 2) {
    axis = normalize(sumW(1, kTop));
    ({ s, ws } = computeS(axis));
    kTop = argmax(s);
  }
  const topAngle = s[kTop];
  if (topAngle < 45) return { valid: false, reason: 'バックスイングが小さすぎます' };

  // 3) 始動・トップ・インパクト時刻
  let kStart = 1;
  while (kStart < kTop && s[kStart] < 2) kStart++;
  const tStart = interpCross(samples, s, kStart, 2);

  // トップ: 角速度が+→-に変わる点を補間
  let tTop = samples[kTop].t;
  if (kTop + 1 < n && ws[kTop] > 0 && ws[kTop + 1] <= 0) {
    tTop = lerp(samples[kTop].t, samples[kTop + 1].t, ws[kTop] / (ws[kTop] - ws[kTop + 1]));
  } else if (kTop > 0 && ws[kTop - 1] > 0 && ws[kTop] <= 0) {
    tTop = lerp(samples[kTop - 1].t, samples[kTop].t, ws[kTop - 1] / (ws[kTop - 1] - ws[kTop]));
  }

  let kImp = -1;
  for (let k = kTop + 1; k < n; k++) {
    if (s[k - 1] > 0 && s[k] <= 0) {
      kImp = k;
      break;
    }
  }
  // 重力が取れたらワールド座標 [T, U, F] = [目標方向, 上, 体から離れる方向] を決める
  let frame = null;
  if (gravity && norm(gravity) > 3) {
    const sh0 = shaft[0];
    let up = normalize(gravity);
    if (dot(up, sh0) > 0) up = scale(up, -1); // シャフト（スマホ上端）は下向きのはず
    const fwd = normalize(sub(sh0, scale(up, dot(sh0, up))));
    let tgt = normalize(cross(up, fwd));
    const kEarly = Math.min(kTop, kStart + 6);
    if (dot(sub(headRel[kEarly], headRel[0]), tgt) > 0) tgt = scale(tgt, -1); // テークバックは目標と逆へ
    frame = { up, fwd, tgt };
  }

  let fImp;
  if (frame) {
    // ヘッドがボールの位置（目標方向 0）を通過した瞬間 = インパクト
    const hT = headRel.map((v) => dot(v, frame.tgt));
    let kG = -1;
    for (let k = kTop + 1; k < n; k++) {
      if (hT[k - 1] < 0 && hT[k] >= 0) {
        kG = k;
        break;
      }
    }
    if (kG > 0) {
      kImp = kG;
      fImp = -hT[kG - 1] / (hT[kG] - hT[kG - 1]);
    }
  }
  if (kImp < 0) return { valid: false, reason: 'アドレス位置まで振り下ろせていません' };
  if (fImp == null) fImp = s[kImp - 1] / (s[kImp - 1] - s[kImp]);
  const tImpact = lerp(samples[kImp - 1].t, samples[kImp].t, fImp);

  const backTime = tStart != null ? tTop - tStart : tTop - t0;
  const downTime = tImpact - tTop;
  const tempo = downTime > 0 ? backTime / downTime : 0;

  // 4) フェース角（インパクト時のシャフト回りのねじれ）
  const twistImp = twist[kImp - 1] + wrap180(twist[kImp] - twist[kImp - 1]) * fImp;
  // バックスイングではフェースが開く → その向きを「開き」とする（持ち方の向きに依存しない）
  let rollBack = 0;
  for (let k = 1; k <= kTop; k++) {
    const dt = Math.min(0.05, Math.max(0, samples[k].t - samples[k - 1].t));
    rollBack += samples[k].w[1] * dt;
  }
  let openSign;
  let faceSignSource;
  if (Math.abs(rollBack) >= 25) {
    openSign = Math.sign(rollBack);
    faceSignSource = 'auto';
  } else {
    openSign = settings.handed === 'left' ? -1 : 1;
    faceSignSource = 'handed';
  }
  if (settings.invertFace) openSign *= -1;
  const face = wrap180(twistImp) * openSign; // + = 開き, - = 閉じ

  // 5) スイングプレーン（シャフトが描く面の法線を比較）
  const planeNormal = (from, to) => {
    const acc = [0, 0, 0];
    for (let k = from; k < to; k++) {
      const c = cross(shaft[k], shaft[k + 1]);
      acc[0] += c[0];
      acc[1] += c[1];
      acc[2] += c[2];
    }
    return normalize(acc);
  };
  const nBack = planeNormal(Math.max(0, kStart - 1), kTop);
  const nDownRaw = planeNormal(kTop, kImp);
  const nDown = [-nDownRaw[0], -nDownRaw[1], -nDownRaw[2]];
  const planeDev = angleBetween(nBack, nDown);
  let planeDir = null; // 'steep'（上から） | 'shallow'（下から）
  let planeBack = null;
  let planeDown = null;
  if (gravity && norm(gravity) > 3) {
    const up = normalize(gravity);
    // 面の傾き（地面からの角度）= 法線と鉛直のなす角
    const incl = (nv) => Math.acos(Math.min(1, Math.abs(dot(nv, up)))) * R2D;
    planeBack = incl(nBack);
    planeDown = incl(nDown);
    planeDir = planeDown > planeBack ? 'steep' : 'shallow';
  }

  // 5b) 3D軌道（胸の中心を支点に、腕とクラブの2本でヘッド位置を推定）
  //  ワールド座標 [T, U, F] = [目標方向, 上, 体から離れる方向]。ボール位置が原点
  let geo = null;
  let clubPath = null;
  let attack = null;
  let downDev = null;
  if (frame) {
    const sh0 = shaft[0];
    const { up, fwd, tgt } = frame;
    // インパクト瞬間のヘッド速度（接線方向）= ω×シャフト + ω腕×腕
    const lerpDir = (arr) => normalize(add(scale(arr[kImp - 1], 1 - fImp), scale(arr[kImp], fImp)));
    const shI = lerpDir(shaft);
    const armI = lerpDir(armDir);
    const wI = scale(qRotate(qs[kImp - 1], samples[kImp].w), D2R);
    const vImpRaw = add(scale(cross(wI, shI), CLUB), scale(cross(scale(armW[kImp], D2R), armI), ARM));
    const toW = (v) => [dot(v, tgt), dot(v, up), dot(v, fwd)];
    const sh0W = toW(sh0);
    const pivot = scale(toW(headRel[0]), -1); // ボール = 原点
    const head = headRel.map((v) => add(pivot, toW(v)));
    const hands = armDir.map((v) => add(pivot, scale(toW(v), ARM)));

    const vW = toW(vImpRaw);
    clubPath = Math.atan2(vW[2], vW[0]) * R2D; // + = インサイドアウト
    attack = Math.atan2(vW[1], Math.hypot(vW[0], vW[2])) * R2D; // - = 上から（ダウンブロー）

    // 理想: アドレスのシャフトと目標ラインを含む面の上を、同じ半径で回る
    let nI = normalize(cross(sh0W, [1, 0, 0]));
    if (cross(nI, sh0W)[0] < 0) nI = scale(nI, -1); // +回転 = 目標方向へ進む
    const outside = Math.sign(nI[1]) || 1; // 面より上側 = 外側（アウトサイド）
    const ideal = [];
    const backDeg = Math.min(270, topAngle);
    for (let a = -backDeg; a <= 170; a += 3) {
      const armI = scale(rotAxis(sh0W, nI, a * ARM_SHARE * D2R), ARM);
      const clubI = scale(rotAxis(sh0W, nI, a * D2R), CLUB);
      ideal.push(add(pivot, add(armI, clubI)));
    }
    const offPlane = head.map((p) => dot(sub(p, pivot), nI) * outside); // m, + = 外側
    // ダウンスイング後半（トップ→インパクトの後ろ半分）での平均のずれ
    const kMid = Math.floor((kTop + kImp) / 2);
    let acc = 0;
    let cnt = 0;
    for (let k = kMid; k <= kImp; k++) {
      acc += offPlane[k];
      cnt++;
    }
    downDev = cnt ? (acc / cnt) * 100 : 0; // cm
    geo = {
      head,
      hands,
      pivot,
      ideal,
      idealNormal: nI,
      offPlane,
      times: samples.map((x) => x.t - t0),
      kStart,
      kTop,
      kImp,
      fImp,
      // 座標系が左手系なら表示時に奥行きを反転して鏡像を防ぐ
      mirror: Math.sign(dot(cross(tgt, up), fwd)) || 1,
    };
    planeDir = downDev > 0 ? 'steep' : 'shallow';
  }

  // 6) 最大角速度・推定ヘッドスピード
  let peak = 0;
  for (let k = kTop; k < Math.min(n, kImp + 3); k++) peak = Math.max(peak, norm(samples[k].w));
  const headSpeed = peak * D2R * 1.5; // m/s（ドライバー換算の目安）

  const result = {
    valid: true,
    t0,
    tStart,
    tTop,
    tImpact,
    backTime,
    downTime,
    tempo,
    topAngle,
    face,
    faceSignSource,
    planeDev,
    planeDir,
    planeBack,
    planeDown,
    peak,
    headSpeed,
    saturated: peak > 1950,
    clubPath,
    attack,
    downDev,
    geo,
    trace: samples.map((smp, k) => ({ t: smp.t - t0, s: s[k], twist: wrap180(twist[k]) * openSign })),
  };
  result.flight = predictFlight(face, clubPath ?? 0);
  result.checks = judge(result, settings);
  result.pass = result.checks.every((c) => c.pass);
  return result;
}

export function judge(r, settings) {
  const lv = LEVELS[settings.level] || LEVELS.normal;
  const out = [];
  if (settings.checks.face) {
    const ok = Math.abs(r.face) <= lv.face;
    let msg;
    if (ok) msg = 'スクエアに戻せています';
    else if (r.face > 0) msg = 'フェースが開いています。スライスしやすい形です';
    else msg = 'フェースが閉じています。フックしやすい形です';
    out.push({
      key: 'face',
      name: 'フェース角',
      value: `${r.face > 0 ? '開き' : r.face < 0 ? '閉じ' : ''} ${Math.abs(r.face).toFixed(1)}°`,
      limit: `±${lv.face}°以内`,
      pass: ok,
      msg,
      voice: ok ? '' : r.face > 0 ? 'フェースが開いています' : 'フェースが閉じています',
    });
  }
  if (settings.checks.tempo) {
    const target = settings.targetTempo;
    const ok = Math.abs(r.tempo - target) <= lv.tempoTol;
    let msg;
    if (ok) msg = 'リズムよく振れています';
    else if (r.tempo < target) msg = 'バックスイングが速すぎるか、切り返しで間が空いています';
    else msg = 'バックスイングがゆっくりすぎます';
    out.push({
      key: 'tempo',
      name: 'テンポ',
      value: `${r.tempo.toFixed(1)} : 1`,
      limit: `${target.toFixed(1)} ±${lv.tempoTol}`,
      pass: ok,
      msg,
      voice: ok ? '' : r.tempo < target ? 'バックスイングが速いです' : 'バックスイングが遅いです',
    });
  }
  if (settings.checks.plane) {
    const ok = r.planeDev <= lv.plane;
    let msg;
    if (ok) msg = '上げた軌道どおりに下ろせています';
    else if (r.planeDir === 'steep') msg = 'ダウンスイングの軌道が立っています。アウトサイドインになりやすい形です';
    else if (r.planeDir === 'shallow') msg = 'ダウンスイングの軌道が寝ています。インサイドアウトが強すぎます';
    else msg = 'バックスイングとダウンスイングで軌道がずれています';
    out.push({
      key: 'plane',
      name: '軌道のずれ',
      value: `${r.planeDev.toFixed(1)}°`,
      limit: `${lv.plane}°以内`,
      pass: ok,
      msg,
      voice: ok ? '' : r.planeDir === 'steep' ? '上から振り下ろしています' : '軌道がずれています',
    });
  }
  if (settings.checks.path && r.clubPath != null) {
    const ok = Math.abs(r.clubPath) <= lv.path;
    let msg;
    if (ok) msg = '目標ラインに沿って振れています';
    else if (r.clubPath > 0) msg = '内側から外へ振り抜いています（インサイドアウト）';
    else msg = '外側から内へ振り抜いています（アウトサイドイン）';
    out.push({
      key: 'path',
      name: 'クラブの通り道',
      value: `${r.clubPath > 0 ? 'イン→アウト' : r.clubPath < 0 ? 'アウト→イン' : ''} ${Math.abs(r.clubPath).toFixed(1)}°`,
      limit: `±${lv.path}°以内`,
      pass: ok,
      msg,
      voice: ok ? '' : r.clubPath > 0 ? '内側から振りすぎです' : '外から振り下ろしています',
    });
  }
  return out;
}

// 弾道予測（D-plane の簡易モデル）。+ = 体から離れる側（右打ちなら右）
export function predictFlight(face, path) {
  const start = 0.75 * face + 0.25 * path;
  const curve = face - path;
  let curveName = 'ストレート';
  if (curve > 6) curveName = 'スライス';
  else if (curve > 2) curveName = 'フェード';
  else if (curve < -6) curveName = 'フック';
  else if (curve < -2) curveName = 'ドロー';
  let name = curveName;
  if (Math.abs(start) > 2) {
    const pre = start > 0 ? 'プッシュ' : 'プル';
    name = curveName === 'ストレート' ? pre : pre + curveName;
  }
  // 180ヤード地点での左右のずれ（ヤード）
  const carry = 180;
  const startOff = carry * Math.tan(start * D2R);
  const curveOff = curve * 3;
  return { start, curve, name, curveName, carry, startOff, curveOff, landing: startOff + curveOff };
}

function argmax(a) {
  let k = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[k]) k = i;
  return k;
}
const lerp = (a, b, f) => a + (b - a) * f;
function interpCross(samples, s, k, level) {
  if (k <= 0 || s[k] < level) return null;
  const f = (level - s[k - 1]) / (s[k] - s[k - 1] || 1);
  return lerp(samples[k - 1].t, samples[k].t, f);
}

// ---------- リアルタイム検出 ----------
const STILL_RATE = 20; // deg/s
const STILL_TIME = 0.8; // s
const START_RATE = 60; // deg/s

export class SwingDetector {
  constructor({ getSettings, onState, onEvent, onResult }) {
    this.getSettings = getSettings;
    this.onState = onState || (() => {});
    this.onEvent = onEvent || (() => {});
    this.onResult = onResult || (() => {});
    this.reset();
  }

  reset() {
    this.state = 'wait'; // wait → address → swing → (解析) → cooldown → wait
    this.stillSince = null;
    this.lastStill = null;
    this.gravAcc = [0, 0, 0];
    this.gravN = 0;
    this.buf = [];
    this.cooldownUntil = 0;
    this.onState(this.state);
  }

  setState(s) {
    if (this.state !== s) {
      this.state = s;
      this.onState(s);
    }
  }

  // t: 秒, w: [x,y,z] deg/s, g: 重力込み加速度 [x,y,z] (任意)
  push(t, w, g) {
    const mag = norm(w);

    if (this.state === 'cooldown') {
      if (t >= this.cooldownUntil) this.setState('wait');
      else return;
    }

    if (this.state === 'wait' || this.state === 'address') {
      if (mag < STILL_RATE) {
        if (this.stillSince == null) {
          this.stillSince = t;
          this.gravAcc = [0, 0, 0];
          this.gravN = 0;
        }
        if (g) {
          this.gravAcc[0] += g[0];
          this.gravAcc[1] += g[1];
          this.gravAcc[2] += g[2];
          this.gravN++;
        }
        this.lastStill = { t, w: [0, 0, 0] };
        if (this.state === 'wait' && t - this.stillSince >= STILL_TIME) {
          this.setState('address');
          this.onEvent('address');
        }
      } else if (this.state === 'address' && mag >= START_RATE) {
        this.gravity = this.gravN > 0 ? this.gravAcc.map((v) => v / this.gravN) : null;
        this.buf = [this.lastStill || { t: t - 1 / 60, w: [0, 0, 0] }, { t, w }];
        this.swingStart = t;
        this.sAcc = 0;
        this.sMax = 0;
        this.axisAcc = [...w];
        this.topFired = false;
        this.impactFired = false;
        this.setState('swing');
        this.onEvent('start');
      } else if (mag >= STILL_RATE) {
        // 静止が崩れた（ワッグルなど）
        this.stillSince = null;
        if (this.state === 'address' && mag < START_RATE) {
          /* 小さな動きは許容 */
        } else {
          this.setState('wait');
        }
      }
      return;
    }

    if (this.state === 'swing') {
      const prev = this.buf[this.buf.length - 1];
      const dt = Math.min(0.05, Math.max(0, t - prev.t));
      this.buf.push({ t, w });
      const el = t - this.swingStart;
      if (el < 0.2) {
        this.axisAcc[0] += w[0];
        this.axisAcc[1] += w[1];
        this.axisAcc[2] += w[2];
      }
      // 端末座標での簡易スイング角（リアルタイム合図用）
      const wp = dot(w, normalize(this.axisAcc));
      this.sAcc += wp * dt;
      this.sMax = Math.max(this.sMax, this.sAcc);
      if (!this.topFired && this.sMax > 45 && wp < -START_RATE) {
        this.topFired = true;
        this.topTime = t;
        this.onEvent('top', { backTime: t - this.swingStart });
      }
      if (this.topFired && !this.impactFired && this.sAcc <= 0) {
        this.impactFired = true;
        this.impactTime = t;
        this.onEvent('impact');
      }

      const finished = this.impactFired && (t - this.impactTime > 0.6 || (t - this.impactTime > 0.25 && mag < STILL_RATE * 3));
      const tooLong = !this.topFired ? el > 3 : !this.impactFired ? t - this.topTime > 1.5 : false;
      const fizzled = !this.topFired && el > 0.4 && mag < STILL_RATE && this.sMax < 45;

      if (finished) {
        const res = analyzeSwing(this.buf, this.getSettings(), this.gravity);
        this.finish(t);
        this.onResult(res);
      } else if (fizzled) {
        // ワッグルだったとみなして待機に戻る
        this.buf = [];
        this.stillSince = null;
        this.setState('wait');
      } else if (tooLong) {
        const res = this.topFired
          ? analyzeSwing(this.buf, this.getSettings(), this.gravity)
          : { valid: false, reason: 'トップが検出できませんでした' };
        this.finish(t);
        this.onResult(res.valid ? res : { valid: false, reason: res.reason || 'スイングを検出できませんでした' });
      }
    }
  }

  finish(t) {
    this.buf = [];
    this.stillSince = null;
    this.cooldownUntil = t + 1.5;
    this.setState('cooldown');
  }
}

// ---------- 疑似スイング生成（デモ・テスト用） ----------
// opts: { back: 秒, down: 秒, top: 度, face: 度(+開き), planeTilt: 度, rate: Hz, noise: deg/s, dir: 1=左打ち / -1=右打ち }
export function simulateSwing(opts = {}) {
  const o = { back: 0.75, down: 0.25, top: 200, follow: 160, face: 0, planeTilt: 0, rate: 60, noise: 3, openRoll: 80, dir: 1, ...opts };
  // 振り抜きはインパクトの速さを保ったまま減速させる
  const vImp = (2 * o.top) / o.down; // deg/s
  const followTime = (o.follow * Math.PI) / 2 / vImp;
  const total = o.back + o.down + followTime + 0.1;
  const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));
  // planeTilt: ダウンスイングで面をアドレスのシャフト線回りに回す角度（- = 外から下ろす）
  // 面ごと回すとフェースも回るので、その分を roll で打ち消す
  const rollImp = o.face - o.planeTilt;
  const pose = (t) => {
    let th; // x軸回りのスイング角
    let roll; // y軸回り（+ = 開き）
    let tilt = 0;
    if (t <= o.back) {
      const f = ease(t / o.back);
      th = o.top * f;
      roll = o.openRoll * f;
    } else if (t <= o.back + o.down) {
      const f = (t - o.back) / o.down;
      th = o.top * (1 - f * f); // 加速しながら下ろす
      roll = o.openRoll + (rollImp - o.openRoll) * f * f;
      tilt = o.planeTilt * ease(f / 0.6);
    } else {
      const g = Math.min(1, (t - o.back - o.down) / followTime);
      th = -o.follow * Math.sin((Math.PI / 2) * g);
      roll = rollImp - 60 * g;
      tilt = o.planeTilt;
    }
    const qRoll = qFromAxisAngle([0, 1, 0], roll * D2R);
    const qSwing = qFromAxisAngle([1, 0, 0], th * o.dir * D2R); // dir=-1 で右打ち（画面を目標に向けた持ち方）
    const qTilt = qFromAxisAngle([0, 1, 0], tilt * D2R);
    return qmul(qTilt, qmul(qSwing, qRoll));
  };
  const samples = [{ t: 0, w: [0, 0, 0] }];
  const dt = 1 / o.rate;
  const rnd = () => (Math.random() - 0.5) * 2 * o.noise;
  for (let t = dt; t <= total; t += dt) {
    const q1 = pose(t - dt);
    const q2 = pose(t);
    // 端末座標の角速度: q1^-1 * q2 の回転ベクトル / dt
    let d = qmul(qconj(q1), q2);
    if (d[0] < 0) d = d.map((v) => -v);
    const ang = 2 * Math.acos(Math.min(1, d[0]));
    const s = Math.sin(ang / 2) || 1;
    const k = ang / dt / s;
    const w = [d[1] * k * R2D + rnd(), d[2] * k * R2D + rnd(), d[3] * k * R2D + rnd()];
    if (ang < 1e-9) w.fill(0);
    samples.push({ t, w });
  }
  // 後ろに静止を少し
  const tEnd = samples[samples.length - 1].t;
  for (let i = 1; i <= 30; i++) samples.push({ t: tEnd + i * dt, w: [rnd(), rnd(), rnd()] });
  return samples;
}
