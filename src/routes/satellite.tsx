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
  const cam2 = (c: typeof S2.cam2) => { s.cam2 = c; s.freeCam = false; s.camKey++; rerender(); };

  // telemetry
  const b = s.body;
  const r = b ? Math.hypot(b.x, b.y) : R_EARTH + s.h;
  const vNow = b ? Math.hypot(b.vx, b.vy) : s.v;
  const vo = orbitalSpeed(s.h, s.massX), ve = escapeSpeed(s.h, s.massX);
  let status = { t: "جاهز للإطلاق", c: "" };
  if (b) {
    if (s.fate === "crash") status = { t: "💥 حدث اصطدام — السرعة غير كافية" , c: "" };
    else if (s.fate === "escape") status = { t: "🚀 إفلات من جاذبية الأرض" , c: "" };
    else if (perigee(b, s.massX) <= R_EARTH) status = { t: "⬇ سقوط نحو الأرض" , c: "" };
    else status = { t: Math.abs(vNow - Math.sqrt(398600.4418 * s.massX / r)) < 0.05 ? "🛰️ مدار دائري مستقر" : "🛰️ مدار مغلق إهليلجي" , c: "" };
  }

  const [open, setOpen] = useState<"fate" | "cam" | "stats" | "lines" | null>(null);
  const [last, setLast] = useState<Preset | null>(null);
  const cam1 = (c: typeof s.cam1) => { s.cam1 = c; s.follow = false; s.freeCam = false; s.camKey++; rerender(); };
  const pickPreset = (p: Preset) => { setLast(p); preset(p); };

  return (
    <div dir="rtl" className="fixed inset-0 overflow-hidden bg-background text-foreground select-none">
      <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">جارٍ تحميل المشهد…</div>}>
        <Sat2Scene version={version} />
      </Suspense>

      {/* top-left discreet section switch */}
      <button onClick={() => switchTo(s.section === 1 ? 2 : 1)} aria-label="تبديل القسم" title={s.section === 1 ? "انحناء الضوء" : "المدارات"}
        className="absolute left-2 top-2 z-30 h-7 rounded-full px-2 text-[10px] opacity-15 transition hover:opacity-70">
        {s.section === 1 ? "🌌" : "🛰️"}
      </button>

      {/* Left tool buttons */}
      <div className="absolute left-3 bottom-4 z-20 flex flex-col gap-1.5">
        {([["fate", "تحكم", "لوحة التحكم"], ["cam", "كاميرا", "الكاميرا"], ["stats", "بيانات", "البيانات"], ["lines", "مسارات", "المسارات"]] as [typeof open, string, string][]).map(([k, ic, l]) => (
          <button key={k} onClick={() => setOpen((o) => (o === k ? null : k))} aria-label={l} title={l}
            className={`grid h-7 min-w-14 place-items-center rounded-full px-2 text-[10px] border border-border/40 text-sm backdrop-blur-md transition ${open === k ? "bg-primary text-primary-foreground" : "bg-background/50 hover:bg-foreground/10"}`}>{ic}</button>
        ))}
      </div>

      {open && (
        <div className="absolute left-14 bottom-4 z-20 max-h-[80vh] max-w-[80vw] overflow-y-auto rounded-lg border border-border/40 bg-background/50 p-2 text-[11px] backdrop-blur-md" dir="rtl">
          {open === "fate" && s.section === 1 && (
            <div className="w-[min(300px,78vw)] space-y-1">
              <div className="grid grid-cols-2 gap-1">
                <Fate on={last === "crash"} onClick={() => pickPreset("crash")}>سقوط واصطدام</Fate>
                <Fate on={last === "escape"} onClick={() => pickPreset("escape")}>سرعة الإفلات</Fate>
                <div className="col-span-2 grid"><Fate on={last === "orbit"} onClick={() => pickPreset("orbit")}>المدار المستقر</Fate></div>
              </div>
              <Group title="كتلة الأرض" val={`×${fmt(s.massX, 1)}`}>
                {([["خفيفة", 0.5], ["طبيعية", 1], ["مضاعفة", 2]] as [string, number][]).map(([l, m]) => (
                  <Fate key={l} on={s.massX === m} onClick={() => { s.massX = m; if (last) preset(last); else rerender(); }}>{l}<span dir="ltr" className="block font-mono text-[9px] text-muted-foreground">×{m}</span></Fate>
                ))}
              </Group>
              <Group title="ارتفاع الإطلاق" val={`${s.h} km`}>
                {([["منخفض", 300], ["متوسط", 500], ["مرتفع", 1500]] as [string, number][]).map(([l, h]) => (
                  <Fate key={l} on={s.h === h} onClick={() => { s.h = h; if (last) preset(last); else reset(); }}>{l}<span dir="ltr" className="block font-mono text-[9px] text-muted-foreground">{h} km</span></Fate>
                ))}
              </Group>
              <Group title="سرعة الزمن" val={`${s.timeScale}×`}>
                {[1, 2, 5].map((k) => <Fate key={k} on={s.timeScale === k} onClick={() => { s.timeScale = k; rerender(); }}>{k}×</Fate>)}
              </Group>
              <div className="grid grid-cols-3 gap-1 pt-1">
                <Fate onClick={() => { setLast(null); reset(); }}>إعادة ضبط</Fate>
                <Fate onClick={playPause}>{!s.body ? "إطلاق" : s.running ? "إيقاف" : "تشغيل"}</Fate>
                <Link to="/" className="rounded-md bg-foreground/10 px-1 py-1 text-center text-[10px] hover:bg-foreground/20">العودة للدرس</Link>
              </div>
            </div>
          )}
          {open === "fate" && s.section === 2 && (
            <div className="w-[min(300px,78vw)] space-y-1">
              <div className="grid grid-cols-2 gap-1">
                <Fate on={s.lightModel === "newton"} onClick={() => { s.lightModel = "newton"; bump2(); }}>نموذج نيوتن</Fate>
                <Fate on={s.lightModel === "einstein"} onClick={() => { s.lightModel = "einstein"; bump2(); }}>نموذج أينشتاين</Fate>
                <div className="col-span-2 grid"><Fate on={s.eclipse} onClick={() => { s.eclipse = !s.eclipse; s.cam2 = s.eclipse ? "scope" : "space"; s.camKey++; bump2(); }}>{s.eclipse ? "إنهاء الكسوف" : "كسوف 1919 (إدينغتون)"}</Fate></div>
              </div>
              <Group title="كتلة الشمس" val={`×${fmt(s.sunMass, 1)}`}>
                {([["نصف", 0.5], ["طبيعية", 1], ["مضاعفة", 2]] as [string, number][]).map(([l, m]) => (
                  <Fate key={l} on={s.sunMass === m} onClick={() => { s.sunMass = m; bump2(); }}>{l}<span dir="ltr" className="block font-mono text-[9px] text-muted-foreground">×{m}</span></Fate>
                ))}
              </Group>
              <div className="grid grid-cols-2 gap-1 pt-1">
                <Fate onClick={() => { s.lightModel = "einstein"; s.sunMass = 1; s.eclipse = false; s.cam2 = "space"; s.camKey++; bump2(); }}>إعادة ضبط</Fate>
                <Link to="/" className="rounded-md bg-foreground/10 px-1 py-1 text-center text-[10px] hover:bg-foreground/20">العودة للدرس</Link>
              </div>
            </div>
          )}
          {open === "cam" && (
            <div className="grid max-h-[60vh] grid-cols-2 gap-0.5 overflow-y-auto">
              {s.section === 1 ? (
                <>
                  {([["front", "المشهد العام"], ["far", "من بعيد"], ["tilt", "منظور مائل"], ["edge", "من الجانب"], ["tower", "فوق البرج"], ["earth", "قرب الأرض"], ["back", "من الخلف"], ["left", "الجانب الآخر"], ["below", "من الأسفل"], ["corner", "زاوية علوية"], ["horizon", "أفق البرج"], ["deep", "الفضاء العميق"]] as [typeof s.cam1, string][]).map(([m, l]) => (
                    <button key={m} onClick={() => cam1(m)} className={`rounded-full px-3 py-1 text-[11px] transition ${!s.follow && !s.freeCam && s.cam1 === m ? "bg-primary text-primary-foreground" : "hover:bg-foreground/10"}`}>{l}</button>
                  ))}
                  <button onClick={() => { s.follow = !s.follow; if (!s.follow) s.camKey++; rerender(); }} className={`rounded-full px-3 py-1 text-[11px] transition ${s.follow ? "bg-primary text-primary-foreground" : "hover:bg-foreground/10"}`}>تتبع القمر</button>
                  <button onClick={() => { s.freeCam = !s.freeCam; s.follow = false; rerender(); }} className={`rounded-full px-3 py-1 text-[11px] transition ${s.freeCam ? "bg-primary text-primary-foreground" : "hover:bg-foreground/10"}`}>تحكم حر 360°</button>
                </>
              ) : (<>
                {([["space", "مشهد علوي واسع"], ["side", "من الجانب"], ["sun", "قرب الشمس"], ["star", "من خلف النجم"], ["scope", "تلسكوب الأرض"], ["behindEarth", "خلف الأرض"], ["below", "من الأسفل"], ["corner", "زاوية علوية"], ["grid", "مستوى الشبكة"], ["far", "من بعيد جدًا"]] as [typeof s.cam2, string][]).map(([m, l]) => (
                  <button key={m} onClick={() => cam2(m)} className={`rounded-full px-3 py-1 text-[11px] transition ${!s.freeCam && s.cam2 === m ? "bg-primary text-primary-foreground" : "hover:bg-foreground/10"}`}>{l}</button>
                ))}
                <button onClick={() => { s.freeCam = !s.freeCam; rerender(); }} className={`rounded-full px-3 py-1 text-[11px] transition ${s.freeCam ? "bg-primary text-primary-foreground" : "hover:bg-foreground/10"}`}>تحكم حر 360°</button>
              </>)}
            </div>
          )}
          {open === "stats" && (
            <div className="w-[min(420px,78vw)] space-y-1">
              {s.section === 1 ? (
                <>
                  <div className={`text-center text-[11px] font-semibold ${s.fate === "crash" || s.fate === "escape" ? "text-destructive" : "text-primary"}`}>{status.t}</div>
                  <div className="grid grid-cols-3 gap-1">
                    <Stat k="السرعة" v={`${fmt(vNow)} كم/ث`} />
                    <Stat k="الارتفاع" v={`${fmt(Math.max(0, r - R_EARTH), 0)} كم`} />
                    <Stat k="تسارع الجاذبية" v={`${fmt(gravityAt(r, s.massX))} م/ث²`} />
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <Stat k="السرعة المدارية" v={`${fmt(vo)} كم/ث`} />
                    <Stat k="سرعة الإفلات" v={`${fmt(ve)} كم/ث`} />
                    <Stat k="كتلة الأرض" v={`×${fmt(s.massX, 1)}`} />
                  </div>
                </>
              ) : (
                <>
                  <div className="text-center text-[11px] font-semibold text-primary">{s.lightModel === "einstein" ? "النسبية العامة (أينشتاين)" : "خط مستقيم (نيوتن)"}</div>
                  <div className="grid grid-cols-2 gap-1">
                    <Stat k="زاوية الانحراف الحقيقية" v={`${fmt(deflectionArcsec(s.sunMass))}″`} />
                    <Stat k="كتلة الشمس" v={`×${fmt(s.sunMass, 1)}`} />
                  </div>
                  <p className="text-[9px] leading-tight text-muted-foreground">الانحناء في المشهد مكبّر للتوضيح؛ الانحراف الحقيقي ثوانٍ قوسية.</p>
                </>
              )}
            </div>
          )}
          {open === "lines" && (
            <div className="space-y-1 text-[11px]">
              {s.section === 1 ? (
                <>
                  <Toggle on={s.showVec} onClick={() => { s.showVec = !s.showVec; rerender(); }} c="#ff6b5a" t="قوة الجاذبية" />
                  <Toggle on={s.showVec} onClick={() => { s.showVec = !s.showVec; rerender(); }} c="#7dffb0" t="السرعة" />
                  <Toggle on={s.showTrail} onClick={() => { s.showTrail = !s.showTrail; rerender(); }} c="#6fe0ff" t="مسار القمر" />
                </>
              ) : (
                <>
                  <Toggle on={s.showLines} onClick={() => { s.showLines = !s.showLines; bump2(); }} c="#ffd76a" t="خطوط الضوء" />
                  <Toggle on={s.showPos} onClick={() => { s.showPos = !s.showPos; bump2(); }} c="#ffffff" t="الموقع الحقيقي والظاهري" />
                  <Toggle on={s.showGrid} onClick={() => { s.showGrid = !s.showGrid; bump2(); }} c="#6fb6ff" t="شبكة الزمكان" />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Fate({ children, on, onClick }: { children: React.ReactNode; on?: boolean; onClick: () => void }) {
  return (<button onClick={onClick} className={`w-full rounded-md px-1 py-1 text-[10px] transition active:scale-[.98] ${on ? "bg-primary/25" : "bg-foreground/10 hover:bg-foreground/20"}`}>{children}</button>);
}
function Group({ title, val, children }: { title: string; val: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/40 p-1">
      <div className="mb-1 flex justify-between text-[10px] text-muted-foreground"><span>{title}</span><span dir="ltr" className="font-mono">{val}</span></div>
      <div className="grid grid-cols-3 gap-1">{children}</div>
    </div>
  );
}
function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 px-1 py-0.5 text-center">
      <div className="text-[9px] text-muted-foreground">{k}</div>
      <div className="font-mono text-[11px] font-semibold" dir="ltr">{v}</div>
    </div>
  );
}
function Toggle({ c, t, on, onClick }: { c: string; t: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 rounded px-1 py-0.5 transition hover:bg-foreground/10 ${on ? "" : "opacity-40"}`}>
      <span className="inline-block h-[3px] w-4 shrink-0 rounded" style={{ background: c }} />
      <span>{t}</span>
    </button>
  );
}
