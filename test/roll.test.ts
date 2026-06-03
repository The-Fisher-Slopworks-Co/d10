// Headless correctness tests for the d10 geometry + roll invariant.
//
// The visual look needs eyes (see README / browser check), but the invariant
// that matters most — "the value shown when the die settles equals the actual
// random result" — is pure math and is asserted here over many rolls.

import { expect, test } from "bun:test";
import {
  FACES,
  FACE_DIGITS,
  FACE_FRAMES,
  VERTICES,
  VIEW_DIR,
  cross,
  dot,
  faceForDigit,
  frontFace,
  normalize,
  quatFromAxisAngle,
  quatMul,
  quatRotate,
  restQuat,
  sub,
  type Vec3,
} from "../src/die3d";

function vertex(i: number): Vec3 {
  const v = VERTICES[i];
  if (!v) throw new Error("bad index");
  return v;
}

test("there are 10 kite faces, each with 4 distinct vertices", () => {
  expect(FACES.length).toBe(10);
  for (const f of FACES) {
    expect(f.length).toBe(4);
    expect(new Set(f).size).toBe(4);
  }
});

test("every face is planar (the apex height is solved for coplanarity)", () => {
  for (const f of FACES) {
    const p0 = vertex(f[0]);
    const p1 = vertex(f[1]);
    const p2 = vertex(f[2]);
    const p3 = vertex(f[3]);
    const n = normalize(cross(sub(p2, p0), sub(p3, p1)));
    // The 4th corner must lie in the plane of the first three.
    const offPlane = Math.abs(dot(n, sub(p3, p0)));
    expect(offPlane).toBeLessThan(1e-3);
  }
});

test("FACE_DIGITS is a bijection onto 1..10", () => {
  expect(FACE_DIGITS.length).toBe(10);
  expect([...FACE_DIGITS].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (let d = 1; d <= 10; d++) {
    expect(FACE_DIGITS[faceForDigit(d)]).toBe(d);
  }
});

test("restQuat pins the chosen face normal to the view direction", () => {
  for (let face = 0; face < 10; face++) {
    const q = restQuat(face);
    const frame = FACE_FRAMES[face]!;
    const n = quatRotate(q, frame.normal);
    // Rotated normal aligns with the camera/view direction.
    expect(dot(n, VIEW_DIR)).toBeGreaterThan(0.999);
  }
});

test("restQuat keeps the read digit upright (face-up maps to screen-up)", () => {
  for (let face = 0; face < 10; face++) {
    const q = restQuat(face);
    const frame = FACE_FRAMES[face]!;
    const up = quatRotate(q, frame.up);
    // Screen-up component dominates and is positive (not upside-down/rotated).
    expect(up[1]).toBeGreaterThan(0.9);
    expect(Math.abs(up[0])).toBeLessThan(0.1);
  }
});

test("at rest the front-facing face is exactly the chosen face", () => {
  for (let face = 0; face < 10; face++) {
    expect(frontFace(restQuat(face))).toBe(face);
  }
});

test("a decaying spin lands exactly on the rest pose (q_spin → identity)", () => {
  const axis: Vec3 = normalize([0.3, 1, 0.5]);
  for (let face = 0; face < 10; face++) {
    const rest = restQuat(face);
    // At t = 1 the spin angle is 0, so q(t) = identity ⊗ rest = rest.
    const spin = quatFromAxisAngle(axis, 0);
    const landed = quatMul(spin, rest);
    expect(frontFace(landed)).toBe(face);
  }
});

// Easing + orientation reproduced from main.ts: q(t) = spin(t) ⊗ wob(t) ⊗ rest,
// where both the spin and wobble angles decay to 0 at t = 1.
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}
function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}
function orientationAt(
  t: number,
  rest: ReturnType<typeof restQuat>,
  spinAxis: Vec3,
  spinTurns: number,
  wobAxis: Vec3,
  wobAngle: number,
) {
  const e = easeOutQuint(t);
  const spin = quatFromAxisAngle(spinAxis, spinTurns * 2 * Math.PI * (1 - e));
  const wob = quatFromAxisAngle(wobAxis, wobAngle * (1 - easeInOutSine(t)));
  return quatMul(quatMul(spin, wob), rest);
}

test("ROLL INVARIANT: a real decaying tumble lands on the rolled result (50k throws)", () => {
  const counts = new Array<number>(11).fill(0);
  let clearlyTumbled = 0; // throws that present a non-result face in flight
  // Sample early, where the decaying spin is fastest, so we actually catch the
  // tumble (by late t it has already eased onto the result).
  const SAMPLE_T = [0.04, 0.08, 0.12, 0.18, 0.25, 0.35];
  const N = 50_000;
  for (let i = 0; i < N; i++) {
    // Exactly what main.ts does: pick result up front, choreograph onto its face.
    const result = 1 + Math.floor(Math.random() * 10);
    const face = faceForDigit(result);
    const rest = restQuat(face);
    const spinAxis = normalize([Math.random() * 1.6 - 0.8, Math.random() * 0.7 - 0.35, Math.random() * 1.6 - 0.8]);
    const wobAxis = normalize([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1]);
    const spinTurns = 3 + Math.floor(Math.random() * 3);
    const wobAngle = (Math.random() * 0.5 + 0.4) * (Math.random() < 0.5 ? 1 : -1);

    // It is genuinely tumbling, not a static reveal: somewhere in flight it
    // presents a face other than the result to the camera.
    let showedOther = false;
    for (const t of SAMPLE_T) {
      if (frontFace(orientationAt(t, rest, spinAxis, spinTurns, wobAxis, wobAngle)) !== face) {
        showedOther = true;
        break;
      }
    }
    if (showedOther) clearlyTumbled++;

    // At t = 1 the decaying angles reach 0, so it lands exactly on the rest pose.
    const settled = orientationAt(1, rest, spinAxis, spinTurns, wobAxis, wobAngle);
    const shown = FACE_DIGITS[frontFace(settled)]!;
    expect(shown).toBe(result);
    counts[result] = (counts[result] ?? 0) + 1;
  }
  // The overwhelming majority visibly tumble (show a non-result face) first.
  expect(clearlyTumbled).toBeGreaterThan(N * 0.9);
  // Result selection itself is uniform over 1..10 (this exercises the picker /
  // Math.random, not the geometry — a sanity check, ~5000 expected each).
  for (let d = 1; d <= 10; d++) {
    expect(counts[d]!).toBeGreaterThan(N / 10 - 400);
    expect(counts[d]!).toBeLessThan(N / 10 + 400);
  }
});
