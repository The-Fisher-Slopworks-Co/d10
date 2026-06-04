// Headless correctness tests for the d10 geometry + the physics roll.
//
// The look needs eyes (see README / browser check), but the properties that
// matter are pure math and are asserted here:
//   • the solid is a valid pentagonal trapezohedron (10 planar kite faces);
//   • its real inertia tensor is the symmetric top a 5-fold-symmetric die must
//     have, so the simulation tumbles believably;
//   • an honest physics throw always *settles* — flat on exactly one face, in
//     bounded time, with an unambiguous reading;
//   • and that reading is FAIR — a seeded chi-square over thousands of throws
//     stays uniform over 1..10 (the result is emergent, not chosen up front, so
//     fairness is a property we must actually check).

import { expect, test } from "bun:test";
import {
  FACES,
  FACE_DIGITS,
  FACE_FRAMES,
  INERTIA,
  VERTICES,
  VOLUME,
  cross,
  dot,
  faceForDigit,
  faceUp,
  normalize,
  quatRotate,
  readDigit,
  settleQuat,
  sub,
  type Vec3,
} from "../src/die3d";
import {
  DEFAULT_BOUNDS,
  autoThrow,
  restingBody,
  simulateToRest,
  step,
} from "../src/physics";
import { mulberry32, randomQuat } from "../src/rng";

function vertex(i: number): Vec3 {
  const v = VERTICES[i];
  if (!v) throw new Error("bad index");
  return v;
}

// ----- geometry -----

test("there are 10 kite faces, each with 4 distinct vertices", () => {
  expect(FACES.length).toBe(10);
  for (const f of FACES) {
    expect(f.length).toBe(4);
    expect(new Set(f).size).toBe(4);
  }
});

test("every face is planar (the apex height is solved for coplanarity)", () => {
  for (const f of FACES) {
    const p0 = vertex(f[0]), p1 = vertex(f[1]), p2 = vertex(f[2]), p3 = vertex(f[3]);
    const n = normalize(cross(sub(p2, p0), sub(p3, p1)));
    expect(Math.abs(dot(n, sub(p3, p0)))).toBeLessThan(1e-3);
  }
});

test("FACE_DIGITS is a bijection onto 1..10 (all fairness needs)", () => {
  expect(FACE_DIGITS.length).toBe(10);
  expect([...FACE_DIGITS].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (let d = 1; d <= 10; d++) expect(FACE_DIGITS[faceForDigit(d)]).toBe(d);
});

test("faces come in antipodal pairs (resting on one lays its pair flat on top)", () => {
  FACE_FRAMES.forEach((frame, i) => {
    let bestDot = 1;
    let partner = -1;
    FACE_FRAMES.forEach((other, j) => {
      if (i === j) return;
      const d = dot(frame.normal, other.normal);
      if (d < bestDot) {
        bestDot = d;
        partner = j;
      }
    });
    // The most-opposed face's normal is the exact negative of this one.
    expect(partner).toBeGreaterThanOrEqual(0);
    expect(bestDot).toBeLessThan(-0.999);
  });
});

// ----- mass properties -----

test("the inertia tensor is a symmetric top (I_xx == I_zz != I_yy, diagonal)", () => {
  expect(VOLUME).toBeGreaterThan(0);
  const Ixx = INERTIA[0][0], Iyy = INERTIA[1][1], Izz = INERTIA[2][2];
  expect(Ixx).toBeGreaterThan(0);
  expect(Iyy).toBeGreaterThan(0);
  // 5-fold symmetry about y → isotropic in the x–z plane.
  expect(Math.abs(Ixx - Izz)).toBeLessThan(1e-6);
  // ...but distinct from the polar moment.
  expect(Math.abs(Iyy - Ixx)).toBeGreaterThan(1e-3);
  // Off-diagonals vanish (and the matrix is symmetric).
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      if (r !== c) expect(Math.abs(INERTIA[r]![c]!)).toBeLessThan(1e-6);
});

// ----- settling -----

test("settleQuat lays the top face exactly flat and the reading is unambiguous", () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 200; i++) {
    const { quat, face } = settleQuat(randomQuat(rng));
    // The chosen face's normal is pinned to +Y.
    const n = quatRotate(quat, FACE_FRAMES[face]!.normal);
    expect(n[1]).toBeGreaterThan(0.9999);
    // It is strictly the highest face — no tie between two faces.
    const ys = FACE_FRAMES.map((fr) => quatRotate(quat, fr.normal)[1]).sort((a, b) => b - a);
    expect(ys[0]! - ys[1]!).toBeGreaterThan(0.2);
    expect(faceUp(quat)).toBe(face);
    expect(readDigit(quat)).toBe(FACE_DIGITS[face]!);
  }
});

test("a resting die already reads the face it was laid on", () => {
  for (let face = 0; face < 10; face++) {
    const body = restingBody(face);
    expect(body.asleep).toBe(true);
    expect(faceUp(body.quat)).toBe(face);
  }
});

test("every machine throw settles flat on one face in bounded time", () => {
  const rng = mulberry32(99);
  const dt = 1 / 180;
  let maxSteps = 0;
  for (let i = 0; i < 400; i++) {
    const body = autoThrow(rng, DEFAULT_BOUNDS);
    let s = 0;
    for (; s < 2000 && !body.asleep; s++) {
      step(body, DEFAULT_BOUNDS, dt);
      // never explodes / goes NaN mid-flight
      expect(Number.isFinite(body.pos[0] + body.pos[1] + body.pos[2])).toBe(true);
    }
    expect(body.asleep).toBe(true); // it actually came to rest on its own
    maxSteps = Math.max(maxSteps, s);
    const top = faceUp(body.quat);
    const n = quatRotate(body.quat, FACE_FRAMES[top]!.normal);
    expect(n[1]).toBeGreaterThan(0.999); // landed flat, not balanced on an edge
  }
  expect(maxSteps).toBeLessThan(2000);
});

// ----- fairness (the headline invariant of an emergent-result die) -----

test("ROLL FAIRNESS: emergent results are uniform over 1..10 (chi-square, seeded)", () => {
  const rng = mulberry32(0xd10);
  const dt = 1 / 180;
  const N = 6000;
  const counts = new Array<number>(11).fill(0);
  for (let i = 0; i < N; i++) {
    const result = simulateToRest(autoThrow(rng, DEFAULT_BOUNDS), DEFAULT_BOUNDS, dt, 2000);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBeLessThanOrEqual(10);
    counts[result] = (counts[result] ?? 0) + 1;
  }
  // Every face must actually appear.
  for (let d = 1; d <= 10; d++) expect(counts[d]!).toBeGreaterThan(0);
  // Chi-square over 10 cells (df = 9). The throw is fair by construction
  // (uniform start orientation + vigorous tumble); this guards against a
  // regression that biases settling. 27.88 is the 99.9% critical value.
  const exp = N / 10;
  let chi = 0;
  for (let d = 1; d <= 10; d++) chi += (counts[d]! - exp) ** 2 / exp;
  expect(chi).toBeLessThan(27.88);
}, 60_000);
