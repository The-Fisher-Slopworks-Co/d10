// d10 geometry + 3D math — a pure, DOM-free module.
//
// Everything here is deterministic geometry and linear algebra so it can be
// imported and asserted by a headless test (see test/roll.test.ts). The DOM,
// the canvas, and the animation live in main.ts.
//
// The solid is a real pentagonal trapezohedron: two apexes on the polar (y)
// axis and a ten-vertex zig-zag "equator" in the x–z plane, giving ten
// congruent kite faces. Picking the result up front and rotating the chosen
// face to the camera (see `restQuat`) is what keeps the rendered die honest:
// the face you read at rest is, by construction, the random result.

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
export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const a = normalize(axis);
  const h = angle / 2;
  const s = Math.sin(h);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)];
}

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

// Quaternion from a 3×3 rotation matrix (Shepperd's method).
export function quatFromMat3(m: Mat3): Quat {
  const m00 = m[0][0], m01 = m[0][1], m02 = m[0][2];
  const m10 = m[1][0], m11 = m[1][1], m12 = m[1][2];
  const m20 = m[2][0], m21 = m[2][1], m22 = m[2][2];
  const trace = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2; // 4w
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2; // 4x
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2; // 4y
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2; // 4z
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return quatNormalize([x, y, z, w]);
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
    // "Up" points from the face toward its apex (vertex 0), projected into
    // the face plane. The digit is drawn with its top toward this vector, so
    // forcing it to screen-up (in restQuat) lands the read digit upright.
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

// How far the resting die tilts its read-face toward the light/up, in radians.
// 0 = face dead-on; positive = we look slightly down onto it (more 3D).
export const VIEW_TILT = 0.21;

// The orientation that brings face `f` to rest facing the camera, upright.
// Builds the rotation mapping the face's own frame (right, up, normal) onto a
// fixed view frame, then converts to a quaternion. Both the face normal → view
// direction AND the digit's up → screen-up are pinned, so the digit can't
// settle rotated or upside-down.
export function restQuat(face: number, tilt: number = VIEW_TILT): Quat {
  const frame = FACE_FRAMES[face];
  if (!frame) throw new Error("bad face index " + face);
  const n = frame.normal;
  // Orthonormal model frame (e1 right, e2 up, e3 normal), right-handed.
  const e1 = normalize(cross(frame.up, n));
  const e2 = cross(n, e1);
  const e3 = n;
  // Target view frame: normal toward camera tilted up by `tilt`, up ≈ +Y.
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const t1: Vec3 = [1, 0, 0];
  const t2: Vec3 = [0, c, -s];
  const t3: Vec3 = [0, s, c];
  // R = Σ t_k ⊗ e_k maps e_k → t_k.
  const R: Mat3 = [
    [
      t1[0] * e1[0] + t2[0] * e2[0] + t3[0] * e3[0],
      t1[0] * e1[1] + t2[0] * e2[1] + t3[0] * e3[1],
      t1[0] * e1[2] + t2[0] * e2[2] + t3[0] * e3[2],
    ],
    [
      t1[1] * e1[0] + t2[1] * e2[0] + t3[1] * e3[0],
      t1[1] * e1[1] + t2[1] * e2[1] + t3[1] * e3[1],
      t1[1] * e1[2] + t2[1] * e2[2] + t3[1] * e3[2],
    ],
    [
      t1[2] * e1[0] + t2[2] * e2[0] + t3[2] * e3[0],
      t1[2] * e1[1] + t2[2] * e2[1] + t3[2] * e3[1],
      t1[2] * e1[2] + t2[2] * e2[2] + t3[2] * e3[2],
    ],
  ];
  return quatFromMat3(R);
}

// The camera/read direction. Derived from VIEW_TILT (not a separate literal) so
// it can never drift out of sync with the rest orientation restQuat() targets.
export const VIEW_DIR: Vec3 = [0, Math.sin(VIEW_TILT), Math.cos(VIEW_TILT)];

// Which face currently reads as "up to the camera": the one whose rotated
// normal is most aligned with VIEW_DIR. Used by the test to confirm the
// rendered result matches the chosen face (the renderer reads the same way).

export function frontFace(orientation: Quat): number {
  let best = -1;
  let bestDot = -Infinity;
  FACE_FRAMES.forEach((frame, i) => {
    const d = dot(quatRotate(orientation, frame.normal), VIEW_DIR);
    if (d > bestDot) {
      bestDot = d;
      best = i;
    }
  });
  return best;
}
