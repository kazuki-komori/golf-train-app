// ボールの弾道シミュレーション
// 座標: x = 目標方向, y = 上, z = 体から離れる側（右打ちなら右）。単位 m, m/s
// 参考: TrackMan の D-plane / 平均値、Smits & Smith、opengolfcoach の空力係数

const M = 0.04593; // kg
const D = 0.04267; // m
const R = D / 2;
const A = (Math.PI * D * D) / 4;
const RHO = 1.225;
const G = 9.81;
const NU = 1.5e-5;
const K = (RHO * A) / (2 * M);
const D2R = Math.PI / 180;
const MPH = 2.23694;

export const CLUBS = {
  driver: { label: 'ドライバー', loft: 15.5, smash: 1.42, faceW: 0.85, launchK: 0.83, spinK: 1.75, spinMin: 1800, spinMax: 4200, roll: 0.12 },
  iron7: { label: '7番アイアン', loft: 25, smash: 1.28, faceW: 0.75, launchK: 0.75, spinK: 3.0, spinMin: 5000, spinMax: 9000, roll: 0.06 },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 打ち出し条件。face, path: + = 体から離れる側。attack: + = 下から
export function launchFrom({ clubSpeed, face, path, attack, club = 'driver' }) {
  const c = CLUBS[club] || CLUBS.driver;
  const att = clamp(attack, -8, 6);
  const dynLoft = c.loft + 0.5 * att; // 下から当てるとロフトが増える
  const spinLoft = Math.max(4, dynLoft - att);
  const ballSpeed = clubSpeed * c.smash;
  const launchV = att + c.launchK * spinLoft;
  const launchH = c.faceW * face + (1 - c.faceW) * path;
  const spin = clamp(c.spinK * clubSpeed * MPH * spinLoft, c.spinMin, c.spinMax); // rpm
  const f2p = face - path;
  const tilt = Math.atan2(Math.sin(f2p * D2R), Math.sin(spinLoft * D2R)) / D2R; // + = 体から離れる側へ曲がる
  return { ballSpeed, launchV, launchH, spin, tilt: clamp(tilt, -45, 45), spinLoft, club: c };
}

function coeffs(v, wmag) {
  const S = (wmag * R) / v;
  const Re = (v * D) / NU;
  const CL = S <= 0.25 ? 1.99 * S - 3.255 * S * S : 0.2941 + 0.3625 * (S - 0.25);
  const CD = 0.225 + 0.275 / (1 + Math.exp(0.0002 * (Re - 80000))) + 0.18 * (1 - Math.exp(-3 * S * S));
  return { CL: Math.max(0, CL), CD };
}

// 弾道を計算して点列を返す
export function simulateFlight(launch) {
  const { ballSpeed, launchV, launchH, spin, tilt } = launch;
  const cv = Math.cos(launchV * D2R);
  let p = [0, 0, 0];
  let v = [ballSpeed * cv * Math.cos(launchH * D2R), ballSpeed * Math.sin(launchV * D2R), ballSpeed * cv * Math.sin(launchH * D2R)];
  // スピン軸: バックスピンは +z。tilt だけ傾けると横向きの揚力が出る
  let wmag = (spin * 2 * Math.PI) / 60;
  const ax = [0, -Math.sin(tilt * D2R), Math.cos(tilt * D2R)];
  const pts = [[...p]];
  const dt = 0.01;
  let t = 0;
  let apex = 0;
  const acc = (vv) => {
    const sp = Math.hypot(vv[0], vv[1], vv[2]);
    const { CL, CD } = coeffs(sp, wmag);
    // ω × v の向き
    const c = [ax[1] * vv[2] - ax[2] * vv[1], ax[2] * vv[0] - ax[0] * vv[2], ax[0] * vv[1] - ax[1] * vv[0]];
    const cn = Math.hypot(c[0], c[1], c[2]) || 1;
    return [
      -K * CD * sp * vv[0] + (K * CL * sp * sp * c[0]) / cn,
      -G - K * CD * sp * vv[1] + (K * CL * sp * sp * c[1]) / cn,
      -K * CD * sp * vv[2] + (K * CL * sp * sp * c[2]) / cn,
    ];
  };
  while (t < 15) {
    // RK4
    const add = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
    const k1v = acc(v);
    const k1p = v;
    const k2v = acc(add(v, k1v, dt / 2));
    const k2p = add(v, k1v, dt / 2);
    const k3v = acc(add(v, k2v, dt / 2));
    const k3p = add(v, k2v, dt / 2);
    const k4v = acc(add(v, k3v, dt));
    const k4p = add(v, k3v, dt);
    const np = [0, 1, 2].map((i) => p[i] + (dt / 6) * (k1p[i] + 2 * k2p[i] + 2 * k3p[i] + k4p[i]));
    const nv = [0, 1, 2].map((i) => v[i] + (dt / 6) * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]));
    wmag *= Math.exp(-0.001 * Math.hypot(...v) * dt); // スピンの減衰（約5%/秒）
    t += dt;
    if (np[1] < 0) {
      const f = p[1] / (p[1] - np[1]);
      p = [p[0] + (np[0] - p[0]) * f, 0, p[2] + (np[2] - p[2]) * f];
      v = nv;
      pts.push([...p]);
      break;
    }
    p = np;
    v = nv;
    apex = Math.max(apex, p[1]);
    pts.push([...p]);
  }
  const carryPt = [...p];
  const flightTime = t;
  const descent = Math.atan2(-v[1], Math.hypot(v[0], v[2])) / D2R;

  // ランは落下角が浅いほど長い（ドライバーでキャリーの約1割）
  const rollFrac = launch.club.roll * clamp((58 - descent) / 20, 0.2, 1);
  const dRoll = Math.hypot(carryPt[0], carryPt[2]) * rollFrac;
  const hv = Math.hypot(v[0], v[2]) || 1;
  const dir = [v[0] / hv, v[2] / hv];
  const roll = [];
  const hop = Math.min(1.2, dRoll * 0.04);
  for (let s = 1; s <= 24; s++) {
    const u = s / 24;
    const d = dRoll * (1 - (1 - u) ** 2);
    const y = u < 0.35 ? hop * Math.sin((Math.PI * u) / 0.35) : 0;
    roll.push([carryPt[0] + dir[0] * d, y, carryPt[2] + dir[1] * d]);
  }
  const q = [carryPt[0] + dir[0] * dRoll, 0, carryPt[2] + dir[1] * dRoll];
  return {
    pts,
    roll,
    carry: Math.hypot(carryPt[0], carryPt[2]),
    carryPt,
    total: Math.hypot(q[0], q[2]),
    totalPt: q,
    apex,
    flightTime,
    descent,
    offline: q[2],
  };
}

// 解析結果から弾道を作る
export function flightFromSwing(r, club = 'driver') {
  const clubSpeed = clamp(r.headSpeed || 35, 18, 55);
  const launch = launchFrom({ clubSpeed, face: r.face, path: r.clubPath ?? 0, attack: r.attack ?? 0, club });
  return { launch, clubSpeed, ...simulateFlight(launch) };
}

// 球筋の名前。start: 打ち出し（-1 左 / 0 まっすぐ / 1 右）、curve: 曲がり（-2..2）。+ = 体から離れる側
export function shapeOf(f) {
  const startDeg = f.launch.launchH;
  const straightOff = f.carry * Math.tan(startDeg * D2R);
  const curveM = f.carryPt[2] - straightOff; // 打ち出しの線からどれだけ曲がったか
  const start = Math.abs(startDeg) <= 2 ? 0 : Math.sign(startDeg);
  let curve = 0;
  if (Math.abs(curveM) > 15) curve = 2 * Math.sign(curveM);
  else if (Math.abs(curveM) > 4) curve = Math.sign(curveM);
  const curveName = { '-2': 'フック', '-1': 'ドロー', 0: 'ストレート', 1: 'フェード', 2: 'スライス' }[curve];
  let name = curveName;
  if (start !== 0) {
    const pre = start > 0 ? 'プッシュ' : 'プル';
    name = curve === 0 ? pre : pre + curveName;
  }
  return { start, curve, name, curveM, startDeg };
}
