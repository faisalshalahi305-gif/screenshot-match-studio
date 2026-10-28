// Pure physics for simulator 2 (Newton's cannon + light bending). Units: km, s.
export const GM_EARTH = 398600.4418; // km^3/s^2
export const R_EARTH = 6371; // km
export const G0 = 9.80665; // m/s^2
export const SUN_DEFLECTION_ARCSEC = 1.75; // grazing-ray deflection for 1 solar mass

export type Fate = "ready" | "flying" | "orbit" | "crash" | "escape";

export const orbitalSpeed = (hKm: number, massX: number) => Math.sqrt((GM_EARTH * massX) / (R_EARTH + hKm));
export const escapeSpeed = (hKm: number, massX: number) => Math.SQRT2 * orbitalSpeed(hKm, massX);
export const gravityAt = (rKm: number, massX: number) => ((GM_EARTH * massX) / (rKm * rKm)) * 1000; // m/s^2

export const PRESET_FACTOR = { crash: 0.6, orbit: 1, escape: 1.08 } as const;
export type Preset = keyof typeof PRESET_FACTOR;
export const presetSpeed = (p: Preset, hKm: number, massX: number) =>
  p === "escape" ? escapeSpeed(hKm, massX) * PRESET_FACTOR.escape : orbitalSpeed(hKm, massX) * PRESET_FACTOR[p];

export type Body = { x: number; y: number; vx: number; vy: number };

/** Launch horizontally from the top of the Earth (on +y) at altitude h. */
export const launch = (hKm: number, vKms: number): Body => ({ x: 0, y: R_EARTH + hKm, vx: vKms, vy: 0 });

const acc = (x: number, y: number, massX: number): [number, number] => {
  const r2 = x * x + y * y, r = Math.sqrt(r2), k = (-GM_EARTH * massX) / (r2 * r);
  return [k * x, k * y];
};

/** One velocity-Verlet step (symplectic: closed orbits stay closed). */
export function step(b: Body, dt: number, massX: number) {
  const [ax, ay] = acc(b.x, b.y, massX);
  b.vx += 0.5 * dt * ax; b.vy += 0.5 * dt * ay;
  b.x += dt * b.vx; b.y += dt * b.vy;
  const [bx, by] = acc(b.x, b.y, massX);
  b.vx += 0.5 * dt * bx; b.vy += 0.5 * dt * by;
}

export const specificEnergy = (b: Body, massX: number) => 0.5 * (b.vx ** 2 + b.vy ** 2) - (GM_EARTH * massX) / Math.hypot(b.x, b.y);

/** Classify the current state: crash on surface contact, escape when energy >= 0, else bound orbit. */
export function classify(b: Body, massX: number): Fate {
  if (Math.hypot(b.x, b.y) <= R_EARTH) return "crash";
  return specificEnergy(b, massX) >= 0 ? "escape" : "orbit";
}

/** Predict whether a bound orbit dips into the Earth (perigee below surface). */
export function perigee(b: Body, massX: number) {
  const mu = GM_EARTH * massX, r = Math.hypot(b.x, b.y), E = specificEnergy(b, massX);
  const h = b.x * b.vy - b.y * b.vx;
  const a = -mu / (2 * E), e = Math.sqrt(Math.max(0, 1 + (2 * E * h * h) / (mu * mu)));
  return E < 0 ? a * (1 - e) : (h * h) / (mu * (1 + e)) || r;
}

/** Real light deflection (arcsec) for a ray grazing at impact b (in solar radii). */
export const deflectionArcsec = (massX: number, bSolarRadii = 1) => (SUN_DEFLECTION_ARCSEC * massX) / bSolarRadii;
