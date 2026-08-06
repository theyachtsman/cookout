"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RARITY_MAP, type CratePull } from "@cookout/shared";
import { audio } from "../../lib/audio";

/**
 * The Recruit Crate opening.
 *
 * A cinematic in the Flame Goon Squad's recruitment bunker: the crate lands on
 * a steel prep table, pressure builds while the player works it open, and the
 * dossier launches out with its rarity written in the border colour before a
 * single word is readable.
 *
 * Two things kept the scene honest. It is built from primitives and shader-free
 * materials rather than downloaded assets, so it costs nothing to load and
 * can't half-render on a slow connection. And the *result is already decided* —
 * the server drew the cards before this mounted — so Skip is never a shortcut
 * to a different outcome, just a shortcut past the theatre.
 */

type Phase = "arrival" | "pressure" | "reveal" | "inspect";

const RARITY_LIGHT: Record<string, string> = {
  common: "#a1a1aa",
  uncommon: "#4ade80",
  rare: "#60a5fa",
  elite: "#c084fc",
  epic: "#fb923c",
  legendary: "#fbbf24",
};

/** Embers drifting up through the bunker. Instanced so the count is free. */
function Embers({ intensity, color }: { intensity: number; color: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const count = 140;
  const seeds = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        x: (Math.random() - 0.5) * 9,
        z: (Math.random() - 0.5) * 7,
        y: Math.random() * 6,
        speed: 0.25 + Math.random() * 0.7,
        drift: (Math.random() - 0.5) * 0.35,
        scale: 0.012 + Math.random() * 0.03,
      })),
    [],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((_, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    seeds.forEach((s, i) => {
      s.y += delta * s.speed * (0.5 + intensity);
      if (s.y > 6) s.y = -0.2;
      dummy.position.set(s.x + Math.sin(s.y + i) * s.drift, s.y, s.z);
      dummy.scale.setScalar(s.scale * (0.6 + intensity));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial color={color} transparent opacity={0.35 + intensity * 0.5} />
    </instancedMesh>
  );
}

/** The bunker: concrete floor, steel prep table, industrial haze. */
/**
 * The bunker.
 *
 * The scene read flat and grey before, and the cause was physical rather than
 * artistic: metal in a PBR renderer is almost entirely reflection, so metalness
 * 0.85 with nothing in the environment to reflect resolves to near-black. Lights
 * alone cannot fix that — they add highlights, not the surroundings a metal
 * surface is supposed to mirror. The Environment below is built from emissive
 * panels rather than a downloaded HDRI, so it costs no network request and
 * still gives every metal something to catch.
 *
 * The other half is colour. Everything was lit from a single warmish direction,
 * so the whole frame sat in one narrow grey band. It is now lit warm from the
 * key side and cool from the fill side, which is what separates surfaces from
 * each other and stops the image reading as monotone.
 */
function Bunker({ accent }: { accent: string }) {
  return (
    <group>
      {/* Something for the metal to reflect. Without this the crate, the table
          and the brackets are all black no matter how bright the lights are. */}
      <Environment resolution={192} frames={1}>
        <Lightformer form="rect" intensity={2.2} color="#ffb774" scale={[10, 5, 1]} position={[6, 5, 2]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.4} color="#5eead4" scale={[10, 5, 1]} position={[-7, 3, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={1.1} color={accent} scale={[6, 3, 1]} position={[0, 1.5, -6]} target={[0, 0, 0]} />
        <Lightformer form="ring" intensity={0.8} color="#a3e635" scale={4} position={[-2, -1.5, 3]} target={[0, 0, 0]} />
      </Environment>

      {/* concrete floor — rough, so it grounds rather than mirrors */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.75, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#0e0e11" roughness={0.92} metalness={0.08} />
      </mesh>

      {/* prep table: brushed steel, warmer and lighter than the crate so the
          two never merge into one silhouette */}
      <mesh position={[0, TABLE_Y, 0]} receiveShadow castShadow>
        <boxGeometry args={[4.2, TABLE_THICKNESS, 2.4]} />
        <meshStandardMaterial color="#6b6b76" roughness={0.28} metalness={0.92} envMapIntensity={1.5} />
      </mesh>
      {/* a lit edge strip, which reads as a real object rather than a slab */}
      <mesh position={[0, TABLE_Y - TABLE_THICKNESS / 2 - 0.012, 1.201]}>
        <boxGeometry args={[4.2, 0.024, 0.01]} />
        <meshBasicMaterial color={accent} />
      </mesh>

      {[-1.8, 1.8].map((x) =>
        [-0.9, 0.9].map((z) => (
          <mesh key={`${x}:${z}`} position={[x, -0.6, z]} castShadow receiveShadow>
            <boxGeometry args={[0.12, 0.4, 0.12]} />
            <meshStandardMaterial color="#3a3a42" roughness={0.45} metalness={0.85} envMapIntensity={1.2} />
          </mesh>
        )),
      )}

      {/* Contact shadow, because a rendered shadow map at this scale is too
          soft to sell contact — this is what makes the crate look placed on
          the table rather than hovering near it. */}
      <ContactShadows
        position={[0, TABLE_Y + TABLE_THICKNESS / 2 + 0.002, 0]}
        scale={5}
        blur={2.4}
        opacity={0.75}
        far={1.6}
        resolution={512}
        color="#000000"
      />

      {/* back wall, so the space reads as enclosed */}
      <mesh position={[0, 2, -5]} receiveShadow>
        <planeGeometry args={[24, 10]} />
        <meshStandardMaterial color="#0b0b0e" roughness={1} />
      </mesh>

      {/* Three-point rig, deliberately split warm/cool. */}
      <ambientLight intensity={0.12} />
      <directionalLight
        position={[5, 7, 4]}
        intensity={2.6}
        color="#ffd7a8"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0005}
      >
        <orthographicCamera attach="shadow-camera" args={[-6, 6, 6, -6, 0.1, 24]} />
      </directionalLight>
      {/* cool fill from the opposite side — the contrast that kills the grey */}
      <directionalLight position={[-6, 3, 2]} intensity={0.9} color="#7dd3fc" />
      {/* rim from behind, so the crate has an edge against the dark wall */}
      <spotLight
        position={[0, 3.4, -3.2]}
        angle={0.7}
        penumbra={0.9}
        intensity={40}
        distance={14}
        color={accent}
      />
      {/* practicals: the Squad's green off the floor, and a rarity kicker */}
      <pointLight position={[-3.4, -0.2, 2.4]} color="#a3e635" intensity={14} distance={10} />
      <pointLight position={[1.6, 0.9, 2.2]} color={accent} intensity={18} distance={9} />
    </group>
  );
}

/** The tactical crate. Shakes under pressure, then bursts. */
/**
 * Where the crate rests.
 *
 * The table's top face is at TABLE_Y + TABLE_THICKNESS/2, and the crate's
 * origin is its centre, so it has to sit half its own height above that. It
 * was hardcoded to -0.22 before, which put it a good 0.4 units through the
 * table — the box appeared to be floating in front of it rather than on it.
 */
const TABLE_Y = -0.4;
const TABLE_THICKNESS = 0.14;
const CRATE_HEIGHT = 1.05;
const REST_Y = TABLE_Y + TABLE_THICKNESS / 2 + CRATE_HEIGHT / 2;

function Crate({
  phase,
  pressure,
  accent,
}: {
  phase: Phase;
  pressure: number;
  accent: string;
}) {
  const group = useRef<THREE.Group>(null);
  const landed = useRef(false);
  const t = useRef(0);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    t.current += delta;

    if (phase === "arrival") {
      // Slam in from above and settle.
      const p = Math.min(1, t.current / 0.55);
      const eased = 1 - Math.pow(1 - p, 4);
      g.position.y = 6 * (1 - eased) + REST_Y;
      if (p >= 1 && !landed.current) landed.current = true;
      g.rotation.y = 0.4 * (1 - eased);
    } else if (phase === "pressure") {
      // Rattle harder the closer it is to opening.
      const shake = pressure * 0.06;
      g.position.x = (Math.random() - 0.5) * shake;
      g.position.y = REST_Y + (Math.random() - 0.5) * shake;
      g.rotation.z = (Math.random() - 0.5) * shake * 0.4;
    } else {
      // Blown open: fall away out of frame.
      g.position.y -= delta * 2.4;
      g.rotation.x += delta * 1.6;
    }
  });

  return (
    <group ref={group} position={[0, 6, 0]}>
      {/* Painted crate body: dark, but not black. Low metalness with a
          gunmetal tint reads as coated steel and, crucially, still takes a
          diffuse highlight — the old near-black high-metal mix had nothing to
          catch and flattened into a silhouette. */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[1.6, CRATE_HEIGHT, 1.1]} />
        <meshStandardMaterial
          color="#2b2f36"
          roughness={0.42}
          metalness={0.45}
          envMapIntensity={1.1}
          emissive={accent}
          emissiveIntensity={pressure * 0.6}
        />
      </mesh>
      {/* A recessed panel, so the face is not one unbroken rectangle. */}
      <mesh position={[0, -0.12, 0.556]} castShadow>
        <boxGeometry args={[1.15, 0.5, 0.02]} />
        <meshStandardMaterial color="#22262c" roughness={0.6} metalness={0.35} />
      </mesh>
      {/* seam, glowing hotter as pressure builds */}
      <mesh position={[0, 0.14, 0]}>
        <boxGeometry args={[1.63, 0.05, 1.13]} />
        <meshBasicMaterial color={accent} transparent opacity={0.25 + pressure * 0.75} />
      </mesh>
      {/* Corner brackets: the brightest metal in frame, and the thing the
          environment actually shows off. */}
      {[
        [-0.78, 0, 0],
        [0.78, 0, 0],
      ].map(([x]) => (
        <mesh key={x} position={[x as number, 0, 0]} castShadow>
          <boxGeometry args={[0.08, 1.08, 1.14]} />
          <meshStandardMaterial
            color="#9ca3af"
            roughness={0.22}
            metalness={1}
            envMapIntensity={2}
          />
        </mesh>
      ))}
      {/* Rivets down each bracket — small, but they give the eye a scale
          reference, which is most of why a prop reads as built rather than
          drawn. */}
      {[-0.78, 0.78].map((x) =>
        [-0.34, 0, 0.34].map((y) => (
          <mesh key={`${x}:${y}`} position={[x * 1.02, y, 0.5]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.028, 0.028, 0.06, 8]} />
            <meshStandardMaterial color="#d4d4d8" roughness={0.2} metalness={1} envMapIntensity={2.2} />
          </mesh>
        )),
      )}
    </group>
  );
}

/** The dossier: launches, spins, then settles facing the camera. */
function Dossier({ accent, active }: { accent: string; active: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const t = useRef(0);

  useFrame((_, delta) => {
    const g = ref.current;
    if (!g || !active) return;
    t.current += delta;
    const p = Math.min(1, t.current / 1.6);
    const eased = 1 - Math.pow(1 - p, 3);
    g.position.y = -0.2 + eased * 1.35;
    // Slow-motion rotation that lands square to the camera.
    g.rotation.y = (1 - eased) * Math.PI * 3;
    g.scale.setScalar(0.55 + eased * 0.45);
  });

  if (!active) return null;
  return (
    <group ref={ref} position={[0, -0.2, 0]}>
      <mesh castShadow>
        <boxGeometry args={[1.15, 1.6, 0.03]} />
        <meshStandardMaterial color="#18181b" roughness={0.6} metalness={0.2} />
      </mesh>
      {/* the border is the rarity — readable before any text is */}
      <mesh position={[0, 0, 0.02]}>
        <boxGeometry args={[1.22, 1.67, 0.01]} />
        <meshBasicMaterial color={accent} />
      </mesh>
      <pointLight position={[0, 0, 1]} color={accent} intensity={14} distance={5} />
    </group>
  );
}

function Scene({ phase, pressure, accent }: { phase: Phase; pressure: number; accent: string }) {
  return (
    <>
      <Bunker accent={accent} />
      <Embers intensity={phase === "pressure" ? pressure : 0.2} color={accent} />
      {phase !== "reveal" && phase !== "inspect" && (
        <Crate phase={phase} pressure={pressure} accent={accent} />
      )}
      {(phase === "reveal" || phase === "inspect") && <Dossier accent={accent} active />}
      {phase === "pressure" && <Crate phase={phase} pressure={pressure} accent={accent} />}
    </>
  );
}

export function CrateOpening({
  pulls,
  onDone,
  skipDefault = false,
}: {
  pulls: CratePull[];
  onDone: () => void;
  /** Remembered preference — the cinematic stays available either way. */
  skipDefault?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("arrival");
  const [pressure, setPressure] = useState(0);
  const [skipped, setSkipped] = useState(skipDefault);

  const pull = pulls[index];
  const rarity = pull?.card.rarity ?? "common";
  const accent = RARITY_LIGHT[rarity] ?? RARITY_LIGHT.common!;
  const isBig = rarity === "legendary" || rarity === "epic";

  // Arrival lands, then the crate is workable.
  useEffect(() => {
    if (skipped || phase !== "arrival") return;
    audio.play("crate.arrive");
    const t = setTimeout(() => setPhase("pressure"), 700);
    return () => clearTimeout(t);
  }, [phase, skipped, index]);

  const work = useCallback(() => {
    if (phase !== "pressure") return;
    setPressure((p) => {
      const next = Math.min(1, p + 0.18);
      audio.play("crate.strain");
      if (next >= 1) {
        setPhase("reveal");
        // The lid going always plays; the pull sting rides on top of it a beat
        // later, so a legendary is heard as "it opened AND it was rare".
        audio.play("crate.burst");
        setTimeout(() => audio.play(isBig ? "crate.legendary" : "crate.reveal"), 220);
        // Let the launch play, then hand over to the inspection card.
        setTimeout(() => setPhase("inspect"), isBig ? 2200 : 1500);
      }
      return next;
    });
  }, [phase, isBig]);

  const next = useCallback(() => {
    if (index + 1 >= pulls.length) {
      onDone();
      return;
    }
    setIndex((i) => i + 1);
    setPressure(0);
    setPhase(skipped ? "inspect" : "arrival");
  }, [index, pulls.length, onDone, skipped]);

  // Skipping jumps straight to the dossier for whatever is left.
  useEffect(() => {
    if (skipped) setPhase("inspect");
  }, [skipped]);

  if (!pull) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      {!skipped && (
        <div
          className="absolute inset-0 cursor-pointer select-none"
          onPointerDown={work}
          role="button"
          tabIndex={0}
          aria-label="Work the crate open"
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && work()}
        >
          <Canvas
            shadows
            dpr={[1, 1.75]}
            camera={{ position: [0, 1.1, 5.2], fov: 42 }}
            gl={{ antialias: true, powerPreference: "high-performance" }}
            // Filmic tone mapping and a correct colour space. Without these,
            // bright highlights clip to flat white and the midtones compress —
            // which is the other half of why this looked washed out and grey.
            onCreated={({ gl }) => {
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.15;
              gl.outputColorSpace = THREE.SRGBColorSpace;
              gl.shadowMap.type = THREE.PCFSoftShadowMap;
            }}
          >
            <color attach="background" args={["#08080a"]} />
            <fog attach="fog" args={["#08080a", 6, 16]} />
            <Scene phase={phase} pressure={pressure} accent={accent} />
          </Canvas>
        </div>
      )}

      {/* pressure prompt */}
      {!skipped && phase === "pressure" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 flex flex-col items-center gap-3">
          <div className="text-sm font-black uppercase tracking-[0.3em] text-zinc-400">
            Force it open
          </div>
          <div className="h-2 w-64 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full transition-[width] duration-150"
              style={{ width: `${pressure * 100}%`, background: accent }}
            />
          </div>
        </div>
      )}

      {/* the dossier itself, once it lands */}
      {phase === "inspect" && <DossierCard pull={pull} onNext={next} last={index + 1 >= pulls.length} />}

      <div className="absolute right-4 top-4 flex items-center gap-2">
        <span className="rounded-full bg-zinc-900/80 px-3 py-1 text-[11px] font-bold text-zinc-400">
          {index + 1} / {pulls.length}
        </span>
        {!skipped && (
          <button
            onClick={() => setSkipped(true)}
            className="rounded-full bg-zinc-900/80 px-3 py-1 text-[11px] font-bold text-zinc-300 hover:bg-zinc-800"
          >
            Skip animation
          </button>
        )}
        <button
          onClick={onDone}
          className="rounded-full bg-zinc-900/80 px-3 py-1 text-[11px] font-bold text-zinc-300 hover:bg-zinc-800"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/** The landed dossier — the readable half of the reveal. */
function DossierCard({
  pull,
  onNext,
  last,
}: {
  pull: CratePull;
  onNext: () => void;
  last: boolean;
}) {
  const { card, duplicate, quantityOwned } = pull;
  const rarity = RARITY_MAP[card.rarity];
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {!duplicate && (
          <div className="mb-2 text-center text-xs font-black uppercase tracking-[0.35em] text-lime-300">
            🔥 New Recruit
          </div>
        )}
        <div
          className="animate-[fadein_.4s_ease] overflow-hidden rounded-2xl bg-zinc-950 p-1 shadow-2xl"
          style={{ boxShadow: `0 0 60px -10px ${rarity.color}`, border: `2px solid ${rarity.color}` }}
        >
          <div className="rounded-xl bg-zinc-900/60 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xl font-black text-zinc-50">{card.name}</div>
                <div className="font-mono text-[11px] text-zinc-500">
                  {card.cardNumber} · {card.callsign}
                </div>
              </div>
              <span
                className="shrink-0 rounded px-2 py-0.5 text-[10px] font-black uppercase"
                style={{ background: `${rarity.color}22`, color: rarity.color }}
              >
                {rarity.label}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
              {[
                ["Species", card.species],
                ["Division", card.division],
                ["Role", card.role],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-zinc-950/60 p-2">
                  <div className="text-[9px] uppercase text-zinc-600">{k}</div>
                  <div className="truncate font-bold text-zinc-200">{v}</div>
                </div>
              ))}
            </div>

            {card.equipment.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {card.equipment.map((e) => (
                  <span key={e} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-300">
                    {e}
                  </span>
                ))}
                {card.traits.map((t) => (
                  <span key={t} className="rounded bg-zinc-800/60 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {t}
                  </span>
                ))}
              </div>
            )}

            {card.biography && (
              <p className="mt-3 text-xs leading-snug text-zinc-400">{card.biography}</p>
            )}
            {card.lore && <p className="mt-1 text-xs italic leading-snug text-zinc-600">{card.lore}</p>}

            {duplicate && (
              <div className="mt-3 rounded-lg bg-zinc-800/60 px-2 py-1 text-center text-[11px] font-bold text-zinc-400">
                Duplicate · you now hold {quantityOwned}
              </div>
            )}
            {card.aiHandle && (
              <a
                href={`/profile/${card.aiHandle}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block rounded-lg bg-zinc-800/60 px-2 py-1.5 text-center text-[11px] font-bold text-lime-300 hover:bg-zinc-800"
              >
                View {card.name}&apos;s profile →
              </a>
            )}
          </div>
        </div>

        <button
          onClick={onNext}
          className="mt-4 w-full rounded-xl bg-lime-400 py-3 text-sm font-black text-zinc-950 hover:bg-lime-300"
        >
          {last ? "Done" : "Next recruit →"}
        </button>
      </div>
    </div>
  );
}
