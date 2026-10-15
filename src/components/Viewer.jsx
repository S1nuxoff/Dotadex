import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Box,
  Check,
  ChevronUp,
  Download,
  Focus,
  Link2,
  Pause,
  Play,
  RotateCw,
  Search,
  Shirt,
  Sparkles,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Stage } from "../viewer/stage.js";
import { HERO_COLOR, formatPrice, heroPortrait, itemModels, rarity, slotName } from "../catalog.js";
import { IconButton, Popover, Select, Toggle, useDismiss } from "./ui.jsx";
import { soundsBase } from "./Voice.jsx";
import { unlockSound } from "../viewer/soundPlayer.js";

// What the stage needs to play animation sounds, loaded once when sound is turned on
let soundData = null;
function loadSoundData(modelsBase) {
  soundData ??= Promise.all(
    ["animsounds.json", "animsound-events.json", "heroes.json"].map((file) =>
      fetch(`${modelsBase}data/${file}`).then((res) => (res.ok ? res.json() : {}))
    )
  ).then(([byModel, events, heroes]) => {
    const attack = {};
    for (const hero of Object.values(heroes)) {
      if (hero.Model && hero.SoundSet) {
        attack[hero.Model.toLowerCase().replace(/\.vmdl$/, ".glb")] = {
          event: `${hero.SoundSet}.Attack`,
          point: Number(hero.AttackAnimationPoint) || 0.4,
        };
      }
    }
    return { base: soundsBase(modelsBase), byModel, events, attack };
  });
  return soundData;
}

const SPEEDS = [0.5, 1, 1.5];

// ?shading=plain in the link, or the last choice on this device
function initialShading() {
  const fromLink = new URLSearchParams(window.location.search).get("shading");
  let saved = null;
  try {
    saved = localStorage.getItem("shading");
  } catch {}
  return [fromLink, saved].find((value) => value === "dota" || value === "plain") ?? "dota";
}

function AnimationPicker({ names, current, onPick }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useDismiss(open, setOpen);
  const shown = names.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex h-9 max-w-[16rem] items-center gap-2 rounded-lg border border-line bg-panel/80 px-3 text-sm text-bone hover:border-ash/50"
      >
        <span className="truncate">{current ?? "No animation"}</span>
        <span className="shrink-0 text-xs text-ash tabular-nums">{names.length}</span>
        <ChevronUp className={`size-4 shrink-0 text-ash transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
      <Popover open={open} className="bottom-11 left-0 w-72 overflow-hidden">
        <label className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <Search className="size-4 text-ash" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find an animation"
            className="w-full bg-transparent text-sm text-bone placeholder:text-ash/70 focus:outline-none"
          />
        </label>
        <ul className="max-h-72 overflow-y-auto py-1 scrollbar-thin">
          {shown.map((name) => (
            <li key={name}>
              <button
                onClick={() => {
                  onPick(name);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-raised ${
                  name === current ? "text-aegis" : "text-bone/90"
                }`}
              >
                <span className="truncate">{name}</span>
                {name === current && <Check className="size-4 shrink-0" />}
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-3 py-3 text-sm text-ash">No animation is called that.</li>}
        </ul>
      </Popover>
    </div>
  );
}

// outfit: what is on screen (see outfitFor), urls: the models to load
export default function Viewer({ catalog, outfit, urls, onStyle, onAlone, onVariant, onWardrobe, onBare }) {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const reduce = useReducedMotion();

  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [animations, setAnimations] = useState([]);
  const [current, setCurrent] = useState(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [shading, setShading] = useState(initialShading);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [sound, setSound] = useState(false);
  const [backdrop, setBackdrop] = useState("");

  const item = outfit.focus ? catalog.itemsById[outfit.focus] : null;
  const scene = outfit.scene ? catalog.scenesById[outfit.scene] : null;
  const hero = outfit.hero ? catalog.heroesById[outfit.hero] : null;
  const color = item ? rarity(item).color : HERO_COLOR;
  const urlsKey = urls.join("|");

  useEffect(() => {
    const stage = new Stage(canvasRef.current);
    stageRef.current = stage;
    return () => stage.dispose();
  }, []);

  useEffect(() => {
    stageRef.current.setRim(color);
  }, [color]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setProgress(0);
    stageRef.current
      .show(urls, (value) => !cancelled && setProgress(value))
      .then((names) => {
        if (cancelled || !names) {
          return;
        }
        setAnimations(names);
        setCurrent(stageRef.current.currentName ?? null);
        setProgress(null);
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason?.message ?? String(reason));
          setProgress(null);
        }
      });
    return () => {
      cancelled = true;
    };
    // urls change identity on every render, the key does not
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey, attempt]);

  useEffect(() => {
    stageRef.current.setShading(shading);
    try {
      localStorage.setItem("shading", shading);
    } catch {}
  }, [shading]);
  useEffect(() => stageRef.current.setPaused(paused), [paused]);
  // A scene shown on its own has no pedestal
  useEffect(() => stageRef.current.setShowcase(!scene), [scene]);
  useEffect(() => {
    stageRef.current.setBackdrop(backdrop && !scene ? `${catalog.scenesBase}scenes/${backdrop}.glb` : null);
  }, [backdrop, scene, catalog.scenesBase]);
  useEffect(() => {
    let cancelled = false;
    if (!sound) {
      stageRef.current.setSound(null);
      return;
    }
    loadSoundData(catalog.modelsBase).then((data) => !cancelled && stageRef.current.setSound(data));
    return () => {
      cancelled = true;
    };
  }, [sound, catalog.modelsBase]);
  useEffect(() => stageRef.current.setSpeed(speed), [speed]);

  const pick = (name) => {
    stageRef.current.play(name);
    setCurrent(name);
    setPaused(false);
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const title = scene ? scene.name : item ? item.name : hero?.name;
  // Showcase scenes for a hero: its own (arcanas, personas) first, then the shared ones
  const backdrops = hero
    ? [
        ...catalog.scenes.filter((entry) => entry.id.includes(`mvp_${hero.id}`)),
        ...catalog.scenes.filter((entry) => entry.id === "scenes/mvp/mvp_default"),
      ]
    : [];
  const changed = hero && !item ? Object.keys(outfit.slots).length : 0;
  const subtitle = scene
    ? ["Scene", `${(scene.size / 1e6).toFixed(0)} MB`]
    : item
    ? [rarity(item).name, item.slot && slotName(item.slot), item.hero && catalog.heroNames[item.hero], formatPrice(item.price)]
    : ["Hero", changed > 0 && `${changed} ${changed === 1 ? "item" : "items"} changed`];
  const downloads = scene ? [] : item ? itemModels(item, outfit.style) : hero ? [hero.model] : [];
  const styles = item?.styles;

  return (
    <section className="stage-backdrop relative h-full overflow-hidden" style={{ "--rim": color }}>
      <canvas ref={canvasRef} className="absolute inset-0 size-full touch-none" aria-label={`3D model of ${title}`} />

      {progress !== null && (
        <div className="absolute inset-x-0 top-0 h-[2px] bg-line/60" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
          <div className="h-full transition-[width] duration-200" style={{ width: `${Math.max(progress, 0.04) * 100}%`, background: color }} />
        </div>
      )}

      <div className="absolute top-4 right-4 flex items-center gap-2">
        <Toggle
          label="Shading"
          value={shading}
          onChange={setShading}
          options={[
            { value: "dota", label: "Dota", icon: <Sparkles className="size-3.5" /> },
            { value: "plain", label: "Plain", icon: <Box className="size-3.5" /> },
          ]}
        />
        <IconButton label={sound ? "Mute animation sounds" : "Play animation sounds"} onClick={() => {
            unlockSound();
            setSound(!sound);
          }} active={sound}>
          {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
        </IconButton>
        <IconButton label="Fit to view" onClick={() => stageRef.current.frameModel()}>
          <Focus className="size-4" />
        </IconButton>
        <IconButton label={copied ? "Link copied" : "Copy link"} onClick={copyLink} active={copied}>
          {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
        </IconButton>
        {hero && onWardrobe && (
          <IconButton label="Wardrobe" onClick={onWardrobe}>
            <Shirt className="size-4" />
          </IconButton>
        )}
      </div>

      {error && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="max-w-sm rounded-xl border border-line bg-panel p-5">
            <p className="text-bone">This model did not load.</p>
            <p className="mt-1 text-sm text-ash">{error}</p>
            <button
              onClick={() => setAttempt(attempt + 1)}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-raised px-3 py-2 text-sm text-bone hover:bg-line"
            >
              <RotateCw className="size-4" /> Load again
            </button>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-stage via-stage/70 to-transparent px-5 pt-24 pb-5 sm:px-8 sm:pb-7">
        <AnimatePresence mode="wait">
          <motion.div
            key={item ? `item/${item.id}` : `hero/${hero?.id}`}
            initial={reduce ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-3xl"
          >
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {subtitle.filter(Boolean).map((part, index) => (
                <span key={part} style={index === 0 ? { color } : undefined} className={index === 0 ? "" : "text-ash"}>
                  {part}
                </span>
              ))}
            </p>
            <h2 className="mt-1 font-display text-4xl leading-[1.05] text-balance text-bone sm:text-5xl lg:text-6xl">{title}</h2>
          </motion.div>
        </AnimatePresence>

        <div className="pointer-events-auto mt-5 flex flex-wrap items-center gap-2">
          {animations.length > 0 && (
            <>
              <IconButton label={paused ? "Play" : "Pause"} onClick={() => setPaused(!paused)}>
                {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              </IconButton>
              <AnimationPicker names={animations} current={current} onPick={pick} />
              <Toggle label="Animation speed" value={speed} onChange={setSpeed} options={SPEEDS.map((value) => ({ value, label: `${value}×` }))} />
            </>
          )}

          {backdrops.length > 0 && (
            <Select
              label="Scene"
              value={backdrop}
              onChange={setBackdrop}
              up
              className="w-44"
              options={[{ value: "", label: "Pedestal" }, ...backdrops.map((entry) => ({ value: entry.id, label: entry.name, hint: `${(entry.size / 1e6).toFixed(0)} MB` }))]}
            />
          )}

          {hero && !item && (
            <Toggle
              label="Outfit"
              value={outfit.bare ? "bare" : "dressed"}
              onChange={(value) => onBare(value === "bare")}
              options={[
                { value: "dressed", label: "Dressed" },
                { value: "bare", label: "Bare model" },
              ]}
            />
          )}

          {styles && (
            <Toggle
              label="Style"
              value={outfit.style ?? 0}
              onChange={onStyle}
              options={styles.map((style, index) => ({
                value: index,
                label: `Style ${index + 1}`,
                disabled: style.missing,
                title: style.missing ? "This style's model is not exported yet" : undefined,
              }))}
            />
          )}

          {item?.hero && catalog.heroesById[item.hero] && (
            <Toggle
              label="Show the item"
              value={!outfit.hero ? "alone" : "hero"}
              onChange={(value) => onAlone(value === "alone")}
              options={[
                {
                  value: "hero",
                  label: `On ${catalog.heroNames[item.hero]}`,
                  icon: <img src={heroPortrait(catalog.heroesById[item.hero])} alt="" className="h-4 w-7 rounded-sm object-cover" />,
                },
                { value: "alone", label: "Alone" },
              ]}
            />
          )}

          {item?.kind === "courier" && !outfit.hero && item.models.length > 1 && (
            <Toggle
              label="Courier form"
              value={(outfit.variant ?? 0) % item.models.length}
              onChange={onVariant}
              options={item.models.map((model, index) => ({ value: index, label: /flying/.test(model) ? "Flying" : "Ground" }))}
            />
          )}

          <div className="ml-auto flex items-center gap-2">
            {downloads.map((model) => (
              <a
                key={model}
                href={catalog.modelsBase + model}
                download
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-panel/80 px-3 text-sm text-ash hover:text-bone"
                title={model}
              >
                <Download className="size-4" />
                {downloads.length > 1 ? model.split("/").pop() : "Download GLB"}
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
