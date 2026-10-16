import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { categoryOf } from "./Voice.jsx";

// The game's chat wheel for a hero's voice lines: hold T (or press the button), point at a
// sector, let go; the hero says a line of that kind, with a fitting animation where it has one

// The animation that goes with a kind of line, by the names heroes' animations have
const ANIMATIONS = {
  Laughs: [/laugh/i],
  "Victory and defeat": [/victory/i, /taunt/i],
  Death: [/^die|death/i],
  Kills: [/taunt/i, /victory/i],
  Spawn: [/spawn/i],
  Thanks: [/greet|wave|bow/i, /taunt/i],
  Attacking: [/^attack/i],
  Abilities: [/^cast/i],
};
// The wheel's size and the short names on its sectors
const OUTER = 190;
const INNER = 46;
const LABELS = {
  Laughs: "Laugh",
  Thanks: "Thanks",
  Kills: "Kill",
  Death: "Death",
  "Victory and defeat": "Victory",
  Spawn: "Spawn",
  "Rivals and allies": "Rivals",
  "Buying items": "Items",
  Runes: "Runes",
  Abilities: "Ability",
  Attacking: "Attack",
  Moving: "Move",
};
const ORDER = ["Laughs", "Thanks", "Kills", "Death", "Victory and defeat", "Spawn", "Rivals and allies", "Buying items", "Runes", "Abilities", "Attacking", "Moving"];

const voices = new Map();
function useVoiceLines(modelsBase, heroId) {
  const [lines, setLines] = useState([]);
  useEffect(() => {
    const url = `${modelsBase}data/voices/npc_dota_hero_${heroId}.json`;
    if (!voices.has(url)) {
      voices.set(url, fetch(url).then((res) => (res.ok ? res.json() : [])).catch(() => []));
    }
    let cancelled = false;
    voices.get(url).then((data) => !cancelled && setLines(data));
    return () => {
      cancelled = true;
    };
  }, [modelsBase, heroId]);
  return lines;
}

export default function ChatWheel({ modelsBase, heroId }) {
  const lines = useVoiceLines(modelsBase, heroId);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(-1);
  const center = useRef({ x: 0, y: 0 });
  // Mirrors of the state for the key handlers, which must not run twice
  const openRef = useRef(false);
  const hoverRef = useRef(-1);
  const show = (value) => {
    openRef.current = value;
    setOpen(value);
  };
  const aim = (value) => {
    hoverRef.current = value;
    setHover(value);
  };

  // Eight kinds of lines the hero has, in the order the game's wheel favours
  const sectors = useMemo(() => {
    const byKind = new Map();
    for (const line of lines) {
      const kind = categoryOf(line.event);
      byKind.set(kind, [...(byKind.get(kind) ?? []), ...line.files]);
    }
    return ORDER.filter((kind) => byKind.get(kind)?.length)
      .slice(0, 8)
      .map((kind) => ({ kind, files: byKind.get(kind) }));
  }, [lines]);

  const say = (index) => {
    const sector = sectors[index];
    if (sector) {
      window.dispatchEvent(new CustomEvent("dotadex:emote", { detail: { files: sector.files, animations: ANIMATIONS[sector.kind] } }));
    }
  };

  const openAt = (x, y) => {
    center.current = { x, y };
    aim(-1);
    show(true);
  };

  const pointTo = (x, y) => {
    const dx = x - center.current.x;
    const dy = y - center.current.y;
    if (Math.hypot(dx, dy) < INNER) {
      aim(-1);
      return;
    }
    const angle = (Math.atan2(dy, dx) + Math.PI * 2.5) % (Math.PI * 2);
    aim(Math.floor((angle / (Math.PI * 2)) * sectors.length) % sectors.length);
  };

  // Hold T anywhere outside a text field
  useEffect(() => {
    const down = (event) => {
      // The key's place on the keyboard, so it works in any layout
      if (event.code !== "KeyT" || event.repeat || event.target.closest?.("input, textarea")) {
        return;
      }
      openAt(window.innerWidth * 0.3, window.innerHeight * 0.5);
    };
    const up = (event) => {
      if (event.code === "KeyT" && openRef.current) {
        say(hoverRef.current);
        show(false);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  return (
    <>
      <button
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          openAt(window.innerWidth * 0.3, window.innerHeight * 0.5 || box.top);
        }}
        data-sound="click"
        data-hover
        className="w-[60px] text-center"
        title="Phrases (hold T)"
      >
        <span className="mx-auto grid size-[52px] place-items-center text-bone/80 hover:text-bone">
          <MessageCircle className="size-9" strokeWidth={1.4} />
        </span>
        <span className="mt-1 block text-[11px] leading-tight text-bone/75">Phrases</span>
      </button>

      {open && sectors.length > 0 && (
        <div
          className="fixed inset-0 z-50"
          onPointerMove={(event) => pointTo(event.clientX, event.clientY)}
          onClick={() => {
            say(hoverRef.current);
            show(false);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            show(false);
          }}
        >
          <div className="absolute size-0" style={{ left: center.current.x, top: center.current.y }}>
            <svg width={2 * OUTER} height={2 * OUTER} viewBox={`${-OUTER} ${-OUTER} ${2 * OUTER} ${2 * OUTER}`} className="absolute" style={{ left: -OUTER, top: -OUTER }}>
              <defs>
                <radialGradient id="wheel-fill">
                  <stop offset="35%" stopColor="rgb(8,11,15)" stopOpacity="0.55" />
                  <stop offset="100%" stopColor="rgb(14,18,24)" stopOpacity="0.85" />
                </radialGradient>
              </defs>
              <circle r={OUTER - 2} fill="url(#wheel-fill)" stroke="rgb(0,0,0)" strokeOpacity="0.7" strokeWidth="2" />
              {sectors.map((sector, index) => {
                const from = (index / sectors.length) * Math.PI * 2 - Math.PI / 2;
                const to = ((index + 1) / sectors.length) * Math.PI * 2 - Math.PI / 2;
                const point = (radius, angle) => `${Math.cos(angle) * radius} ${Math.sin(angle) * radius}`;
                const wedge = `M ${point(INNER, from)} L ${point(OUTER - 4, from)} A ${OUTER - 4} ${OUTER - 4} 0 0 1 ${point(OUTER - 4, to)} L ${point(INNER, to)} A ${INNER} ${INNER} 0 0 0 ${point(INNER, from)} Z`;
                return (
                  <path
                    key={sector.kind}
                    d={wedge}
                    fill={hover === index ? "rgba(255,255,255,0.14)" : "transparent"}
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth="1"
                  />
                );
              })}
              <circle r={INNER} fill="rgba(0,0,0,0.6)" stroke="rgba(255,255,255,0.15)" />
              {hover >= 0 && (
                <line
                  x1="0"
                  y1="0"
                  x2={Math.cos(((hover + 0.5) / sectors.length) * Math.PI * 2 - Math.PI / 2) * INNER}
                  y2={Math.sin(((hover + 0.5) / sectors.length) * Math.PI * 2 - Math.PI / 2) * INNER}
                  stroke="rgba(255,255,255,0.7)"
                  strokeWidth="2"
                />
              )}
            </svg>
            {sectors.map((sector, index) => {
              const angle = ((index + 0.5) / sectors.length) * Math.PI * 2 - Math.PI / 2;
              const radius = (INNER + OUTER) / 2 + 6;
              return (
                <span
                  key={sector.kind}
                  className={`pointer-events-none absolute w-24 -translate-x-1/2 -translate-y-1/2 text-center font-sans text-[13px] leading-tight uppercase tracking-[0.08em] transition-colors ${
                    hover === index ? "text-bone" : "text-ash"
                  }`}
                  style={{ left: Math.cos(angle) * radius, top: Math.sin(angle) * radius }}
                >
                  {LABELS[sector.kind] ?? sector.kind}
                </span>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
