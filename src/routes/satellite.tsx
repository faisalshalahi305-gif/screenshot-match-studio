import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { S2 } from "@/components/sat/sat2-state";
import { R_EARTH, orbitalSpeed, escapeSpeed, gravityAt, presetSpeed, launch, perigee, deflectionArcsec, type Preset } from "@/lib/sat-physics";

const Sat2Scene = lazy(() => import("@/components/sat/Sat2Scene"));

export const Route = createFileRoute("/satellite")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "المحاكي 2: القمر الصناعي وانحناء الضوء" },
      { name: "description", content: "محاكاة ثلاثية الأبعاد لمدفع نيوتن والسرعة المدارية وسرعة الإفلات، وانحناء الضوء قرب الشمس وكسوف 1919." },
      { property: "og:title", content: "المحاكي 2: القمر الصناعي وانحناء الضوء" },
      { property: "og:description", content: "سقوط، مدار مستقر، إفلات، كتلة الأرض، ومسار الضوء حول الشمس." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SatellitePage,
});

const fmt = (n: number, d = 2) => (isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }) : "∞");

function SatellitePage() {
  const [, force] = useState(0);
  const [version, setVersion] = useState(0);
  const rerender = () => force((x) => x + 1);
  const bump2 = () => { setVersion((v) => v + 1); rerender(); };
  useEffect(() => { const id = window.setInterval(rerender, 120); return () => clearInterval(id); }, []);

  const s = S2;
  const reset = () => { s.body = null; s.fate = "ready"; s.running = false; s.stopped = false; s.t = 0; s.runKey++; s.crashT = -99; rerender(); };
  const fire = () => { reset(); s.body = launch(s.h, s.v); s.fate = "orbit"; s.running = true; rerender(); };
  const preset = (p: Preset) => { s.v = presetSpeed(p, s.h, s.massX); fire(); };
  const playPause = () => { if (!s.body) fire(); else { s.running = !s.running; rerender(); } };
  const switchTo = (n: 1 | 2) => { s.section = n; s.follow = false; s.camKey++; bump2(); };
  const cam2 = (c: "space" | "scope") => { s.cam2 = c; s.camKey++; rerender(); };

  // telemetry
  const b = s.body;
  const r = b ? Math.hypot(b.x, b.y) : R_EARTH + s.h;
  const vNow = b ? Math.hypot(b.vx, b.vy) : s.v;
  const vo = orbitalSpeed(s.h, s.massX), ve = escapeSpeed(s.h, s.massX);
  let status: { t: string; c: string } = { t: "جاهز للإطلاق", c: "bg-foreground/15 text-foreground" };
  if (b) {
    if (s.fate === "crash") status = { t: "💥 حدث اصطدام — السرعة غير كافية", c: "bg-destructive/80 text-destructive-foreground" };
    else if (s.fate === "escape") status = { t: "🚀 إفلات من جاذبية الأرض", c: "bg-sky-500/80 text-background" };
    else if (perigee(b, s.massX) <= R_EARTH) status = { t: "⬇ سقوط نحو الأرض", c: "bg-orange-500/80 text-background" };
    else status = { t: Math.abs(vNow - Math.sqrt(398600.4418 * s.massX / r)) < 0.05 ? "🛰️ مدار دائري مستقر" : "🛰️ مدار مغلق إهليلجي", c: "bg-emerald-500/80 text-background" };
  }

  return (
    <div dir="rtl" className="relative h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0">
        <Suspense fallback={<div className="grid h-full place-items-center text-muted-foreground">جارٍ تحميل المشهد…</div>}>
          <Sat2Scene version={version} />
        </Suspense>
      </div>

      {/* top-left discreet section switch */}
      <div dir="rtl" className="absolute left-2 top-2 z-20 flex overflow-hidden rounded-full border border-border/40 bg-background/40 text-[11px] opacity-60 backdrop-blur transition hover:opacity-100">
        <button onClick={() => switchTo(1)} className={`px-3 py-1 ${s.section === 1 ? "bg-primary/30 text-primary" : ""}`}>🛰️ المدارات</button>
        <button onClick={() => switchTo(2)} className={`px-3 py-1 ${s.section === 2 ? "bg-primary/30 text-primary" : ""}`}>🌌 انحناء الضوء</button>
      </div>

      {/* top-right back + telemetry */}
      <div className="absolute right-2 top-2 z-20 flex w-[min(230px,48vw)] flex-col gap-1">
        <Link to="/" className="self-start rounded-full border border-border/40 bg-background/50 px-3 py-1 text-[11px] backdrop-blur hover:bg-foreground/10">🔙 العودة للدرس</Link>
        <div className="rounded-xl border border-border/40 bg-background/50 p-2 backdrop-blur">
          {s.section === 1 ? (
            <div className="space-y-1">
              <Row k="السرعة" v={`${fmt(vNow)} km/s`} />
              <Row k="الارتفاع" v={`${fmt(Math.max(0, r - R_EARTH), 0)} km`} />
              <Row k="تسارع الجاذبية" v={`${fmt(gravityAt(r, s.massX))} m/s²`} />
              <Row k="كتلة الأرض" v={`×${fmt(s.massX, 1)}`} />
              <div className="grid grid-cols-2 gap-1 pt-1">
                <Row k="السرعة المدارية" v={`${fmt(vo)} km/s`} small />
                <Row k="سرعة الإفلات" v={`${fmt(ve)} km/s`} small />
              </div>
              <div className={`rounded-full px-2 py-0.5 text-center text-[10px] font-semibold ${status.c}`}>{status.t}</div>
            </div>
          ) : (
            <div className="space-y-1">
              <Row k="زاوية الانحراف الحقيقية" v={`${fmt(deflectionArcsec(s.sunMass))}″`} />
              <Row k="كتلة الشمس" v={`×${fmt(s.sunMass, 1)}`} />
              <div className="rounded-full bg-primary/25 px-2 py-0.5 text-center text-[10px] font-semibold text-primary">{s.lightModel === "einstein" ? "النسبية العامة (أينشتاين)" : "خط مستقيم (نيوتن)"}</div>
              <p className="text-[9px] leading-tight text-muted-foreground">الانحناء في المشهد مكبّر بصرياً للتوضيح؛ الانحراف الحقيقي صغير جداً (ثوانٍ قوسية). تغيير كتلة الشمس تجربة افتراضية.</p>
            </div>
          )}
        </div>
      </div>

      {/* bottom HUD */}
      <div className="absolute inset-x-0 bottom-2 z-20 mx-auto w-[min(720px,97vw)] rounded-2xl border border-border/40 bg-background/55 p-2 backdrop-blur-md">
        {s.section === 1 ? (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-1">
              <Btn tone="red" onClick={() => preset("crash")}>💥 سقوط واصطدام</Btn>
              <Btn tone="green" onClick={() => preset("orbit")}>🔄 مدار مستقر</Btn>
              <Btn tone="blue" onClick={() => preset("escape")}>🚀 سرعة الإفلات</Btn>
            </div>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
              <Slider label="كتلة الأرض" value={s.massX} min={0.2} max={3} step={0.1} show={`×${fmt(s.massX, 1)}`} onChange={(x) => { s.massX = x; rerender(); }} />
              <Slider label="ارتفاع الإطلاق" value={s.h} min={300} max={2000} step={50} show={`${s.h} km`} onChange={(x) => { s.h = x; if (!s.body) rerender(); else reset(); }} />
              <Slider label="سرعة الإطلاق" value={s.v} min={1} max={15} step={0.05} show={`${fmt(s.v)} km/s`} onChange={(x) => { s.v = x; rerender(); }} />
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1">
              <Pill on={false} onClick={playPause}>{!s.body ? "▶ إطلاق" : s.running ? "⏸ إيقاف" : "▶ تشغيل"}</Pill>
              <Pill on={false} onClick={reset}>↺ إعادة</Pill>
              {[1, 2, 5].map((k) => <Pill key={k} on={s.timeScale === k} onClick={() => { s.timeScale = k; rerender(); }}>{k}×</Pill>)}
              <Pill on={s.showVec} onClick={() => { s.showVec = !s.showVec; rerender(); }}>👁️ المتجهات</Pill>
              <Pill on={s.showTrail} onClick={() => { s.showTrail = !s.showTrail; rerender(); }}>〰️ المسار</Pill>
              <Pill on={s.follow} onClick={() => { s.follow = !s.follow; if (!s.follow) s.camKey++; rerender(); }}>🎥 تتبع القمر</Pill>
            </div>
            {s.showVec && <div className="flex justify-center gap-3 text-[10px] text-muted-foreground"><span><b className="text-emerald-400">━</b> السرعة</span><span><b className="text-red-500">━</b> الجاذبية</span><span><b className="text-cyan-300">━</b> المسار</span></div>}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1">
              <Btn tone={s.lightModel === "newton" ? "gold" : "plain"} onClick={() => { s.lightModel = "newton"; bump2(); }}>📏 نموذج نيوتن (خط مستقيم)</Btn>
              <Btn tone={s.lightModel === "einstein" ? "blue" : "plain"} onClick={() => { s.lightModel = "einstein"; bump2(); }}>🌀 نموذج أينشتاين (انحناء)</Btn>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1">
              <Pill on={s.showPos} onClick={() => { s.showPos = !s.showPos; bump2(); }}>⭐ الموقع الحقيقي والظاهري</Pill>
              <Pill on={s.showGrid} onClick={() => { s.showGrid = !s.showGrid; bump2(); }}>🕸️ شبكة الزمكان</Pill>
              <Pill on={s.showLines} onClick={() => { s.showLines = !s.showLines; bump2(); }}>〰️ خطوط الضوء</Pill>
            </div>
            <Slider label="☀️ كتلة الشمس" value={s.sunMass} min={0.5} max={3} step={0.1} show={`×${fmt(s.sunMass, 1)}`} onChange={(x) => { s.sunMass = x; bump2(); }} />
            <Btn tone={s.eclipse ? "gold" : "plain"} onClick={() => { s.eclipse = !s.eclipse; s.cam2 = s.eclipse ? "scope" : "space"; s.camKey++; bump2(); }}>🌑 {s.eclipse ? "إنهاء الكسوف" : "محاكاة كسوف 1919 (إدينغتون)"}</Btn>
            <div className="flex justify-center gap-1">
              <Pill on={s.cam2 === "space"} onClick={() => cam2("space")}>🛰️ منظور الفضاء الشامل</Pill>
              <Pill on={s.cam2 === "scope"} onClick={() => cam2("scope")}>🔭 منظور تلسكوب الأرض</Pill>
            </div>
            {s.eclipse && <div className="flex justify-center gap-3 text-[10px] text-muted-foreground"><span>◌ الموقع الحقيقي للنجم</span><span className="text-yellow-300">◯ الموقع المرصود أثناء الكسوف</span></div>}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, small }: { k: string; v: string; small?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`${small ? "text-[9px]" : "text-[10px]"} text-muted-foreground`}>{k}</span>
      <span dir="ltr" className={`font-mono ${small ? "text-[10px]" : "text-[12px]"} font-semibold`}>{v}</span>
    </div>
  );
}
const TONES: Record<string, string> = {
  red: "bg-destructive/35 hover:bg-destructive/50",
  green: "bg-emerald-500/30 hover:bg-emerald-500/45",
  blue: "bg-sky-500/30 hover:bg-sky-500/45",
  gold: "bg-amber-500/35 hover:bg-amber-500/50",
  plain: "bg-foreground/10 hover:bg-foreground/20",
};
function Btn({ children, onClick, tone }: { children: React.ReactNode; onClick: () => void; tone: string }) {
  return <button onClick={onClick} className={`w-full rounded-xl px-2 py-2 text-[11px] font-semibold transition active:scale-[.98] ${TONES[tone]}`}>{children}</button>;
}
function Pill({ children, onClick, on }: { children: React.ReactNode; onClick: () => void; on: boolean }) {
  return <button onClick={onClick} className={`rounded-full px-3 py-1 text-[11px] transition ${on ? "bg-primary text-primary-foreground" : "bg-foreground/10 hover:bg-foreground/20"}`}>{children}</button>;
}
function Slider({ label, value, min, max, step, show, onChange }: { label: string; value: number; min: number; max: number; step: number; show: string; onChange: (v: number) => void }) {
  return (
    <label className="block rounded-lg border border-border/30 px-2 py-1">
      <div className="flex justify-between text-[10px]"><span className="text-muted-foreground">{label}</span><span dir="ltr" className="font-mono">{show}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full accent-primary" aria-label={label} />
    </label>
  );
}
