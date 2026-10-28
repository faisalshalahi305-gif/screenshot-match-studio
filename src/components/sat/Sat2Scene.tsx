// @ts-nocheck
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars, useTexture, Line } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import dayA from "@/assets/earth_atmos_2048.jpg.asset.json";
import cloudA from "@/assets/earth_clouds_1024.png.asset.json";
import { R_EARTH, step, classify } from "@/lib/sat-physics";
import { S2, KM, BASE_RATE, ESCAPE_STOP_KM, LIGHT_O, lightGeometry } from "./sat2-state";

const RE = R_EARTH * KM; // scene radius of Earth
const TRAIL_MAX = 6000;

/* ---------------- Camera rig: fixed views + smooth cinematic flights ---------------- */
function CameraRig({ controls }) {
  const { camera } = useThree();
  const goal = useRef({ pos: new THREE.Vector3(0, 7, 30), tgt: new THREE.Vector3(0, 2, 0), t: 1, key: -1 });
  useFrame((_, dt) => {
    const c = controls.current; if (!c) return;
    const s = S2;
    if (goal.current.key !== s.camKey) {
      goal.current.key = s.camKey; goal.current.t = 0;
      if (s.section === 1) { goal.current.pos.set(0, 7, 30); goal.current.tgt.set(0, 2, 0); }
      else if (s.cam2 === "scope") { goal.current.pos.set(LIGHT_O.x + 47.5, 0.5, 0); goal.current.tgt.set(LIGHT_O.x - 10, 0, 2.5); }
      else { goal.current.pos.set(LIGHT_O.x + 6, 42, 58); goal.current.tgt.set(LIGHT_O.x, -2, 0); }
    }
    if (s.section === 1 && s.follow && s.body) {
      const p = new THREE.Vector3(s.body.x * KM, s.body.y * KM, 0);
      const v = new THREE.Vector3(s.body.vx, s.body.vy, 0).normalize();
      const want = p.clone().add(p.clone().normalize().multiplyScalar(2.5)).add(v.multiplyScalar(-5)).add(new THREE.Vector3(0, 0, 4));
      const k = 1 - Math.exp(-4 * dt);
      camera.position.lerp(want, k); c.target.lerp(p, k); c.update();
      return;
    }
    if (goal.current.t < 1) {
      goal.current.t = Math.min(1, goal.current.t + dt / 1.8);
      const k = 1 - Math.exp(-5 * dt) + (goal.current.t >= 1 ? 1 : 0);
      camera.position.lerp(goal.current.pos, Math.min(1, k));
      c.target.lerp(goal.current.tgt, Math.min(1, k));
      c.update();
    }
  });
  return null;
}

/* ---------------- Section 1: Earth, tower, satellite ---------------- */
function Earth() {
  const [day, clouds] = useTexture([dayA.url, cloudA.url]);
  day.colorSpace = THREE.SRGBColorSpace;
  const e = useRef(), c = useRef();
  useFrame((_, dt) => { if (e.current) e.current.rotation.y += dt * 0.02; if (c.current) c.current.rotation.y += dt * 0.028; });
  return (
    <group>
      <mesh ref={e}><sphereGeometry args={[RE, 96, 96]} /><meshStandardMaterial map={day} roughness={0.85} metalness={0} /></mesh>
      <mesh ref={c}><sphereGeometry args={[RE * 1.008, 64, 64]} /><meshStandardMaterial map={clouds} transparent opacity={0.45} depthWrite={false} /></mesh>
      <mesh><sphereGeometry args={[RE * 1.06, 64, 64]} /><meshBasicMaterial color="#5ab8ff" transparent opacity={0.12} side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
    </group>
  );
}

function Tower() {
  const g = useRef();
  useFrame(() => {
    const h = S2.h * KM;
    if (g.current) { g.current.scale.set(1, Math.max(0.05, h), 1); g.current.position.y = RE + h / 2; }
  });
  return (
    <group>
      <mesh position={[0, RE + 0.12, 0]}><coneGeometry args={[0.7, 0.5, 24]} /><meshStandardMaterial color="#7d7468" roughness={1} /></mesh>
      <mesh ref={g}><cylinderGeometry args={[0.06, 0.16, 1, 12]} /><meshStandardMaterial color="#b9bcc4" metalness={0.7} roughness={0.35} /></mesh>
    </group>
  );
}

function Satellite() {
  const grp = useRef(), blink = useRef(), boom = useRef(), flash = useRef();
  const trailGeo = useMemo(() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3)); g.setDrawRange(0, 0); return g; }, []);
  const trail = useRef({ n: 0, key: -1 });
  const vArrow = useMemo(() => new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x39ff7a, 0.35, 0.22), []);
  const gArrow = useMemo(() => new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(), 1, 0xff3b30, 0.35, 0.22), []);
  const trailLine = useMemo(() => new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: "#3ff3ff", transparent: true, opacity: 0.95 })), [trailGeo]);

  useFrame((state, rdt) => {
    const s = S2;
    const dt = Math.min(rdt, 0.05);
    if (trail.current.key !== s.runKey) { trail.current.key = s.runKey; trail.current.n = 0; trailGeo.setDrawRange(0, 0); }
    // physics
    if (s.body && s.running && s.fate !== "crash" && !s.stopped) {
      let simDt = dt * BASE_RATE * s.timeScale;
      while (simDt > 0) {
        const h = Math.min(2, simDt); simDt -= h;
        step(s.body, h, s.massX); s.t += h;
        const r = Math.hypot(s.body.x, s.body.y);
        if (r <= R_EARTH) {
          const k = R_EARTH / r; s.body.x *= k; s.body.y *= k;
          s.fate = "crash"; s.crashT = state.clock.elapsedTime; break;
        }
        if (r > ESCAPE_STOP_KM) { s.stopped = true; break; }
      }
      if (s.fate !== "crash") s.fate = classify(s.body, s.massX);
      const t = trail.current;
      if (t.n < TRAIL_MAX) { trailGeo.attributes.position.setXYZ(t.n, s.body.x * KM, s.body.y * KM, 0); t.n++; trailGeo.attributes.position.needsUpdate = true; trailGeo.setDrawRange(0, t.n); }
    }
    const b = s.body ?? { x: 0, y: R_EARTH + s.h, vx: s.v, vy: 0 };
    const p = new THREE.Vector3(b.x * KM, b.y * KM, 0);
    const vd = new THREE.Vector3(b.vx, b.vy, 0);
    if (grp.current) {
      grp.current.position.copy(p);
      if (vd.lengthSq() > 0) grp.current.rotation.z = Math.atan2(vd.y, vd.x);
      grp.current.visible = s.section === 1 && !(s.fate === "crash" && state.clock.elapsedTime - s.crashT > 0.15);
    }
    if (blink.current) blink.current.visible = Math.sin(state.clock.elapsedTime * 6) > 0;
    // vectors
    const r = p.length();
    const show = s.showVec && s.section === 1 && s.fate !== "crash";
    vArrow.visible = gArrow.visible = show;
    if (show) {
      vArrow.position.copy(p); vArrow.setDirection(vd.clone().normalize()); vArrow.setLength(Math.max(0.6, vd.length() * 0.28), 0.35, 0.22);
      const gms = (398600.4418 * s.massX) / ((r / KM) ** 2) * 1000;
      gArrow.position.copy(p); gArrow.setDirection(p.clone().multiplyScalar(-1).normalize()); gArrow.setLength(Math.max(0.6, gms * 0.3), 0.35, 0.22);
    }
    trailLine.visible = s.showTrail;
    // explosion
    const age = state.clock.elapsedTime - s.crashT;
    const on = s.fate === "crash" && age < 1.4;
    if (boom.current) {
      boom.current.visible = on; boom.current.position.copy(p);
      const sc = 0.2 + age * 2.2; boom.current.scale.setScalar(sc);
      boom.current.material.opacity = Math.max(0, 1 - age / 1.4);
    }
    if (flash.current) { flash.current.position.copy(p); flash.current.intensity = on ? 60 * Math.max(0, 1 - age / 0.8) : 0; }
    if (on && age < 0.4) { state.camera.position.x += (Math.random() - 0.5) * 0.06; state.camera.position.y += (Math.random() - 0.5) * 0.06; }
  });

  return (
    <group>
      <primitive object={trailLine} />
      <primitive object={vArrow} />
      <primitive object={gArrow} />
      <group ref={grp} scale={0.55}>
        <mesh><boxGeometry args={[0.5, 0.42, 0.42]} /><meshStandardMaterial color="#d8b25a" metalness={0.9} roughness={0.25} /></mesh>
        {[-1, 1].map((sgn) => (
          <group key={sgn}>
            <mesh position={[0, 0, sgn * 0.42]}><boxGeometry args={[0.04, 0.04, 0.35]} /><meshStandardMaterial color="#aaa" /></mesh>
            <mesh position={[0, 0, sgn * 1.05]}><boxGeometry args={[0.36, 0.02, 0.95]} /><meshStandardMaterial color="#1d3f9a" emissive="#1f5cff" emissiveIntensity={0.35} metalness={0.6} roughness={0.3} /></mesh>
          </group>
        ))}
        <mesh ref={blink} position={[0.27, 0.15, 0]}><sphereGeometry args={[0.05, 8, 8]} /><meshBasicMaterial color="#9dffb0" toneMapped={false} /></mesh>
      </group>
      <mesh ref={boom} visible={false}><sphereGeometry args={[1, 32, 32]} /><meshBasicMaterial color="#ff8a2a" transparent toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
      <pointLight ref={flash} color="#ff7a30" intensity={0} distance={14} />
    </group>
  );
}

/* ---------------- Section 2: Sun, light paths, spacetime grid, 1919 eclipse ---------------- */
function useGlowTexture() {
  return useMemo(() => {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const g = c.getContext("2d"); const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,240,210,0.6)"); gr.addColorStop(0.6, "rgba(255,200,140,0.12)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }, []);
}

function SpacetimeGrid() {
  const ref = useRef(); const lastM = useRef(-1);
  const geo = useMemo(() => new THREE.PlaneGeometry(120, 70, 96, 56).rotateX(-Math.PI / 2), []);
  const base = useMemo(() => geo.attributes.position.array.slice(), [geo]);
  useFrame(() => {
    if (!ref.current) return;
    ref.current.visible = S2.showGrid;
    if (lastM.current === S2.sunMass) return; lastM.current = S2.sunMass;
    const a = geo.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2];
      a.setY(i, -(10 * S2.sunMass) / Math.sqrt(x * x + z * z + 6) );
    }
    a.needsUpdate = true;
  });
  return <mesh ref={ref} geometry={geo} position={[0, -3.6, 0]}><meshBasicMaterial color="#38d6c8" wireframe transparent opacity={0.28} depthWrite={false} /></mesh>;
}

function LightScene() {
  const glow = useGlowTexture();
  const sun = useRef(), corona = useRef(), moon = useRef(), haloSun = useRef(), amb = useRef();
  const fieldRef = useRef();
  const field = useMemo(() => [[5, 30], [6.5, 110], [4.6, 200], [8, 255], [5.6, 320], [9, 160]].map(([r, d]) => ({ r, a: (d * Math.PI) / 180 })), []);
  // rebuild geometry each frame from S2 (cheap: few points)
  const lines = useRef({});
  useFrame((state, rdt) => {
    const s = S2, dt = Math.min(rdt, 0.05);
    const target = s.eclipse ? 1 : 0;
    s.eclipseT += Math.sign(target - s.eclipseT) * Math.min(Math.abs(target - s.eclipseT), dt / 3);
    const e = s.eclipseT;
    if (moon.current) { moon.current.position.set(30, 0, 6 * (1 - e) * (1 - e) + 0.02); moon.current.visible = e > 0.001; }
    if (sun.current) sun.current.material.color.setScalar(1).lerp(new THREE.Color("#ffd27a"), 0).multiplyScalar(1 - 0.6 * e);
    if (haloSun.current) haloSun.current.material.opacity = 0.9 * (1 - e);
    if (corona.current) { corona.current.material.opacity = e * 0.9; corona.current.lookAt(state.camera.position); }
    if (fieldRef.current) fieldRef.current.visible = e > 0.85;
    if (amb.current) amb.current.intensity = 0.5 * (1 - 0.8 * e);
  });

  const g = lightGeometry(S2.sunMass);
  return (
    <group position={[LIGHT_O.x, 0, 0]}>
      <ambientLight ref={amb} intensity={0.5} />
      <pointLight position={[0, 0, 0]} intensity={400} distance={120} color="#fff2d0" />
      {/* Sun */}
      <mesh ref={sun}><sphereGeometry args={[3, 64, 64]} /><meshBasicMaterial color="#ffcf6a" toneMapped={false} /></mesh>
      <sprite ref={haloSun} scale={[16, 16, 1]}><spriteMaterial map={glow} color="#ffb347" transparent depthWrite={false} blending={THREE.AdditiveBlending} /></sprite>
      <mesh ref={corona}><planeGeometry args={[14, 14]} /><meshBasicMaterial map={glow} color="#f4f6ff" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} /></mesh>
      {/* Moon (eclipse) */}
      <mesh ref={moon} visible={false}><sphereGeometry args={[1.08, 48, 48]} /><meshBasicMaterial color="#050505" /></mesh>
      {/* Real star */}
      <mesh position={[-45, 0, g.starZ]}><sphereGeometry args={[0.45, 24, 24]} /><meshBasicMaterial color="#ffffff" toneMapped={false} /></mesh>
      <sprite position={[-45, 0, g.starZ]} scale={[3, 3, 1]}><spriteMaterial map={glow} transparent depthWrite={false} blending={THREE.AdditiveBlending} /></sprite>
      {/* Earth + observatory */}
      <group position={[45, 0, 0]}>
        <EarthSmall />
        <mesh position={[-1.25, 0.15, 0]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.12, 0.18, 0.7, 12]} /><meshStandardMaterial color="#e8e8e8" metalness={0.6} roughness={0.3} /></mesh>
      </group>
      <Paths />
      <SpacetimeGrid />
      {/* 1919 field stars: dotted ring = true place, gold ring = observed place */}
      <group ref={fieldRef} visible={false} position={[-20, 0, 0]}>
        {field.map((f, i) => {
          const y0 = Math.sin(f.a) * f.r, z0 = Math.cos(f.a) * f.r;
          const shift = 1 + (1.1 * S2.sunMass) / f.r;
          const y1 = y0 * shift, z1 = z0 * shift;
          return (
            <group key={i}>
              <mesh position={[0, y0, z0]}><sphereGeometry args={[0.12, 8, 8]} /><meshBasicMaterial color="#bfc7d6" /></mesh>
              <Ring y={y0} z={z0} color="#ffffff" dashed />
              <mesh position={[0, y1, z1]}><sphereGeometry args={[0.16, 8, 8]} /><meshBasicMaterial color="#ffe58a" toneMapped={false} /></mesh>
              <Ring y={y1} z={z1} color="#ffd34d" />
              <Line points={[[0, y0, z0], [0, y1, z1]]} color="#ffd34d" lineWidth={1.5} />
            </group>
          );
        })}
      </group>
    </group>
  );
}

function Ring({ y, z, color, dashed }) {
  const pts = useMemo(() => Array.from({ length: 33 }, (_, i) => { const a = (i / 32) * Math.PI * 2; return [0, y + Math.sin(a) * 0.45, z + Math.cos(a) * 0.45]; }), [y, z]);
  return <Line points={pts} color={color} lineWidth={1.2} dashed={dashed} dashSize={0.12} gapSize={0.1} />;
}

function EarthSmall() {
  const [day] = useTexture([dayA.url]); day.colorSpace = THREE.SRGBColorSpace;
  return <mesh rotation={[0.3, 2, 0]}><sphereGeometry args={[1.2, 48, 48]} /><meshStandardMaterial map={day} /></mesh>;
}

function Paths() {
  const s = S2; const g = lightGeometry(s.sunMass);
  return (
    <group>
      {s.lightModel === "newton" && s.showLines && (
        <Line points={g.newton} color="#c9c2a8" lineWidth={2} dashed dashSize={0.8} gapSize={0.5} />
      )}
      {s.lightModel === "einstein" && s.showLines && (
        <Line points={g.blocked ? g.curve.slice(0, Math.ceil(g.curve.length / 2)) : g.curve} color={g.blocked ? "#ff6b5a" : "#3fa8ff"} lineWidth={3} />
      )}
      {s.showPos && s.lightModel === "einstein" && !g.blocked && (
        <group>
          <Line points={[[45, 0, 0], [-45, 0, g.appZ]]} color="#ffd34d" lineWidth={1.2} dashed dashSize={0.6} gapSize={0.5} />
          <mesh position={[-45, 0, g.appZ]}><sphereGeometry args={[0.5, 24, 24]} /><meshBasicMaterial color="#ffd34d" transparent opacity={0.55} toneMapped={false} /></mesh>
          <Line points={[[-45, 0, g.starZ + 0.6], [-45, 0, g.appZ - 0.6]]} color="#ffffff" lineWidth={1.5} />
        </group>
      )}
    </group>
  );
}

/* ---------------- Root ---------------- */
export default function Sat2Scene({ version }) {
  const controls = useRef();
  return (
    <Canvas camera={{ position: [0, 7, 30], fov: 50, near: 0.05, far: 4000 }} dpr={[1, 2]} gl={{ antialias: true }}
      onCreated={({ gl }) => { gl.domElement.parentElement?.setAttribute("data-scene-ready", "1"); }}>
      <color attach="background" args={["#02030a"]} />
      <Stars radius={900} depth={200} count={7000} factor={7} saturation={0.15} fade speed={0.4} />
      <ambientLight intensity={0.08} />
      <directionalLight position={[40, 18, 30]} intensity={2.6} color="#fff4e2" />
      <Suspense fallback={null}>
        <Earth />
        <Tower />
        <Satellite />
        <LightScene key={version} />
      </Suspense>
      <OrbitControls ref={controls} enableDamping dampingFactor={0.08} minDistance={2} maxDistance={600} />
      <CameraRig controls={controls} />
      <EffectComposer>
        <Bloom intensity={0.9} luminanceThreshold={0.75} luminanceSmoothing={0.2} mipmapBlur />
        <Vignette darkness={0.55} offset={0.3} />
      </EffectComposer>
    </Canvas>
  );
}
