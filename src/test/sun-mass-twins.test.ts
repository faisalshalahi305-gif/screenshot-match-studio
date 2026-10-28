import { describe, it, expect } from "vitest";
import { orbitInfo, setVelocity, type Body } from "@/lib/orbit-physics";
import { Sim, RACE_DELAY_S, RACE_END_S, TWIN_SOFT_DV } from "@/components/sim/sim-state";

const earth = (): Body => { const b = { x: 1, y: 0, vx: 0, vy: 0 }; setVelocity(b, 29.8, 0); return b; };

describe("sun mass", () => {
  it("much smaller mass (×0.25) unbinds Earth", () => {
    expect(orbitInfo(earth(), true, 0.25).kind).toBe("hyperbolic");
  });
  it("smaller mass (×0.6) keeps Earth bound but on a longer orbit", () => {
    const o = orbitInfo(earth(), true, 0.6);
    expect(o.kind).toBe("elliptic");
    expect(o.periodYr).toBeGreaterThan(1);
  });
  it("larger mass shortens Earth's period", () => {
    expect(orbitInfo(earth(), true, 1.5).periodYr).toBeLessThan(1);
  });
  it("changing mass affects every planet, not only Earth", () => {
    const s = new Sim();
    const before = s.planets.map((p) => ({ ...p }));
    s.setSunMass(4);
    s.advance(1);
    const ref = new Sim(); ref.advance(1);
    s.planets.forEach((p, i) => expect(Math.hypot(p.x - ref.planets[i]!.x, p.y - ref.planets[i]!.y)).toBeGreaterThan(0));
    expect(before.length).toBe(7);
  });
});

describe("two-planet experiment", () => {
  it("race continues from the divergence state and stops at the end", () => {
    const s = new Sim();
    s.startRace();
    expect(s.race.added).toBe(0);
    for (let i = 0; i < RACE_DELAY_S * 10 - 1; i++) s.advance(0.1);
    const twinBefore = { ...s.twin };
    expect(s.race.added).toBe(0);
    s.advance(0.3);
    // not reset to the start point
    expect(Math.hypot(s.twin.x - twinBefore.x, s.twin.y - twinBefore.y)).toBeLessThan(0.2);
    expect(s.race.added).toBeGreaterThan(0);
    for (let t = 0; t < RACE_END_S; t += 0.1) s.advance(0.1);
    expect(s.race.done).toBe(true);
    expect(s.running).toBe(false);
    expect(TWIN_SOFT_DV).toBe(0.3);
  });
});
