// Orca desktop pet — heading-based swimming, corner resting, drag, glass bubble.
//
// The motion model from the swimming spec: she has a HEADING and a forward speed, and she
// can only go where the nose points. Turning is rate-limited, so a 180 always becomes a
// visible arc, never a slide or a reverse. Speed drops while she turns, which is what makes
// it read as swimming rather than sliding.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const canvas = document.getElementById('c');
let W = window.innerWidth;
let H = window.innerHeight;
const MARGIN = 120;            // keeps flukes and fins off the edges

const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(1.6, 2.6, 8.4);
camera.lookAt(0, 0.1, 0);

const key = new THREE.DirectionalLight(0xffffff, 1.9); key.position.set(2.4, 5.2, 3.2); scene.add(key);
const fill = new THREE.DirectionalLight(0x9dc6e8, 1.6); fill.position.set(-3.6, 1.0, 2.2); scene.add(fill);
const rim = new THREE.DirectionalLight(0xbfe6ff, 1.5); rim.position.set(-1.4, 2.0, -5.0); scene.add(rim);
scene.add(new THREE.HemisphereLight(0xdcefff, 0x14232c, 1.2));

const uniforms = {
  uTime: { value: 0 }, uSwim: { value: 1.0 }, uJaw: { value: 0.0 }, uBend: { value: 0.0 },
  uZMin: { value: -2.5 }, uZMax: { value: 2.5 }, uAmp: { value: 0.22 },
  uPhase: { value: 0 }, uSwing: { value: 1 }
};

const root = new THREE.Group();
scene.add(root);


let pivot = null;
const headPoint = new THREE.Vector3();

// ---------------------------------------------------------------- materials
function patchSwim(m) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSwim = uniforms.uSwim;
    shader.uniforms.uJaw = uniforms.uJaw;
    shader.uniforms.uBend = uniforms.uBend;
    shader.uniforms.uZMin = uniforms.uZMin;
    shader.uniforms.uZMax = uniforms.uZMax;
    shader.uniforms.uAmp = uniforms.uAmp;
    shader.uniforms.uPhase = uniforms.uPhase;
    shader.uniforms.uSwing = uniforms.uSwing;
    shader.uniforms.uPhase = uniforms.uPhase;
    shader.uniforms.uSwing = uniforms.uSwing;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uSwim; uniform float uJaw; uniform float uBend;
        uniform float uZMin; uniform float uZMax; uniform float uAmp;
        uniform float uPhase; uniform float uSwing;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float z = position.z;
          float along = 1.0 - clamp((z - uZMin) / max(0.001, uZMax - uZMin), 0.0, 1.0);
          float bodyLen = uZMax - uZMin;
          float amp = pow(along, 3.0);
          float k = 6.28318 / (bodyLen * 0.62);
          float phase = uPhase;        // advanced at a rate set by her swim speed
          transformed.y += sin(z * k + phase) * uAmp * uSwing * amp * uSwim;
          transformed.y -= amp * 0.30 * (1.0 - cos(z * k + phase)) * uAmp * uSwing * uSwim * 0.5;
          transformed.x += sin(z * k * 0.8 + phase) * 0.02 * bodyLen * amp * uSwim;
          transformed.y += uBend * pow(along, 1.6) * 0.35;
        }`);
  };
  m.needsUpdate = true;
}

// ---------------------------------------------------------------- Moonlit Pearl skin
const PEARL = {
  body: new THREE.Color(0x1B3048),      // midnight ocean blue
  pearl: new THREE.Color(0xF1F7F7),     // pearl white belly + eye patches
  fin: new THREE.Color(0x9FCEDB),       // ice blue fin edges
  lavender: new THREE.Color(0xB9A9DF),  // iridescent highlight
  seafoam: new THREE.Color(0xA8E9E8)    // rim glow
};

function makePearlMaterial(src) {
  const m = new THREE.MeshPhysicalMaterial({
    map: src.map || null,
    normalMap: src.normalMap || null,
    normalScale: src.normalScale ? src.normalScale.clone() : new THREE.Vector2(0.8, 0.8),
    roughness: 0.62,
    metalness: 0.0,
    clearcoat: 0.22,
    clearcoatRoughness: 0.45,
    iridescence: 0.42,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [120, 420],
    transmission: 0.05,                  // satin glass, still opaque enough to be an animal
    thickness: 0.6,
    attenuationColor: new THREE.Color(0x9FCEDB),
    attenuationDistance: 1.4,
    ior: 1.38,
    envMapIntensity: 0.35,
    side: THREE.FrontSide
  });

  // two-tone the markings: the asset's texture is a black/white mask, so the body colour and
  // the pearl white are mixed by luminance instead of tinting everything blue.
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBody = { value: PEARL.body };
    shader.uniforms.uPearl = { value: PEARL.pearl };

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uBody; uniform vec3 uPearl;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec3 src = texture2D(map, vMapUv).rgb;
          float lum = dot(src, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = mix(uBody, uPearl, smoothstep(0.58, 0.86, lum));
        }`);

    // re-use the swim/jaw vertex patch
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSwim = uniforms.uSwim;
    shader.uniforms.uJaw = uniforms.uJaw;
    shader.uniforms.uBend = uniforms.uBend;
    shader.uniforms.uZMin = uniforms.uZMin;
    shader.uniforms.uZMax = uniforms.uZMax;
    shader.uniforms.uAmp = uniforms.uAmp;
    shader.uniforms.uPhase = uniforms.uPhase;
    shader.uniforms.uSwing = uniforms.uSwing;
    shader.uniforms.uPhase = uniforms.uPhase;
    shader.uniforms.uSwing = uniforms.uSwing;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uSwim; uniform float uJaw; uniform float uBend;
        uniform float uZMin; uniform float uZMax; uniform float uAmp;
        uniform float uPhase; uniform float uSwing;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float z = position.z;
          float along = 1.0 - clamp((z - uZMin) / max(0.001, uZMax - uZMin), 0.0, 1.0);
          float bodyLen = uZMax - uZMin;
          float amp = pow(along, 3.0);
          float k = 6.28318 / (bodyLen * 0.62);
          float phase = uPhase;        // advanced at a rate set by her swim speed
          transformed.y += sin(z * k + phase) * uAmp * uSwing * amp * uSwim;
          transformed.y -= amp * 0.30 * (1.0 - cos(z * k + phase)) * uAmp * uSwing * uSwim * 0.5;
          transformed.y += uBend * pow(along, 1.6) * 0.35;
        }`);
  };
  return m;
}

const loader = new GLTFLoader();
loader.load('assets/orca-bought.glb', (gltf) => {
  const inner = new THREE.Group();
  inner.add(gltf.scene);
  inner.updateMatrixWorld(true);

  // bake orientation into the vertices: Y-up, length along Z, nose at -Z
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.applyMatrix4(o.matrixWorld);
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.scale.set(1, 1, 1);
  });
  gltf.scene.position.set(0, 0, 0);
  gltf.scene.rotation.set(0, 0, 0);
  gltf.scene.scale.set(1, 1, 1);

  // This asset's axes are unknown, so find the body axis and rotate it onto Z.
  let box = new THREE.Box3().setFromObject(inner);
  let size = new THREE.Vector3();
  box.getSize(size);
  if (size.x > size.y && size.x > size.z) {
    gltf.scene.traverse((o) => { if (o.isMesh) o.geometry.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2)); });
  } else if (size.y > size.x && size.y > size.z) {
    gltf.scene.traverse((o) => { if (o.isMesh) o.geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2)); });
  }
  inner.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(inner);
  const mid = new THREE.Vector3();
  box.getSize(size); box.getCenter(mid);
  console.log('BAKED_BBOX', size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2));
  uniforms.uZMin.value = mid.z - size.z / 2;
  uniforms.uZMax.value = mid.z + size.z / 2;
  uniforms.uAmp.value = size.z * 0.055;      // ~5.5% of body length at the flukes
  inner.position.set(-mid.x, -mid.y, -mid.z);

  pivot = new THREE.Group();
  pivot.add(inner);
  const camDist = camera.position.length();
  const visibleH = 2 * camDist * Math.tan((camera.fov * Math.PI / 180) / 2);
  const worldPerPx = (visibleH * camera.aspect) / W;
  const targetPx = Math.max(160, Math.min(380, W * 0.185));
  pivot.scale.setScalar((targetPx * worldPerPx) / size.z);
  window.__targetPx = targetPx;
  window.__bodyLen = size.z;
  root.add(pivot);

  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.material;
    if (src.map) src.map.colorSpace = THREE.SRGBColorSpace;
    if (src.normalMap) src.normalScale.set(0.85, 0.85);

    // the shipped material stays available as the natural fallback
    src.roughness = 0.9;
    src.metalness = 0.0;
    src.envMapIntensity = 0.06;
    patchSwim(src);

    const pearl = makePearlMaterial(src);
    o.userData.naturalMat = src;
    o.userData.pearlMat = pearl;
    o.material = src;      // natural black-and-white orca by default
    // pearl remains one tray click away
  });

  // report the on-screen size once, so the scale is tuned against pixels not guesses
  setTimeout(() => {
    const b = new THREE.Box3().setFromObject(pivot);
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3(
        i & 1 ? b.max.x : b.min.x,
        i & 2 ? b.max.y : b.min.y,
        i & 4 ? b.max.z : b.min.z
      ).project(camera);
      pts.push(v);
    }
    const xs = pts.map(p => (p.x * 0.5 + 0.5) * W);
    const ys = pts.map(p => (-p.y * 0.5 + 0.5) * H);
    console.log('SCREEN_SIZE', Math.round(Math.max(...xs) - Math.min(...xs)), 'x',
                Math.round(Math.max(...ys) - Math.min(...ys)), 'px of', W, H);
  }, 900);
  window.__orcaReady = true;
}, undefined, (err) => { window.__orcaError = String(err); console.error(err); });

// ---------------------------------------------------------------- motion model
const now = () => performance.now() / 1000;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function spring(cur, target, dt, rate) {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

// heading: 0 = travelling right, π/2 = down, π = left. Speed is always forward.
const pose = {
  x: W * 0.72, y: H * 0.66,
  heading: Math.PI,
  speed: 0,
  roll: 0, pitch: 0, jaw: 0, bend: 0, yaw: Math.PI
};
const aim = { x: pose.x, y: pose.y };

const CRUISE = 58;       // px/s — inside the 35-85 spec band
const TURN_RATE = 1.25;  // rad/s — a 180 takes ~2.5 s

// Rest anchors are inset further than the swim margin: her body is ~400 px long, so a
// corner at the raw margin leaves her nose or flukes hanging off the stage.
const REST_X = W * 0.34, REST_Y = H * 0.30;
const CORNERS = [
  { x: W - REST_X, y: H - REST_Y },
  { x: REST_X, y: H - REST_Y },
  { x: W - REST_X, y: REST_Y },
  { x: REST_X, y: REST_Y }
];

const S = {
  REST: 'rest', SWIM: 'swim', CIRCLE: 'circle', FACE: 'face', PATROL: 'patrol',
  DEPART: 'depart', DRAG: 'drag', SETTLE: 'settle', ROLL: 'roll',
  FIG8: 'fig8', LOOP: 'loop'
};
const state = { name: S.SWIM, t: 0, until: 0, circleDir: 1, circleT: 0, anchor: null, spin: 0, nextTrick: 0 };

function enter(name) { state.name = name; state.t = 0; }

function startRoll() {
  enter(S.ROLL);
  state.until = now() + 3.0;
}

function startFig8() {
  enter(S.FIG8);
  state.trickT = 0;
  state.cx = clamp(pose.x, W * 0.35, W * 0.65);
  state.cy = clamp(pose.y, H * 0.40, H * 0.70);
  state.until = now() + 11;
}

function startLoop() {
  enter(S.LOOP);
  state.trickT = 0;
  state.cx = clamp(pose.x, W * 0.35, W * 0.65);
  state.cy = clamp(pose.y, H * 0.35, H * 0.68);
  state.until = now() + 9;
}

// the three tricks, in the order she asked for them
const TRICKS = [
  { name: 'barrel roll', run: startRoll }
];
let trickIndex = 0;

function nextTrick() {
  const t = TRICKS[trickIndex % TRICKS.length];
  trickIndex++;
  held = false;                   // a trick needs room to swim
  bubble.classList.remove('show');
  t.run();
  return t.name;
}

function pickTrick() {
  // a barrel roll reads best while she is cruising, not while resting
  if (Math.random() < 0.55) startRoll();
  else goCircle();
}

function nearestCorner() {
  let best = CORNERS[0], bd = 1e9;
  for (const c of CORNERS) {
    const d = (c.x - pose.x) ** 2 + (c.y - pose.y) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function goRest() {
  const c = nearestCorner();
  aim.x = c.x; aim.y = c.y;
  enter(S.REST);
  state.until = now() + rand(20, 60);          // spec: 20-60 s, sometimes longer
}

function goExplore() {
  // exploration stays near the edges, never straight through the middle
  const edge = Math.floor(rand(0, 4));
  const t = rand(0.15, 0.85);
  aim.x = edge < 2 ? rand(MARGIN, W - MARGIN) : (edge === 2 ? W - MARGIN * 0.8 : MARGIN * 0.8);
  aim.y = edge >= 2 ? rand(MARGIN, H - MARGIN) : (edge === 0 ? H - MARGIN * 0.8 : MARGIN * 0.8);
  aim.x = clamp(aim.x, MARGIN, W - MARGIN);
  aim.y = clamp(aim.y, MARGIN, H - MARGIN);
  enter(S.SWIM);
  state.until = now() + rand(5, 12);
}

function goPatrol() {
  enter(S.PATROL);
  state.patrolDir = Math.random() < 0.5 ? 1 : -1;
  state.crossings = 0;
  state.until = now() + rand(12, 20);
}

function goCircle() {
  enter(S.CIRCLE);
  state.circleT = 0;
  state.circleDir = Math.random() < 0.5 ? 1 : -1;
  state.until = now() + rand(10, 15);
}

function faceViewer() {
  enter(S.FACE);
  bubble.classList.add('show');
  aim.x = W * 0.5; aim.y = H * 0.5;
}

let held = false;

function hold() {
  held = true;
  faceViewer();
  state.anchor = { x: pose.x, y: pose.y };
  aim.x = pose.x; aim.y = pose.y;
  bubble.classList.add('show');
}

function release() {
  held = false;
  bubble.classList.remove('show');
  goExplore();          // free to swim anywhere again
}

function depart() {
  enter(S.DEPART);
  bubble.classList.remove('show');
  const goRight = pose.x < W * 0.5;
  aim.x = goRight ? W - MARGIN : MARGIN;
  aim.y = clamp(pose.y + rand(-80, 80), MARGIN, H - MARGIN);
}

// ---------------------------------------------------------------- steering
function steer(dt, targetX, targetY, speedScale = 1) {
  const dx = targetX - pose.x;
  const dy = targetY - pose.y;
  const dist = Math.hypot(dx, dy);
  const wanted = Math.atan2(dy, dx);
  const delta = wrapAngle(wanted - pose.heading);

  // rate-limited turn: she always arcs into a new direction instead of sliding
  const maxTurn = TURN_RATE * dt;
  pose.heading = wrapAngle(pose.heading + clamp(delta, -maxTurn, maxTurn));

  // slow down while turning hard, accelerate when aligned
  const alignment = Math.max(0.18, Math.cos(clamp(delta, -1.2, 1.2)));
  const wantedSpeed = Math.min(CRUISE, dist * 1.6) * alignment * speedScale;
  pose.speed = spring(pose.speed, wantedSpeed, dt, 1.8);

  pose.x += Math.cos(pose.heading) * pose.speed * dt;
  pose.y += Math.sin(pose.heading) * pose.speed * dt;

  // body banks into the turn
  pose.roll = spring(pose.roll, clamp(delta, -0.5, 0.5) * 0.35, dt, 2.2);
  return dist;
}

let HALF_LEN = (window.__targetPx || 250) / 2;   // px, half her visible length
const HALF_HGT = 95;

function clampToScreen() {
  const mx = HALF_LEN, my = HALF_HGT;
  if (pose.x < mx) { pose.x = mx; pose.heading = 0; pose.speed *= 0.5; }
  if (pose.x > W - mx) { pose.x = W - mx; pose.heading = Math.PI; pose.speed *= 0.5; }
  if (pose.y < my + 30) { pose.y = my + 30; pose.speed *= 0.7; }
  if (pose.y > H - my) { pose.y = H - my; pose.speed *= 0.7; }
}

function clampToScreenLegacy() {
  const m = MARGIN * 0.72;
  if (pose.x < m) { pose.x = m; pose.heading = 0; pose.speed *= 0.6; }
  if (pose.x > W - m) { pose.x = W - m; pose.heading = Math.PI; pose.speed *= 0.6; }
  if (pose.y < m) { pose.y = m; pose.heading = Math.PI * 0.5; pose.speed *= 0.6; }
  if (pose.y > H - m) { pose.y = H - m; pose.heading = -Math.PI * 0.5; pose.speed *= 0.6; }
}

function updateState(dt) {
  state.t += dt;
  const t = now();

  switch (state.name) {
    case S.REST: {
      // station-keeping: she floats near the anchor, never fully frozen
      const c = nearestCorner();
      aim.x = c.x + Math.sin(t * 0.35) * 7;
      aim.y = c.y + Math.cos(t * 0.28) * 5;
      const d = steer(dt, aim.x, aim.y, 0.28);
      if (d < 26 && state.t > 3) pose.speed = spring(pose.speed, 2.5, dt, 2);
      if (t > state.until) {
        if (t > (state.nextTrick || 0)) {
          state.nextTrick = t + rand(35, 70);   // rare, and never back to back
          pickTrick();
        } else goExplore();
      }
      break;
    }

    case S.SWIM: {
      const d = steer(dt, aim.x, aim.y, 1);
      if (d < 40 || t > state.until) goRest();
      break;
    }

    case S.PATROL: {
      // sweep across, turn, sweep back: the back-and-forth she asked for
      const y = H * 0.62 + Math.sin(now() * 0.3) * 40;
      if (state.patrolDir > 0) {
        aim.x = W - HALF_LEN - 60; aim.y = y;
        if (pose.x > W - HALF_LEN - 90) state.patrolDir = -1;
      } else {
        aim.x = HALF_LEN + 60; aim.y = y;
        if (pose.x < HALF_LEN + 90) state.patrolDir = 1;
      }
      steer(dt, aim.x, aim.y, 1);
      if (t > state.until) goRest();
      break;
    }

    case S.CIRCLE: {
      state.circleT += dt;
      const a = state.circleT * 0.55 * state.circleDir;
      aim.x = W * 0.5 + Math.cos(a) * 210;
      aim.y = H * 0.5 + Math.sin(a) * 105;
      steer(dt, aim.x, aim.y, 0.85);
      pose.roll = state.circleDir * 0.18;
      if (t > state.until) goRest();
      break;
    }

    case S.FACE: {
      // held: stay exactly where she was clicked
      if (held && state.anchor) { aim.x = state.anchor.x; aim.y = state.anchor.y; }
      const d = steer(dt, aim.x, aim.y, held ? 0.15 : 0.5);
      if (d < 30) pose.speed = spring(pose.speed, 1.5, dt, 2.4);
      // phases: 0-0.4 slow, 0.4-1.5 turn, 1.5-2.2 curious, 2.2-4.5 look around
      if (held) {
        const baseX = state.anchor ? state.anchor.x : W * 0.5;
        pose.jaw = spring(pose.jaw, 0.20, dt, 4);
        aim.x = baseX + Math.sin(now() * 0.55) * 30;      // slow look, left then right
      } else if (state.t < 0.4) pose.jaw = spring(pose.jaw, 0.12, dt, 4);
      else if (state.t < 1.5) pose.jaw = spring(pose.jaw, 0.5, dt, 4);
      else if (state.t < 2.2) pose.jaw = spring(pose.jaw, 0.85, dt, 4);
      else if (state.t < 9.0) {
        // slow, deliberate sweep: 3.5 s left, 3.5 s right, as if looking at you
        pose.jaw = spring(pose.jaw, 0.30, dt, 4);
        const baseX = state.anchor ? state.anchor.x : W * 0.5;
        aim.x = baseX + Math.sin((state.t - 2.2) * 0.9) * 26;
      } else pose.jaw = spring(pose.jaw, 0.26, dt, 3);
      break;
    }

    case S.DEPART: {
      const d = steer(dt, aim.x, aim.y, 1);
      pose.jaw = spring(pose.jaw, 0, dt, 4);
      if (d < 50 || state.t > 6) goRest();
      break;
    }

    case S.FIG8: {
      // one full figure-eight: x sweeps once, y twice — a proper crossing path
      state.trickT += dt;
      const a = (state.trickT / 9.0) * Math.PI * 2;
      const ax = W * 0.32;                 // nearly full width: an infinity across the screen
      const ay = H * 0.22;
      aim.x = state.cx + Math.sin(a) * ax;
      aim.y = state.cy + Math.sin(a * 2) * ay * 0.5;
      steer(dt, aim.x, aim.y, 1.05);
      pose.roll = Math.cos(a) * 0.14;
      if (state.trickT > 9.4) { pose.roll = 0; enter(S.FACE); }
      break;
    }

    case S.LOOP: {
      // a big vertical O, nose up the far side and over the top
      state.trickT += dt;
      const a = (state.trickT / 7.4) * Math.PI * 2;
      const ax = W * 0.30;                 // a big O, not a small circle
      const ay = H * 0.30;
      aim.x = state.cx + Math.cos(a) * ax;
      aim.y = state.cy + Math.sin(a) * ay;
      steer(dt, aim.x, aim.y, 1.1);
      pose.roll = -Math.sin(a) * 0.18;
      if (state.trickT > 7.8) { pose.roll = 0; enter(S.FACE); }
      break;
    }

    case S.ROLL: {
      // one slow revolution around her long axis, while still drifting forward
      const p = Math.min(1, state.t / 2.4);
      const e = p * p * (3 - 2 * p);
      state.spin = -e * Math.PI * 2;
      steer(dt, aim.x, aim.y, 0.55);
      if (state.t > 2.6) {
        state.spin = 0;
        enter(S.SWIM);
        state.until = now() + rand(20, 40);
      }
      break;
    }

    case S.SETTLE: {
      pose.speed = spring(pose.speed, 0, dt, 3);
      pose.jaw = spring(pose.jaw, 0, dt, 4);
      if (state.t > 2.2) { enter(S.REST); state.until = now() + rand(20, 60); }
      break;
    }

    case S.DRAG:
      pose.speed = spring(pose.speed, 0, dt, 6);
      break;
  }

  if (state.name !== S.FACE) pose.jaw = spring(pose.jaw, 0, dt, 3);
  clampToScreen();
}

// ---------------------------------------------------------------- render loop
let last = now();
let swimPhase = 0;
let frozen = false;         // test hook: stop the steering so a pose can be inspected
const proj = new THREE.Vector3();

function frame() {
  const t = now();
  const dt = Math.min(0.05, t - last);
  last = t;

  if (!frozen && state.name !== S.DRAG) updateState(dt);

  uniforms.uTime.value = t;
  // tail beat rate follows her speed: ~0.22 Hz resting, ~0.55 Hz cruising
  const speedRatio = Math.min(1.5, pose.speed / CRUISE);
  swimPhase += dt * (1.4 + 2.0 * speedRatio);
  uniforms.uPhase.value = swimPhase;
  uniforms.uSwing.value = 0.45 + 0.65 * speedRatio;
  uniforms.uSwim.value = spring(uniforms.uSwim.value, state.name === S.FACE ? 0.45 : 1, dt, 1.6);
  uniforms.uJaw.value = pose.jaw;
  uniforms.uBend.value = pose.bend;

  if (pivot) {
    // heading -> visual yaw: nose right at -π/2, nose left at +π/2, head-on at 0
    // in FACE she turns her whole body toward the camera; otherwise yaw follows travel
    const sideYaw = Math.cos(pose.heading) >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
    const targetYaw = state.name === S.FACE ? Math.PI * 0.10 : sideYaw;
    const yawRate = state.name === S.FACE ? 3.4 : 1.6;
    const dyaw = wrapAngle(targetYaw - pose.yaw);
    pose.yaw = wrapAngle(pose.yaw + dyaw * (1 - Math.exp(-yawRate * dt)));
    const yaw = pose.yaw;
    root.position.set((pose.x / W - 0.5) * 6.4, -(pose.y / H - 0.5) * 4.0, 0);
    root.rotation.y = yaw;
    root.rotation.z = -pose.roll * 0.5;
    root.rotation.x = clamp(Math.sin(pose.heading) * 0.12, -0.2, 0.2) + (state.spin || 0);
  }

  // bubble follows the head, projected from 3D so it tracks her through turns
  if (pivot) {
    headPoint.set(0, 0.42, -1.75);
    pivot.localToWorld(headPoint);
    proj.copy(headPoint).project(camera);
    const sx = (proj.x * 0.5 + 0.5) * W;
    const sy = (-proj.y * 0.5 + 0.5) * H;
    bubble.style.left = sx.toFixed(1) + 'px';
    bubble.style.top = (sy - 58).toFixed(1) + 'px';
    const scale = clamp(0.55 + 180 / Math.max(300, sy + 420), 0.62, 0.86);
    bubble.style.transform = `translate(-50%, -100%) scale(${scale.toFixed(3)})`;
  }

  // report her screen rectangle ~12x a second; the main process uses it for click-through
  if (pivot && t - (window.__lastRect || 0) > 0.033) {
    window.__lastRect = t;
    const b = new THREE.Box3().setFromObject(pivot);
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < 8; i++) {
      const v = new THREE.Vector3(
        i & 1 ? b.max.x : b.min.x,
        i & 2 ? b.max.y : b.min.y,
        i & 4 ? b.max.z : b.min.z
      ).project(camera);
      const sx = (v.x * 0.5 + 0.5) * W;
      const sy = (-v.y * 0.5 + 0.5) * H;
      x0 = Math.min(x0, sx); y0 = Math.min(y0, sy);
      x1 = Math.max(x1, sx); y1 = Math.max(y1, sy);
    }
    let rx = x0, ry = y0, rw = x1 - x0, rh = y1 - y0;

    // Her body and the card are reported as TWO rects, not one merged box: a merged box
    // would swallow clicks in the empty gap between her head and the card.
    const body = { x: rx, y: ry, w: rw, h: rh };
    let card = null;
    if (bubble.classList.contains('show')) {
      const br = bubble.getBoundingClientRect();
      if (br.width > 4 && br.height > 4) card = { x: br.left, y: br.top, w: br.width, h: br.height };
    }
    window.__centreX = rx + rw / 2;
    window.__centreY = ry + rh / 2;
    if (window.pet && window.pet.reportRect) window.pet.reportRect({ body, card });

    // contact shadow: an ellipse under the body, sized from what the camera sees
    const shadowEl = document.getElementById('shadow');
    if (shadowEl) {
      const sw = Math.max(70, rw * 0.70);
      const sh = Math.max(12, Math.min(34, rw * 0.10));
      shadowEl.style.width = sw.toFixed(0) + 'px';
      shadowEl.style.height = sh.toFixed(0) + 'px';
      shadowEl.style.left = (rx + rw / 2).toFixed(0) + 'px';
      shadowEl.style.top = (ry + rh + sh * 0.5).toFixed(0) + 'px';
      shadowEl.style.opacity = (0.50 * pose.zoom).toFixed(2);
    }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- input: click, drag
const bubble = document.getElementById('bubble');   // stays hidden until she is clicked

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function hitTest(cx, cy) {
  if (!pivot) return false;
  const rect = canvas.getBoundingClientRect();
  ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
  ray.setFromCamera(ndc, camera);
  return ray.intersectObject(root, true).length > 0;
}

let over = false;
let press = null;        // {x, y, offsetX, offsetY, moved}
let lastClickAt = 0;
let lastClickPos = { x: 0, y: 0 };
const DRAG_PX = 6;

canvas.addEventListener('pointermove', (e) => {
  if (press) {
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!press.moved && Math.hypot(dx, dy) > DRAG_PX) {
      press.moved = true;
      enter(S.DRAG);                 // cancel navigation immediately
      pose.speed = 0;
    }
    if (press.moved) {
      // follow the cursor with the original grab offset, lightly smoothed
      const tx = e.clientX - press.offsetX;
      const ty = e.clientY - press.offsetY;
      pose.x = spring(pose.x, clamp(tx, 40, W - 40), 1 / 60, 22);
      pose.y = spring(pose.y, clamp(ty, 40, H - 40), 1 / 60, 22);
      aim.x = pose.x; aim.y = pose.y;
    }
    return;
  }

  const inside = hitTest(e.clientX, e.clientY);
  if (inside !== over) {
    over = inside;
    if (window.pet) window.pet.hitTest(inside);
    document.body.style.cursor = inside ? 'grab' : 'default';
  }
});

canvas.addEventListener('pointerdown', (e) => {
  const nearMiss = Math.hypot(e.clientX - window.__centreX, e.clientY - window.__centreY) < 22;
  const onBody = hitTest(e.clientX, e.clientY);
  if (!onBody && !nearMiss) return;
  press = { x: e.clientX, y: e.clientY, offsetX: e.clientX - pose.x, offsetY: e.clientY - pose.y, moved: false };
  canvas.setPointerCapture(e.pointerId);
  document.body.style.cursor = 'grabbing';
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (held) release();
});

canvas.addEventListener('dblclick', (e) => {
  if (!hitTest(e.clientX, e.clientY)) return;
  const name = nextTrick();       // roll -> figure 8 -> loop -> roll ...
  console.log('trick:', name);
});

canvas.addEventListener('pointerup', (e) => {
  if (window.pet && window.pet.releaseFocus) setTimeout(() => window.pet.releaseFocus(), 60);
  if (!press) return;
  const wasDrag = press.moved;
  press = null;
  document.body.style.cursor = over ? 'grab' : 'default';
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}

  if (wasDrag) {
    // released: this position is now the user's anchor and outranks corner preference
    enter(S.SETTLE);
    aim.x = pose.x; aim.y = pose.y;
  } else {
    if (held) release();            // click again: bubble away, she swims free
    else hold();                    // first click: bubble appears, she stays put
  }
});

function resizeToViewport() {
  W = window.innerWidth;
  H = window.innerHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  if (pivot && window.__bodyLen) {
    const camDist = camera.position.length();
    const visibleH = 2 * camDist * Math.tan((camera.fov * Math.PI / 180) / 2);
    const worldPerPx = (visibleH * camera.aspect) / W;
    const targetPx = Math.max(160, Math.min(380, W * 0.185));
    pivot.scale.setScalar((targetPx * worldPerPx) / window.__bodyLen);
    HALF_LEN = targetPx / 2;
  }
}

window.addEventListener('resize', resizeToViewport);

window.addEventListener('click', (e) => {
  if (held && e.target === canvas) {
    // canvas clicks are already handled above; this covers everything else in the window
    return;
  }
  if (held) release();
}, true);

window.addEventListener('mousedown', (e) => {
  if (!hitTest(e.clientX, e.clientY)) e.preventDefault();
});

// ---------------------------------------------------------------- Spotify surface
const sp = {
  title: document.getElementById('title'),
  artist: document.getElementById('artist'),
  status: document.getElementById('status'),
  dot: document.getElementById('dot'),
  art: document.getElementById('art'),
  prog: document.getElementById('prog'),
  tNow: document.getElementById('tNow'),
  tLeft: document.getElementById('tLeft')
};

function fmt(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}

// Real data only: nothing here invents a track. Until Spotify is connected it says so.
window.__spotify = {
  update(t) {
    if (!t) {
      sp.status.textContent = 'Waiting for music';
      sp.title.textContent = 'Nothing playing';
      sp.artist.textContent = 'Start a track in Spotify';
      sp.dot.classList.add('idle');
      sp.prog.style.width = '0%';
      return;
    }
    sp.title.textContent = t.title || 'Unknown track';
    sp.artist.textContent = t.artist || '';
    sp.status.textContent = t.playing ? 'Currently playing' : 'Paused';
    sp.dot.classList.toggle('idle', !t.playing);
    if (t.art) sp.art.innerHTML = `<img src="${t.art}" alt="">`;
    const pct = t.duration ? (t.progress / t.duration) * 100 : 0;
    sp.prog.style.width = clamp(pct, 0, 100) + '%';
    sp.tNow.textContent = fmt(t.progress);
    sp.tLeft.textContent = '-' + fmt((t.duration || 0) - (t.progress || 0));
  }
};
// Spotify is driven by the main process: it holds the tokens and polls the Web API.
// The card never invents a track — with no playback it says so honestly.
if (window.pet && window.pet.spotify) {
  window.pet.spotify.onUpdate((data) => {
    if (!data) {
      window.__spotify.update(null);
      return;
    }
    if (data.needsAuth) {
      sp.status.textContent = 'Reconnect needed';
      sp.title.textContent = 'Spotify session expired';
      sp.artist.textContent = 'Tray menu → Connect Spotify';
      sp.dot.classList.add('idle');
      return;
    }
    window.__spotify.update(data);
  });

  document.querySelectorAll('.controls button').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const r = await window.pet.spotify.control(b.dataset.act);
      if (r && r.status === 403) {
        sp.status.textContent = 'Premium required';
        sp.artist.textContent = 'Spotify limits controls to Premium';
      }
    });
  });

  window.pet.spotify.status().then((s) => {
    if (!s.connected) {
      sp.title.textContent = 'Not connected';
      sp.artist.textContent = s.hasClientId ? 'Tray → Connect Spotify' : 'Add spotify.json, then connect';
    }
  }).catch(() => {});
}

window.__spotify.update(null);

document.querySelectorAll('.controls button').forEach((b) => {
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
});

// ---------------------------------------------------------------- pearl / natural swap
let naturalSkin = false;

function setNatural(on) {
  naturalSkin = on;
  if (!body) return;
  body.traverse((o) => {
    if (!o.isMesh || !o.userData.pearlMat) return;
    o.material = on ? o.userData.naturalMat : o.userData.pearlMat;
  });
}

if (window.pet && window.pet.onNatural) window.pet.onNatural(setNatural);

// ---------------------------------------------------------------- test hooks
window.__orca = {
  state: () => ({ name: state.name, pose: { ...pose }, aim: { ...aim }, jaw: pose.jaw }),
  force: (n) => enter(n),
  goRest, goExplore, goCircle, faceViewer, depart,
  hitTest,
  setBackdrop: (on) => { scene.background = on ? new THREE.Color(0xcfdde6) : null; },
  setJaw: (v) => { pose.jaw = v; },
  // measure what the camera actually sees at each yaw: decisive for axis questions
  measureYaw: () => {
    const out = {};
    const saved = frozen; frozen = true;
    for (const y of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      root.rotation.set(0, y, 0);
      root.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(root);
      const pts = [];
      for (let i = 0; i < 8; i++) {
        pts.push(new THREE.Vector3(
          i & 1 ? b.max.x : b.min.x,
          i & 2 ? b.max.y : b.min.y,
          i & 4 ? b.max.z : b.min.z
        ).project(camera));
      }
      const xs = pts.map(q => (q.x * 0.5 + 0.5) * W);
      const ys = pts.map(q => (-q.y * 0.5 + 0.5) * H);
      out['yaw' + Math.round(y * 180 / Math.PI)] = [Math.round(Math.max(...xs) - Math.min(...xs)),
                                                     Math.round(Math.max(...ys) - Math.min(...ys))];
    }
    frozen = saved;
    return out;
  },
  freeze: (v) => { frozen = v; },
  hold, release, nextTrick, setNatural,
  showCard: (on) => bubble.classList.toggle('show', on !== false), trickName: () => TRICKS[(trickIndex - 1 + TRICKS.length) % TRICKS.length].name,
  isHeld: () => held,
  setHeading: (v) => { pose.heading = v; },
  setRoll: (v) => { pose.roll = v; },
  teleport: (x, y) => { pose.x = x; pose.y = y; aim.x = x; aim.y = y; }
};
state.nextTrick = now() + 25;
console.log('orca renderer ready');
