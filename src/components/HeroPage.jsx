import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Minimize2, X } from "lucide-react";
import { abilityIcon, useGameData } from "../gamedata.js";
import { GAME_BUTTON, useUiLayout } from "./ui.jsx";
import HeroInfo from "./HeroInfo.jsx";
import Voice from "./Voice.jsx";
import ChatWheel from "./ChatWheel.jsx";
import { fetchData } from "../fetchData.js";

// Which sound and voice lines go with each ability (abilitysounds.json), loaded once
let abilitySounds = null;
function loadAbilitySounds(modelsBase) {
  abilitySounds ??= fetchData(`${modelsBase}data/abilitysounds.json`)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));
  return abilitySounds;
}

// The keys the game casts with: the ultimate on R, the others on Q W E, then D F
function castKeys(abilities, known) {
  const keys = {};
  const basic = ["Q", "W", "E", "D", "F"];
  let next = 0;
  for (const name of abilities) {
    keys[name] = /ULTIMATE/.test(known[name]?.AbilityType ?? "")
      ? "R"
      : basic[next++];
  }
  return keys;
}

// The abilities cast from the keyboard: not the innate, not hidden ones
function castable(info, known) {
  return Array.from(
    { length: 9 },
    (_, index) => info[`Ability${index + 1}`],
  ).filter(
    (name) =>
      name &&
      name !== "generic_hidden" &&
      !name.startsWith("special_bonus") &&
      known[name] &&
      known[name].Innate !== "1" &&
      !/HIDDEN/.test(known[name].AbilityBehavior ?? ""),
  );
}

// A hero's page as the game has it now (dashboard_page_hero_new_v2): the hero's backdrop, the
// model in the middle; on the left its name, attribute, complexity, attack type and tags, its
// abilities and stats; on the right what it wears. Sizes are the game's, on a 1080 high screen.

const TABS = [
  ["loadout", "Loadout"],
  ["voice", "Voice"],
  ["stats", "Stats"],
  ["about", "About"],
];

// The game's numbers for what each point of an attribute gives
const HEALTH_PER_STRENGTH = 22;
const HEALTH_REGEN_PER_STRENGTH = 0.1;
const MANA_PER_INTELLIGENCE = 12;
const MANA_REGEN_PER_INTELLIGENCE = 0.05;
const ARMOR_PER_AGILITY = 1 / 6;
const UNIVERSAL_DAMAGE = 0.45;

const ATTRIBUTES = {
  DOTA_ATTRIBUTE_STRENGTH: "strength",
  DOTA_ATTRIBUTE_AGILITY: "agility",
  DOTA_ATTRIBUTE_INTELLECT: "intelligence",
  DOTA_ATTRIBUTE_ALL: "all",
};
// The columns' distance from the content's sides by the screen's shape
const SIDE = { "16x10": 60, "21x9": 0 };

const image = (base, path) => `${base}images/${path}.png`;
const mask = (url) => ({
  mask: `url(${url}) center / contain no-repeat`,
  WebkitMask: `url(${url}) center / contain no-repeat`,
});

// Which backdrop each hero has, loaded once
let backgrounds = null;
function loadBackgrounds(base) {
  backgrounds ??= fetchData(`${base}data/loadout_backgrounds.json`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  return backgrounds;
}

// The picture behind the hero as the game's hero page draws it (dashboard_page_hero_new_v2 and
// hero_loadout_background_images stylesheets): over the whole screen, the hero's gradient with its
// backdrop picture (16:9, as high as the screen, at most 1920 wide) at 0.3 opacity, blurred 6 and
// at 0.4 saturation, tinted by its wash color, through the picture's mask; DarkEdges over that; the
// whole at 1.3 saturation, blurred 6 again, 1.04 times larger.
// Panorama composites in linear color (its shaders take textures and blend layers in linear
// space), which a browser's CSS cannot, so it is worked out here in a canvas, small, as everything
// in it is blurred. Checked on game screenshots (Sniper, Disruptor): linear blending with the wash
// multiplying (tinting) the picture matches the game where only the backdrop shows; the sRGB,
// laid-over version was twice as far off.
const BACKDROP_WIDTH = 480;
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => toLinear(i / 255));
// #rrggbb or #rrggbbaa to linear [r, g, b] and its alpha
const hexColor = (hex) => {
  const v = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return { rgb: [toLinear(v(1)), toLinear(v(3)), toLinear(v(5))], alpha: hex.length > 7 ? v(7) : 1 };
};

function loadImage(url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

// The bytes of a w × h canvas with an image drawn at x, y, dw × dh
function pixels(image, w, h, x, y, dw, dh) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, x, y, dw, dh);
  return context.getImageData(0, 0, w, h).data;
}

// Gaussian blur of an RGB float image (3 floats a pixel) in place, edges held
function blurRgb(data, w, h, sigma) {
  if (sigma < 0.3) {
    return;
  }
  const r = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-0.5 * ((i - r) / sigma) ** 2));
  const total = kernel.reduce((a, b) => a + b, 0);
  const copy = new Float32Array(data.length);
  const pass = (count, length, at) => {
    for (let line = 0; line < count; line++) {
      for (let i = 0; i < length; i++) {
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let k = -r; k <= r; k++) {
          const o = at(line, Math.min(length - 1, Math.max(0, i + k)));
          const weight = kernel[k + r];
          red += copy[o] * weight;
          green += copy[o + 1] * weight;
          blue += copy[o + 2] * weight;
        }
        const o = at(line, i);
        data[o] = red / total;
        data[o + 1] = green / total;
        data[o + 2] = blue / total;
      }
    }
  };
  copy.set(data);
  pass(h, w, (y, x) => (y * w + x) * 3);
  copy.set(data);
  pass(w, h, (x, y) => (y * w + x) * 3);
}

// Saturation towards or away from the luminance (0.2126, 0.7152, 0.0722)
function saturate(data, amount) {
  for (let o = 0; o < data.length; o += 3) {
    const luma = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    data[o] = luma + amount * (data[o] - luma);
    data[o + 1] = luma + amount * (data[o + 1] - luma);
    data[o + 2] = luma + amount * (data[o + 2] - luma);
  }
}

// The backdrop for a screen of w × h pixels, drawn into canvas
function drawBackdrop(canvas, w, h, look, picture, mask) {
  const rw = Math.min(BACKDROP_WIDTH, w);
  const rh = Math.max(1, Math.round((h * rw) / w));
  // one pixel of the game's 1080-high layout, in this picture's pixels
  const unit = rh / 1080;
  // Panorama's blur: gaussian(6px) records (6 + 6) × passes × 0.8 = 9.6 for its blur pass
  // (panorama.dll 0x1801c2a42), whose kernel weighs exp(-0.5 (i / (9.6 / 2))²) (0x180072f10):
  // a standard deviation of 4.8 pixels of the screen, not scaled with the layout
  const blurSigma = (0.8 * (6 + 6) * 0.5 * rh) / (h * (window.devicePixelRatio || 1));
  const out = new Float32Array(rw * rh * 3);
  // The hero's gradient, top to bottom
  const from = hexColor(look?.from ?? "#1b1f2a").rgb;
  const to = hexColor(look?.to ?? "#0d0e12").rgb;
  for (let y = 0; y < rh; y++) {
    const t = rh > 1 ? y / (rh - 1) : 0;
    for (let x = 0; x < rw; x++) {
      const o = (y * rw + x) * 3;
      for (let i = 0; i < 3; i++) {
        out[o + i] = from[i] + (to[i] - from[i]) * t;
      }
    }
  }
  if (picture) {
    // #HeroLoadoutBackgroundImage: as high as the screen, at most 1920 wide, centred; the picture
    // contained in it, the mask stretched over it
    const ew = Math.min(rw, 1920 * unit);
    const ex = (rw - ew) / 2;
    const fit = Math.min(ew / picture.width, rh / picture.height);
    const pw = picture.width * fit;
    const ph = picture.height * fit;
    const bytes = pixels(picture, rw, rh, ex + (ew - pw) / 2, (rh - ph) / 2, pw, ph);
    const maskBytes = mask ? pixels(mask, rw, rh, ex, 0, ew, rh) : null;
    const layer = new Float32Array(rw * rh * 3);
    const cover = new Float32Array(rw * rh);
    for (let i = 0; i < rw * rh; i++) {
      layer[i * 3] = LINEAR[bytes[i * 4]];
      layer[i * 3 + 1] = LINEAR[bytes[i * 4 + 1]];
      layer[i * 3 + 2] = LINEAR[bytes[i * 4 + 2]];
      // where the picture is drawn, times the mask (its grey is the game texture's alpha)
      cover[i] = (bytes[i * 4 + 3] / 255) * (maskBytes ? maskBytes[i * 4] / 255 : 1);
    }
    blurRgb(layer, rw, rh, blurSigma);
    saturate(layer, 0.4);
    // wash-color tints: the picture times white moved towards the color by its alpha
    const wash = look.wash ? hexColor(look.wash) : null;
    const tint = wash ? wash.rgb.map((c) => 1 - wash.alpha + c * wash.alpha) : [1, 1, 1];
    for (let i = 0; i < rw * rh; i++) {
      const a = 0.3 * cover[i];
      for (let k = 0; k < 3; k++) {
        out[i * 3 + k] = out[i * 3 + k] * (1 - a) + layer[i * 3 + k] * tint[k] * a;
      }
    }
  }
  // DarkEdges: black over by a radial gradient at the middle, radii 80% × 100%, clear to 0.2
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const d = Math.hypot((x / rw - 0.5) / 0.8, y / rh - 0.5);
      const keep = 1 - Math.min(1, Math.max(0, (d - 0.2) / 0.8));
      const o = (y * rw + x) * 3;
      out[o] *= keep;
      out[o + 1] *= keep;
      out[o + 2] *= keep;
    }
  }
  saturate(out, 1.3);
  blurRgb(out, rw, rh, blurSigma);
  canvas.width = rw;
  canvas.height = rh;
  const context = canvas.getContext("2d");
  const image = context.createImageData(rw, rh);
  for (let i = 0; i < rw * rh; i++) {
    image.data[i * 4] = Math.round(toSrgb(out[i * 3]) * 255);
    image.data[i * 4 + 1] = Math.round(toSrgb(out[i * 3 + 1]) * 255);
    image.data[i * 4 + 2] = Math.round(toSrgb(out[i * 3 + 2]) * 255);
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

export function Backdrop({ base, heroId }) {
  const canvasRef = useRef(null);
  // The colors alone over the picture as it comes, fading out
  const previousRef = useRef(null);
  const drawnKey = useRef(null);
  const [all, setAll] = useState(null);
  const [images, setImages] = useState({ key: null, picture: null, mask: null });
  const [screen, setScreen] = useState(() => [window.innerWidth, window.innerHeight]);
  useEffect(() => {
    loadBackgrounds(base).then(setAll);
  }, [base]);
  useEffect(() => {
    let timer;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setScreen([window.innerWidth, window.innerHeight]), 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  const look = all?.heroes[heroId];
  const key = all ? `${look?.image ?? ""}|${all.mask ?? ""}` : null;
  useEffect(() => {
    if (!key) {
      return;
    }
    let current = true;
    Promise.all([
      look?.image ? loadImage(`${base}${look.image}`) : null,
      look?.image && all.mask ? loadImage(`${base}${all.mask}`) : null,
    ]).then(([picture, mask]) => current && setImages({ key, picture, mask }));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, base]);
  useEffect(() => {
    if (!canvasRef.current || !all) {
      return;
    }
    // As the game's page: the next hero's colors at once (its class sets the gradient), its picture
    // over them once loaded (an Image panel shows when its texture has come), fading in here
    const ready = images.key === key;
    const state = `${heroId}|${ready ? "picture" : "colors"}`;
    const previous = previousRef.current;
    if (ready && drawnKey.current === `${heroId}|colors` && previous) {
      previous.width = canvasRef.current.width;
      previous.height = canvasRef.current.height;
      previous.getContext("2d").drawImage(canvasRef.current, 0, 0);
      previous.style.transition = "none";
      previous.style.opacity = "1";
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          previous.style.transition = "opacity 0.3s ease-out";
          previous.style.opacity = "0";
        })
      );
    }
    drawnKey.current = state;
    try {
      drawBackdrop(canvasRef.current, screen[0], screen[1], look, ready ? images.picture : null, ready ? images.mask : null);
    } catch {
      // a picture the browser will not let the page read: the gradient alone
      drawBackdrop(canvasRef.current, screen[0], screen[1], look, null, null);
    }
  }, [all, look, images, key, screen, heroId]);
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0d0e12]">
      {/* The game's panel covers the screen, under its top bar too; the page ends at the screen's bottom */}
      <canvas
        ref={canvasRef}
        className="absolute inset-x-0 bottom-0 h-[100vh] w-full"
        style={{ transform: "scale(1.04)" }}
      />
      <canvas
        ref={previousRef}
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[100vh] w-full"
        style={{ transform: "scale(1.04)", opacity: 0 }}
      />
    </div>
  );
}

// The name on one line (TitleExtraLarge: the title font, bold, 52, 1.5 letter spacing), made
// smaller when it is too long for 95% of its 660 wide panel, as the game shrinks it
const NAME_SIZE = 52;
const NAME_SPACING = 1.5;
const NAME_WIDTH = 660 * 0.95;
// The title font's width of a text at the name's full size, measured off the page so its zoom
// and layout play no part; the letter spacing added
function nameWidth(name) {
  const context = (nameWidth.canvas ??=
    document.createElement("canvas")).getContext("2d");
  context.font = `700 ${NAME_SIZE}px Reaver, Radiance, sans-serif`;
  const text = name.toUpperCase();
  return context.measureText(text).width + text.length * NAME_SPACING;
}

function HeroName({ name }) {
  const fit = () =>
    Math.min(NAME_SIZE, (NAME_SIZE * NAME_WIDTH) / nameWidth(name));
  const [size, setSize] = useState(fit);
  useEffect(() => {
    let current = true;
    setSize(fit());
    // Measured again once the title font is in, as it is wider than the one standing in for it
    document.fonts
      ?.load(`700 ${NAME_SIZE}px Reaver`)
      .then(() => current && setSize(fit()));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  return (
    <h1 className="flex h-[75px] w-[660px] items-center">
      <span
        className="shrink-0 font-display leading-none font-bold tracking-[1.5px] whitespace-nowrap text-white uppercase"
        style={{ fontSize: size }}
      >
        {name}
      </span>
    </h1>
  );
}

// LabelMedium in LightestGrey at half opacity
function Label({ children }) {
  return (
    <span className="text-[16px] leading-[20px] tracking-[1px] text-[#dae2e5]/50 uppercase">
      {children}
    </span>
  );
}

// ButtonPrimary DarkGrey with an icon
function DarkButton({ label, onClick, children }) {
  return (
    <button onClick={onClick} data-sound="click" aria-label={label} title={label} className={GAME_BUTTON}>
      {children}
    </button>
  );
}

function HeroSummary({ catalog, hero, info, data, onAbout, onCast, onPreview }) {
  const base = catalog.modelsBase;
  const roles = (info?.Role ?? "").split(",").filter(Boolean);
  const ranged = (info?.AttackCapabilities ?? "").includes("RANGED");
  const complexity = Number(info?.Complexity ?? 1);
  const known = data?.abilities ?? {};
  const texts = data?.texts ?? {};
  const innate = info
    ? Array.from(
        { length: 9 },
        (_, index) => info[`Ability${index + 1}`],
      ).filter((name) => name && known[name]?.Innate === "1")
    : [];
  const abilities = info ? castable(info, known) : [];
  const keys = castKeys(abilities, known);
  const attribute = ATTRIBUTES[info?.AttributePrimary] ?? "all";
  const ability = (name, round) => {
    const title =
      texts[`DOTA_Tooltip_ability_${name}`] ?? name.replace(/_/g, " ");
    const key = keys[name];
    return (
      <button
        key={name}
        onClick={() => !round && onCast(name)}
        title={`${title}${key ? ` (${key})` : ""}`}
        className="group mr-[8px] mb-[8px] size-[52px]"
      >
        <img
          src={abilityIcon(base, name, known[name])}
          alt=""
          className={`size-full object-cover shadow-[0_4px_8px_#000] transition group-hover:brightness-125 group-active:scale-95 ${round ? "rounded-full border-2 border-[#5c6470]" : ""}`}
          onError={(event) => (event.currentTarget.style.visibility = "hidden")}
        />
      </button>
    );
  };

  return (
    <div>
      <HeroName name={hero.name} />
      {/* Attribute, complexity, attack type and tags in one row */}
      <div className="mt-[4px] mb-[2px] flex items-center">
        <img
          src={image(
            base,
            `primary_attribute_icons/primary_attribute_icon_${attribute}_psd`,
          )}
          alt=""
          title={attribute}
          className="mr-[12px] size-[32px]"
        />
        {/* The game's pips, 20 square at 90%, washed #dedede */}
        <span className="mr-[8px] flex items-center" title={`Complexity ${complexity}`}>
          {[1, 2, 3].map((level) => (
            <span
              key={level}
              className="mr-[2px] size-[20px] bg-[length:90%] bg-center bg-no-repeat brightness-[0.87]"
              style={{
                backgroundImage: `url(${image(base, `hero_complexity_${level <= complexity ? "full" : "empty"}_png`)})`,
              }}
            />
          ))}
        </span>
        <span className="mr-[16px] flex items-center">
          <Label>Attack Type:</Label>
          <span
            title={ranged ? "Ranged" : "Melee"}
            className="-mr-[2px] size-[30px] bg-[#8b989e] hover:bg-[#b0bcc2]"
            style={mask(
              image(
                base,
                `control_icons/filter_${ranged ? "ranges" : "melee"}_png`,
              ),
            )}
          />
        </span>
        <span className="flex items-center">
          <Label>Tags:</Label>
          <span className="flex">
            {roles.map((role) => (
              <span
                key={role}
                title={role}
                className="-mr-[2px] size-[30px] bg-[#8b989e] hover:bg-[#b0bcc2]"
                style={mask(
                  image(base, `control_icons/filter_${role.toLowerCase()}_png`),
                )}
              />
            ))}
          </span>
        </span>
      </div>
      {/* The talent tree, the innate, the abilities, then Aghanim's: 12 below the row less the
          actions' 5, and 12 above the stats */}
      <div className="mt-[7px] mb-[12px] flex flex-wrap items-center">
        <button
          onClick={onAbout}
          data-sound="click"
          title="Talents"
          className="mr-[8px] mb-[8px] size-[52px]"
        >
          <img
            src={`${import.meta.env.BASE_URL}ui/talents.svg`}
            alt=""
            className="size-full object-contain opacity-80 hover:opacity-100"
          />
        </button>
        {innate.map((name) => ability(name, true))}
        {abilities.map((name) => ability(name, false))}
        <button
          onClick={onAbout}
          data-sound="click"
          title="Aghanim's Scepter and Shard"
          className="mr-[8px] mb-[8px] size-[52px]"
        >
          <img
            src={`${import.meta.env.BASE_URL}ui/aghs_off_large.png`}
            alt=""
            className="size-full object-contain p-[4px] opacity-80 hover:opacity-100"
          />
        </button>
        <ChatWheel modelsBase={base} heroId={hero.id} />
      </div>
      {info && <StatsSummary base={base} info={info} />}
      {/* The full screen button; the game's demo button beside it has nothing to open here */}
      <div className="mt-[24px] flex">
        <DarkButton label="Fullscreen hero" onClick={onPreview}>
          {/* The game's control_icons/24px/full_screen, 20 square, washed LightestGrey */}
          <span
            className="mx-[4px] size-[20px] bg-[#dae2e5] drop-shadow-[0_1px_4px_rgb(0_0_0/0.3)]"
            style={mask(`${base}images/control_icons/24px/full_screen.svg`)}
          />
        </DarkButton>
      </div>
    </div>
  );
}

// Attributes on the left; damage, armor, speed, attack time and speed, range, then health and
// mana at level 1, as the game works them out from the attributes
function StatsSummary({ base, info }) {
  const number = (key, fallback = 0) => Number(info[key] ?? fallback);
  const strength = number("AttributeBaseStrength");
  const agility = number("AttributeBaseAgility");
  const intelligence = number("AttributeBaseIntelligence");
  const bonus =
    {
      DOTA_ATTRIBUTE_STRENGTH: strength,
      DOTA_ATTRIBUTE_AGILITY: agility,
      DOTA_ATTRIBUTE_INTELLECT: intelligence,
    }[info.AttributePrimary] ??
    Math.floor((strength + agility + intelligence) * UNIVERSAL_DAMAGE);
  const round = (value) => Math.round(value * 10) / 10;
  const derived = [
    [
      "icon_damage_psd",
      "Damage",
      `${number("AttackDamageMin") + bonus} - ${number("AttackDamageMax") + bonus}`,
    ],
    [
      "icon_armor_psd",
      "Armor",
      round(number("ArmorPhysical") + agility * ARMOR_PER_AGILITY),
    ],
    ["icon_speed_psd", "Movement Speed", number("MovementSpeed")],
    // hero_stat_icons: BaseAttackTimeIcon is the clock, BaseAttackSpeedIcon its third picture
    ["icon_attack_speed2_psd", "Base Attack Time", number("AttackRate")],
    [
      "icon_attack_speed3_psd",
      "Attack Speed",
      number("BaseAttackSpeed", 100) + agility,
    ],
    ["icon_attack_range_psd", "Attack Range", number("AttackRange")],
  ];
  const attributes = [
    ["Strength", "strength", strength, number("AttributeStrengthGain")],
    ["Agility", "agility", agility, number("AttributeAgilityGain")],
    [
      "Intelligence",
      "intelligence",
      intelligence,
      number("AttributeIntelligenceGain"),
    ],
  ];
  const pools = [
    [
      "Max Health",
      number("StatusHealth", 120) + strength * HEALTH_PER_STRENGTH,
      round(number("StatusHealthRegen") + strength * HEALTH_REGEN_PER_STRENGTH),
      "from-[#5aa15e] to-[#406c55]",
    ],
    [
      "Max Mana",
      number("StatusMana", 75) + intelligence * MANA_PER_INTELLIGENCE,
      round(
        number("StatusManaRegen") + intelligence * MANA_REGEN_PER_INTELLIGENCE,
      ),
      "from-[#3782a4] to-[#235777]",
    ],
  ];
  // The border's brush: white at 6% fading out over the right half
  const line = "linear-gradient(90deg, #ffffff06 50%, #ffffff00)";
  return (
    <div className="relative my-[8px] flex w-[500px] py-px">
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: line }}
      />
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px"
        style={{ background: line }}
      />
      {/* LabelSmall titles at 40%, TitleSmall values (the title font, 17, bold) */}
      <div className="w-[128px] shrink-0 border-r border-white/[0.02] py-[16px]">
        {attributes.map(([label, icon, value, gain], index) => (
          <div key={label} className={index < 2 ? "mb-[8px]" : ""}>
            <p className="mb-[2px] text-[13px] leading-[16px] tracking-[1px] text-[#dae2e5]/40 uppercase">
              {label}
            </p>
            <p className="flex items-center font-display text-[17px] leading-[1.2] font-bold tracking-[0.8px] text-[#dae2e5] uppercase">
              <img
                src={image(
                  base,
                  `primary_attribute_icons/primary_attribute_icon_${icon}_psd`,
                )}
                alt=""
                className="mr-[8px] size-[20px]"
              />
              {value} + {round(gain)}
            </p>
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="mt-[16px] ml-[16px] flex pr-[64px]">
          {derived.map(([icon, label, value]) => (
            <div
              key={label}
              title={label}
              className="flex flex-1 flex-col items-center"
            >
              {/* The picture itself, washed LightestGrey (#dae2e5 multiplies it, about 0.88) */}
              <img
                src={image(base, `hud/reborn/${icon}`)}
                alt=""
                className="size-[20px] object-contain brightness-[0.88]"
              />
              <span className="mt-[2px] h-[18px] text-[16px] leading-[18px] whitespace-nowrap text-[#dae2e5]/80 tabular-nums">
                {value}
              </span>
            </div>
          ))}
        </div>
        {/* 16 in from the left, 160 from the right */}
        <div className="mt-[8px] mr-[160px] ml-[16px]">
          {pools.map(([label, value, regen, colors]) => (
            <div key={label} className="mb-[4px]">
              <p className="text-[13px] leading-[16px] tracking-[1px] text-[#8b989e] uppercase">
                {label}
              </p>
              <div
                className={`relative mt-[2px] flex h-[24px] items-center rounded-[3px] bg-gradient-to-b ${colors}`}
              >
                <span className="absolute inset-x-0 text-center font-display text-[17px] leading-[1.2] font-bold tracking-[1.5px] text-white [text-shadow:0_2px_5px_#000]">
                  {value}
                </span>
                <span className="relative mr-[8px] ml-auto text-[16px] leading-[20px] font-semibold tracking-[1px] text-white/80 [text-shadow:0_1px_5px_#000]">
                  +{regen}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stats({ info }) {
  if (!info) {
    return null;
  }
  const number = (key) => Number(info[key] ?? 0);
  const rows = [
    [
      "Strength",
      `${number("AttributeBaseStrength")} +${number("AttributeStrengthGain")}`,
      "#e0533e",
    ],
    [
      "Agility",
      `${number("AttributeBaseAgility")} +${number("AttributeAgilityGain")}`,
      "#3fc364",
    ],
    [
      "Intelligence",
      `${number("AttributeBaseIntelligence")} +${number("AttributeIntelligenceGain")}`,
      "#3f9fe0",
    ],
    ["Damage", `${number("AttackDamageMin")}–${number("AttackDamageMax")}`],
    ["Attack time", number("AttackRate")],
    ["Attack range", number("AttackRange")],
    ["Projectile speed", number("ProjectileSpeed") || "Instant"],
    ["Armor", number("ArmorPhysical")],
    ["Magic resistance", `${number("MagicalResistance") || 25}%`],
    ["Move speed", number("MovementSpeed")],
    ["Turn rate", number("MovementTurnRate")],
    [
      "Vision",
      `${number("VisionDaytimeRange")} / ${number("VisionNighttimeRange")}`,
    ],
    ["Health regen", number("StatusHealthRegen")],
    ["Mana regen", number("StatusManaRegen")],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-10 gap-y-0 text-[16px]">
      {rows.map(([label, value, color]) => (
        <div
          key={label}
          className="flex justify-between gap-4 border-b border-black/50 py-2.5"
        >
          <dt className="text-ash" style={color ? { color } : undefined}>
            {label}
          </dt>
          <dd className="text-bone tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// DOTAPersonaSelector: the hero's own look ("Classic") and each persona by its cosmetic group's
// name, with their icons, in the game's pill tab group; only for heroes with personas
function PersonaSelector({ base, heroKey, info, texts, persona, onPersona }) {
  const personas = Object.entries(info?.Persona ?? {}).sort(([a], [b]) => a - b);
  if (!personas.length) {
    return null;
  }
  const options = [
    [0, "Classic", heroKey],
    ...personas.map(([index, entry]) => [
      Number(index),
      texts[(entry.cosmetic_group_name ?? "").replace(/^#/, "")] ?? `Persona ${index}`,
      entry.name ?? `${heroKey}_persona${index}`,
    ]),
  ];
  return (
    <div className="-ml-[8px] mb-[20px] flex self-start rounded-full border border-black/20 bg-black/70 py-[2px]">
      {options.map(([value, label, icon]) => (
        <button
          key={value}
          role="tab"
          aria-selected={persona === value}
          onClick={() => persona !== value && onPersona(value)}
          data-sound="toptab"
          className={`mx-[2px] flex items-center rounded-full border px-[20px] py-[6px] outline-none text-[16px] leading-[20px] tracking-[1px] uppercase ${
            persona === value
              ? "border-white/[0.07] bg-gradient-to-b from-[#445055] to-[#2f363a] text-white shadow-[0_2px_4px_rgb(0_0_0/0.2)] [text-shadow:0_0_12px_rgb(197_222_255/0.3)]"
              : "border-transparent text-[#768e8d] hover:text-[#dae2e5]"
          }`}
        >
          {/* Radiance's capitals sit 1.4 above the middle of a 20 line; moved down onto it */}
          <span className="translate-y-[1.5px]">{label}</span>
          <img
            src={image(base, `heroes/icons/${icon}_png`)}
            alt=""
            className="-my-[2px] ml-[8px] size-[24px]"
            onError={(event) => (event.currentTarget.style.display = "none")}
          />
        </button>
      ))}
    </div>
  );
}

// The row under the top bar: the previous hero, the page's tabs, the next hero
function HeroNav({ hero, base, tab, onTab, previous, next, onOpen }) {
  const side = (other, forward) =>
    other && (
      <button
        onClick={() => onOpen({ type: "hero", id: other.id })}
        data-sound="toptab"
        className={`flex items-center p-[12px] text-[16px] leading-[20px] tracking-[1px] text-[#b0bcc2] uppercase opacity-20 transition-opacity duration-100 hover:opacity-100 hover:brightness-150 active:translate-y-px ${forward ? "flex-row-reverse" : ""}`}
      >
        {forward ? (
          <ArrowRight className="mx-[6px] size-[24px]" />
        ) : (
          <ArrowLeft className="mx-[6px] size-[24px]" />
        )}
        {other.name}
      </button>
    );
  return (
    // The game's secondary tabs (dashboard_tabs_heroes): the previous and next hero 40 in from the
    // sides at 20% until hovered; the tabs 20 high with 3 letter spacing
    <div className="flex h-[52px] items-center bg-gradient-to-b from-black/45 to-black/20 px-[40px]">
      <div className="w-[300px]">{side(previous, false)}</div>
      <div className="flex flex-1 items-center justify-center">
        <img
          src={image(base, `heroes/icons/npc_dota_hero_${hero.id}_png`)}
          alt=""
          className="mt-[2px] mr-[12px] size-[28px]"
          onError={(event) => (event.currentTarget.style.display = "none")}
        />
        {TABS.map(([id, label], index) => (
          <Fragment key={id}>
            {index > 0 && (
              <span className="mx-[15px] mt-[4px] mb-px text-[18px] text-[#768e8d]" aria-hidden>
                /
              </span>
            )}
            <button
              role="tab"
              aria-selected={tab === id}
              data-sound="toptab"
              onClick={() => onTab(id)}
              className={`mt-[4px] text-[20px] tracking-[3px] uppercase transition-colors ${tab === id ? "text-white [text-shadow:0_0_12px_#5d7070]" : "text-[#768e8d] hover:text-white"}`}
            >
              {label}
            </button>
          </Fragment>
        ))}
      </div>
      <div className="flex w-[300px] justify-end">{side(next, true)}</div>
    </div>
  );
}

export default function HeroPage({
  catalog,
  hero,
  language,
  viewer,
  summary,
  wardrobe,
  wardrobeOpen,
  onCloseWardrobe,
  previous,
  next,
  onOpen,
  persona,
  onPersona,
  shownHeroId = null,
}) {
  const [tab, setTab] = useState("loadout");
  // The hero's info and backdrop change when its model comes into view, not before: the last hero
  // stood beside the next one's info and on its backdrop while the model loaded. Not waiting past
  // a few seconds for a model that does not come
  const [waited, setWaited] = useState(null);
  useEffect(() => {
    const timer = setTimeout(() => setWaited(hero.id), 5000);
    return () => clearTimeout(timer);
  }, [hero.id]);
  const inView = shownHeroId === hero.id || waited === hero.id;
  // Meanwhile the info is the hero in view's, with what it wears and its persona as they were
  const shown = inView || !shownHeroId ? hero : (catalog.heroesById[shownHeroId] ?? hero);
  const lastInView = useRef({ summary, persona });
  if (shown === hero) lastInView.current = { summary, persona };
  const shownSummary = shown === hero ? summary : lastInView.current.summary;
  const shownPersona = shown === hero ? persona : lastInView.current.persona;
  const backdropHero = shown.id;
  // The hero alone on the whole screen, as the game's preview button does
  const [preview, setPreview] = useState(false);
  const page = useRef(null);
  const { scale, aspect } = useUiLayout();
  const { data } = useGameData(
    catalog.modelsBase,
    ["heroes.json", "abilities.json"],
    language,
  );
  const info = data?.heroes[`npc_dota_hero_${shown.id}`];

  // Casting: a click on an ability or its key sends its animation, sound and voice lines to the stage
  const cast = (ability) => {
    const known = data?.abilities ?? {};
    const list = info
      ? Array.from(
          { length: 9 },
          (_, index) => info[`Ability${index + 1}`],
        ).filter((name) => name && known[name])
      : [];
    loadAbilitySounds(catalog.modelsBase).then((all) => {
      const entry = all[`npc_dota_hero_${shown.id}`]?.[ability] ?? {};
      window.dispatchEvent(
        new CustomEvent("dotadex:cast", {
          detail: {
            ability,
            index: Math.max(0, list.indexOf(ability)),
            sounds: entry.sounds ?? [],
            lines: entry.lines ?? [],
          },
        }),
      );
    });
  };
  useEffect(() => {
    if (!info || !data?.abilities) {
      return;
    }
    const abilities = castable(info, data.abilities);
    const keys = castKeys(abilities, data.abilities);
    const onKey = (event) => {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.target.closest?.("input, textarea")
      ) {
        return;
      }
      // The key's place on the keyboard, so it works in any layout, as in the game
      const ability = abilities.find(
        (name) => `Key${keys[name]}` === event.code,
      );
      if (ability) {
        cast(ability);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Escape closes the outfit picker, or a tab's panel back to the loadout
  useEffect(() => {
    if (!wardrobeOpen && tab === "loadout") {
      return;
    }
    const onKey = (event) => {
      if (event.key === "Escape") {
        wardrobeOpen ? onCloseWardrobe() : setTab("loadout");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wardrobeOpen, onCloseWardrobe, tab]);

  const togglePreview = () => {
    if (preview) {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      setPreview(false);
    } else {
      setPreview(true);
      page.current?.requestFullscreen?.().catch(() => {});
    }
  };
  // Leaving the browser's full screen (Escape) ends the preview too
  useEffect(() => {
    if (!preview) {
      return;
    }
    const onChange = () => !document.fullscreenElement && setPreview(false);
    const onKey = (event) => event.key === "Escape" && setPreview(false);
    document.addEventListener("fullscreenchange", onChange);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      window.removeEventListener("keydown", onKey);
    };
  }, [preview]);

  return (
    <div
      ref={page}
      data-preview={preview || undefined}
      className="fade-images relative min-h-0 flex-1 overflow-hidden"
    >
      <Backdrop base={catalog.modelsBase} heroId={backdropHero} />
      {/* The model fills the page under the columns */}
      <div className="absolute inset-0">{viewer}</div>
      {/* Back from the preview; the loadout's own button sits in the left column */}
      {preview && (
        <button
          onClick={togglePreview}
          data-sound="click"
          aria-label="Back to the loadout"
          title="Back to the loadout"
          className="absolute right-[24px] bottom-[24px] z-10 grid size-[40px] place-items-center rounded-[2px] bg-gradient-to-b from-[#3b434e] to-[#262c34] text-[#e6ebef] opacity-40 shadow-[0_2px_8px_rgb(0_0_0/0.5)] transition hover:opacity-100 hover:brightness-150"
          style={{ zoom: scale }}
        >
          <Minimize2 className="size-[20px]" strokeWidth={2.25} />
        </button>
      )}
      <div
        className={`pointer-events-none absolute inset-0 flex flex-col ${preview ? "hidden" : ""}`}
        style={{ zoom: scale }}
      >
        {wardrobeOpen && tab === "loadout" ? (
          // CHANGE OUTFIT takes the page; the model steps to the left meanwhile
          <div className="relative min-h-0 flex-1">{wardrobe}</div>
        ) : (
          <>
            {/* .EquippedBackgroundShard: 800 by 300 from the page's middle, skewed -16° and moved
                750 right, 196 down from the screen's top (the NoTier place: no hero level here;
                700 right on 16:10); white edge and fill fading out, all at 5% */}
            {tab === "loadout" && (
              <div
                aria-hidden
                className="absolute top-[-61px] left-[calc(50%-400px)] h-[300px] w-[800px] border border-solid opacity-5"
                style={{
                  transform: `skewX(-16deg) translateX(${aspect === "16x10" ? 700 : 750}px) translateY(196px)`,
                  // The game's gradients run from the top left corner to 16% 60% (fill) and 10% 60% (edge)
                  background: "linear-gradient(144.6deg, #ffffff27, #ffffff00 221px)",
                  borderImage: "linear-gradient(156deg, #ffffff, #ffffff00 197px) 1",
                }}
              />
            )}
            {/* The model's controls (animation, playback, outfit, download): a row at the bottom,
                in the middle, at 80% */}
            <div
              id="hero-model-controls"
              className="enter-up pointer-events-auto absolute bottom-[21px] left-1/2 z-10 flex origin-bottom -translate-x-1/2 scale-[0.8] items-center gap-[8px] empty:hidden"
              style={{ "--enter-delay": "0.2s" }}
            />
            <div className="enter-down pointer-events-auto">
              <HeroNav
                hero={hero}
                base={catalog.modelsBase}
                tab={tab}
                onTab={setTab}
                previous={previous}
                next={next}
                onOpen={onOpen}
              />
            </div>
            <div className="relative min-h-0 flex-1">
              {/* #HeroPageContent: 1920 wide at most, in the middle. The columns start 212 below
                  the screen's top (here the top bar's 61 and these tabs' 52 are above), 90 in
                  from its sides (60 on 16:10, none on 21:9) */}
              <div
                className="absolute inset-0 mx-auto max-w-[1920px]"
                style={{ "--side": `${SIDE[aspect] ?? 90}px` }}
              >
                {/* The columns come in from the sides, again for each hero, once it is in view */}
                <div key={`summary-${shown.id}`} className="enter-left pointer-events-auto absolute top-[99px] left-(--side) w-[540px]" style={{ "--enter-delay": "0.08s" }}>
                  <HeroSummary
                    catalog={catalog}
                    hero={shown}
                    info={info}
                    data={data}
                    onAbout={() =>
                      setTab(tab === "about" ? "loadout" : "about")
                    }
                    onCast={cast}
                    onPreview={togglePreview}
                  />
                </div>
                {tab === "loadout" && (
                  <div key={`loadout-${shown.id}`} className="enter-right pointer-events-auto absolute top-[111px] right-(--side) flex w-[422px] flex-col" style={{ "--enter-delay": "0.14s" }}>
                    <PersonaSelector
                      base={catalog.modelsBase}
                      heroKey={`npc_dota_hero_${shown.id}`}
                      info={info}
                      texts={data?.texts ?? {}}
                      persona={shownPersona}
                      onPersona={onPersona}
                    />
                    {shownSummary}
                  </div>
                )}
              </div>
              {tab !== "loadout" ? (
                <div key={tab} className="enter-right pointer-events-auto absolute top-[90px] right-[90px] bottom-[40px] w-[620px] shadow-[0_8px_32px_rgb(0_0_0/0.5)]">
                  <div className="h-full overflow-y-auto bg-black/55 p-[24px] pr-[48px] scrollbar-thin">
                    {tab === "voice" && (
                      <Voice
                        modelsBase={catalog.modelsBase}
                        heroKey={`npc_dota_hero_${shown.id}`}
                      />
                    )}
                    {tab === "stats" && <Stats info={info} />}
                    {tab === "about" && (
                      <HeroInfo
                        base={catalog.modelsBase}
                        heroKey={`npc_dota_hero_${shown.id}`}
                        language={language}
                      />
                    )}
                  </div>
                  <button
                    onClick={() => setTab("loadout")}
                    data-sound="back"
                    aria-label="Back to the loadout"
                    title="Back to the loadout"
                    className="absolute top-[10px] right-[10px] grid size-[32px] place-items-center rounded-[2px] bg-gradient-to-b from-[#3b434e] to-[#262c34] text-[#e6ebef] shadow-[0_2px_8px_rgb(0_0_0/0.5)] hover:brightness-150"
                  >
                    <X className="size-[20px]" strokeWidth={2.5} />
                  </button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
