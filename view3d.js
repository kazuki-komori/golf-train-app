// 3D表示（three.js）
// 座標: x = 目標方向, y = 上, z = 体から離れる側（ボールが原点, 単位 m）
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const COLORS = {
  bg: 0x0d2a1f,
  ground: 0x1c5a3c,
  grid: 0x2f7a52,
  target: 0xf2c230,
  ideal: 0xc9dccd,
  back: 0x8fd3ff,
  follow: 0xf7f8f3,
  body: 0xf7f8f3,
  good: 0x5fd38d,
  warn: 0xf2c230,
  bad: 0xff6b5b,
};

// 理想の面からのずれ(m)に応じた色
export function devColor(m) {
  const a = Math.abs(m);
  if (a < 0.04) return COLORS.good;
  if (a < 0.1) return COLORS.warn;
  return COLORS.bad;
}

function makeLabel(text, { color = '#f7f8f3', bg = 'rgba(13,42,31,0.78)', size = 0.16 } = {}) {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = '700 44px "Zen Kaku Gothic New", sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 36;
  cv.width = w;
  cv.height = 68;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 68, 14);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 18, 36);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set((size * w) / 68, size, 1);
  sp.renderOrder = 10;
  return sp;
}

function disposeTree(group) {
  for (const o of [...group.children]) {
    group.remove(o);
    o.traverse?.((c) => {
      c.geometry?.dispose();
      if (c.material) {
        c.material.map?.dispose();
        c.material.dispose();
      }
    });
  }
}

class BaseView {
  constructor(container, { aspect = 0.8, far = 60 } = {}) {
    this.container = container;
    this.aspect = aspect;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.bg);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, far);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x224433, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(2, 5, 3);
    this.scene.add(sun);
    this.dynamic = new THREE.Group();
    this.scene.add(this.dynamic);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    const loop = () => {
      requestAnimationFrame(loop);
      if (!this.container.offsetParent) return; // 非表示のときは描かない
      this.controls.update();
      this.tick?.();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  resize() {
    const w = this.container.clientWidth || 320;
    const h = Math.round(w * this.aspect);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  look(pos, target) {
    this.camera.position.copy(pos);
    this.controls.target.copy(target);
    this.camera.lookAt(target);
  }
}

// ---------- スイングの軌道 ----------
export class SwingView extends BaseView {
  constructor(container) {
    super(container, { aspect: 0.85 });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(5, 48), new THREE.MeshLambertMaterial({ color: COLORS.ground }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.002;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(8, 16, COLORS.grid, COLORS.grid);
    grid.material.transparent = true;
    grid.material.opacity = 0.5;
    this.scene.add(grid);
    // 目標ライン（ボールから目標へ）
    const tl = new THREE.Mesh(new THREE.BoxGeometry(5, 0.004, 0.02), new THREE.MeshBasicMaterial({ color: COLORS.target }));
    tl.position.set(1.5, 0.002, 0);
    this.scene.add(tl);
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 16), new THREE.MeshBasicMaterial({ color: COLORS.target }));
    arrow.rotation.z = -Math.PI / 2;
    arrow.position.set(4.05, 0.03, 0);
    this.scene.add(arrow);
    const tlabel = makeLabel('目標', { color: '#f2c230', size: 0.24 });
    tlabel.position.set(3.7, 0.25, 0);
    this.scene.add(tlabel);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    ball.position.set(0, 0.03, 0);
    this.scene.add(ball);
    this.layers = {};
  }

  show(geo) {
    disposeTree(this.dynamic);
    this.geo = geo;
    const m = geo.mirror || 1;
    const V = (p) => new THREE.Vector3(p[0], p[1], p[2] * m);
    const pivot = V(geo.pivot);
    this.pivotV = pivot;
    const pts = geo.head.map(V);
    this.pts = pts;
    this.handPts = geo.hands.map(V);
    const L = (this.layers = { body: new THREE.Group(), ideal: new THREE.Group(), back: new THREE.Group(), down: new THREE.Group(), follow: new THREE.Group() });
    Object.values(L).forEach((g) => this.dynamic.add(g));

    // 体（目安）
    const bodyMat = new THREE.MeshStandardMaterial({ color: COLORS.body, transparent: true, opacity: 0.18, depthWrite: false });
    const away = Math.sign(pivot.z) || -1;
    const torsoTop = pivot.clone().add(new THREE.Vector3(0, 0.12, 0));
    const hip = new THREE.Vector3(pivot.x, Math.max(0.75, pivot.y - 0.55), pivot.z + 0.12 * away);
    L.body.add(capsuleBetween(hip, torsoTop, 0.16, bodyMat));
    const headBall = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), bodyMat);
    headBall.position.copy(torsoTop).add(new THREE.Vector3(0, 0.22, 0));
    L.body.add(headBall);
    for (const dx of [-0.2, 0.2]) {
      L.body.add(capsuleBetween(hip.clone().add(new THREE.Vector3(dx * 0.6, 0, 0)), new THREE.Vector3(hip.x + dx, 0.05, hip.z + 0.1 * away), 0.07, bodyMat));
    }

    // お手本の面（半透明の板）と軌道（点線）
    const sh0 = pts[0].clone().sub(pivot).normalize();
    const tx = new THREE.Vector3(1, 0, 0);
    const nrm = new THREE.Vector3().crossVectors(tx, sh0).normalize();
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 2.6),
      new THREE.MeshBasicMaterial({ color: COLORS.ideal, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }),
    );
    plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(tx, new THREE.Vector3().crossVectors(nrm, tx).normalize(), nrm));
    plane.position.copy(pivot).addScaledVector(sh0, 0.9);
    L.ideal.add(plane);
    const idealLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(geo.ideal.map(V)),
      new THREE.LineDashedMaterial({ color: COLORS.ideal, dashSize: 0.07, gapSize: 0.05 }),
    );
    idealLine.computeLineDistances();
    L.ideal.add(idealLine);
    const pl = makeLabel('お手本の面', { color: '#c9dccd', size: 0.2 });
    pl.position.copy(geo.ideal.length ? V(geo.ideal[Math.floor(geo.ideal.length * 0.15)]) : pivot).add(new THREE.Vector3(0, 0.15, 0));
    L.ideal.add(pl);

    // 実際の軌道。上げる = 水色、下ろす = ずれに応じて緑/黄/赤、振り抜き = 白
    const tube = (from, to, color, r = 0.014) => {
      const p = pts.slice(Math.max(0, from), Math.min(pts.length, to + 1));
      if (p.length < 2) return null;
      const curve = new THREE.CatmullRomCurve3(p);
      return new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.max(6, p.length * 4), r, 8, false),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 }),
      );
    };
    const b = tube(0, geo.kTop, COLORS.back, 0.011);
    if (b) L.back.add(b);
    for (let k = geo.kTop; k < geo.kImp; k++) {
      const t = tube(k, k + 1, devColor(geo.offPlane[k]), 0.018);
      if (t) L.down.add(t);
    }
    const f = tube(geo.kImp - 1, pts.length - 1, COLORS.follow, 0.009);
    if (f) L.follow.add(f);

    const topDot = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 12), new THREE.MeshBasicMaterial({ color: COLORS.back }));
    topDot.position.copy(pts[geo.kTop]);
    L.back.add(topDot);
    const tlb = makeLabel('トップ', { size: 0.2 });
    tlb.position.copy(pts[geo.kTop]).add(new THREE.Vector3(0, 0.18, 0));
    L.back.add(tlb);

    // ずれが一番大きい所にラベル
    let kMax = geo.kTop;
    for (let k = geo.kTop; k < geo.kImp; k++) if (Math.abs(geo.offPlane[k]) > Math.abs(geo.offPlane[kMax])) kMax = k;
    const dev = geo.offPlane[kMax];
    if (Math.abs(dev) >= 0.04) {
      const lb = makeLabel(`${dev > 0 ? '外側' : '内側'}に ${Math.round(Math.abs(dev) * 100)}cm`, {
        color: Math.abs(dev) >= 0.1 ? '#ff8a7d' : '#f2c230',
        size: 0.22,
      });
      lb.position.copy(pts[kMax]).add(new THREE.Vector3(0, 0.2, 0));
      L.down.add(lb);
    }

    // 再生用のクラブ
    this.club = new THREE.Group();
    const armMat = new THREE.MeshStandardMaterial({ color: COLORS.body, transparent: true, opacity: 0.55 });
    this.arm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 10), armMat);
    this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 8), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    this.clubHead = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x666666 }));
    this.club.add(this.arm, this.shaft, this.clubHead);
    this.dynamic.add(this.club);
    this.setFrame(geo.kImp - 1 + geo.fImp);
    this.setCamera(this.view || 'dtl');
  }

  setLayer(name, on) {
    if (this.layers[name]) this.layers[name].visible = on;
  }

  setFrame(f) {
    const pts = this.pts;
    const k = Math.max(0, Math.min(pts.length - 1, f));
    const i = Math.floor(k);
    const j = Math.min(pts.length - 1, i + 1);
    const head = pts[i].clone().lerp(pts[j], k - i);
    const hands = this.handPts[i].clone().lerp(this.handPts[j], k - i);
    placeCylinder(this.arm, this.pivotV, hands);
    placeCylinder(this.shaft, hands, head);
    this.clubHead.position.copy(head);
  }

  play(speed = 0.35) {
    const t = this.geo.times;
    this.anim = { start: performance.now(), speed, t0: t[0], t1: t[t.length - 1] };
  }

  tick() {
    if (!this.anim) return;
    const a = this.anim;
    const tt = a.t0 + ((performance.now() - a.start) / 1000) * a.speed;
    const t = this.geo.times;
    if (tt >= a.t1) {
      this.anim = null;
      this.setFrame(this.geo.kImp - 1 + this.geo.fImp);
      this.onEnd?.();
      return;
    }
    let i = 0;
    while (i < t.length - 2 && t[i + 1] < tt) i++;
    this.setFrame(i + (tt - t[i]) / (t[i + 1] - t[i] || 1));
  }

  setCamera(view) {
    this.view = view;
    const p = this.pivotV || new THREE.Vector3(0, 1.2, -0.8);
    const mid = new THREE.Vector3(0, p.y * 0.75, p.z * 0.45);
    const side = -Math.sign(p.z || -1);
    const pos = {
      dtl: new THREE.Vector3(-5, 1.3, p.z * 0.45), // 後ろから（飛球線の後方）
      face: new THREE.Vector3(0, 1.3, side * 6.2), // 正面から
      top: new THREE.Vector3(0.01, 7, p.z * 0.45), // 真上から
    }[view];
    this.look(pos, mid);
  }
}

// ---------- ボールの行方 ----------
export class FlightView extends BaseView {
  constructor(container) {
    super(container, { aspect: 0.62, far: 900 });
    this.scene.background = new THREE.Color(0x3d6e8c);
    this.scene.fog = new THREE.Fog(0x3d6e8c, 160, 520);
    const rough = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshLambertMaterial({ color: 0x174a32 }));
    rough.rotation.x = -Math.PI / 2;
    rough.position.set(200, -0.05, 0);
    this.scene.add(rough);
    const fw = new THREE.Mesh(new THREE.PlaneGeometry(320, 36), new THREE.MeshLambertMaterial({ color: COLORS.ground }));
    fw.rotation.x = -Math.PI / 2;
    fw.position.set(160, 0, 0);
    this.scene.add(fw);
    // 距離の目印（50mごと）
    for (let d = 50; d <= 300; d += 50) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 36), new THREE.MeshBasicMaterial({ color: 0xf7f8f3, transparent: true, opacity: 0.35 }));
      line.rotation.x = -Math.PI / 2;
      line.position.set(d, 0.02, 0);
      this.scene.add(line);
      const lb = makeLabel(`${d}m`, { size: 5 });
      lb.position.set(d, 3, -22);
      this.scene.add(lb);
    }
    const tl = new THREE.Mesh(new THREE.PlaneGeometry(320, 0.25), new THREE.MeshBasicMaterial({ color: COLORS.target, transparent: true, opacity: 0.7 }));
    tl.rotation.x = -Math.PI / 2;
    tl.position.set(160, 0.03, 0);
    this.scene.add(tl);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.scene.add(this.ball);
  }

  show(fl, mirror = 1) {
    disposeTree(this.dynamic);
    this.mirror = mirror;
    const V = (p) => new THREE.Vector3(p[0], p[1], p[2] * mirror);
    this.path = fl.pts.map(V).concat(fl.roll.map(V));
    this.nAir = fl.pts.length;
    this.times = fl.pts.map((_, i) => (i / (fl.pts.length - 1)) * fl.flightTime);
    const rollT = 1.2;
    fl.roll.forEach((_, i) => this.times.push(fl.flightTime + ((i + 1) / fl.roll.length) * rollT));
    // 細い線（ラン含む）と太いトレーサー（空中）
    const geom = new THREE.BufferGeometry().setFromPoints(this.path);
    geom.setDrawRange(0, 0);
    this.tracer = new THREE.Line(geom, new THREE.LineBasicMaterial({ color: 0xff6b5b }));
    this.dynamic.add(this.tracer);
    const airCurve = new THREE.CatmullRomCurve3(fl.pts.filter((_, i) => i % 3 === 0 || i === fl.pts.length - 1).map(V));
    this.tube = new THREE.Mesh(new THREE.TubeGeometry(airCurve, 240, 0.22, 6, false), new THREE.MeshBasicMaterial({ color: 0xff6b5b }));
    this.tube.geometry.setDrawRange(0, 0);
    this.tubeCount = this.tube.geometry.index.count;
    this.dynamic.add(this.tube);
    // 着地点と止まった位置
    const c = V(fl.carryPt);
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3, 32), new THREE.MeshBasicMaterial({ color: 0xf2c230, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(c).setY(0.05);
    this.dynamic.add(ring);
    const lc = makeLabel(`キャリー ${Math.round(fl.carry)}m`, { size: 7, color: '#f2c230' });
    lc.position.copy(c).setY(9);
    this.dynamic.add(lc);
    const tp = V(fl.totalPt);
    const flag = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    flag.position.copy(tp).setY(2.5);
    this.dynamic.add(flag);
    const lt = makeLabel(`止まった所 ${Math.round(fl.total)}m`, { size: 7 });
    lt.position.copy(tp).setY(18);
    this.dynamic.add(lt);
    this.fl = fl;
    this.setCamera(this.view || 'behind');
    this.play();
  }

  play() {
    this.anim = { start: performance.now() };
  }

  tick() {
    if (!this.anim || !this.path) return;
    const tt = (performance.now() - this.anim.start) / 1000;
    const t = this.times;
    let i = 0;
    while (i < t.length - 1 && t[i + 1] < tt) i++;
    const p = this.path[Math.min(i, this.path.length - 1)];
    this.ball.position.copy(p).setY(p.y + 0.6);
    this.tracer.geometry.setDrawRange(0, i + 1);
    const airFrac = Math.min(1, (i + 1) / this.nAir);
    this.tube.geometry.setDrawRange(0, Math.floor((this.tubeCount * airFrac) / 3) * 3);
    if (this.view === 'chase') {
      this.camera.position.lerp(p.clone().add(new THREE.Vector3(-35, 12, 0)), 0.08);
      this.controls.target.lerp(p, 0.12);
    }
    if (tt > t[t.length - 1]) this.anim = null;
  }

  setCamera(view) {
    this.view = view;
    const fl = this.fl;
    const far = fl ? fl.total : 200;
    if (view === 'top') this.look(new THREE.Vector3(far * 0.5, far * 1.05, 0.01), new THREE.Vector3(far * 0.5, 0, 0));
    else if (view === 'chase') this.look(new THREE.Vector3(-20, 8, 0), new THREE.Vector3(10, 4, 0));
    else this.look(new THREE.Vector3(-30, 14, 0), new THREE.Vector3(far * 0.55, 0, (fl ? fl.offline * 0.4 : 0) * (this.mirror || 1)));
  }
}

function capsuleBetween(a, b, r, mat) {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 12), mat);
  mesh.position.copy(a).lerp(b, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return mesh;
}
function placeCylinder(mesh, a, b) {
  const len = a.distanceTo(b);
  mesh.scale.set(1, len, 1);
  mesh.position.copy(a).lerp(b, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
}
