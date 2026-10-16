import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
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
  Volume2,
  VolumeX,
} from "lucide-react";
import { Stage, T_POSE } from "../viewer/stage.js";
import { HERO_COLOR, formatPrice, heroPortrait, itemModels, rarity, slotName } from "../catalog.js";
import { IconButton, Popover, Select, Toggle, useDismiss } from "./ui.jsx";
import { playSound, soundsBase } from "./Voice.jsx";
import { ATTRIBUTES, abilityIcon, useGameData } from "../gamedata.js";
import { unlockSound } from "../viewer/soundPlayer.js";
import { getViewSettings, onViewSettings } from "../viewSettings.js";

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

// The standard MVP forest, offered at night: its camera is placed by the game's code, so
// ours frames the model; the light and fog are a night of our own instead of the scene's day.
const SHOWCASE = "scenes/mvp/mvp_default";
const NIGHT = {
  light: {
    color: [0.42, 0.5, 0.72],
    direction: [0.45, -0.75, 0.5],
    ambient: [
      [0.32, 0.36, 0.55],
      [0.12, 0.14, 0.24],
      [0.05, 0.05, 0.1],
    ],
  },
  fog: { color: [0.035, 0.04, 0.075], density: 0.0014 },
  points: [],
};


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
// What the game's hero pick shows under a name: the attributes in their colors with their
// gains, then damage, armor, speed and range
function HeroSummary({ catalog, heroId, language }) {
  const { data } = useGameData(catalog.modelsBase, ["heroes.json", "abilities.json"], language);
  const hero = data?.heroes[`npc_dota_hero_${heroId}`];
  if (!hero) {
    return null;
  }
  const number = (key) => Number(hero[key] ?? 0);
  // Abilities and texts may still be on their way while the heroes are in
  const known = data.abilities ?? {};
  const texts = data.texts ?? {};
  // The hero's own abilities, the way the game lists them, without hidden ones and talents
  const abilities = Array.from({ length: 9 }, (_, index) => hero[`Ability${index + 1}`]).filter(
    (name) => name && name !== "generic_hidden" && !name.startsWith("special_bonus") && known[name] && !/HIDDEN/.test(known[name].AbilityBehavior ?? "")
  );
  const primary = hero.AttributePrimary;
  const attributes = [
    ["DOTA_ATTRIBUTE_STRENGTH", "Strength", number("AttributeBaseStrength"), number("AttributeStrengthGain")],
    ["DOTA_ATTRIBUTE_AGILITY", "Agility", number("AttributeBaseAgility"), number("AttributeAgilityGain")],
    ["DOTA_ATTRIBUTE_INTELLECT", "Intelligence", number("AttributeBaseIntelligence"), number("AttributeIntelligenceGain")],
  ];
  const stats = [
    ["Damage", `${number("AttackDamageMin")}–${number("AttackDamageMax")}`],
    ["Armor", number("ArmorPhysical")],
    ["Speed", number("MovementSpeed")],
    ["Range", number("AttackRange")],
  ];
  return (
    <>
    {abilities.length > 0 && (
      <div className="pointer-events-auto mt-3 flex flex-wrap gap-2">
        {abilities.map((name) => {
          const title = texts[`DOTA_Tooltip_ability_${name}`] ?? name.replace(/_/g, " ");
          return (
            <figure key={name} className="w-[72px]" title={title}>
              <img
                src={abilityIcon(catalog.modelsBase, name, known[name])}
                alt=""
                className="mx-auto size-12 rounded-sm border border-line/80 object-cover"
                onError={(event) => (event.currentTarget.style.visibility = "hidden")}
              />
              <figcaption className="mt-1 line-clamp-2 text-center text-[11px] leading-tight text-bone/85">{title}</figcaption>
            </figure>
          );
        })}
      </div>
    )}
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      {attributes.map(([key, name, value, gain]) => (
        <span key={key} className="flex items-center gap-1.5 tabular-nums" title={name}>
          <span
            className={`size-3 rounded-full ${primary === key ? "ring-2 ring-offset-1 ring-offset-stage" : ""}`}
            style={{ background: ATTRIBUTES[key].color, "--tw-ring-color": ATTRIBUTES[key].color }}
          />
          <span className="text-bone">{value}</span>
          <span className="text-xs text-ash">+{gain}</span>
        </span>
      ))}
      <span className="h-4 w-px bg-line" aria-hidden />
      {stats.map(([label, value]) => (
        <span key={label} className="tabular-nums">
          <span className="text-ash">{label}</span> <span className="text-bone">{value}</span>
        </span>
      ))}
    </div>
    </>
  );
}

// The primary attribute and roles above a hero's name
function useHeroLine(catalog, heroId, language) {
  const { data } = useGameData(catalog.modelsBase, ["heroes.json"], language);
  const hero = heroId && data?.heroes[`npc_dota_hero_${heroId}`];
  if (!hero) {
    return null;
  }
  const attribute = ATTRIBUTES[hero.AttributePrimary] ?? ATTRIBUTES.DOTA_ATTRIBUTE_ALL;
  return { attribute, roles: (hero.Role ?? "").split(",").filter(Boolean) };
}

const MASK_HEIGHT = 100;
// The mask the game sees a hero page's scene through; used only once it has loaded, as a mask
// that fails to load would hide the whole scene
function useSceneMask(base) {
  const src = `${base}images/masks/hero_model_preview_mask_loadout_psd.png`;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const image = new Image();
    image.onload = () => setReady(true);
    image.src = src;
  }, [src]);
  if (!ready) {
    return undefined;
  }
  const url = `url(${src})`;
  // The game's scene runs under the top bar to the screen's top; ours starts below it, so the mask
  // is drawn a little shorter for its floor to fade where the game's does, the rest left dark
  const size = `100% ${MASK_HEIGHT}%`;
  return { maskImage: url, WebkitMaskImage: url, maskMode: "luminance", maskSize: size, WebkitMaskSize: size, maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat" };
}

export default function Viewer({ catalog, language, hideTitle = false, frameShift = 0, loadout = false, portrait = null, portraitShot = "default", particles = [], outfit, urls, onStyle, onAlone, onVariant, onWardrobe, onBare, onPersona }) {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const reduce = useReducedMotion();

  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [animations, setAnimations] = useState([]);
  const [current, setCurrent] = useState(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // On from the start; browsers let it play once the page has been clicked
  const [sound, setSound] = useState(true);
  useEffect(() => {
    const unlock = () => unlockSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  // A scene of the game behind the model; the pedestal by default
  const [backdrop, setBackdrop] = useState("");

  const item = outfit.focus ? catalog.itemsById[outfit.focus] : null;
  const scene = outfit.scene ? catalog.scenesById[outfit.scene] : null;
  const hero = outfit.hero ? catalog.heroesById[outfit.hero] : null;
  const color = item ? rarity(item).color : HERO_COLOR;
  const urlsKey = urls.join("|");

  useEffect(() => {
    const stage = new Stage(canvasRef.current);
    // The spawn animation hands over to idle on its own
    stage.onAnimation = (name) => setCurrent(name);
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

  useEffect(() => stageRef.current.setPaused(paused), [paused]);
  // The game's light and camera for the scene on screen
  useEffect(() => {
    // Scenes are built for their own camera: seen from anywhere else, their painted cards and
    // foreground stand in the way
    const picked = backdrop && hero ? catalog.scenesById[backdrop] : null;
    const info = scene ?? (backdrop === SHOWCASE && picked ? { ...picked, ...NIGHT } : picked);
    stageRef.current.setSceneLook(info ?? null);
  }, [scene, backdrop, hero, catalog]);

  // A scene shown on its own has no pedestal, except treasure scenes: their backgrounds
  // are particles only, so the chest stands on the pedestal instead
  useEffect(() => stageRef.current.setShowcase(!scene || scene.id.startsWith("scenes/treasure/")), [scene]);
  useEffect(() => {
    // Behind heroes only; items and couriers keep the pedestal
    stageRef.current.setBackdrop(backdrop && !scene && hero ? `${catalog.scenesBase}scenes/${backdrop}.glb` : null);
  }, [backdrop, scene, hero, catalog.scenesBase]);
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
  useEffect(() => stageRef.current.setFrameShift(frameShift), [frameShift]);
  const mask = useSceneMask(catalog.modelsBase);
  useEffect(() => stageRef.current.setLoadout(loadout), [loadout]);
  // The game's particle effects of what is on screen
  const [particlesOn, setParticlesOn] = useState(() => getViewSettings().particles);
  useEffect(() => onViewSettings((settings) => setParticlesOn(settings.particles)), []);
  const particlesKey = particlesOn ? particles.join("|") : "";
  useEffect(() => stageRef.current.setParticles(catalog.modelsBase, particlesOn ? particles : []), [particlesKey, catalog.modelsBase]);
  // The free camera of the settings, or the game's fixed one on a hero's page
  useEffect(() => {
    stageRef.current.setFreeCamera(getViewSettings().freeCamera);
    return onViewSettings((settings) => stageRef.current?.setFreeCamera(settings.freeCamera));
  }, []);
  // The game's pedestal and camera for the hero on its page
  useEffect(
    () => stageRef.current.setPortrait(loadout ? portrait : null, loadout && portrait ? `${catalog.modelsBase}${portrait.pedestal}` : null, portraitShot),
    [loadout, portrait, portraitShot, catalog.modelsBase]
  );

  // Casting and emotes from the hero page: an animation, the ability's sound, a voice line
  useEffect(() => {
    const onCast = (event) => {
      const { ability, index, sounds, lines } = event.detail;
      unlockSound();
      stageRef.current.castAbility(ability, index, sounds);
      if (lines?.length && Math.random() < 0.6) {
        playSound(soundsBase(catalog.modelsBase) + lines[Math.floor(Math.random() * lines.length)]);
      }
    };
    const onEmote = (event) => {
      const { animations, files } = event.detail;
      unlockSound();
      const name = stageRef.current.findAnimation(animations ?? []);
      if (name) {
        stageRef.current.playOnce(name);
      }
      if (files?.length) {
        playSound(soundsBase(catalog.modelsBase) + files[Math.floor(Math.random() * files.length)]);
      }
    };
    window.addEventListener("dotadex:cast", onCast);
    window.addEventListener("dotadex:emote", onEmote);
    return () => {
      window.removeEventListener("dotadex:cast", onCast);
      window.removeEventListener("dotadex:emote", onEmote);
    };
  }, [catalog.modelsBase]);

  // A hero comes in with one of its spawn lines, as in the game: fetched when the hero is
  // picked, spoken when its model shows up on the stage
  const spawnLine = useRef({ files: null, shown: false });
  useEffect(() => {
    const line = (spawnLine.current = { files: null, shown: false });
    const speak = () => {
      if (line.files?.length && line.shown && sound) {
        playSound(soundsBase(catalog.modelsBase) + line.files[Math.floor(Math.random() * line.files.length)]);
        line.files = null;
      }
    };
    stageRef.current.onShow = () => {
      line.shown = true;
      speak();
    };
    if (!sound || !hero) {
      return;
    }
    fetch(`${catalog.modelsBase}data/voices/npc_dota_hero_${hero.id}.json`)
      .then((res) => (res.ok ? res.json() : []))
      .then((lines) => {
        line.files = lines.filter((entry) => /_spawn|_respawn/.test(entry.event)).flatMap((entry) => entry.files);
        speak();
      })
      .catch(() => {});
  }, [hero?.id, outfit.persona, sound, catalog.modelsBase]);

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
        ...catalog.scenes.filter((entry) => entry.id === "scenes/mvp/mvp_default" || entry.id === SHOWCASE),
      ]
    : [];
  const changed = hero && !item ? Object.keys(outfit.slots).length : 0;
  const heroLine = useHeroLine(catalog, !item && !scene ? hero?.id : null, language);
  const subtitle = scene
    ? ["Scene", `${(scene.size / 1e6).toFixed(0)} MB`]
    : item
    ? [rarity(item).name, item.slot && slotName(item.slot), item.hero && catalog.heroNames[item.hero], formatPrice(item.price)]
    : heroLine
    ? [heroLine.attribute.name, ...heroLine.roles, changed > 0 && `${changed} ${changed === 1 ? "item" : "items"} changed`]
    : ["Hero", changed > 0 && `${changed} ${changed === 1 ? "item" : "items"} changed`];
  const downloads = scene ? [] : item ? itemModels(item, outfit.style) : hero ? [hero.model] : [];
  const styles = item?.styles;

  return (
    <section className={`${loadout ? "" : "stage-backdrop "}relative h-full overflow-hidden`} style={{ "--rim": color }}>
      {/* On a hero's page the scene is seen through the game's mask, its sides and floor fading out */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full touch-none"
        aria-label={`3D model of ${title}`}
        style={loadout ? mask : undefined}
      />

      {progress !== null && (
        <div className="absolute inset-x-0 top-0 h-[2px] bg-line/60" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
          <div className="h-full transition-[width] duration-200" style={{ width: `${Math.max(progress, 0.04) * 100}%`, background: color }} />
        </div>
      )}

      {/* Playback, outfit and view controls in one row at the bottom */}
      {/* On a hero's page they sit under the model, between the page's two columns */}
      <div
        className={`pointer-events-auto absolute flex flex-wrap items-center gap-2 ${
          loadout ? `bottom-6 ${frameShift > 0 ? "left-[24%]" : "left-1/2"} max-w-[40%] -translate-x-1/2 justify-center` : `bottom-4 left-4 ${hideTitle ? "w-[calc(55%-2rem)]" : "right-4"}`
        }`}
      >
        {animations.length > 0 && (
          <>
            <IconButton label={paused ? "Play" : "Pause"} onClick={() => setPaused(!paused)}>
              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            </IconButton>
            <AnimationPicker names={[T_POSE, ...animations]} current={current} onPick={pick} />
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

        {hero?.personas?.length > 0 && (
          <Toggle
            label="Persona"
            value={outfit.persona ?? 0}
            onChange={onPersona}
            options={[{ value: 0, label: "Default" }, ...hero.personas.map((_, index) => ({ value: index + 1, label: hero.personas.length > 1 ? `Persona ${index + 1}` : "Persona" }))]}
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

        <div className="flex items-center gap-2">
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
            <div className="ml-auto flex items-center gap-2">
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

      <div className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-stage via-stage/70 to-transparent px-5 pt-24 pb-20 sm:px-8 sm:pb-20 ${hideTitle ? "hidden" : ""}`}>
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
                <span key={part} style={index === 0 ? { color: heroLine && !item ? heroLine.attribute.color : color } : undefined} className={index === 0 ? "" : "text-ash"}>
                  {part}
                </span>
              ))}
            </p>
            <h2 className="mt-1 font-display text-4xl leading-[1.05] text-balance text-bone sm:text-5xl lg:text-6xl">{title}</h2>
            {hero && !item && !scene && <HeroSummary catalog={catalog} heroId={hero.id} language={language} />}
          </motion.div>
        </AnimatePresence>

      </div>
    </section>
  );
}
