// A tiny, dependency-free random source.
//
// The physics throw is seeded through a `Rng` function so the production app can
// pass `Math.random` while the headless fairness test passes a deterministic
// PRNG — making the chi-square uniformity check reproducible instead of flaky.

import { normalize, type Quat, type Vec3 } from "./die3d";

export type Rng = () => number;

// mulberry32 — a small, well-distributed 32-bit PRNG. Same seed → same stream.
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A uniform random rotation (Shoemake's method). Sampling the *initial
// orientation* uniformly over SO(3) is what makes an honest physics roll fair:
// the isohedral die has no preferred face, so a uniform start + a vigorous
// tumble lands on each digit equally often.
export function randomQuat(rng: Rng): Quat {
  const u1 = rng(), u2 = rng(), u3 = rng();
  const s1 = Math.sqrt(1 - u1), s2 = Math.sqrt(u1);
  const t1 = 2 * Math.PI * u2, t2 = 2 * Math.PI * u3;
  return [s1 * Math.sin(t1), s1 * Math.cos(t1), s2 * Math.sin(t2), s2 * Math.cos(t2)];
}

// A uniformly random unit vector (used for the tumble axis on an auto-throw).
export function randomDir(rng: Rng): Vec3 {
  const z = rng() * 2 - 1;
  const a = rng() * 2 * Math.PI;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return normalize([r * Math.cos(a), z, r * Math.sin(a)]);
}
