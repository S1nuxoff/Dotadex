import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { HERO_COLOR, formatPrice, heroPortrait, itemModels, rarity, slotName, wornOnHero } from "../catalog.js";
import { GAME_BUTTON, GamePills, IconButton, Popover, Select, Toggle, useDismiss } from "./ui.jsx";
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

function AnimationPicker({ names, current, onPick, game = false, speed, speeds = [], onSpeed }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useDismiss(open, setOpen);
  const shown = names.filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()));
  if (game) {
    // The game's DropDown (a dark gradient, a 2px edge, 18 labels) and its menu in #3d4448
    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="Animation"
          title="Animation"
          data-sound="click"
          className="flex h-[34px] w-[240px] items-center border-2 border-[#5e686966] bg-gradient-to-b from-[#292e2e] to-[#191e1e] px-[8px] text-left shadow-[0_0_1px_3px_#00000055] hover:from-[#393e3e] hover:to-[#292e2e]"
        >
          <span className={`ml-[6px] flex-1 truncate text-[18px] ${open ? "text-white" : "text-[#b0bcc2]"}`}>{current ?? "No animation"}</span>
          <span className="mr-[6px] text-[14px] text-[#8b989e] tabular-nums">{names.length}</span>
          <ChevronUp className={`size-[18px] shrink-0 text-[#b0bcc2] ${open ? "" : "rotate-180"}`} />
        </button>
        {open && (
          <div className="absolute bottom-full left-0 z-30 mb-[4px] w-[320px] bg-[#3d4448] shadow-[0_0_6px_#00000066]">
            {/* The playback speed, in the menu's own rows */}
            {speeds.length > 0 && (
              <div role="group" aria-label="Animation speed" className="flex border-b border-black/40">
                {speeds.map((value) => (
                  <button
                    key={value}
                    onClick={() => onSpeed(value)}
                    data-sound="click"
                    aria-pressed={speed === value}
                    className={`flex-1 pt-[6px] pb-[2px] text-[18px] tabular-nums hover:bg-[#585e62] ${speed === value ? "bg-[#585e62] text-white" : "text-white/60"}`}
                  >
                    {value}×
                  </button>
                ))}
              </div>
            )}
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find an animation"
              className="w-full border-b border-black/40 bg-[#2a2f33] px-[16px] py-[8px] text-[18px] text-white outline-none placeholder:text-white/40"
            />
            <ul className="max-h-[444px] overflow-y-auto scrollbar-thin">
              {shown.map((name) => (
                <li key={name}>
                  <button
                    onClick={() => {
                      onPick(name);
                      setOpen(false);
                    }}
                    className={`w-full truncate border-y border-black/40 pt-[6px] pb-[2px] pl-[16px] text-left text-[18px] hover:bg-[#585e62] ${name === current ? "text-white" : "text-white/60"}`}
                  >
                    {name}
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li className="px-[16px] py-[8px] text-[18px] text-white/40">No animation is called that.</li>}
            </ul>
          </div>
        )}
      </div>
    );
  }

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

// The mask the game sees a hero page's scene through; used only once it has loaded, as a mask
// that fails to load would hide the whole scene
function useSceneMask(base, armory) {
  const src = `${base}images/masks/${armory ? "hero_model_preview_mask_psd" : "hero_model_preview_mask_loadout_psd"}.png`;
  const [ready, setReady] = useState(null);
  useEffect(() => {
    const image = new Image();
    image.onload = () => setReady(src);
    image.src = src;
  }, [src]);
  if (ready !== src) {
    return undefined;
  }
  const url = `url(${src})`;
  // The game stretches it over #HeroSceneGroup: the whole screen's height, at most 1920 of its
  // 1080-high layout wide, centred (the mask is the texture's alpha, the PNG's grey). Our canvas
  // starts below the top bar and ends at the screen's bottom, so the mask is sized by the screen
  // and set to the bottom, its top cut off as the bar covers it; past its sides the scene is hidden.
  // The Armory's (#CollectionSceneBody) is 30 below the screen's top and 50 above its bottom, its
  // group moved 600 right.
  const unit = "100vh / 1080";
  const size = armory ? `min(100%, calc(100vh * 1920 / 1080)) calc(${unit} * 1000)` : "min(100%, calc(100vh * 1920 / 1080)) 100vh";
  const position = armory ? `calc(50% + ${unit} * 600) calc(${unit} * -31)` : "center bottom";
  return {
    maskImage: url,
    WebkitMaskImage: url,
    maskMode: "luminance",
    maskSize: size,
    WebkitMaskSize: size,
    maskPosition: position,
    WebkitMaskPosition: position,
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
  };
}

export default function Viewer({ catalog, language, hideTitle = false, frameShift = 0, loadout = false, armory = false, portrait = null, portraitShot = "default", particles = [], outfit, urls, onStyle, onAlone, onVariant, onWardrobe, onBare, onPersona }) {
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

  useEffect(() => {
    stageRef.current.setPaused(paused);
  }, [paused]);
  // The game's light and camera for a scene of the Scenes section
  useEffect(() => {
    stageRef.current.setSceneLook(scene ?? null);
  }, [scene]);

  // A scene shown on its own has no pedestal, except treasure scenes: their backgrounds
  // are particles only, so the chest stands on the pedestal instead
  useEffect(() => {
    stageRef.current.setShowcase(!scene || scene.id.startsWith("scenes/treasure/"));
  }, [scene]);
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
  useEffect(() => {
    stageRef.current.setSpeed(speed);
  }, [speed]);
  useEffect(() => {
    stageRef.current.setFrameShift(frameShift);
  }, [frameShift]);
  const mask = useSceneMask(catalog.modelsBase, armory);
  // The hero page's row of buttons, once it is on the page
  const [gameSlot, setGameSlot] = useState(null);
  useEffect(() => {
    const slot = loadout && !armory ? document.getElementById("hero-model-controls") : null;
    if (slot !== gameSlot) {
      setGameSlot(slot);
    }
  });
  const [freeCamera, setFreeCamera] = useState(() => getViewSettings().freeCamera);
  useEffect(() => onViewSettings((settings) => setFreeCamera(settings.freeCamera)), []);
  // Everything but a scene of the Scenes section stands in the game's loadout scene (its pedestal
  // and light); off the hero page the model is framed by us, the game's cameras being the page's
  const staged = !scene;
  useEffect(() => {
    stageRef.current.setLoadout(staged);
  }, [staged]);
  // The game's particle effects of what is on screen
  const [particlesOn, setParticlesOn] = useState(() => getViewSettings().particles);
  useEffect(() => onViewSettings((settings) => setParticlesOn(settings.particles)), []);
  const particlesKey = particlesOn ? particles.map((effect) => `${effect.system}${effect.snapshots ? JSON.stringify(effect.snapshots) : ""}`).join("|") : "";
  useEffect(() => {
    stageRef.current.setParticles(catalog.modelsBase, particlesOn ? particles : [], particlesOn);
  }, [particlesKey, particlesOn, catalog.modelsBase]);
  // The free camera of the settings, or the game's fixed one on a hero's page
  useEffect(() => {
    stageRef.current.setFreeCamera(getViewSettings().freeCamera);
    return onViewSettings((settings) => stageRef.current?.setFreeCamera(settings.freeCamera));
  }, []);
  // The logo carved into the pedestal, unless turned off in the settings
  useEffect(() => {
    stageRef.current.setWatermark(getViewSettings().watermark);
    return onViewSettings((settings) => stageRef.current?.setWatermark(settings.watermark));
  }, []);
  // The hero's size on its page, as the game takes it: LoadoutScale, else ModelScale
  const { data: heroData } = useGameData(catalog.modelsBase, ["heroes.json"]);
  const heroEntry = outfit?.hero ? heroData?.heroes?.[`npc_dota_hero_${outfit.hero}`] : null;
  const heroScale = Number(heroEntry?.LoadoutScale ?? heroEntry?.ModelScale ?? 1);
  useEffect(() => {
    stageRef.current.setHeroScale(heroScale);
  }, [heroScale]);
  // The game's pedestal, light and (on the hero page) camera
  const staging = staged && portrait ? (loadout ? portrait : { ...portrait, cameras: {} }) : null;
  useEffect(
    () => stageRef.current.setPortrait(staging, staging ? `${catalog.modelsBase}${staging.pedestal}` : null, portraitShot),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [staged, loadout, portrait, portraitShot, catalog.modelsBase]
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

      {/* On the hero page the model's controls join the game's row of buttons in the left column */}
      {gameSlot &&
        createPortal(
          <>
            {animations.length > 0 && (
              <>
                <AnimationPicker game names={[T_POSE, ...animations]} current={current} onPick={pick} speed={speed} speeds={SPEEDS} onSpeed={setSpeed} />
                <button onClick={() => setPaused(!paused)} data-sound="click" aria-label={paused ? "Play" : "Pause"} title={paused ? "Play" : "Pause"} className={GAME_BUTTON}>
                  {paused ? <Play className="mx-[4px] size-[20px]" /> : <Pause className="mx-[4px] size-[20px]" />}
                </button>
              </>
            )}
            {hero && !item && (
              <GamePills
                label="Outfit"
                value={outfit.bare ? "bare" : "dressed"}
                onChange={(value) => onBare(value === "bare")}
                options={[
                  { value: "dressed", label: "Dressed" },
                  { value: "bare", label: "Bare" },
                ]}
              />
            )}
            {downloads.map((model) => (
              <a key={model} href={catalog.modelsBase + model} download title={model} data-sound="click" className={GAME_BUTTON}>
                <Download className="mr-[8px] size-[20px]" />
                {downloads.length > 1 ? model.split("/").pop() : "GLB"}
              </a>
            ))}
            {freeCamera && (
              <button onClick={() => stageRef.current.frameModel()} data-sound="click" aria-label="Fit to view" title="Fit to view" className={GAME_BUTTON}>
                <Focus className="mx-[4px] size-[20px]" />
              </button>
            )}
          </>,
          gameSlot
        )}

      {/* Playback, outfit and view controls in one row at the bottom */}
      {/* On a hero's page they sit under the model, between the page's two columns */}
      <div
        hidden={loadout && !armory}
        className={`viewer-controls pointer-events-auto absolute flex flex-wrap items-center gap-2 ${
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

        {/* The hero page has the game's own persona switch over EQUIPPED */}
        {hero?.personas?.length > 0 && !loadout && (
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

        {item?.hero && catalog.heroesById[item.hero] && wornOnHero(item.slot) && (
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
        {/* The hero page goes without the sound and link buttons, as the game's has none */}
        {!loadout && (
          <IconButton label={sound ? "Mute animation sounds" : "Play animation sounds"} onClick={() => {
              unlockSound();
              setSound(!sound);
            }} active={sound}>
            {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          </IconButton>
        )}
        <IconButton label="Fit to view" onClick={() => stageRef.current.frameModel()}>
          <Focus className="size-4" />
        </IconButton>
        {!loadout && (
          <IconButton label={copied ? "Link copied" : "Copy link"} onClick={copyLink} active={copied}>
            {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
          </IconButton>
        )}
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
