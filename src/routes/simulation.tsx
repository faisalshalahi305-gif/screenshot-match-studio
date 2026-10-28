import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Sim, PACE, RACE_DELAY_S, RACE_MAX_DV, RACE_RATE, SUN_MASS_PRESETS, SUN_MASS_KG } from "@/components/sim/sim-state";
import type { CamMode, Show } from "@/components/sim/SpaceScene";
import { orbitInfo, auyrToKms, escapeSpeedKms, surfaceTempK, EARTH_V_KMS, GM } from "@/lib/orbit-physics";

// Retry the chunk once, then hard-reload once if it still fails (stale chunk after a restart/deploy).
const SpaceScene = lazy(async () => {
  try {
    return await import("@/components/sim/SpaceScene");
  } catch {
    await new Promise((r) => setTimeout(r, 800));
    try {
      return await import("@/components/sim/SpaceScene");
    } catch (e) {
      if (!sessionStorage.getItem("sim-reloaded")) {
        sessionStorage.setItem("sim-reloaded", "1");
        window.location.reload();
        return new Promise<never>(() => {});
      }
      throw e;
    }
  }
});
if (typeof window !== "undefined") window.setTimeout(() => sessionStorage.removeItem("sim-reloaded"), 10_000);

export const Route = createFileRoute("/simulation")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "المحاكي 1: حركة الكواكب والجاذبية" },
      { name: "description", content: "محاكاة علمية ثلاثية الأبعاد لحركة الأرض حول الشمس وتأثير تغيير السرعة والجاذبية." },
      { property: "og:title", content: "المحاكي 1: حركة الكواكب والجاذبية" },
      { property: "og:description", content: "مدارات محسوبة فيزيائياً، إفلات، اصطدام، وإيقاف افتراضي للجاذبية." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SimulationPage,
});

const KIND: Record<string, string> = {
  circular: "مدار مغلق شبه دائري",
  elliptic: "مدار مغلق إهليلجي",
  parabolic: "مسار حدّي (سرعة الإفلات)",
  hyperbolic: "مسار مفتوح — إفلات من الشمس",
  collision: "مسار يتقاطع مع الشمس — اصطدام",
  free: "حركة مستقيمة (بلا جاذبية)",
};

export const FATE_DELAY_MS = 10_000;

const fmt = (n: number, d = 2) => (isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }) : "∞");

function SimulationPage() {
  const [sim] = useState(() => new Sim());
  const [, force] = useState(0);
  const [tick, setTick] = useState(0);
  const onTickCb = useCallback(() => setTick((x) => x + 1), []);
  const [mode, setMode] = useState<CamMode>("top");
  const [flyKey, setFlyKey] = useState(0);
  const [open, setOpen] = useState<"fate" | "cam" | "stats" | "lines" | null>(null);
  const [solo, setSolo] = useState(false);
  const [ellip, setEllip] = useState(0.6);
  const [pending, setPending] = useState<string | null>(null);
  const fateTimer = useRef<number | null>(null);
  const [cinema] = useState(true);
  const [speed, setSpeed] = useState(EARTH_V_KMS);
  const [angle, setAngle] = useState(0);
  const [show, setShow] = useState<Show>({ trails: true, vectors: true, predict: true, prev: true, grid: true });
  const timers = useRef<number[]>([]);

  const fly = useCallback((m: CamMode) => { setMode(m); setFlyKey((k) => k + 1); }, []);
  const cinematic = useCallback(() => {
    if (!cinema) return;
    timers.current.forEach(clearTimeout);
    fly("follow");
    timers.current = [window.setTimeout(() => fly("system"), 4200)];
  }, [cinema, fly]);
  const introTimer = useRef<number | null>(null);
  const stopAutoCam = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (introTimer.current) clearTimeout(introTimer.current);
  }, []);

  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 120);
    const t = window.setTimeout(() => {}, 0);
    introTimer.current = t;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === "Space") { sim.running = !sim.running; e.preventDefault(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { clearInterval(id); clearTimeout(t); window.removeEventListener("keydown", onKey); timers.current.forEach(clearTimeout); if (fateTimer.current) clearTimeout(fateTimer.current); };
  }, [sim, fly]);

  const b = sim.earth;
  const r = Math.hypot(b.x, b.y);
  const v = auyrToKms(Math.hypot(b.vx, b.vy));
  const M = sim.sunMass;
  const info = orbitInfo(b, sim.gravity, M);
  const vesc = escapeSpeedKms(r, M);
  const vcirc = auyrToKms(Math.sqrt((GM * M) / r));
  const tempC = surfaceTempK(r) - 273;
  const gAcc = sim.gravity ? ((GM * M) / (r * r)) * 1.496e11 / (3.156e7 ** 2) * 1000 : 0; // mm/s²
  const twinSep = sim.twinOn ? Math.hypot(sim.twin.x - b.x, sim.twin.y - b.y) * 149.6 : 0;
  const status = sim.collided.earth ? KIND["collision"] : KIND[info.kind];

  const applySpeed = (s: number, a = angle) => {
    const sv = Math.max(0, Math.min(80, s));
    setSpeed(sv);
    PACE.v = 1;
    sim.applyVelocity(sv, a);
    cinematic();
  };
  const reset = () => {
    sim.reset();
    setSpeed(EARTH_V_KMS); setAngle(0);
    timers.current.forEach(clearTimeout);
    fly("follow");
    timers.current = [window.setTimeout(() => fly("system"), 2200)];
  };
  // Hidden 10-second suspense timer: the orbit continues calmly, then the event fires suddenly.
  const schedule = (key: string, action: () => void) => {
    if (fateTimer.current) clearTimeout(fateTimer.current);
    setPending(key);
    fateTimer.current = window.setTimeout(() => {
      fateTimer.current = null;
      setPending(null);
      sim.running = true;
      action();
      force((x) => x + 1);
    }, FATE_DELAY_MS);
  };
  // States never move the camera; only the user's own camera choice does.
  const setV = (s: number) => { const sv = Math.max(0, Math.min(80, s)); setSpeed(sv); setAngle(0); PACE.v = 1; sim.applyVelocity(sv, 0); };
  const fates: Record<string, () => void> = {
    stable: () => { sim.stopTwin(); sim.setGravity(true); setV(EARTH_V_KMS); },
    sun: () => { sim.setGravity(true); setV(6); },
    escape: () => { sim.setGravity(true); setV(46); },
    ...Object.fromEntries(SUN_MASS_PRESETS.map((p) => [`mass_${p.key}`, () => { sim.setSunMass(p.m); }])),
    ellipse: () => { sim.setGravity(true); setV(EARTH_V_KMS + ellip * 10); },
    twins: () => { sim.setGravity(true); sim.stopTwin(); sim.startRace(); },
  };
  const pick = (k: string) => { PACE.v = 1; const f = fates[k]; if (f) schedule(k, f); };
  const quickReset = () => { if (fateTimer.current) clearTimeout(fateTimer.current); fateTimer.current = null; setPending(null); reset(); };

  const hideOrbits = show.rings === false;
  const toggle = (k: keyof Show) => setShow((s) => ({ ...s, [k]: !s[k] }));

  return (
    <div dir="rtl" className="fixed inset-0 overflow-hidden bg-background text-foreground select-none">
      <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">جارٍ تحميل المشهد الفضائي…</div>}>
        <SpaceScene sim={sim} show={show} mode={mode} flyKey={flyKey} tick={tick} onTick={onTickCb} onUser={stopAutoCam} hidePlanets={solo} />
      <button onClick={() => setSolo((s) => !s)} aria-label="إخفاء الكواكب" title="إخفاء الكواكب" className={`absolute left-2 top-2 z-30 h-7 w-7 rounded-full text-xs transition ${solo ? "bg-primary/30 opacity-90" : "opacity-15 hover:opacity-60"}`}>◐</button>
      </Suspense>

      {/* Left tool buttons */}
      <div className="absolute left-3 bottom-4 z-20 flex flex-col gap-1.5">
        {([["fate", "تحكم", "لوحة التحكم"], ["cam", "كاميرا", "الكاميرا"], ["stats", "بيانات", "البيانات"], ["lines", "مسارات", "المسارات"]] as [typeof open, string, string][]).map(([k, ic, l]) => (
          <button key={k} onClick={() => setOpen((o) => (o === k ? null : k))} aria-label={l} title={l}
            className={`grid h-7 min-w-14 place-items-center rounded-full px-2 text-[10px] border border-border/40 text-sm backdrop-blur-md transition ${open === k ? "bg-primary text-primary-foreground" : "bg-background/50 hover:bg-foreground/10"}`}>{ic}</button>
        ))}
      </div>

      {open && (
        <div className="absolute left-14 bottom-4 z-20 max-w-[80vw] rounded-lg border border-border/40 bg-background/50 p-2 text-[11px] backdrop-blur-md" dir="rtl">
          {open === "fate" && (
            <div className="w-[min(300px,78vw)] space-y-1">
              <div className="grid grid-cols-2 gap-1">
                <Fate on={pending === "sun"} onClick={() => pick("sun")}>مسار الاصطدام</Fate>
                <Fate on={pending === "escape"} onClick={() => pick("escape")}>مسار الإفلات</Fate>
                <div className="col-span-2 grid"><Fate on={pending === "stable"} onClick={() => pick("stable")}>المدار المستقر</Fate></div>
              </div>
              <div className="rounded-md border border-border/40 p-1">
                <div className="mb-1 flex justify-between text-[10px] text-muted-foreground"><span>كتلة الشمس</span><span dir="ltr" className="font-mono">×{fmt(M, 2)} = {(SUN_MASS_KG * M).toExponential(2)} kg</span></div>
                <div className="grid grid-cols-2 gap-1">
                  {SUN_MASS_PRESETS.map((p) => (
                    <Fate key={p.key} on={pending === `mass_${p.key}` || (!pending && M === p.m)} onClick={() => pick(`mass_${p.key}`)}>
                      {p.label}<span dir="ltr" className="block font-mono text-[9px] text-muted-foreground">×{p.m} · {(SUN_MASS_KG * p.m).toExponential(2)} kg</span>
                    </Fate>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-border/40 p-1">
                <Fate on={pending === "ellipse"} onClick={() => pick("ellipse")}>مدار بيضاوي</Fate>
                <input type="range" min={0.1} max={1.2} step={0.05} value={ellip} onChange={(e) => setEllip(parseFloat(e.target.value))} className="mt-1 w-full accent-primary" aria-label="شدة التمدد" />
                <div className="flex justify-between text-[9px] text-muted-foreground"><span>شدة التمدد</span><span dir="ltr" className="font-mono">{fmt(EARTH_V_KMS + ellip * 10, 1)} km/s</span></div>
              </div>
              <div className="rounded-md border border-border/40 p-1">
                <Fate on={pending === "twins"} onClick={() => pick("twins")}>تجربة كوكبين</Fate>
              </div>
              <Fate on={hideOrbits} onClick={() => setShow((s) => { const h = !hideOrbits; return { ...s, trails: !h, predict: !h, prev: !h, grid: !h, rings: !h }; })}>{hideOrbits ? "إظهار المدارات" : "إخفاء المدارات"}</Fate>
              <div className="grid grid-cols-3 gap-1 pt-1">
                <Fate onClick={quickReset}>إعادة ضبط</Fate>
                <Fate onClick={() => { sim.running = !sim.running; force((x) => x + 1); }}>{sim.running ? "إيقاف" : "تشغيل"}</Fate>
                <Link to="/" className="rounded-md bg-foreground/10 px-1 py-1 text-center text-[10px] hover:bg-foreground/20">العودة للدرس</Link>
              </div>
            </div>
          )}
          {open === "cam" && (
            <div className="flex flex-col gap-0.5">
              {([["top", "المجموعة الشمسية (علوي)"], ["grand", "المجموعة الشمسية (مائل)"], ["horizon", "أفق الأرض"], ["helio", "من فوق الشمس"], ["follow", "قرب الأرض"], ["chase", "تتبع خلفي"], ["system", "المدار كاملاً"], ["inner", "الكواكب الداخلية"], ["wide", "كل الكواكب"], ["sun", "الشمس"]] as [CamMode, string][]).map(([m, l]) => (
                <button key={m} onClick={() => fly(m)} className={`rounded-full px-3 py-1 text-[11px] transition ${mode === m ? "bg-primary text-primary-foreground" : "hover:bg-foreground/10"}`}>{l}</button>
              ))}
            </div>
          )}
          {open === "stats" && (
            <div className="w-[min(420px,78vw)] space-y-1">
              <div className={`text-center text-[11px] font-semibold ${info.kind === "hyperbolic" || sim.collided.earth ? "text-destructive" : "text-primary"}`}>{status}</div>
              <div className="grid grid-cols-3 gap-1">
                <Stat k="سرعة الأرض" v={`${fmt(v)} كم/ث`} />
                <Stat k="البعد عن الشمس" v={`${fmt(r * 149.6, 1)} م.كم`} />
                <Stat k="تسارع الجاذبية" v={`${fmt(gAcc / 1000, 5)} م/ث²`} />
              </div>
              <div className="grid grid-cols-4 gap-1">
                <Stat k="سرعة الإفلات" v={`${fmt(vesc, 1)} كم/ث`} />
                <Stat k="زمن الدورة" v={sim.gravity && !sim.collided.earth && isFinite(info.periodYr) ? `${fmt(info.periodYr * 365.25, 1)} يوم` : "—"} />
                <Stat k="الحرارة" v={`${fmt(tempC, 0)}°م`} />
                <Stat k="الزمن المنقضي" v={`${fmt(sim.t * 365.25, 0)} يوم`} />
              </div>
            </div>
          )}
          {open === "lines" && (
            <div className="space-y-1 text-[11px]">
              <Explain c="#ff6b5a" t="قوة الجاذبية F" />
              <Explain c="#7dffb0" t="السرعة v" />
              <Explain c="#6fb6ff" t="المسار الحالي" />
              <Explain c="#ffffff" t="المسار المتوقع" />
              <Explain c="#c9a46a" t="المدار السابق" />
              {sim.twinOn && <Explain c="#ffb347" t="الكوكب الأسرع" />}
            </div>
          )}
        </div>
      )}

      {sim.race.on && sim.twinOn && (() => {
        const R = sim.race;
        const days = (sim.t - R.t0) * 365.25;
        const row = (name: string, body: typeof sim.earth, key: "earth" | "twin", dead: boolean) => {
          const o = orbitInfo(body, sim.gravity, M);
          return (
            <div className="rounded-lg border border-border/50 bg-background/70 px-2 py-1 backdrop-blur">
              <div className="text-center text-[11px] font-semibold">{name}</div>
              <div className="grid grid-cols-3 gap-1">
                <Stat k="السرعة" v={dead ? "—" : `${fmt(auyrToKms(Math.hypot(body.vx, body.vy)))} كم/ث`} />
                <Stat k="زمن الدورة" v={!dead && isFinite(o.periodYr) ? `${fmt(o.periodYr * 365.25, 0)} يوم` : "—"} />
                <Stat k="الدورات المكتملة" v={fmt(Math.abs(R.sweep[key]) / (2 * Math.PI), 2)} />
              </div>
            </div>
          );
        };
        const left = Math.max(0, RACE_DELAY_S - R.realT);
        const accelEnd = RACE_DELAY_S + RACE_MAX_DV / RACE_RATE;
        return (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-20 mx-auto flex w-[min(560px,96vw)] flex-col gap-1">
            <div className="text-center text-[11px] font-semibold text-primary">
              {R.done ? "انتهت التجربة — النتائج النهائية" : left > 0 ? `افتراق تدريجي — تبدأ المقارنة بعد ${Math.ceil(left)} ث` : R.realT < accelEnd ? "الكوكب الأسرع يتسارع ويتغير مداره وزمن دورته" : "مقارنة المدارين عند اختلاف السرعة"} · الزمن المنقضي {fmt(days, 0)} يوم
            </div>
            <div className="grid grid-cols-2 gap-1">
              {row("كوكب الأرض", sim.earth, "earth", sim.collided.earth)}
              {row("الكوكب الأسرع", sim.twin, "twin", sim.collided.twin)}
            </div>
          </div>
        );
      })()}

    </div>
  );
}

function Fate({ children, on, onClick }: { children: React.ReactNode; on?: boolean; onClick: () => void }) {
  return (<button onClick={onClick} className={`w-full rounded-md px-1 py-1 text-[10px] transition active:scale-[.98] ${on ? "bg-primary/25" : "bg-foreground/10 hover:bg-foreground/20"}`}>{children}</button>);
}
function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 px-1 py-0.5 text-center">
      <div className="text-[9px] text-muted-foreground">{k}</div>
      <div className="font-mono text-[11px] font-semibold" dir="ltr">{v}</div>
    </div>
  );
}
function Explain({ c, t }: { c: string; t: string }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="inline-block h-[3px] w-4 shrink-0 rounded" style={{ background: c }} />
      <span>{t}</span>
    </div>
  );
}
