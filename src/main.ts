// d10 — a real, physically simulated ten-sided die you can grab and throw.
//
// The solid is a pentagonal trapezohedron drawn from scratch each frame on a
// <canvas>: vertices are placed in a small 3D world (a floor with invisible
// walls), projected through one shared camera, depth-sorted, flat-shaded, and
// stamped with each face's digit. The motion is a genuine rigid-body simulation
// (see physics.ts) — nothing is decided up front. Grab the die and flick it, or
// press Roll for a fair machine throw; the number is whichever face lands up.
//
// One camera definition drives both projection (world → screen, for drawing) and
// unprojection (screen → world, for the drag pick) so they can never drift.

import {
  FACES,
  FACE_DIGITS,
  FACE_FRAMES,
  VERTICES,
  cross,
  faceForDigit,
  normalize,
  quatRotate,
  sub,
  type Vec3,
} from "./die3d";
import {
  DEFAULT_BOUNDS,
  autoThrow,
  readResult,
  releasedBody,
  restingBody,
  step,
  type Body,
  type Bounds,
} from "./physics";

// ----- DOM -----
const stage = document.getElementById("stage") as HTMLElement;
const canvas = document.getElementById("dieCanvas") as HTMLCanvasElement;
const btn = document.getElementById("rollBtn") as HTMLButtonElement;
const sparks = document.getElementById("sparks") as HTMLElement;
const live = document.getElementById("live") as HTMLElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

// ----- look & feel tunables (tuned by eye in the browser) -----
const LIGHT: Vec3 = normalize([-0.42, 0.78, 0.55]); // key light (upper-left-front)
const TEAL: readonly [number, number, number] = [108, 246, 224];
const RAMP_LO: readonly [number, number, number] = [38, 21, 74];
const RAMP_MID: readonly [number, number, number] = [123, 79, 214];
const RAMP_HI: readonly [number, number, number] = [205, 170, 255];

// ----- the camera (single source of truth for both directions) -----
const CAM_PITCH = 0.72; // look-down angle (radians) — enough to read the top face
const CAM_DIST = 9.0; // camera distance from the look point (die radii)
const CAM_LOOK: Vec3 = [0, 0.35, 0]; // point the camera centres on (just off the floor)
const SIN_P = Math.sin(CAM_PITCH);
const COS_P = Math.cos(CAM_PITCH);
const CAM_POS: Vec3 = [CAM_LOOK[0], CAM_LOOK[1] + CAM_DIST * SIN_P, CAM_LOOK[2] + CAM_DIST * COS_P];

// ----- physics world -----
// Start from the reference bounds the fairness test uses; `resize` then adapts
// the field width to the viewport aspect so the die stays a readable size on
// everything from a wide desktop to a narrow phone.
const bounds: Bounds = { ...DEFAULT_BOUNDS };
const FIXED_DT = 1 / 180;
const HOLD_Y = 1.9; // height the die rides at while held
let body: Body = restingBody(faceForDigit(10), bounds);
let current = 10;

// ----- canvas sizing (DPR-aware) -----
let dpr = 1;
let boxW = 0;
let boxH = 0;
let cx = 0; // screen point that CAM_LOOK projects to
let cy = 0;
let focal = 0; // focal length in CSS px

function resize(): void {
  const rect = stage.getBoundingClientRect();
  boxW = Math.max(1, rect.width);
  boxH = Math.max(1, rect.height);
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(boxW * dpr);
  canvas.height = Math.round(boxH * dpr);
  cx = boxW / 2;
  cy = boxH * 0.46;
  // Responsive field: keep the depth fixed, but widen the floor on wide screens
  // and narrow it on portrait. This keeps both fits balanced so the die never
  // shrinks to an unreadable size on a phone (where width would otherwise win).
  bounds.z = DEFAULT_BOUNDS.z;
  bounds.x = clamp((bounds.z * boxW) / boxH * 0.9, 2.2, 5.0);
  // Frame the whole play floor (derived from the bounds, so the die always has
  // visible room to roll). A world unit at the look distance spans `unit` px.
  const unit = Math.min(boxW / (2 * bounds.x + 2.6), boxH / (2 * bounds.z + 1.4));
  focal = unit * CAM_DIST;
  render();
}

// ----- camera transforms -----
// World point → [screenX, screenY, depth]. Depth grows with distance (sort key).
function project(p: Vec3): [number, number, number] {
  const dx = p[0] - CAM_POS[0];
  const dy = p[1] - CAM_POS[1];
  const dz = p[2] - CAM_POS[2];
  const xv = dx; // d · right (1,0,0)
  const yv = dy * COS_P - dz * SIN_P; // d · up (0,cos,-sin)
  const zv = -(dy * SIN_P + dz * COS_P); // d · forward (0,-sin,-cos)
  const s = focal / zv;
  return [cx + xv * s, cy - yv * s, zv];
}

// Screen point → the world point where its camera ray meets the plane y = planeY.
// Exact inverse of project(), so a grabbed die sits right under the cursor.
function screenToPlane(sx: number, sy: number, planeY: number): Vec3 {
  const a = (sx - cx) / focal; // = xv / zv
  const b = (cy - sy) / focal; // = yv / zv
  // ray direction = a·right + b·up + forward
  const dir: Vec3 = [a, b * COS_P - SIN_P, -b * SIN_P - COS_P];
  const t = (planeY - CAM_POS[1]) / dir[1];
  return [CAM_POS[0] + t * dir[0], planeY, CAM_POS[2] + t * dir[2]];
}

// ----- math/easing helpers -----
function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function mix(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function worldOf(bodyPoint: Vec3): Vec3 {
  return [
    body.pos[0] + quatRotate(body.quat, bodyPoint)[0],
    body.pos[1] + quatRotate(body.quat, bodyPoint)[1],
    body.pos[2] + quatRotate(body.quat, bodyPoint)[2],
  ];
}

// Per-face flat shading. `facing` is how squarely the face meets the camera.
function shadeFace(normalW: Vec3, facing: number): string {
  const diff = Math.max(0, normalW[0] * LIGHT[0] + normalW[1] * LIGHT[1] + normalW[2] * LIGHT[2]);
  const b = 0.16 + 0.84 * diff;
  const base = b < 0.5 ? mix(RAMP_LO, RAMP_MID, b * 2) : mix(RAMP_MID, RAMP_HI, (b - 0.5) * 2);
  const rim = Math.pow(clamp(1 - facing, 0, 1), 2.4) * 0.5; // teal grazing rim
  const col = mix(base, TEAL, rim * (1 - diff * 0.5));
  return `rgb(${Math.round(col[0])}, ${Math.round(col[1])}, ${Math.round(col[2])})`;
}

// ----- the floor -----
function drawFloor(): void {
  // A soft pool of light where the camera looks, plus a faint receding grid that
  // sells the open floor without any walls.
  const centre = project([0, bounds.floorY, 0]);
  const glow = ctx.createRadialGradient(centre[0], centre[1], 0, centre[0], centre[1], Math.max(boxW, boxH) * 0.62);
  glow.addColorStop(0, "rgba(123, 79, 214, 0.16)");
  glow.addColorStop(0.5, "rgba(108, 246, 224, 0.05)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, boxW, boxH);

  const gx = bounds.x + 0.4;
  const gz = bounds.z + 0.4;
  const stepN = 6;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(169, 116, 255, 0.10)";
  ctx.beginPath();
  for (let i = 0; i <= stepN; i++) {
    const x = -gx + (2 * gx * i) / stepN;
    const a = project([x, bounds.floorY, -gz]);
    const b = project([x, bounds.floorY, gz]);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  for (let i = 0; i <= stepN; i++) {
    const z = -gz + (2 * gz * i) / stepN;
    const a = project([-gx, bounds.floorY, z]);
    const b = project([gx, bounds.floorY, z]);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.stroke();
}

// ----- the contact shadow (tracks the die across the floor) -----
function drawShadow(): void {
  const h = Math.max(0, body.pos[1] - bounds.floorY);
  const rad = 1.05 + h * 0.32; // larger + softer as the die rises
  const g0 = project([body.pos[0], bounds.floorY, body.pos[2]]);
  const ex = project([body.pos[0] + rad, bounds.floorY, body.pos[2]]);
  const ez = project([body.pos[0], bounds.floorY, body.pos[2] + rad]);
  const rx = Math.hypot(ex[0] - g0[0], ex[1] - g0[1]);
  const ry = Math.hypot(ez[0] - g0[0], ez[1] - g0[1]);
  const alpha = clamp(0.5 - h * 0.16, 0.08, 0.5);
  ctx.save();
  ctx.translate(g0[0], g0[1]);
  ctx.scale(rx, Math.max(0.0001, ry));
  const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  sg.addColorStop(0, `rgba(0,0,0,${alpha.toFixed(3)})`);
  sg.addColorStop(0.6, `rgba(0,0,0,${(alpha * 0.5).toFixed(3)})`);
  sg.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ----- the die -----
const DIGIT_FADE = 0.16;

function drawDie(): void {
  const rv = VERTICES.map((v) => worldOf(v));
  const proj = rv.map((v) => project(v));

  type Vis = { face: number; normalW: Vec3; facing: number; depth: number };
  const visible: Vis[] = [];
  FACE_FRAMES.forEach((frame, i) => {
    const normalW = quatRotate(body.quat, frame.normal);
    const centroidW = worldOf(frame.centroid);
    const toCam = normalize(sub(CAM_POS, centroidW));
    const facing = normalW[0] * toCam[0] + normalW[1] * toCam[1] + normalW[2] * toCam[2];
    if (facing <= 0.02) return; // back-facing
    const f = FACES[i]!;
    const depth = (proj[f[0]]![2] + proj[f[1]]![2] + proj[f[2]]![2] + proj[f[3]]![2]) / 4;
    visible.push({ face: i, normalW, facing, depth });
  });
  visible.sort((p, q) => q.depth - p.depth); // far first

  const r = focal / CAM_DIST; // ≈ pixels per world unit at the die
  const edgeW = Math.max(0.8, r * 0.012);

  // Pass 1 — filled, stroked facets.
  ctx.lineJoin = "round";
  for (const v of visible) {
    const f = FACES[v.face]!;
    const p0 = proj[f[0]]!, p1 = proj[f[1]]!, p2 = proj[f[2]]!, p3 = proj[f[3]]!;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.lineTo(p3[0], p3[1]);
    ctx.closePath();
    ctx.fillStyle = shadeFace(v.normalW, v.facing);
    ctx.fill();
    ctx.lineWidth = edgeW;
    ctx.strokeStyle = "rgba(20, 11, 40, 0.62)";
    ctx.stroke();
  }

  // Sheen on the most camera-facing facet.
  const front = visible.reduce<Vis | null>((best, v) => (best && best.facing >= v.facing ? best : v), null);
  if (front) {
    const f = FACES[front.face]!;
    const fx = (proj[f[0]]![0] + proj[f[1]]![0] + proj[f[2]]![0] + proj[f[3]]![0]) / 4;
    const fy = (proj[f[0]]![1] + proj[f[1]]![1] + proj[f[2]]![1] + proj[f[3]]![1]) / 4;
    const g = ctx.createRadialGradient(fx - r * 0.16, fy - r * 0.28, 0, fx, fy, r * 0.95);
    g.addColorStop(0, "rgba(255,255,255,0.20)");
    g.addColorStop(0.35, "rgba(255,255,255,0.05)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(proj[f[0]]![0], proj[f[0]]![1]);
    ctx.lineTo(proj[f[1]]![0], proj[f[1]]![1]);
    ctx.lineTo(proj[f[2]]![0], proj[f[2]]![1]);
    ctx.lineTo(proj[f[3]]![0], proj[f[3]]![1]);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, boxW, boxH);
    ctx.restore();
  }

  // Pass 2 — the digit on each visible facet, riding the face plane.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const v of visible) {
    const alpha = clamp((v.facing - DIGIT_FADE) / 0.5, 0, 1);
    if (alpha <= 0.02) continue;
    const frame = FACE_FRAMES[v.face]!;
    const upR = quatRotate(body.quat, frame.up);
    const rightR = cross(upR, v.normalW);
    const cW = worldOf(frame.centroid);
    const s = 0.34;
    const pc = project(cW);
    const pu = project([cW[0] + s * upR[0], cW[1] + s * upR[1], cW[2] + s * upR[2]]);
    const pr = project([cW[0] + s * rightR[0], cW[1] + s * rightR[1], cW[2] + s * rightR[2]]);
    const Rx = pr[0] - pc[0], Ry = pr[1] - pc[1];
    const Ux = pu[0] - pc[0], Uy = pu[1] - pc[1];
    const area = Math.abs(Rx * -Uy - Ry * -Ux);
    const sides = Math.hypot(Rx, Ry) * Math.hypot(Ux, Uy);
    if (sides < 1 || area < 0.2 * sides) continue;

    const label = String(FACE_DIGITS[v.face]!);
    const fontLocal = label.length > 1 ? 1.18 : 1.5;
    ctx.save();
    ctx.transform(Rx, Ry, -Ux, -Uy, pc[0], pc[1]);
    ctx.globalAlpha = alpha;
    ctx.font = `800 ${fontLocal}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = "rgba(20, 10, 38, 0.45)";
    ctx.fillText(label, 0.03, 0.05);
    ctx.fillStyle = "#fbf8ff";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
}

function render(): void {
  if (boxW === 0) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, boxW, boxH);
  drawFloor();
  drawShadow();
  drawDie();
}

// ----- animation loop (steps the real simulation; sleeps when settled) -----
let running = false;
let lastTs = 0;
let acc = 0;
let settledAnnounced = true; // the initial resting die is not "a roll"

function ensureRunning(): void {
  if (running) return;
  running = true;
  lastTs = 0;
  acc = 0;
  stage.classList.add("spinning");
  requestAnimationFrame(frame);
}

function frame(ts: number): void {
  if (lastTs === 0) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;

  if (!held && !body.asleep) {
    acc += dt;
    let n = 0;
    while (acc >= FIXED_DT && n < 8) {
      step(body, bounds, FIXED_DT);
      acc -= FIXED_DT;
      n++;
    }
    if (acc > FIXED_DT) acc = 0; // shed backlog after a long stall
    if (body.asleep) onSettled();
  } else {
    acc = 0;
  }

  render();

  if (!held && body.asleep) {
    running = false;
    stage.classList.remove("spinning");
    return; // idle: stop burning frames until the next interaction
  }
  requestAnimationFrame(frame);
}

function onSettled(): void {
  const result = readResult(body);
  if (settledAnnounced) return;
  settledAnnounced = true;
  announce(result);
  if (!reduceQuery.matches) burst(project([body.pos[0], body.pos[1], body.pos[2]]));
}

function announce(n: number): void {
  current = n;
  setDieLabel(n);
  live.textContent = "Rolled " + n + ".";
  vibrate(VIBRATE_LAND); // a short tick when a result comes up (where supported)
}

function setDieLabel(n: number): void {
  canvas.setAttribute(
    "aria-label",
    "Ten-sided die, showing " + n + ". Drag it to throw, or press Enter to roll.",
  );
}

// ----- throws -----
// The Roll button / keyboard fire a fair machine throw.
function roll(): void {
  enableMotion(); // first gesture also unlocks shake-to-roll (iOS needs this)
  clearAllSparks();
  live.textContent = "";
  if (reduceQuery.matches) {
    reducedRoll();
    return;
  }
  body = autoThrow(Math.random, bounds);
  settledAnnounced = false;
  ensureRunning();
}

// Reduced motion: skip the tumble, pick a fair result, snap it flat and read it.
function reducedRoll(): void {
  const result = 1 + Math.floor(Math.random() * 10);
  body = restingBody(faceForDigit(result), bounds);
  settledAnnounced = true;
  render();
  announce(result);
}

// ----- drag to throw -----
let held = false;
let activePointerId: number | null = null;
let grabDX = 0;
let grabDZ = 0;
type Sample = { x: number; z: number; t: number };
let history: Sample[] = [];

function pointerWorld(ev: PointerEvent): Vec3 {
  const rect = canvas.getBoundingClientRect();
  return screenToPlane(ev.clientX - rect.left, ev.clientY - rect.top, HOLD_Y);
}

function dieScreenRadius(): number {
  return (focal / CAM_DIST) * 1.15; // die silhouette ≈ one world radius
}

function onPointerDown(ev: PointerEvent): void {
  enableMotion(); // grabbing the die is also a gesture that can unlock motion
  if (reduceQuery.matches) {
    roll();
    return;
  }
  if (held) return; // already dragging with one pointer — ignore extra touches
  const rect = canvas.getBoundingClientRect();
  const sx = ev.clientX - rect.left;
  const sy = ev.clientY - rect.top;
  const c = project(body.pos);
  if (Math.hypot(sx - c[0], sy - c[1]) > dieScreenRadius() * 1.5) return; // missed the die

  ev.preventDefault();
  canvas.setPointerCapture(ev.pointerId);
  canvas.focus({ preventScroll: true }); // keep the die keyboard-operable after a grab
  held = true;
  activePointerId = ev.pointerId;
  body.asleep = false;
  body.vel = [0, 0, 0];
  body.angVel = [0, 0, 0];
  const pw = pointerWorld(ev);
  grabDX = body.pos[0] - pw[0];
  grabDZ = body.pos[2] - pw[2];
  body.pos = [pw[0] + grabDX, HOLD_Y, pw[2] + grabDZ];
  clearAllSparks();
  live.textContent = "";
  history = [{ x: body.pos[0], z: body.pos[2], t: performance.now() }];
  canvas.style.cursor = "grabbing";
  ensureRunning();
}

function onPointerMove(ev: PointerEvent): void {
  if (!held || ev.pointerId !== activePointerId) return;
  const pw = pointerWorld(ev);
  const x = clamp(pw[0] + grabDX, -bounds.x, bounds.x);
  const z = clamp(pw[2] + grabDZ, -bounds.z, bounds.z);
  body.pos = [x, HOLD_Y, z];
  const now = performance.now();
  history.push({ x, z, t: now });
  if (history.length > 8) history.shift();
}

function onPointerUp(ev: PointerEvent): void {
  if (!held || ev.pointerId !== activePointerId) return;
  held = false;
  activePointerId = null;
  canvas.style.cursor = "grab";
  try {
    canvas.releasePointerCapture(ev.pointerId);
  } catch {
    /* pointer already released */
  }

  // Release velocity from the last ~90ms of drag.
  const now = performance.now();
  const recent = history[history.length - 1] ?? { x: body.pos[0], z: body.pos[2], t: now };
  let past = recent;
  for (let i = history.length - 1; i >= 0; i--) {
    past = history[i]!;
    if (now - past.t >= 90) break;
  }
  const dtv = Math.max(0.016, (recent.t - past.t) / 1000);
  let vx = (recent.x - past.x) / dtv;
  let vz = (recent.z - past.z) / dtv;
  const speed = Math.hypot(vx, vz);

  // A tap (no real flick) becomes a fair machine throw, so a click still rolls.
  if (speed < 1.2) {
    body = autoThrow(Math.random, bounds);
    settledAnnounced = false;
    ensureRunning();
    return;
  }

  const cap = 8.5;
  if (speed > cap) {
    vx *= cap / speed;
    vz *= cap / speed;
  }
  // Spin from the flick: tumbling axis perpendicular to the throw, plus a base
  // so even a slow drag turns over a few times before it lands.
  const spinGain = 2.2;
  const base = 5 + Math.random() * 4;
  const ax = -vz, az = vx; // (v × up) in the floor plane
  const al = Math.hypot(ax, az) || 1;
  const angVel: Vec3 = [
    (ax / al) * base + ax * spinGain,
    (Math.random() - 0.5) * 6,
    (az / al) * base + az * spinGain,
  ];
  body = releasedBody(body.pos, body.quat, [vx, 0.5, vz], angVel);
  settledAnnounced = false;
  ensureRunning();
}

// An aborted gesture (palm rejection, the OS stealing the touch) must not throw:
// drop the die where it was held with no flick and no machine throw — it simply
// falls and settles. Never runs the velocity/throw path.
function onPointerCancel(ev: PointerEvent): void {
  if (!held || ev.pointerId !== activePointerId) return;
  held = false;
  activePointerId = null;
  canvas.style.cursor = "grab";
  try {
    canvas.releasePointerCapture(ev.pointerId);
  } catch {
    /* pointer already released */
  }
  history = [];
  body = releasedBody(body.pos, body.quat, [0, 0, 0], [0, 0, 0]);
  settledAnnounced = false;
  ensureRunning();
}

// ----- spark burst on landing -----
type Spark = { el: HTMLSpanElement; dx: number; dy: number; sc: number };
let sparkToken = 0;
function burst(at: [number, number, number]): void {
  if (reduceQuery.matches) return;
  sparks.style.left = at[0] + "px";
  sparks.style.top = at[1] + "px";
  sparkToken++;
  const my = sparkToken;
  const n = 16;
  const frag = document.createDocumentFragment();
  const nodes: Spark[] = [];
  for (let i = 0; i < n; i++) {
    const s = document.createElement("span");
    s.className = "spark";
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const dist = 42 + Math.random() * 50;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist * 0.82 - 10;
    const hue = Math.random() < 0.5 ? "#a974ff" : "#6cf6e0";
    s.style.background = "radial-gradient(circle at 50% 50%, #fff 0%, " + hue + " 45%, rgba(0,0,0,0) 75%)";
    const sc = 0.6 + Math.random() * 0.9;
    s.style.transform = "translate(0px,0px) scale(" + sc + ")";
    s.style.opacity = "1";
    frag.appendChild(s);
    nodes.push({ el: s, dx, dy, sc });
  }
  sparks.appendChild(frag);
  requestAnimationFrame(() => {
    if (my !== sparkToken) {
      cleanupSparks(nodes);
      return;
    }
    for (const nd of nodes) {
      nd.el.style.transition = "transform 720ms cubic-bezier(.12,.7,.25,1), opacity 720ms ease-out";
      nd.el.style.transform = "translate(" + nd.dx + "px," + nd.dy + "px) scale(" + nd.sc * 0.25 + ")";
      nd.el.style.opacity = "0";
    }
  });
  setTimeout(() => cleanupSparks(nodes), 820);
}
function cleanupSparks(nodes: Spark[]): void {
  for (const nd of nodes) if (nd.el.parentNode) nd.el.parentNode.removeChild(nd.el);
}
function clearAllSparks(): void {
  sparkToken++;
  while (sparks.firstChild) sparks.removeChild(sparks.firstChild);
}

// ----- haptics (vibrate on devices that support it) -----
// iOS has no Vibration API, and Android Chrome only vibrates after the page has
// seen a real user gesture. Feature-detect and swallow failures so unsupported
// devices simply stay silent.
const canVibrate = typeof navigator.vibrate === "function";
const VIBRATE_LAND = 24; // ms tick when a roll settles on a number
const VIBRATE_SHAKE: number[] = [18, 24, 38]; // buzz·pause·buzz — a rattle confirming a shake

function vibrate(pattern: number | number[]): void {
  if (!canVibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* vibrate can throw before any gesture on some browsers — ignore */
  }
}

// ----- shake to roll (device motion sensors) -----
// On a phone with motion sensors, a firm shake throws the die — like rattling it
// in a cup. We watch the accelerometer (`accelerationIncludingGravity` is present
// on every device with an IMU: accelerometer + gyro) and fire on a large
// sample-to-sample jump. The throw runs through the normal fair path
// (`roll` → `autoThrow`), so a shake stays exactly as fair as pressing Roll.
//
// iOS 13+ hides the sensor behind a permission prompt that must be requested from
// inside a user gesture, so `enableMotion` is wired to the first tap/grab/roll.
interface MotionCtor {
  new (type: string, eventInitDict?: DeviceMotionEventInit): DeviceMotionEvent;
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
}
const MotionEventCtor: MotionCtor | undefined = (
  window as unknown as { DeviceMotionEvent?: MotionCtor }
).DeviceMotionEvent;
const needsMotionPermission =
  !!MotionEventCtor && typeof MotionEventCtor.requestPermission === "function";

const SHAKE_DELTA = 22; // m/s² jump between samples that counts as a shake — a
//                         conservative headless guess; tune on a real device.
const SHAKE_COOLDOWN = 900; // ms between shake-fired rolls (debounce)
let lastAccel: { x: number; y: number; z: number } | null = null;
let lastShakeAt = 0;
let motionRequested = false;

function onDeviceMotion(ev: DeviceMotionEvent): void {
  const a = ev.accelerationIncludingGravity;
  if (!a || a.x == null || a.y == null || a.z == null) return;
  if (lastAccel) {
    const dx = a.x - lastAccel.x;
    const dy = a.y - lastAccel.y;
    const dz = a.z - lastAccel.z;
    const delta = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const now = performance.now();
    if (delta > SHAKE_DELTA && now - lastShakeAt > SHAKE_COOLDOWN) {
      lastShakeAt = now;
      onShake();
    }
  }
  lastAccel = { x: a.x, y: a.y, z: a.z };
}

function onShake(): void {
  if (held) return; // don't yank the die out of a hand mid-drag
  vibrate(VIBRATE_SHAKE);
  roll();
}

// Subscribe to motion events. On iOS this must run inside a user gesture (it
// pops a permission prompt); everywhere else we can subscribe straight away.
function enableMotion(): void {
  if (motionRequested || !MotionEventCtor) return;
  motionRequested = true;
  if (needsMotionPermission) {
    MotionEventCtor.requestPermission!()
      .then((state) => {
        if (state === "granted") window.addEventListener("devicemotion", onDeviceMotion);
      })
      .catch(() => {
        /* prompt dismissed — shake stays off, everything else still works */
      });
  } else {
    window.addEventListener("devicemotion", onDeviceMotion);
  }
}

// ----- wiring -----
btn.addEventListener("click", roll);
canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerCancel);
canvas.addEventListener("keydown", (ev: KeyboardEvent) => {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    roll();
  }
});

if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => resize()).observe(stage);
} else {
  window.addEventListener("resize", resize);
}

// init
setDieLabel(current);
resize();
// Where the sensor needs no permission (Android/desktop), start listening now so
// a shake works without a tap first. iOS waits for the first gesture instead.
if (!needsMotionPermission) enableMotion();
