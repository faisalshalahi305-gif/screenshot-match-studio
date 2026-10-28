// @ts-nocheck
import * as THREE from "three";
import { setVelocity, step, SUN_COLLIDE_AU, EARTH_V_KMS, orbitInfo, type Body } from "@/lib/orbit-physics";

export const S = 20; // scene units per AU
export const RACE_DELAY_S = 15; // real seconds both planets move together before the twin speeds up
export const RACE_RATE = 0.8; // km/s gained per real second
export const RACE_MAX_DV = 8; // total km/s added to the twin
export const TWIN_SOFT_DV = 0.3; // km/s difference during the gradual-divergence phase
export const TWIN_LEAD_RAD = 0.6; // angular head start of the faster planet
/** Real seconds after acceleration ends before the two-planet experiment stops completely. */
export const RACE_TAIL_S = 20;
export const RACE_END_S = RACE_DELAY_S + RACE_MAX_DV / RACE_RATE + RACE_TAIL_S;

/** Sun-mass presets, as multiples of the real Sun (1.989×10³⁰ kg). */
export const SUN_MASS_KG = 1.989e30;
export const SUN_MASS_PRESETS = [
  { key: "more", label: "أكبر", m: 1.5 },
  { key: "muchLess", label: "أصغر", m: 0.25 },
] as const;

/** Other planets simulated with real gravity (AU, start phase in rad). */
export const PLANET_ORBITS = [
  { name: "mercury", au: 0.39, phase: 1.2 },
  { name: "venus", au: 0.72, phase: 3.9 },
  { name: "mars", au: 1.52, phase: 0.6 },
  { name: "jupiter", au: 5.2, phase: 2.4 },
  { name: "saturn", au: 9.58, phase: 5.1 },
  { name: "uranus", au: 19.2, phase: 4.2 },
  { name: "neptune", au: 30.05, phase: 0.2 },
];
const circularBody = (au: number, phase: number): Body => {
  const v = Math.sqrt((4 * Math.PI * Math.PI) / au);
  return { x: au * Math.cos(phase), y: au * Math.sin(phase), vx: -v * Math.sin(phase), vy: v * Math.cos(phase) };
};
export const EARTH_R = 0.42; // exaggerated visual radius
export const SUN_R = SUN_COLLIDE_AU * S;

export const toScene = (b: Body, out = new THREE.Vector3()) => out.set(b.x * S, 0, -b.y * S);

export class Trail {
  max = 9000;
  arr = new Float32Array(this.max * 3);
  n = 0;
  geom = new THREE.BufferGeometry();
  attr = new THREE.BufferAttribute(this.arr, 3);
  constructor() {
    this.attr.setUsage(THREE.DynamicDrawUsage);
    this.geom.setAttribute("position", this.attr);
    this.geom.setDrawRange(0, 0);
  }
  push(v: THREE.Vector3) {
    if (this.n > 0) {
      const i = (this.n - 1) * 3;
      const dx = this.arr[i] - v.x, dz = this.arr[i + 2] - v.z;
      if (dx * dx + dz * dz < 0.0225) return;
    }
    if (this.n >= this.max) {
      this.arr.copyWithin(0, 3);
      this.n = this.max - 1;
    }
    this.arr[this.n * 3] = v.x;
    this.arr[this.n * 3 + 1] = v.y;
    this.arr[this.n * 3 + 2] = v.z;
    this.n++;
    this.attr.needsUpdate = true;
    this.geom.setDrawRange(0, this.n);
  }
  clear() {
    this.n = 0;
    this.geom.setDrawRange(0, 0);
  }
  snapshot() {
    return this.arr.slice(0, this.n * 3);
  }
}

export type SimEvent = { x: number; z: number; kind: "speed" | "gravity-off" | "gravity-on"; t: number };

// Shared pace for every planet: slow on entry/reset, normal after any control change.
export const SLOW_PACE = 0.45;
export const PACE = { v: SLOW_PACE };

export class Sim {
  earth: Body = { x: 1, y: 0, vx: 0, vy: 0 };
  twin: Body = { x: 1, y: 0, vx: 0, vy: 0 };
  gravity = true;
  sunMass = 1;
  planets: Body[] = [];
  planetDead: boolean[] = [];
  twinOn = false;
  twinDv = 0.3;
  race = {
    on: false, done: false, realT: 0, added: 0, lastRecompute: 0,
    ang: { earth: 0, twin: 0 }, sweep: { earth: 0, twin: 0 }, t0: 0,
  };
  running = true;
  timeScale = 0.12; // years per real second
  t = 0;
  collided = { earth: false, twin: false };
  trail = new Trail();
  twinTrail = new Trail();
  prev: Float32Array[] = [];
  events: SimEvent[] = [];
  predict: Float32Array = new Float32Array(0);
  predictTwin: Float32Array = new Float32Array(0);
  predictVersion = 0;
  explosion: { pos: THREE.Vector3; t0: number } | null = null;
  clock = 0;
  changeVersion = 0;

  constructor() {
    this.reset();
  }

  reset() {
    PACE.v = SLOW_PACE;
    this.earth = { x: 1, y: 0, vx: 0, vy: 0 };
    setVelocity(this.earth, EARTH_V_KMS, 0);
    this.gravity = true;
    this.sunMass = 1;
    this.planets = PLANET_ORBITS.map((p) => circularBody(p.au, p.phase));
    this.planetDead = PLANET_ORBITS.map(() => false);
    this.running = true;
    this.twinOn = false;
    this.race.on = false;
    this.race.done = false;
    this.t = 0;
    this.collided = { earth: false, twin: false };
    this.trail.clear();
    this.twinTrail.clear();
    this.prev = [];
    this.events = [];
    this.explosion = null;
    this.recompute();
  }

  snapshotPrev() {
    if (this.trail.n > 3) {
      this.prev.push(this.trail.snapshot());
      if (this.prev.length > 3) this.prev.shift();
    }
    this.trail.clear();
  }

  mark(kind: SimEvent["kind"]) {
    const p = toScene(this.earth);
    this.events.push({ x: p.x, z: p.z, kind, t: this.clock });
    if (this.events.length > 6) this.events.shift();
  }

  applyVelocity(speedKms: number, angleDeg: number) {
    if (this.collided.earth) return;
    this.snapshotPrev();
    this.mark("speed");
    setVelocity(this.earth, speedKms, angleDeg);
    this.changeVersion++;
    this.recompute();
  }

  setGravity(on: boolean) {
    if (on === this.gravity) return;
    this.snapshotPrev();
    this.mark(on ? "gravity-on" : "gravity-off");
    this.gravity = on;
    this.changeVersion++;
    this.recompute();
  }

  /** Change the Sun's mass instantly; every body keeps its current position and velocity. */
  setSunMass(m: number) {
    if (m === this.sunMass) return;
    this.snapshotPrev();
    this.mark("speed");
    this.gravity = true;
    this.sunMass = m;
    this.changeVersion++;
    this.recompute();
  }

  startTwin(dvKms: number) {
    this.twinDv = dvKms;
    this.twinOn = true;
    this.collided.twin = false;
    const r = Math.hypot(this.earth.x, this.earth.y);
    const sp = Math.hypot(this.earth.vx, this.earth.vy);
    const k = (r + 0.0008) / r;
    // The faster planet starts ahead (in the direction of motion) so it leads while it leaves the orbit.
    const dir = Math.sign(this.earth.x * this.earth.vy - this.earth.y * this.earth.vx) || 1;
    const a = TWIN_LEAD_RAD * dir, c = Math.cos(a), s = Math.sin(a);
    const ex = this.earth.x * k, ey = this.earth.y * k;
    this.twin = { x: ex * c - ey * s, y: ex * s + ey * c, vx: this.earth.vx * c - this.earth.vy * s, vy: this.earth.vx * s + this.earth.vy * c };
    const f = (sp + dvKms / 4.740470463) / sp;
    this.twin.vx *= f;
    this.twin.vy *= f;
    this.twinTrail.clear();
    this.trail.clear();
    this.recompute();
  }

  /** Two-planet experiment: gradual divergence, then the race continues from that exact state. */
  startRace(softDv = TWIN_SOFT_DV) {
    this.running = true;
    this.startTwin(softDv);
    this.race = {
      on: true, done: false, realT: 0, added: 0, lastRecompute: 0,
      ang: { earth: Math.atan2(this.earth.y, this.earth.x), twin: Math.atan2(this.twin.y, this.twin.x) },
      sweep: { earth: 0, twin: 0 }, t0: this.t,
    };
  }

  stopTwin() {
    this.race.on = false;
    this.twinOn = false;
    this.twinTrail.clear();
    this.recompute();
  }

  static forecast(b0: Body, gravity: boolean, mass = 1) {
    const b = { ...b0 };
    const o = orbitInfo(b, gravity, mass);
    const pts: number[] = [];
    const h = 0.0015;
    const maxT = gravity && isFinite(o.periodYr) ? Math.min(o.periodYr * 1.002, 12) : 6;
    let t = 0, i = 0;
    while (t < maxT && i < 40000) {
      step(b, h, gravity, mass);
      t += h;
      i++;
      const r = Math.hypot(b.x, b.y);
      if (i % 3 === 0) pts.push(b.x * S, 0, -b.y * S);
      if (gravity && r < SUN_COLLIDE_AU) break;
      if (r > 60) break;
    }
    return new Float32Array(pts);
  }

  recompute() {
    this.predict = this.collided.earth ? new Float32Array(0) : Sim.forecast(this.earth, this.gravity, this.sunMass);
    this.predictTwin = this.twinOn && !this.collided.twin ? Sim.forecast(this.twin, this.gravity, this.sunMass) : new Float32Array(0);
    this.predictVersion++;
  }

  advance(realDt: number) {
    this.clock += realDt;
    if (!this.running) return;
    const dt = realDt * this.timeScale * PACE.v;
    const h = 0.0004;
    const n = Math.min(4000, Math.ceil(dt / h));
    const sub = dt / n;
    const bodies: ["earth" | "twin", Body][] = [["earth", this.earth]];
    if (this.twinOn) bodies.push(["twin", this.twin]);
    for (const [key, b] of bodies) {
      if (this.collided[key]) continue;
      for (let i = 0; i < n; i++) {
        step(b, sub, this.gravity, this.sunMass);
        if (this.gravity && Math.hypot(b.x, b.y) < SUN_COLLIDE_AU) {
          this.collided[key] = true;
          if (key === "earth") this.explosion = { pos: toScene(b), t0: this.clock };
          this.recompute();
          break;
        }
      }
    }
    this.planets.forEach((b, k) => {
      if (this.planetDead[k]) return;
      for (let i = 0; i < n; i++) {
        step(b, sub, this.gravity, this.sunMass);
        const r = Math.hypot(b.x, b.y);
        if ((this.gravity && r < SUN_COLLIDE_AU) || r > 400) { this.planetDead[k] = true; break; }
      }
    });
    this.t += dt;
    const R = this.race;
    if (R.on) {
      R.realT += realDt;
      if (R.realT >= RACE_END_S) { R.done = true; this.running = false; }
      // After RACE_DELAY_S real seconds the twin speeds up gradually and visibly.
      if (R.realT > RACE_DELAY_S && R.added < RACE_MAX_DV && !this.collided.twin) {
        const inc = Math.min(RACE_RATE * realDt, RACE_MAX_DV - R.added);
        const sp = Math.hypot(this.twin.vx, this.twin.vy);
        const f = (sp + inc / 4.740470463) / sp;
        this.twin.vx *= f;
        this.twin.vy *= f;
        R.added += inc;
        if (R.realT - R.lastRecompute > 0.4) { R.lastRecompute = R.realT; this.recompute(); }
      }
      const unwrap = (b: Body, key: "earth" | "twin") => {
        const a = Math.atan2(b.y, b.x);
        let d = a - R.ang[key];
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        R.ang[key] = a;
        R.sweep[key] += d;
      };
      if (!this.collided.earth) unwrap(this.earth, "earth");
      if (!this.collided.twin) unwrap(this.twin, "twin");
    }
  }
}
