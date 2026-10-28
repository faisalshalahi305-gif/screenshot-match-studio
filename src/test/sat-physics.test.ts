import { describe, it, expect } from "vitest";
import { orbitalSpeed, escapeSpeed, presetSpeed, launch, step, classify, perigee, R_EARTH, deflectionArcsec } from "@/lib/sat-physics";

const run = (h: number, v: number, m: number, secs: number) => {
  const b = launch(h, v);
  for (let t = 0; t < secs; t += 2) { step(b, 2, m); if (Math.hypot(b.x, b.y) <= R_EARTH) return "crash"; }
  return classify(b, m);
};

describe("satellite physics", () => {
  it("orbital speed depends on altitude", () => {
    expect(orbitalSpeed(400, 1)).toBeCloseTo(7.67, 1);
    expect(orbitalSpeed(2000, 1)).toBeLessThan(orbitalSpeed(300, 1));
  });
  it("escape speed is sqrt(2) × orbital", () => {
    expect(escapeSpeed(500, 1) / orbitalSpeed(500, 1)).toBeCloseTo(Math.SQRT2, 6);
  });
  it("three presets give crash / orbit / escape", () => {
    for (const m of [0.3, 1, 3]) {
      expect(run(500, presetSpeed("crash", 500, m), m, 20000)).toBe("crash");
      expect(run(500, presetSpeed("orbit", 500, m), m, 20000)).toBe("orbit");
      expect(run(500, presetSpeed("escape", 500, m), m, 20000)).toBe("escape");
    }
  });
  it("circular orbit keeps its altitude", () => {
    const b = launch(500, orbitalSpeed(500, 1));
    for (let i = 0; i < 3000; i++) step(b, 2, 1);
    expect(Math.hypot(b.x, b.y) - R_EARTH).toBeCloseTo(500, -1);
  });
  it("raising Earth mass makes a stable orbit fall", () => {
    const b = launch(500, orbitalSpeed(500, 1));
    expect(perigee(b, 2.5)).toBeLessThan(R_EARTH);
  });
  it("light deflection is 1.75 arcsec per solar mass", () => {
    expect(deflectionArcsec(1)).toBe(1.75);
    expect(deflectionArcsec(2)).toBe(3.5);
  });
});
