// d10 — a single ten-sided die roller.
//
// The real result is generated up front; the tumble is pure theater that locks
// the displayed digit to that result as it settles, so the number you see at
// rest always equals the actual roll. A single `rollId` token cancels stale
// callbacks, keeping rapid re-rolls and mid-roll interruptions clean.

const die = document.getElementById("die") as HTMLElement;
const dieWrap = die;
const stage = document.getElementById("stage") as HTMLElement;
const shadow = document.getElementById("shadow") as HTMLElement;
const numText = document.querySelector<SVGTextElement>("#numText")!;
const btn = document.getElementById("rollBtn") as HTMLButtonElement;
const sparks = document.getElementById("sparks") as HTMLElement;
const live = document.getElementById("live") as HTMLElement;
const blurNode = document.querySelector<SVGFEGaussianBlurElement>("#blurNode")!;

const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

let rollId = 0; // cancellation token
let current = 10; // last settled value

type Spark = { el: HTMLSpanElement; dx: number; dy: number; sc: number };

function setNumber(n: number): void {
  numText.textContent = String(n);
  // tighten the wide "10"
  numText.setAttribute("font-size", n === 10 ? "46" : "60");
}

function setDieLabel(n: number): void {
  die.setAttribute("aria-label", "Ten-sided die, currently showing " + n + ". Activate to roll.");
}

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

// ----- spark burst on landing -----
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

  // animate out
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
  for (const nd of nodes) {
    if (nd.el.parentNode) nd.el.parentNode.removeChild(nd.el);
  }
}
function clearAllSparks(): void {
  while (sparks.firstChild) sparks.removeChild(sparks.firstChild);
}

// easing
function easeOutQuint(t: number): number {
  return 1 - Math.pow(1 - t, 5);
}
function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// ----- the main roll -----
function roll(): void {
  rollId++;
  const myRoll = rollId;

  // TRUE RESULT — generated up front, animation is pure theater
  const result = 1 + Math.floor(Math.random() * 10);

  clearAllSparks();
  live.textContent = "";

  // Clear any inline styles a prior (reduced-motion) roll may have left behind,
  // so both paths always start from a clean transform/opacity state.
  dieWrap.style.opacity = "1";
  dieWrap.style.transition = "";

  if (reduceQuery.matches) {
    reducedRoll(myRoll, result);
    return;
  }

  stage.classList.add("spinning");

  // randomize spin character each roll
  const spins = 3 + Math.floor(Math.random() * 2); // full Z turns
  const dir = Math.random() < 0.5 ? 1 : -1;
  const totalZ = dir * (spins * 360 + (Math.random() * 120 - 60));
  const wobX = (Math.random() * 18 + 14) * (Math.random() < 0.5 ? 1 : -1); // bounded
  const wobY = (Math.random() * 18 + 14) * (Math.random() < 0.5 ? 1 : -1);
  const settleZ = Math.random() * 6 - 3; // tiny resting tilt

  const DUR = 1500 + Math.random() * 250; // ms
  let start: number | null = null;
  let lastDigitSwap = 0;

  function frame(ts: number): void {
    if (myRoll !== rollId) return; // cancelled
    if (start === null) start = ts;
    const elapsed = ts - start;
    const t = clamp(elapsed / DUR, 0, 1);
    const e = easeOutQuint(t);

    // ---- lift trajectory: rises then lands (parabola-ish, peak ~38%) ----
    const liftPhase = easeInOutSine(clamp(t / 0.62, 0, 1)); // up
    const landPhase = t > 0.62 ? easeOutQuint((t - 0.62) / 0.38) : 0;
    const lift = liftPhase * (1 - landPhase); // 0..1..0
    const translateY = -lift * 46;
    const scale = 1 + lift * 0.16;

    // ---- rotation: decelerate to target, then a tiny overshoot-and-settle ----
    const targetZ = totalZ + settleZ;
    const baseZ = targetZ * e; // glides to targetZ
    // damped spring overshoot, active in the last ~30%, peaks ~3.5deg, ->0 at t=1
    const sp = clamp((t - 0.7) / 0.3, 0, 1);
    const springDeg = -dir * 3.6 * Math.sin(sp * Math.PI * 1.5) * (1 - sp) * (1 - sp);
    const rzFinal = baseZ + springDeg;

    const rx = wobX * (1 - e) + Math.sin(t * Math.PI) * 4 * (1 - landPhase);
    const ry = wobY * (1 - e);

    dieWrap.style.transform =
      "translateY(" +
      translateY.toFixed(2) +
      "px) scale(" +
      scale.toFixed(3) +
      ") rotateX(" +
      rx.toFixed(2) +
      "deg) rotateY(" +
      ry.toFixed(2) +
      "deg) rotateZ(" +
      rzFinal.toFixed(2) +
      "deg)";

    // ---- shadow choreography (inverse of lift) ----
    const sScale = 1 - lift * 0.34;
    const sOpacity = 1 - lift * 0.55;
    const sBlur = 7 + lift * 12;
    shadow.style.transform = "translateX(-50%) scale(" + sScale.toFixed(3) + ")";
    shadow.style.opacity = sOpacity.toFixed(3);
    shadow.style.filter = "blur(" + sBlur.toFixed(1) + "px)";

    // ---- motion blur tied to angular speed (peak early, fade out) ----
    const speed = 1 - e; // ~angular velocity proxy
    const blurAmt = clamp(speed * 5.2 - 0.4, 0, 5);
    blurNode.setAttribute("stdDeviation", blurAmt.toFixed(2));

    // ---- digit cycling: fast early, slowing, lock to result near the end ----
    const swapInterval = 40 + e * 150; // ms; slows as it settles
    if (t < 0.82) {
      if (ts - lastDigitSwap >= swapInterval) {
        lastDigitSwap = ts;
        const rnd = 1 + Math.floor(Math.random() * 10);
        setNumber(rnd);
      }
    } else {
      // lock to true result for the final settle
      if (numText.textContent !== String(result)) setNumber(result);
    }

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      finishRoll(myRoll, result, settleZ);
    }
  }

  requestAnimationFrame(frame);
}

function finishRoll(myRoll: number, result: number, settleZ: number): void {
  if (myRoll !== rollId) return;
  setNumber(result);
  blurNode.setAttribute("stdDeviation", "0");

  // final resting transform (tiny tilt, grounded)
  dieWrap.style.transform =
    "translateY(0px) scale(1) rotateX(0deg) rotateY(0deg) rotateZ(" + settleZ.toFixed(2) + "deg)";
  shadow.style.transform = "translateX(-50%) scale(1)";
  shadow.style.opacity = "1";
  shadow.style.filter = "blur(7px)";

  stage.classList.remove("spinning");

  burst(myRoll);

  current = result;
  setDieLabel(result);
  live.textContent = "Rolled " + result + ".";
}

// ----- reduced motion: calm fade/scale to result -----
function reducedRoll(myRoll: number, result: number): void {
  stage.classList.remove("spinning");
  blurNode.setAttribute("stdDeviation", "0");
  dieWrap.style.transition = "none";
  dieWrap.style.transform = "scale(0.9)";
  dieWrap.style.opacity = "0.35";
  setNumber(result);

  // force reflow then ease in
  void dieWrap.offsetWidth;
  requestAnimationFrame(() => {
    if (myRoll !== rollId) return;
    dieWrap.style.transition = "transform 360ms ease, opacity 360ms ease";
    dieWrap.style.transform = "scale(1)";
    dieWrap.style.opacity = "1";
  });

  setTimeout(() => {
    if (myRoll !== rollId) return;
    dieWrap.style.transition = "";
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

// init resting state
setNumber(current);
setDieLabel(current);
