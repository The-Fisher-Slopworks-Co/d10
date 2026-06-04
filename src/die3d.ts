// d10 geometry + 3D math — a pure, DOM-free module.
//
// Everything here is deterministic geometry and linear algebra so it can be
// imported and asserted by a headless test (see test/roll.test.ts). The DOM,
// the canvas, and the animation live in main.ts.
//
// The solid is a real pentagonal trapezohedron: two apexes on the polar (y)
// axis and a ten-vertex zig-zag "equator" in the x–z plane, giving ten
// congruent kite faces. The die is thrown as a real rigid body (see
// physics.ts); the result is whichever face settles on top — read with
// `faceUp`/`settleQuat`, never chosen up front. This module also computes the
// solid's real inertia tensor, so that tumble is physically honest.

// ----- small fixed-width vector / quaternion types -----
// Fixed-length tuples (not number[]) so `v[0]` is `number`, not
// `number | undefined`, under tsconfig's noUncheckedIndexedAccess.
export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number]; // x, y, z, w
export type Mat3 = readonly [Vec3, Vec3, Vec3]; // rows

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}
export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len > 1e-12 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 0, 0];
}

// ----- quaternions (Hamilton product, active rotation) -----
// (a ⊗ b) applies b first, then a — matches quatRotate(a⊗b, v) = a(b(v)).
export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

// Rotate v by q using the standard t = 2·(q.xyz × v) form.
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}

// Rotation matrix (body → world) for a unit quaternion. R·v == quatRotate(q, v).
export function quatToMat3(q: Quat): Mat3 {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z;
  const wx = w * x, wy = w * y, wz = w * z;
  return [
    [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy)],
    [2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx)],
    [2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy)],
  ];
}

// ----- small 3×3 matrix helpers (used by the inertia tensor + rigid body) -----
export function mat3MulVec(m: Mat3, v: Vec3): Vec3 {
  return [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
}
export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const out: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      out[i]![j] = a[i]![0]! * b[0]![j]! + a[i]![1]! * b[1]![j]! + a[i]![2]! * b[2]![j]!;
  return [
    [out[0]![0]!, out[0]![1]!, out[0]![2]!],
    [out[1]![0]!, out[1]![1]!, out[1]![2]!],
    [out[2]![0]!, out[2]![1]!, out[2]![2]!],
  ];
}
export function mat3Transpose(m: Mat3): Mat3 {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}
export function mat3Scale(m: Mat3, s: number): Mat3 {
  return [
    [m[0][0] * s, m[0][1] * s, m[0][2] * s],
    [m[1][0] * s, m[1][1] * s, m[1][2] * s],
    [m[2][0] * s, m[2][1] * s, m[2][2] * s],
  ];
}
export function mat3Add(a: Mat3, b: Mat3): Mat3 {
  return [
    [a[0][0] + b[0][0], a[0][1] + b[0][1], a[0][2] + b[0][2]],
    [a[1][0] + b[1][0], a[1][1] + b[1][1], a[1][2] + b[1][2]],
    [a[2][0] + b[2][0], a[2][1] + b[2][1], a[2][2] + b[2][2]],
  ];
}
export function mat3Inverse(m: Mat3): Mat3 {
  const a = m[0][0], b = m[0][1], c = m[0][2];
  const d = m[1][0], e = m[1][1], f = m[1][2];
  const g = m[2][0], h = m[2][1], i = m[2][2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-18) throw new Error("singular matrix");
  const inv = 1 / det;
  return [
    [A * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [B * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [C * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}

// Shortest-arc quaternion rotating unit vector `a` onto unit vector `b`.
export function quatFromTo(a: Vec3, b: Vec3): Quat {
  const d = dot(a, b);
  if (d > 0.999999) return [0, 0, 0, 1];
  if (d < -0.999999) {
    // Antiparallel: 180° about any axis perpendicular to a.
    let axis = cross([1, 0, 0], a);
    if (length(axis) < 1e-6) axis = cross([0, 1, 0], a);
    axis = normalize(axis);
    return [axis[0], axis[1], axis[2], 0];
  }
  const axis = cross(a, b);
  return quatNormalize([axis[0], axis[1], axis[2], 1 + d]);
}

// ----- the solid -----
// Equator radius is 1. `EQUATOR_C` is the zig-zag half-amplitude; the apex
// height `APEX_Y` is then fixed by the requirement that each kite's four
// corners stay coplanar (the constant 9.4723 is solved from that condition —
// see the planarity assertion in the test).
// 0.118 gives a classic, faintly tall d10 silhouette (tuned by eye); any value
// in roughly 0.10–0.14 stays a believable die. APEX_Y is then NOT free — it is
// fixed by the coplanarity condition (the 9.4723 factor is solved from it, and
// the test asserts every face stays planar).
const EQUATOR_C = 0.118;
const APEX_Y = 9.4723 * EQUATOR_C;

function buildVertices(): Vec3[] {
  const verts: Vec3[] = [];
  // Index 0..9: equator zig-zag (even index = upper, odd = lower).
  for (let k = 0; k < 10; k++) {
    const ang = (Math.PI / 5) * k; // 36° steps
    const y = k % 2 === 0 ? EQUATOR_C : -EQUATOR_C;
    verts.push([Math.cos(ang), y, Math.sin(ang)]);
  }
  verts.push([0, APEX_Y, 0]); // 10: top apex
  verts.push([0, -APEX_Y, 0]); // 11: bottom apex
  return verts;
}

export const VERTICES: readonly Vec3[] = buildVertices();
export const TOP_APEX = 10;
export const BOT_APEX = 11;

// Ten kite faces, each as four vertex indices wound CCW when seen from
// outside. Five fan from the top apex, five from the bottom apex.
function buildFaces(): (readonly [number, number, number, number])[] {
  const faces: (readonly [number, number, number, number])[] = [];
  for (let j = 0; j < 5; j++) {
    // top kite: apex, upper, lower, upper
    faces.push([TOP_APEX, (2 * j) % 10, (2 * j + 1) % 10, (2 * j + 2) % 10]);
  }
  for (let j = 0; j < 5; j++) {
    // bottom kite: apex, lower, upper, lower
    faces.push([BOT_APEX, (2 * j + 1) % 10, (2 * j + 2) % 10, (2 * j + 3) % 10]);
  }
  return faces;
}

export const FACES: readonly (readonly [number, number, number, number])[] = buildFaces();

function vertexOf(i: number): Vec3 {
  const v = VERTICES[i];
  if (!v) throw new Error("bad vertex index " + i);
  return v;
}

// Centroid, outward normal, and in-plane "up" (toward the apex) for each face.
export type FaceFrame = { centroid: Vec3; normal: Vec3; up: Vec3 };

function buildFrames(): FaceFrame[] {
  return FACES.map((f) => {
    const p0 = vertexOf(f[0]);
    const p1 = vertexOf(f[1]);
    const p2 = vertexOf(f[2]);
    const p3 = vertexOf(f[3]);
    const centroid = scale(add(add(p0, p1), add(p2, p3)), 0.25);
    // Normal from the kite's diagonals; flip to point away from the origin.
    let normal = normalize(cross(sub(p2, p0), sub(p3, p1)));
    if (dot(normal, centroid) < 0) normal = scale(normal, -1);
    // "Up" points from the face toward its apex (vertex 0), projected into the
    // face plane. The renderer draws each digit with its top toward this vector
    // (see drawDie in main.ts), so the printed number reads upright on a face.
    const toApex = sub(p0, centroid);
    const up = normalize(sub(toApex, scale(normal, dot(toApex, normal))));
    return { centroid, normal, up };
  });
}

export const FACE_FRAMES: readonly FaceFrame[] = buildFrames();

// Digit printed on each face (face index 0..9 → 1..10). A permutation chosen
// so neighbouring faces differ and antipodal faces sum to 11, like a real d10.
// Only the *selected* face is ever read, so this is purely cosmetic — but the
// test asserts it stays a bijection, which is what guarantees the value shown
// equals the value rolled.
export const FACE_DIGITS: readonly number[] = [1, 2, 3, 4, 5, 7, 6, 10, 9, 8];

export const FACE_FOR_DIGIT: readonly number[] = (() => {
  const map = new Array<number>(11).fill(-1); // index by digit 1..10
  FACE_DIGITS.forEach((digit, face) => {
    map[digit] = face;
  });
  return map;
})();

export function faceForDigit(digit: number): number {
  const f = FACE_FOR_DIGIT[digit];
  // Distinguish an out-of-range digit (undefined) from a corrupted/non-bijective
  // map (-1) so a failure here is actually diagnosable.
  if (f === undefined) throw new Error("digit out of range: " + digit);
  if (f < 0) throw new Error("digit " + digit + " is missing from FACE_DIGITS (map not a bijection)");
  return f;
}

// ----- mass properties (the real inertia tensor) -----
// The solid is centrally symmetric, so its centre of mass is the origin and the
// model vertices already sit relative to it. We integrate the inertia tensor
// *exactly* by decomposing the solid into tetrahedra (origin → each surface
// triangle) and summing each one's contribution via the canonical-tetrahedron
// covariance. With a 5-fold symmetry axis (y) the result is a symmetric top:
// I_xx == I_zz != I_yy with zero off-diagonals (the test asserts this).
export const MASS = 1;

// ∫ ξξᵀ dV over the canonical tetra (0, e1, e2, e3) = (1/120)·[[2,1,1],[1,2,1],[1,1,2]].
const TETRA_COV: Mat3 = [
  [2 / 120, 1 / 120, 1 / 120],
  [1 / 120, 2 / 120, 1 / 120],
  [1 / 120, 1 / 120, 2 / 120],
];

function computeMassProps(): { volume: number; inertia: Mat3; invInertia: Mat3 } {
  let volume = 0;
  let cov: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  // Each kite face splits into two outward-wound triangles.
  for (const f of FACES) {
    for (const [i, j, k] of [[f[0], f[1], f[2]], [f[0], f[2], f[3]]] as const) {
      const a = vertexOf(i), b = vertexOf(j), c = vertexOf(k);
      // The origin lies inside the solid and these origin→face tetrahedra tile it
      // with no overlap, so each contributes its (unsigned) volume regardless of
      // how the face happens to be wound. |det M| = 6·(tetra volume).
      const vol6 = Math.abs(dot(a, cross(b, c)));
      volume += vol6 / 6;
      const M: Mat3 = [
        [a[0], b[0], c[0]],
        [a[1], b[1], c[1]],
        [a[2], b[2], c[2]],
      ];
      // ∫ x xᵀ dV over this tetra = |det M| · M · TETRA_COV · Mᵀ. (TETRA_COV is
      // permutation-symmetric, so vertex order within the triangle is irrelevant.)
      cov = mat3Add(cov, mat3Scale(mat3Mul(mat3Mul(M, TETRA_COV), mat3Transpose(M)), vol6));
    }
  }
  const density = MASS / volume;
  cov = mat3Scale(cov, density); // C = ∫ ρ x xᵀ dV
  const tr = cov[0][0] + cov[1][1] + cov[2][2];
  // Inertia tensor I = trace(C)·Id − C.
  const inertia: Mat3 = [
    [tr - cov[0][0], -cov[0][1], -cov[0][2]],
    [-cov[1][0], tr - cov[1][1], -cov[1][2]],
    [-cov[2][0], -cov[2][1], tr - cov[2][2]],
  ];
  return { volume, inertia, invInertia: mat3Inverse(inertia) };
}

const MASS_PROPS = computeMassProps();
export const VOLUME = MASS_PROPS.volume;
export const INERTIA: Mat3 = MASS_PROPS.inertia;
export const INV_INERTIA_BODY: Mat3 = MASS_PROPS.invInertia;

// World up — the floor's normal. A settled die is read off its top face.
export const WORLD_UP: Vec3 = [0, 1, 0];

// Which face currently points most upward (its world normal closest to +Y).
// A trapezohedron resting flat on its bottom face puts the antipodal face flat
// on top; that top face is what you read on a real d10.
export function faceUp(orientation: Quat): number {
  let best = 0;
  let bestY = -Infinity;
  FACE_FRAMES.forEach((frame, i) => {
    const ny = quatRotate(orientation, frame.normal)[1];
    if (ny > bestY) {
      bestY = ny;
      best = i;
    }
  });
  return best;
}

// The digit read off a given orientation (its top face's printed value, 1..10).
export function readDigit(orientation: Quat): number {
  return FACE_DIGITS[faceUp(orientation)]!;
}

// Minimal-tilt correction: nudge the current orientation so its top face's
// normal is *exactly* +Y. Doubles as the settle snap — it removes residual
// jitter and makes the top-face read unambiguous without spinning the die.
export function settleQuat(orientation: Quat): { quat: Quat; face: number } {
  const face = faceUp(orientation);
  const n = quatRotate(orientation, FACE_FRAMES[face]!.normal);
  const corr = quatFromTo(n, WORLD_UP);
  return { quat: quatNormalize(quatMul(corr, orientation)), face };
}

// An orientation that lays a chosen face flat on top (used by the reduced-motion
// path, which picks a face directly instead of simulating a throw).
export function faceUpQuat(face: number): Quat {
  return quatFromTo(FACE_FRAMES[face]!.normal, WORLD_UP);
}
