// A small, exact rigid-body simulator for one d10 — pure and DOM-free so it can
// be unit-tested headlessly (see test/roll.test.ts).
//
// The die is a convex polyhedron tumbling under gravity in a box: a floor plus
// four invisible walls that keep a hard throw on screen. Collisions are resolved
// with sequential impulses (restitution + Coulomb friction) and split-impulse
// position correction. When the die has rested in floor contact at low energy
// for long enough it "sleeps": we snap its top face exactly flat (killing
// residual jitter) and read the digit there. Nothing is decided up front — the
// number is whatever the simulation settles on.

import {
  FACE_DIGITS,
  INV_INERTIA_BODY,
  MASS,
  VERTICES,
  add,
  cross,
  dot,
  faceUp,
  faceUpQuat,
  length,
  mat3Mul,
  mat3MulVec,
  mat3Transpose,
  quatMul,
  quatNormalize,
  quatToMat3,
  scale,
  settleQuat,
  sub,
  type Quat,
  type Vec3,
} from "./die3d";
import { randomDir, randomQuat, type Rng } from "./rng";

// ----- a rigid body -----
// Vectors/quaternions are immutable tuples; the body holds mutable *references*
// that the step reassigns. Angular velocity is stored in the world frame.
export interface Body {
  pos: Vec3; // centre of mass in world space
  quat: Quat; // orientation (body → world)
  vel: Vec3; // linear velocity
  angVel: Vec3; // angular velocity (world frame, rad/s)
  asleep: boolean;
  restTimer: number; // seconds spent settled in floor contact
}

// The play box. Symmetric in x/z; floor at y = floorY. Walls are invisible.
export interface Bounds {
  x: number; // |x| ≤ x for the die's vertices
  z: number; // |z| ≤ z
  floorY: number;
}

export const DEFAULT_BOUNDS: Bounds = { x: 4.0, z: 3.2, floorY: 0 };

// ----- tunables (a coherent feel; tuned by eye + the fairness test) -----
const INV_MASS = 1 / MASS;
const GRAVITY = 30; // world units / s²
const RESTITUTION = 0.4; // bounciness of a fast contact
const REST_THRESHOLD = 1.4; // below this approach speed, no bounce (kills micro-chatter)
const FRICTION = 0.62; // Coulomb coefficient
const LIN_DAMP = 0.2; // air drag (per second)
const ANG_DAMP = 0.35;
const SOLVER_ITERS = 14; // sequential-impulse iterations per step
const PEN_SLOP = 0.0015; // allowed penetration before correcting
const PEN_BETA = 0.8; // position-correction fraction
const CONTACT_EPS = 0.02; // a vertex within this of a plane counts as touching
const SLEEP_LIN = 0.16; // linear speed under which the die may sleep
const SLEEP_ANG = 0.3; // angular speed under which the die may sleep
const SLEEP_TIME = 0.32; // seconds of sustained calm + floor contact → sleep

// A bounding plane: the region dot(p, n) ≥ d is "inside".
interface Plane {
  n: Vec3;
  d: number;
}

function buildPlanes(b: Bounds): Plane[] {
  return [
    { n: [0, 1, 0], d: b.floorY }, // floor
    { n: [-1, 0, 0], d: -b.x }, // right wall (x ≤ x)
    { n: [1, 0, 0], d: -b.x }, // left wall  (x ≥ −x)
    { n: [0, 0, -1], d: -b.z }, // near wall (z ≤ z)
    { n: [0, 0, 1], d: -b.z }, // far wall  (z ≥ −z)
  ];
}

// Quaternion integration for a world-frame angular velocity: q̇ = ½ ω ⊗ q.
function integrateQuat(q: Quat, w: Vec3, dt: number): Quat {
  const wq: Quat = [w[0], w[1], w[2], 0];
  const dq = quatMul(wq, q);
  return quatNormalize([
    q[0] + 0.5 * dt * dq[0],
    q[1] + 0.5 * dt * dq[1],
    q[2] + 0.5 * dt * dq[2],
    q[3] + 0.5 * dt * dq[3],
  ]);
}

interface Contact {
  r: Vec3; // contact point relative to COM
  n: Vec3; // contact normal (into the body)
  initVn: number; // approach speed sampled before solving (for restitution)
  jn: number; // accumulated normal impulse (≥ 0)
}

// Advance the simulation by `dt` seconds. No-op once the body is asleep.
export function step(body: Body, bounds: Bounds, dt: number): void {
  if (body.asleep) return;

  // Integrate: gravity → velocity → position, and spin → orientation.
  body.vel = add(body.vel, [0, -GRAVITY * dt, 0]);
  body.pos = add(body.pos, scale(body.vel, dt));
  body.quat = integrateQuat(body.quat, body.angVel, dt);

  const R = quatToMat3(body.quat);
  // World-space inverse inertia: I⁻¹_world = R · I⁻¹_body · Rᵀ.
  const invI = mat3Mul(mat3Mul(R, INV_INERTIA_BODY), mat3Transpose(R));
  const worldVerts = VERTICES.map((v) => add(body.pos, mat3MulVec(R, v)));
  const planes = buildPlanes(bounds);

  // Gather contacts (any vertex at/under a bounding plane).
  const contacts: Contact[] = [];
  let floorContact = false;
  for (const p of worldVerts) {
    for (const pl of planes) {
      const pen = pl.d - dot(p, pl.n);
      if (pen > -CONTACT_EPS) {
        const r = sub(p, body.pos);
        const vn = dot(add(body.vel, cross(body.angVel, r)), pl.n);
        contacts.push({ r, n: pl.n, initVn: vn, jn: 0 });
        if (pl.n[1] > 0.5) floorContact = true;
      }
    }
  }

  // Sequential-impulse velocity solve (restitution + friction).
  for (let it = 0; it < SOLVER_ITERS; it++) {
    for (const c of contacts) {
      // --- normal impulse ---
      const vp = add(body.vel, cross(body.angVel, c.r));
      const vn = dot(vp, c.n);
      const e = -c.initVn > REST_THRESHOLD ? RESTITUTION : 0;
      const rn = cross(c.r, c.n);
      const invMassN = INV_MASS + dot(c.n, cross(mat3MulVec(invI, rn), c.r));
      let dj = (-(vn + e * c.initVn)) / invMassN;
      const prev = c.jn;
      c.jn = Math.max(prev + dj, 0); // accumulated normal impulse stays compressive
      dj = c.jn - prev;
      const imp = scale(c.n, dj);
      body.vel = add(body.vel, scale(imp, INV_MASS));
      body.angVel = add(body.angVel, mat3MulVec(invI, cross(c.r, imp)));

      // --- friction impulse (clamped to the friction cone) ---
      if (c.jn > 0) {
        const vp2 = add(body.vel, cross(body.angVel, c.r));
        const vt = sub(vp2, scale(c.n, dot(vp2, c.n)));
        const vtLen = length(vt);
        if (vtLen > 1e-7) {
          const t = scale(vt, 1 / vtLen);
          const rt = cross(c.r, t);
          const invMassT = INV_MASS + dot(t, cross(mat3MulVec(invI, rt), c.r));
          let jt = -vtLen / invMassT;
          const maxF = FRICTION * c.jn;
          jt = jt < -maxF ? -maxF : jt > maxF ? maxF : jt;
          const fimp = scale(t, jt);
          body.vel = add(body.vel, scale(fimp, INV_MASS));
          body.angVel = add(body.angVel, mat3MulVec(invI, cross(c.r, fimp)));
        }
      }
    }
  }

  // Split-impulse position correction: push the deepest penetration per plane
  // out without feeding energy back into the velocities.
  for (const pl of planes) {
    let maxPen = 0;
    for (const p of worldVerts) {
      const pen = pl.d - dot(p, pl.n);
      if (pen > maxPen) maxPen = pen;
    }
    if (maxPen > PEN_SLOP) body.pos = add(body.pos, scale(pl.n, (maxPen - PEN_SLOP) * PEN_BETA));
  }

  // Air drag.
  body.vel = scale(body.vel, Math.max(0, 1 - LIN_DAMP * dt));
  body.angVel = scale(body.angVel, Math.max(0, 1 - ANG_DAMP * dt));

  // Sleep when the die has been calm *and* touching the floor long enough.
  if (floorContact && length(body.vel) < SLEEP_LIN && length(body.angVel) < SLEEP_ANG) {
    body.restTimer += dt;
    if (body.restTimer >= SLEEP_TIME) settle(body, bounds);
  } else {
    body.restTimer = 0;
  }
}

// Snap to rest: lay the top face exactly flat, drop onto the floor, freeze.
function settle(body: Body, bounds: Bounds): void {
  const { quat } = settleQuat(body.quat);
  body.quat = quat;
  const R = quatToMat3(quat);
  let minY = Infinity;
  for (const v of VERTICES) {
    const y = body.pos[1] + mat3MulVec(R, v)[1];
    if (y < minY) minY = y;
  }
  const cx = Math.max(-bounds.x, Math.min(bounds.x, body.pos[0]));
  const cz = Math.max(-bounds.z, Math.min(bounds.z, body.pos[2]));
  body.pos = [cx, body.pos[1] + (bounds.floorY - minY), cz];
  body.vel = [0, 0, 0];
  body.angVel = [0, 0, 0];
  body.restTimer = 0;
  body.asleep = true;
}

// The digit a settled die shows (its top face's value, 1..10).
export function readResult(body: Body): number {
  return FACE_DIGITS[faceUp(body.quat)]!;
}

// ----- making throws -----

// Lay the die at rest with a chosen face up (init + reduced-motion path).
export function restingBody(face: number, bounds: Bounds = DEFAULT_BOUNDS): Body {
  const quat = faceUpQuat(face);
  const R = quatToMat3(quat);
  let minY = Infinity;
  for (const v of VERTICES) {
    const y = mat3MulVec(R, v)[1];
    if (y < minY) minY = y;
  }
  return {
    pos: [0, bounds.floorY - minY, 0],
    quat,
    vel: [0, 0, 0],
    angVel: [0, 0, 0],
    asleep: true,
    restTimer: 0,
  };
}

// A fair, vigorous machine throw: uniform-random start orientation + strong
// tumble. This is what the Roll button / keyboard fire, and what the fairness
// test exercises. (A hand drag, by contrast, is only as lively as the flick.)
export function autoThrow(rng: Rng, bounds: Bounds = DEFAULT_BOUNDS): Body {
  return {
    pos: [(rng() * 2 - 1) * bounds.x * 0.3, 3.0 + rng() * 0.9, (rng() * 2 - 1) * bounds.z * 0.25],
    quat: randomQuat(rng),
    vel: [(rng() * 2 - 1) * 4, 1.5 + rng() * 2.5, (rng() * 2 - 1) * 4],
    angVel: scale(randomDir(rng), 16 + rng() * 14),
    asleep: false,
    restTimer: 0,
  };
}

// Build a free body from a hand release (the renderer supplies world-space
// velocity/spin derived from the drag).
export function releasedBody(pos: Vec3, quat: Quat, vel: Vec3, angVel: Vec3): Body {
  return { pos, quat, vel, angVel, asleep: false, restTimer: 0 };
}

// Run a body to rest and return the digit. Used by the headless tests; the live
// app steps the same `step()` from its animation loop instead.
export function simulateToRest(body: Body, bounds: Bounds, dt: number, maxSteps: number): number {
  let steps = 0;
  for (; steps < maxSteps && !body.asleep; steps++) step(body, bounds, dt);
  if (!body.asleep) settle(body, bounds); // force a clean read if it dawdled
  return readResult(body);
}
