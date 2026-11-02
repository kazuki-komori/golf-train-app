import assert from 'node:assert/strict';
import { analyzeSwing, simulateSwing, SwingDetector, DEFAULT_SETTINGS } from '../engine.js';

const S = { ...DEFAULT_SETTINGS, checks: { ...DEFAULT_SETTINGS.checks } };
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a.toFixed(2)} vs ${b} (±${tol})`);

// 1) 理想スイング
let r = analyzeSwing(simulateSwing({ back: 0.75, down: 0.25, face: 0 }), S);
assert.ok(r.valid, r.reason);
near(r.tempo, 3.0, 0.3, 'tempo');
near(r.face, 0, 4, 'face');
assert.ok(r.planeDev < 8, `planeDev ${r.planeDev}`);
assert.ok(r.pass, JSON.stringify(r.checks));
console.log('ideal', r.tempo.toFixed(2), r.face.toFixed(1), r.planeDev.toFixed(1));

// 2) フェース開き / 閉じ
r = analyzeSwing(simulateSwing({ face: 20 }), S);
near(r.face, 20, 5, 'open face');
assert.equal(r.checks.find((c) => c.key === 'face').pass, false);
r = analyzeSwing(simulateSwing({ face: -20 }), S);
near(r.face, -20, 5, 'closed face');
// 持ち方が逆（ねじれ方向が逆）でも開き・閉じが正しく判定される
r = analyzeSwing(simulateSwing({ face: -20, openRoll: -80 }), S);
near(r.face, 20, 5, 'reversed hold open face');

// 3) 打ち急ぎ
r = analyzeSwing(simulateSwing({ back: 0.45, down: 0.3 }), S);
near(r.tempo, 1.5, 0.3, 'rushed tempo');
assert.equal(r.checks.find((c) => c.key === 'tempo').pass, false);

// 4) 軌道ずれ
r = analyzeSwing(simulateSwing({ planeTilt: 25 }), S);
console.log('planeDev tilted', r.planeDev.toFixed(1));
assert.ok(r.planeDev > 18, `planeDev ${r.planeDev}`);

// 5) リアルタイム検出器を通す
const results = [];
const events = [];
const det = new SwingDetector({ getSettings: () => S, onEvent: (e) => events.push(e), onResult: (x) => results.push(x) });
let t = 0;
for (let i = 0; i < 90; i++) det.push((t += 1 / 60), [1, -1, 0.5]); // アドレス静止
const sw = simulateSwing({ face: 0 });
for (const smp of sw.slice(1)) det.push(t + smp.t, smp.w);
assert.deepEqual(events, ['address', 'start', 'top', 'impact']);
assert.equal(results.length, 1);
assert.ok(results[0].valid && results[0].pass, JSON.stringify(results[0].checks || results[0]));
console.log('detector ok', results[0].tempo.toFixed(2));

// 6) 3D・クラブパス・弾道（重力あり）
const G = [0.5 * 9.8, -0.866 * 9.8, 0];
r = analyzeSwing(simulateSwing({}), S, G);
assert.ok(r.geo, 'geo');
near(r.clubPath, 0, 3, 'ideal path');
near(r.downDev, 0, 3, 'ideal downDev cm');
console.log('ideal path', r.clubPath.toFixed(1), 'attack', r.attack.toFixed(1), r.flight.name);
const head0 = r.geo.head[0];
assert.ok(Math.hypot(...head0) < 1e-6, 'head starts at ball');
// 上から下ろす（面より外側）→ アウトサイドイン、内側から → インサイドアウト
r = analyzeSwing(simulateSwing({ planeTilt: 6 }), S, G);
console.log('steep', r.clubPath.toFixed(1), r.downDev.toFixed(1), r.flight.name);
assert.ok(r.clubPath < -3 && r.downDev > 2 && r.planeDir === 'steep');
r = analyzeSwing(simulateSwing({ planeTilt: -6 }), S, G);
console.log('shallow', r.clubPath.toFixed(1), r.downDev.toFixed(1), r.flight.name);
assert.ok(r.clubPath > 1 && r.downDev < -2 && r.planeDir === 'shallow');
r = analyzeSwing(simulateSwing({ face: 12 }), S, G);
console.log('open12', r.flight.name, r.flight.landing.toFixed(1));
assert.ok(r.flight.landing > 10);
console.log('ALL PASS');
