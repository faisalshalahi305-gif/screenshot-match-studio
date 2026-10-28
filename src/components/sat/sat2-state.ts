import type { Body, Fate } from "@/lib/sat-physics";

export const KM = 1 / 1000; // scene units per km
export const BASE_RATE = 240; // simulated seconds per real second at 1×
export const ESCAPE_STOP_KM = 90000;
export const LIGHT_O = { x: 400 }; // light-bending scene sits far from Earth scene

export const S2 = {
  section: 1 as 1 | 2,
  camKey: 0,
  // section 1
  h: 500,
  v: 7.6,
  massX: 1,
  body: null as Body | null,
  fate: "ready" as Fate,
  running: false,
  stopped: false,
  t: 0,
  crashT: -99,
  runKey: 0,
  timeScale: 1,
  showVec: true,
  showTrail: true,
  follow: false,
  cam1: "front" as "front" | "far" | "tilt" | "edge" | "tower" | "earth",
  // section 2
  lightModel: "einstein" as "newton" | "einstein",
  showPos: false,
  showGrid: true,
  showLines: true,
  sunMass: 1,
  eclipse: false,
  eclipseT: 0,
  cam2: "space" as "space" | "scope" | "sun" | "side" | "star",
};

/**
 * Light-path geometry (scene units, x along star→Earth, z sideways).
 * The bend is visually exaggerated; the real value is shown as a number.
 */
export function lightGeometry(m: number) {
  const starZ = 0.8;
  const zMid = 1.9 + 1.6 * m; // closest pass height above the Sun's centre
  const blocked = zMid < 3.05;
  const z1 = (zMid - starZ * 0.125) / 0.75;
  const P0: [number, number] = [-45, starZ], C1: [number, number] = [-3, z1], C2: [number, number] = [3, z1], P2: [number, number] = [45, 0];
  const curve: [number, number, number][] = [];
  for (let i = 0; i <= 80; i++) {
    const t = i / 80, u = 1 - t;
    const x = u ** 3 * P0[0] + 3 * u * u * t * C1[0] + 3 * u * t * t * C2[0] + t ** 3 * P2[0];
    const z = u ** 3 * P0[1] + 3 * u * u * t * C1[1] + 3 * u * t * t * C2[1] + t ** 3 * P2[1];
    curve.push([x, 0, z]);
  }
  const appZ = (z1 * 90) / (P2[0] - C2[0]);
  // straight path stops where it meets the Sun's disc
  const newton: [number, number, number][] = [[-45, 0, starZ], [-3, 0, starZ * (3 / 90 + 0.5) ]];
  return { starZ, curve, blocked, appZ, newton };
}
