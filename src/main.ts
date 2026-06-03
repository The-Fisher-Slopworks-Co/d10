// d10 — a single ten-sided die, rendered as a real 3D pentagonal trapezohedron
// and physically thrown.
//
// The solid is drawn from scratch each frame on a <canvas>: every vertex is
// rotated by the die's current orientation quaternion, projected with mild
// perspective, depth-sorted, shaded by its facing to the light, and stamped
// with the digit printed on that face. No 3D library, no runtime deps.
//
// The throw is real motion — the die is flung up, tumbles on a random axis,
// arcs back down and bounces before settling — but the *result* is still
// decided up front. The trick (see die3d.restQuat) is that the tumble decays
// onto a precomputed orientation that puts the chosen face squarely in front,
// so the number you read when it stops is exactly the random roll. One
// `rollId` token cancels stale callbacks so rapid re-rolls stay clean.

import {
  FACES,
  FACE_DIGITS,
  FACE_FRAMES,
  VERTICES,
  cross,
  faceForDigit,
  normalize,
  quatFromAxisAngle,
  quatMul,
  quatNormalize,
  quatRotate,
  restQuat,
  type Quat,
  type Vec3,
} from "./die3d";

// ----- DOM -----
const die = document.getElementById("die") as HTMLElement;
const stage = document.getElementById("stage") as HTMLElement;
const shadow = document.getElementById("shadow") as HTMLElement;
const canvas = document.getElementById("dieCanvas") as HTMLCanvasElement;
const btn = document.getElementById("rollBtn") as HTMLButtonElement;
const sparks = document.getElementById("sparks") as HTMLElement;
const live = document.getElementById("live") as HTMLElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const DROP_SHADOW = "drop-shadow(0 16px 22px rgba(0, 0, 0, 0.5))";

// ----- tunables (all in one place; tuned by eye in the browser) -----
const CAM_DIST = 5.6; // perspective strength (smaller = more dramatic)
const CY_FRAC = 0.57; // resting vertical centre, as a fraction of the box
const FIT_W = 2.7; // box-width / die-radius
const FIT_H = 3.9; // box-height / die-radius
const LIGHT: Vec3 = normalize([-0.42, 0.7, 0.62]); // key light (upper-left-front)
const TEAL: readonly [number, number, number] = [108, 246, 224];
const RAMP_LO: readonly [number, number, number] = [38, 21, 74]; // deep shadow purple
const RAMP_MID: readonly [number, number, number] = [123, 79, 214];
const RAMP_HI: readonly [number, number, number] = [205, 170, 255]; // lit highlight

// ----- canvas sizing (DPR-aware, re-rendered on resize) -----
let dpr = 1;
let boxW = 0;
let boxH = 0;
let baseR = 0;

function resize(): void {
  const rect = die.getBoundingClientRect();
  boxW = Math.max(1, rect.width);
  boxH = Math.max(1, rect.height);
  dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(boxW * dpr);
  canvas.height = Math.round(boxH * dpr);
  baseR = Math.min(boxW / FIT_W, boxH / FIT_H);
  renderStatic();
}

// ----- math/easing helpers -----
function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}
function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}
function mix(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// ----- projection -----
// Rotated model point -> [screenX, screenY, perspectiveScale]. Mild pinhole
// perspective: points nearer the camera (+z) get magnified.
function project(p: Vec3, cx: number, cy: number, r: number): [number, number, number] {
  const persp = 1 / (1 - p[2] / CAM_DIST);
  return [cx + p[0] * r * persp, cy - p[1] * r * persp, persp];
}

// Per-face flat shading -> CSS rgb() string. Lambert key light on the purple
// ramp, plus a teal counter-light that grazes faces turned away from the key.
function shadeFace(normalRot: Vec3): string {
  const diff = Math.max(0, normalRot[0] * LIGHT[0] + normalRot[1] * LIGHT[1] + normalRot[2] * LIGHT[2]);
  const b = 0.16 + 0.84 * diff; // keep unlit faces visible
  const base = b < 0.5 ? mix(RAMP_LO, RAMP_MID, b * 2) : mix(RAMP_MID, RAMP_HI, (b - 0.5) * 2);
  // teal rim: strongest where the face grazes the viewer
  const rim = Math.pow(clamp(1 - normalRot[2], 0, 1), 2.4) * 0.5;
  const col = mix(base, TEAL, rim * (1 - diff * 0.5));
  return `rgb(${Math.round(col[0])}, ${Math.round(col[1])}, ${Math.round(col[2])})`;
}

// ----- the renderer -----
const APEX_DIGIT_FADE = 0.12; // normals below this z don't show their digit

// Draw the whole solid at the given orientation, lifted by `lift` px (toss
// height), nudged sideways by `drift`, scaled by `scaleMul`, with optional
// motion blur. Returns nothing; pure paint.
function renderDie(orientation: Quat, lift: number, drift: number, scaleMul: number, blur: number): void {
  const cx = boxW / 2 + drift;
  const cy = CY_FRAC * boxH - lift;
  const r = baseR * scaleMul;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, boxW, boxH);

  // Rotate every vertex once.
  const rv: Vec3[] = VERTICES.map((v) => quatRotate(orientation, v));
  const proj: [number, number, number][] = rv.map((v) => project(v, cx, cy, r));

  type Vis = { face: number; normal: Vec3; depth: number };
  const visible: Vis[] = [];
  FACE_FRAMES.forEach((frame, i) => {
    const n = quatRotate(orientation, frame.normal);
    if (n[2] <= 0.02) return; // back-facing
    const f = FACES[i]!;
    const a = rv[f[0]]!, b = rv[f[1]]!, c = rv[f[2]]!, d = rv[f[3]]!;
    const depth = (a[2] + b[2] + c[2] + d[2]) / 4;
    visible.push({ face: i, normal: n, depth });
  });
  // Painter's order: far first. (Convex solid faces don't overlap, but this
  // keeps shared edges and digits layering predictably.)
  visible.sort((p, q) => p.depth - q.depth);

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
    ctx.fillStyle = shadeFace(v.normal);
    ctx.fill();
    ctx.lineWidth = edgeW;
    ctx.strokeStyle = "rgba(20, 11, 40, 0.62)";
    ctx.stroke();
  }

  // Soft sheen blob on the most front-facing facet, for a glassy highlight.
  const front = visible.reduce<Vis | null>((best, v) => (best && best.normal[2] >= v.normal[2] ? best : v), null);
  if (front) {
    const f = FACES[front.face]!;
    const cxf = (proj[f[0]]![0] + proj[f[1]]![0] + proj[f[2]]![0] + proj[f[3]]![0]) / 4;
    const cyf = (proj[f[0]]![1] + proj[f[1]]![1] + proj[f[2]]![1] + proj[f[3]]![1]) / 4;
    const g = ctx.createRadialGradient(cxf - r * 0.16, cyf - r * 0.28, 0, cxf, cyf, r * 0.95);
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

  // Pass 2 — the digit printed on each visible facet, riding the face plane.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const v of visible) {
    const alpha = clamp((v.normal[2] - APEX_DIGIT_FADE) / 0.5, 0, 1);
    if (alpha <= 0.02) continue;
    const frame = FACE_FRAMES[v.face]!;
    const upR = quatRotate(orientation, frame.up);
    const rightR = cross(upR, v.normal); // unit (upR ⟂ normal)
    const cW = quatRotate(orientation, frame.centroid);
    const s = 0.34; // sample distance along the face axes (world units)
    const pc = project(cW, cx, cy, r);
    const pu = project([cW[0] + s * upR[0], cW[1] + s * upR[1], cW[2] + s * upR[2]], cx, cy, r);
    const pr = project([cW[0] + s * rightR[0], cW[1] + s * rightR[1], cW[2] + s * rightR[2]], cx, cy, r);
    const Rx = pr[0] - pc[0], Ry = pr[1] - pc[1];
    const Ux = pu[0] - pc[0], Uy = pu[1] - pc[1];
    // Skip the glyph if its in-plane basis has collapsed (face seen edge-on):
    // a near-singular transform would smear the digit into a streak. Scale-
    // invariant test — the parallelogram area vs. its sides (≈ sin of the angle
    // between the axes); below ~0.2 the face is too foreshortened to read.
    const area = Math.abs(Rx * -Uy - Ry * -Ux);
    const sides = Math.hypot(Rx, Ry) * Math.hypot(Ux, Uy);
    if (sides < 1 || area < 0.2 * sides) continue;

    const digit = FACE_DIGITS[v.face]!;
    const label = String(digit);
    const fontLocal = label.length > 1 ? 1.18 : 1.5; // "10" rides smaller

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // local +x -> face right, local +y -> face *down* (= -up on screen)
    ctx.transform(Rx, Ry, -Ux, -Uy, pc[0], pc[1]);
    ctx.globalAlpha = alpha;
    ctx.font = `800 ${fontLocal}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    // subtle engraved feel: dark offset under bright face value
    ctx.fillStyle = "rgba(20, 10, 38, 0.45)";
    ctx.fillText(label, 0.03, 0.05);
    ctx.fillStyle = "#fbf8ff";
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  setCanvasFilter(blur > 0.05 ? `${DROP_SHADOW} blur(${blur.toFixed(2)}px)` : DROP_SHADOW);
}

// Only touch canvas.style.filter when it actually changes — the idle loop
// renders forever, and re-writing the same string each frame thrashes style.
let lastFilter = "";
function setCanvasFilter(value: string): void {
  if (value === lastFilter) return;
  canvas.style.filter = value;
  lastFilter = value;
}

// ----- orientation state + idle life -----
let rollId = 0; // cancellation token
let current = 10; // last settled value
let restOrientation: Quat = restQuat(faceForDigit(current));
let rolling = false;
let idleStart: number | null = null;

function setDieLabel(n: number): void {
  die.setAttribute("aria-label", "Ten-sided die, currently showing " + n + ". Activate to roll.");
}

// Render the die sitting still (used on resize and between rolls).
function renderStatic(): void {
  if (boxW === 0) return;
  renderDie(restOrientation, 0, 0, 1, 0);
  shadow.style.transform = "translateX(-50%) scale(1)";
  shadow.style.opacity = "1";
  shadow.style.filter = "blur(7px)";
}

// A breathing micro-wobble at rest so the solid reads as 3D. The amplitude is
// tiny (a few degrees) so the chosen face stays square to the camera and its
// digit stays the one you read.
const IDLE_AXIS: Vec3 = normalize([0.5, 0.18, 1]);
function idleFrame(ts: number): void {
  if (rolling || reduceQuery.matches) return;
  if (idleStart === null) idleStart = ts;
  const t = (ts - idleStart) / 1000;
  const wobble = quatFromAxisAngle(IDLE_AXIS, Math.sin(t * 0.8) * 0.05);
  const bob = Math.sin(t * 0.8) * baseR * 0.012;
  renderDie(quatMul(wobble, restOrientation), bob, 0, 1, 0);
  requestAnimationFrame(idleFrame);
}

// ----- spark burst on landing (kept from the original) -----
type Spark = { el: HTMLSpanElement; dx: number; dy: number; sc: number };
function burst(myRoll: number): void {
  if (reduceQuery.matches) return;
  const n = 16;
  const frag = document.createDocumentFragment();
  const nodes: Spark[] = [];
  for (let i = 0; i < n; i++) {
    const s = document.createElement("span");
    s.className = "spark";
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4;
    const dist = 46 + Math.random() * 54;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist * 0.82 - 12;
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
    if (myRoll !== rollId) {
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
  while (sparks.firstChild) sparks.removeChild(sparks.firstChild);
}

// ----- the throw -----
// Bouncing toss height in [0,1]: a big first arc, then two decaying bounces
// that settle to 0 at t=1. `peaks` controls how many times it leaves the floor.
function tossHeight(t: number): number {
  const lobes = 2.35; // ~1 big throw + a couple of bounces
  const env = Math.pow(1 - t, 1.25); // overall decay to the floor
  return Math.abs(Math.sin(Math.PI * lobes * t)) * env;
}

function roll(): void {
  rollId++;
  const myRoll = rollId;

  // TRUE RESULT — chosen up front; the tumble is choreographed to land on it.
  const result = 1 + Math.floor(Math.random() * 10);
  const targetRest = restQuat(faceForDigit(result));

  clearAllSparks();
  live.textContent = "";
  // Clear any inline styles a prior (possibly cancelled) roll left behind so
  // both the animated and reduced-motion paths start from a clean slate.
  canvas.style.transition = "";
  canvas.style.opacity = "1";
  setCanvasFilter(DROP_SHADOW);

  if (reduceQuery.matches) {
    reducedRoll(myRoll, result, targetRest);
    return;
  }

  rolling = true;
  idleStart = null;
  stage.classList.add("spinning");

  // Random tumble: a primary axis (biased away from pure vertical so it rolls
  // like a thrown die) plus a faster-decaying wobble axis for richness.
  const spinAxis = normalize([Math.random() * 1.6 - 0.8, Math.random() * 0.7 - 0.35, Math.random() * 1.6 - 0.8]);
  const wobAxis = normalize([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
  const dir = Math.random() < 0.5 ? 1 : -1;
  const turns = 3 + Math.floor(Math.random() * 3); // 3..5 full tumbles
  const totalAngle = dir * (turns * Math.PI * 2 + Math.PI * (Math.random() * 0.6 + 0.2));
  const wobAngle = (Math.random() * 0.5 + 0.4) * (Math.random() < 0.5 ? 1 : -1);
  const driftMax = (Math.random() * 0.16 + 0.06) * baseR * (Math.random() < 0.5 ? 1 : -1);

  const DUR = 1650 + Math.random() * 300;
  let startTs: number | null = null;

  function frame(ts: number): void {
    if (myRoll !== rollId) return;
    if (startTs === null) startTs = ts;
    const t = clamp((ts - startTs) / DUR, 0, 1);
    const e = easeOutQuint(t);

    // Orientation: a decaying spin (+wobble) that reaches identity at t=1, so
    // q(t) = spin ⊗ wobble ⊗ targetRest lands exactly on targetRest.
    const spin = quatFromAxisAngle(spinAxis, totalAngle * (1 - e));
    const wob = quatFromAxisAngle(wobAxis, wobAngle * (1 - easeInOutSine(t)));
    const orientation = quatNormalize(quatMul(quatMul(spin, wob), targetRest));

    // Toss arc + sideways drift that eases back under the shadow.
    const h = tossHeight(t);
    const lift = h * baseR * 0.92;
    const drift = driftMax * (1 - easeOutQuint(t));
    const scaleMul = 1 + h * 0.12;

    // Motion blur tracks angular speed (fast early, gone by the settle).
    const speed = (1 - e) * (1 - t * 0.2);
    const blur = clamp(speed * 6.5 - 0.3, 0, 6);

    renderDie(orientation, lift, drift, scaleMul, blur);

    // Contact shadow: shrinks/fades/blurs as the die rises.
    const sScale = 1 - h * 0.4;
    shadow.style.transform = "translateX(-50%) scale(" + sScale.toFixed(3) + ")";
    shadow.style.opacity = (1 - h * 0.6).toFixed(3);
    shadow.style.filter = "blur(" + (7 + h * 13).toFixed(1) + "px)";

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      finishRoll(myRoll, result, targetRest);
    }
  }
  requestAnimationFrame(frame);
}

function finishRoll(myRoll: number, result: number, targetRest: Quat): void {
  if (myRoll !== rollId) return;
  restOrientation = targetRest;
  rolling = false;
  renderStatic();
  stage.classList.remove("spinning");
  burst(myRoll);
  current = result;
  setDieLabel(result);
  live.textContent = "Rolled " + result + ".";
  idleStart = null;
  requestAnimationFrame(idleFrame);
}

// ----- reduced motion: compute the rest pose and calmly fade onto it -----
function reducedRoll(myRoll: number, result: number, targetRest: Quat): void {
  stage.classList.remove("spinning");
  rolling = false;
  restOrientation = targetRest;
  // Kill any in-flight fade transition so the dim-then-ease-in starts crisply,
  // even on a rapid re-roll mid-fade.
  canvas.style.transition = "none";
  canvas.style.opacity = "0.25";
  renderStatic();
  void canvas.offsetWidth; // reflow so the "none" transition + dim commit now
  requestAnimationFrame(() => {
    if (myRoll !== rollId) return;
    canvas.style.transition = "opacity 360ms ease";
    canvas.style.opacity = "1";
  });
  setTimeout(() => {
    if (myRoll !== rollId) return;
    canvas.style.transition = "";
    current = result;
    setDieLabel(result);
    live.textContent = "Rolled " + result + ".";
  }, 400);
}

// ----- wiring -----
btn.addEventListener("click", roll);
die.addEventListener("click", roll);
die.addEventListener("keydown", (ev: KeyboardEvent) => {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    roll();
  }
});

if (typeof ResizeObserver !== "undefined") {
  new ResizeObserver(() => resize()).observe(die);
} else {
  window.addEventListener("resize", resize);
}

// init
setDieLabel(current);
resize();
requestAnimationFrame(idleFrame);
