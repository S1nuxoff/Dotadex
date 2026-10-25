import { useEffect, useMemo, useRef, useState } from "react";
import { emptySlotIcon, heroSlots, itemIcon, itemsForSlot, personaOf, rarity, slotName, sortItems } from "../catalog.js";
import { fetchData } from "../fetchData.js";
import { useGameData } from "../gamedata.js";
import { useUiLayout } from "./ui.jsx";
import { startCardEdges } from "../viewer/cardEdges.js";
import { DOTADEX_BASE, FILES_SITE, panoramaFile, panoramaImage } from "../datasets.js";
import { Download } from "lucide-react";

// CUSTOMIZE on a hero's page as the game draws it: #HeroCustomize with its DOTACosmeticPicker
// (ui_cosmetic_picker, hero_slot_item_picker_loadout, ui_econ_item_animated, collection_shared)
// and, under the hero, the scene's DOTASetPreviewControls (ui_set_preview_controls). Lengths are
// the game's 1080-high layout's. This layer starts under the top bar, 61 below the screen's top.

const TOP_BAR = 61;
// #HeroCustomize: margin-left 824 (630 on 16:10), centred with #CosmeticPicker's 974 in the page;
// the picker 62 + 28 below the screen's top and 90 above its bottom
const PICKER_WIDTH = 974;
const PICKER_MARGIN = { "16x10": 630 };
// #HeroSceneGroup moves 500 left and 40 up while customizing; the set's controls stand at the
// bottom of #HeroSceneBody (1020 high from 60 down), their .Container 90 above it
const SCENE_SHIFT = 500;
const CONTROLS_BOTTOM = 40 + 90;
// CosmeticPicker_Heroes_SetTile / _ItemTile, with the card's 6 of margin round its .Container
const SET_TILE = [245, 373];
const ITEM_TILE = [185, 237];

const LIGHTEST = "#dae2e5";
const LIGHTER = "#b0bcc2";

// Which card background each hero has (collection_shared), loaded once with the page's backdrops
let backgrounds = null;
function useCardBackground(base, heroId) {
  const [cards, setCards] = useState(null);
  useEffect(() => {
    backgrounds ??= fetchData(`${DOTADEX_BASE}data/loadout_backgrounds.json`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
    let live = true;
    backgrounds.then((data) => live && setCards(data?.cards ?? {}));
    return () => {
      live = false;
    };
  }, [base]);
  return cards?.[heroId] ? `${DOTADEX_BASE}${cards[heroId]}` : null;
}

// The items each treasure holds, for "In Treasure"
const treasureItems = new WeakMap();
function inTreasure(catalog) {
  if (!treasureItems.has(catalog)) {
    treasureItems.set(catalog, new Set(catalog.treasures.flatMap((treasure) => (treasure.tiers ?? []).flat())));
  }
  return treasureItems.get(catalog);
}

// A set's portrait as the game's set portrait generator left it: econ/sets/v2/<set>_png, its
// styles <set>_style_<n>_png; the hero's own look npc_dota_hero_<hero>_<persona>
const portrait = (icon, style) => itemIcon({ icon: style ? `${icon}_style_${style}` : icon });

// The number of styles a set has: the most any of its items has
function setStyles(catalog, set) {
  return Math.max(1, ...set.items.map((id) => catalog.itemsById[id]?.styles?.length ?? 1));
}

const mask = (url) => ({ maskImage: `url(${url})`, WebkitMaskImage: `url(${url})`, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" });
const washed = (url) => ({
  mask: `url(${url}) center / contain no-repeat`,
  WebkitMask: `url(${url}) center / contain no-repeat`,
});

// ButtonPrimary (dotastyles): 34 high, 16 to the sides, the label 16 in capitals at 80%
const BUTTON =
  "flex h-[34px] shrink-0 items-center justify-center rounded-[3px] border px-[16px] text-[16px] leading-[20px] text-white/80 uppercase shadow-[0_2px_8px_rgb(0_0_0/0.3)] transition-[filter] duration-100 hover:text-white hover:brightness-200";
const LIGHT_GREY = "border-white/[0.07] bg-gradient-to-b from-[#525f65] to-[#2f363a] active:from-[#2f363a] active:to-[#525f65]";
const DARK_GREY = "border-white/[0.03] bg-gradient-to-b from-[#262c30] to-[#121719] active:from-[#121719] active:to-[#262c30]";
const GREEN = "border-white/[0.12] bg-gradient-to-b from-[#5aa15e] to-[#406c55] active:from-[#406c55] active:to-[#5aa15e]";

// ToggleButton.FilterCheck: the black tick box, its label 18 high in LighterGrey
function FilterCheck({ label, checked, onChange }) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group mr-[8px] flex items-center px-[4px] py-px"
    >
      <span
        className={`size-[18px] shrink-0 transition-all duration-200 ${
          checked
            ? "border-[3px] border-black bg-gradient-to-b from-[#e7f6f5] to-[#a0d6d7] shadow-[0_0_8px_0_#5b62bf77]"
            : "border-2 border-[#5e686966] bg-black shadow-[0_0_1px_3px_#00000055] group-hover:border-[#697879]"
        }`}
      />
      <span
        className={`ml-[8px] text-[18px] leading-[24px] tracking-[0.3px] [text-shadow:0_1px_4px_rgb(0_0_0/0.6)] ${
          checked ? "text-[whitesmoke]" : "text-[#b0bcc2] group-hover:text-[#d2d6d1]"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

// DOTAHeroSlotItemPickerLoadout.ShowTitles: what the slot wears at 72 (the full sets' look at 72
// by 100), its name; the chosen one lit with a bar on its left and a caret on its right
function SlotRow({ icons, name, image, tall, isDefault, active, onSelect }) {
  return (
    <button
      onClick={onSelect}
      // DOTAHeroSlotItemPickerLoadout.IsActive
      data-select-sound={active ? undefined : "ui_preview_button_click"}
      className={`group relative flex w-full min-w-[210px] items-center border-t border-t-white/[0.015] border-b text-left ${
        active
          ? "border-b-black/60 bg-[linear-gradient(150deg,#b0cdff14,#62718b0a_70%)]"
          : "border-b-black/40 hover:bg-[linear-gradient(90deg,#56688a22,#56688a00_83%)] hover:transition-[background] hover:duration-200"
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-[-1px] bottom-0 left-0 w-[2px] bg-gradient-to-b from-[#c2ced4] to-[#727d81] transition-opacity duration-200 ${active ? "opacity-100" : "opacity-0"}`}
      />
      <span
        className={`relative mt-[8px] mr-[8px] mb-[7px] ml-[9px] shrink-0 overflow-hidden ${
          tall ? "h-[100px] w-[72px] bg-gradient-to-b from-[#313b42] to-[#778d9b] shadow-[0_1px_8px_rgb(0_0_0/0.4)]" : "size-[72px]"
        } ${active ? "brightness-200" : "transition-transform duration-200 group-hover:scale-105"}`}
      >
        {image && (
          <img
            src={image}
            alt=""
            loading="lazy"
            className={`size-full ${tall ? "object-cover object-top" : "object-cover"} ${isDefault ? "grayscale" : ""}`}
            onError={(event) => (event.currentTarget.style.visibility = "hidden")}
          />
        )}
        {/* #SlotEconItem.IsDefaultItem: no color, washed #c4e8fe */}
        {isDefault && <span aria-hidden className="absolute inset-0 bg-[#c4e8fe] mix-blend-multiply" />}
      </span>
      <span
        className={`mr-[24px] mb-[2px] ml-[8px] min-w-0 flex-1 text-[18px] leading-[1.1] transition-colors duration-100 ${
          active ? "glow-text-bright text-[#dae2e5]" : "text-[#b0bcc2] group-hover:text-[#dae2e5]"
        }`}
      >
        {name}
      </span>
      {/* .MenuArrow: caret_right at half of 40, washed white */}
      <span
        aria-hidden
        className={`absolute top-1/2 right-[-12px] size-[40px] -translate-y-1/2 bg-white transition-[opacity,transform] duration-200 ${
          active ? "glow-image-bright opacity-100" : "translate-x-[-4px] opacity-0 group-hover:translate-x-0 group-hover:opacity-20"
        }`}
        style={{ ...washed(`${icons}caret_right.svg`), maskSize: "50% 50%", WebkitMaskSize: "50% 50%" }}
      />
    </button>
  );
}

// A card of the picker, DOTAEconItemAnimated: a set's portrait on the hero's card background
// (.Animated) or an item's icon over its grey (.Static); its name, then what it does: equipped, or
// the way to get it. Worn and owned (the hero's own) it is Equipped, in a thick light frame with
// the corner badge; worn but not owned it is being previewed, in a thin frame
// files: the item on the download site, where all its files are (a small button under the pointer)
function EconCard({ base, kind, image, background, name, look, styles, style, onStyle, market, treasure, owned, worn, onPick, files }) {
  const set = kind === "set";
  const [width, height] = set ? SET_TILE : ITEM_TILE;
  const top = look && ["arcana", "immortal"].includes(look.id);
  const equipped = worn && owned;
  const previewing = worn && !owned;
  return (
    <li className="group/card relative shrink-0 pb-[2px]" style={{ width, height }}>
      <button
        onClick={worn ? undefined : onPick}
        // .Container:hover #ActionButton:active plays ui_loadout_equipped; the card it makes the
        // chosen one (DOTAEconItemAnimated:selected) ui_generic_button_click
        data-sound={worn ? undefined : "ui_loadout_equipped"}
        data-select-sound={worn ? undefined : "ui_generic_button_click"}
        className={`econ-card group absolute inset-[6px] flex flex-col text-left shadow-[0_6px_24px_-8px_rgb(0_0_0/0.8)] transition-[filter,transform] duration-100 active:scale-[0.985] active:brightness-50 ${
          equipped ? "econ-flash" : ""
        } ${previewing ? "econ-previewing" : ""}`}
        style={{
          background: set
            ? owned
              ? "linear-gradient(180deg, #1c2332 40%, #2b415a 80%)"
              : "linear-gradient(180deg, #172931 40%, #2b4f5a 80%)"
            : owned
            ? "linear-gradient(135deg, #111419 50%, #000000)"
            : "linear-gradient(135deg, #1d3c4a 20%, #0a1b1c)",
        }}
      >
        {set ? (
          <span className="absolute inset-0 overflow-hidden">
            {/* .HeroBackgroundImage, three times as bright under the pointer */}
            {background && <span className="absolute inset-0 bg-cover bg-center group-hover:brightness-300" style={{ backgroundImage: `url(${background})` }} />}
            {/* .StyledBorder2 on the owned ones */}
            {owned && <span aria-hidden className="absolute inset-0 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.4)] [border-image:linear-gradient(#000000ab,#00000000)_6] [border-style:solid] [border-width:6px]" />}
            {/* #SceneContainer, faded at the bottom through set_thumbnail_mask */}
            <span
              className="absolute inset-0 transition-transform duration-400 ease-[cubic-bezier(0,1,0,1)] group-hover:scale-[1.07]"
              style={mask(panoramaImage("masks/set_thumbnail_mask_psd"))}
            >
              {image && <img src={image} alt="" loading="lazy" className="size-full" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />}
            </span>
          </span>
        ) : (
          // #StaticItemViewContainer: two thirds of the width high, grey to light grey below the middle
          <span className="relative block w-full shrink-0 overflow-hidden bg-[linear-gradient(180deg,#424142_50%,#9d9d9d)]" style={{ height: ((width - 12) * 2) / 3 }}>
            {image && (
              <img
                src={image}
                alt=""
                loading="lazy"
                className="size-full scale-[1.04] object-cover transition-[transform,filter] duration-400 ease-[cubic-bezier(0,1,0,1)] group-hover:scale-110 group-hover:brightness-200"
                onError={(event) => (event.currentTarget.style.visibility = "hidden")}
              />
            )}
            {/* .MarketPriceContainer: the market's price, top left */}
            {market && (
              <span className="absolute top-[8px] left-[8px] flex h-[22px] items-center rounded-[3px] bg-[#0d0f12] px-[6px] text-[13px] leading-[16px] text-[#b0bcc2] [text-shadow:0_1px_4px_#000]">
                {market}
              </span>
            )}
          </span>
        )}
        {set && top && <CardEdges base={base} name="armory_edge_set" rarity={look.id} equipped={equipped} />}
        {/* .ArcanaLabel / .ImmortalLabel on full sets of those rarities */}
        {set && top && (
          <span className={`relative self-center p-[12px] text-[16px] text-white/80 [text-shadow:0_1px_4px_#000] glow-${look.id}-label`}>{look.name}</span>
        )}
        {/* .PreviewingLabel */}
        {previewing && (
          <span className={`relative self-center rounded-[2px] text-[13px] leading-[16px] font-semibold text-white/60 uppercase [text-shadow:0_2px_8px_rgb(0_0_0/0.8)] ${set && top ? "mt-[0px]" : "mt-[12px]"}`}>
            Previewing
          </span>
        )}
        {/* #ItemInfoContainer at the bottom */}
        <span className="relative mt-auto flex w-full flex-col items-center px-[12px] pb-[16px]">
          {styles > 1 && (
            <span className="mb-[6px] flex gap-[6px]">
              {Array.from({ length: styles }, (_, index) => (
                <span
                  key={index}
                  role="radio"
                  aria-checked={style === index}
                  aria-label={`Style ${index + 1}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onStyle(index);
                  }}
                  className={`size-[14px] cursor-pointer rounded-full border-2 ${style === index ? "border-[#dae2e5] bg-[#8b989e]" : "border-[#8b989e]/70 bg-black/60 hover:border-[#dae2e5]"}`}
                />
              ))}
            </span>
          )}
          {name && (
            <span
              className={`w-full text-center text-[16px] ${
                set ? "h-[20px] truncate leading-[20px] text-white/60 [text-shadow:0_2px_8px_#000]" : "line-clamp-2 h-[36px] leading-[18px] text-[#b0bcc2] group-hover:text-white"
              }`}
            >
              {name}
            </span>
          )}
          {equipped ? (
            // #StatusLabelContainer
            <span className="mt-[8px] mb-px w-full border-t border-transparent py-[6px] text-center [border-image:linear-gradient(90deg,#fff0,#ffffff04_30%,#ffffff04_70%,#fff0)_1]">
              <span className="text-[16px] leading-[20px] font-semibold text-white/90 uppercase [text-shadow:0_0_12px_rgb(224_249_255/0.4)]">Equipped</span>
            </span>
          ) : treasure && !owned ? (
            // DOTAPurchaseButton.Direct.InTreasure
            <span className="mt-[8px] flex h-[34px] w-full items-center justify-center rounded-[3px] border border-white/[0.08] bg-gradient-to-b from-[#3784a6] to-[#215373] px-[8px] shadow-[0_3px_6px_-1px_rgb(0_0_0/0.4)]">
              <img src={panoramaImage("icon_treasure_button_png")} alt="" className="mr-[2px] size-[20px]" onError={(event) => (event.currentTarget.style.display = "none")} />
              <span className="text-[16px] leading-[20px] tracking-[1px] text-white uppercase [text-shadow:0_1px_4px_rgb(0_0_0/0.6)]">In Treasure</span>
            </span>
          ) : (
            // #ActionButton: EQUIP under the pointer
            <span className={`${BUTTON} ${DARK_GREY} mt-[8px] w-full translate-y-[3px] opacity-0 transition-[opacity,transform] delay-[50ms] duration-150 ease-out group-hover:translate-y-0 group-hover:opacity-100 group-hover:delay-0`}>
              Equip
            </span>
          )}
        </span>
        {/* #BottomLayer: the rarity's strip, darker at its ends */}
        <span
          aria-hidden
          className={`relative h-[3px] w-full shrink-0 border-t border-white/5 opacity-80 shadow-[0_-1px_0_0_rgb(0_0_0/0.6)] ${top ? `glow-${look.id}-strip` : ""}`}
          style={{ background: look?.color ?? "transparent" }}
        >
          <span className="absolute inset-0 bg-[linear-gradient(270deg,#000000aa,#00000000_35%,#00000000_65%,#000000aa)]" />
        </span>
        {/* #Equipped: the badge in the top right corner */}
        <span
          aria-hidden
          className={`absolute top-0 right-0 size-[28px] bg-contain bg-[position:right_top] bg-no-repeat transition-transform duration-200 ${equipped ? "" : "translate-x-[20px] -translate-y-[20px] opacity-0"}`}
          style={{ backgroundImage: `url(${panoramaImage("status_icons/econtooltip_equipped_psd")})` }}
        />
      </button>
      {/* #EquippedBorder: 4 (5 below) for the equipped, 1 (2 below) for the previewed */}
      <span
        aria-hidden
        className={`pointer-events-none absolute top-[6px] right-[6px] bottom-[9px] left-[6px] border-solid shadow-[inset_0_-1px_0_0_#000] transition-[opacity,border-width] duration-200 ${
          equipped ? "border-x-4 border-t-4 border-b-[5px] opacity-100" : previewing ? "border-x border-t border-b-2 opacity-80" : "border-0 opacity-0"
        }`}
        style={{ borderImage: equipped ? "linear-gradient(#c2ced4, #727d81) 1" : previewing ? "linear-gradient(#fff, #fff) 1" : undefined }}
      />
      {/* Its files on the download site: an item's at the foot of its picture, a set's top left */}
      {files && (
        <a
          href={files}
          target="_blank"
          rel="noreferrer"
          title="Download its files: model, textures, icon"
          aria-label={`Download the files of ${name}`}
          className="absolute z-10 flex size-[30px] items-center justify-center rounded-[3px] border border-white/10 bg-[#0d0f12]/85 text-[#b0bcc2] opacity-0 shadow-[0_2px_6px_rgb(0_0_0/0.6)] transition-opacity duration-150 group-hover/card:opacity-100 hover:text-white"
          style={set ? { top: 14, left: 14 } : { top: 6 + ((width - 12) * 2) / 3 - 36, right: 14 }}
        >
          <Download className="size-[16px]" />
        </a>
      )}
    </li>
  );
}

// #ArcanaBackgroundEffect: the particle edges, a scene of their own laid over the card's
// (ui_econ_item_animated). The game shows them once the card's live scene is loaded, and loads
// that on Immortal and Arcana sets only (client.dll 0x182b27790); Immortal's hue turned -90°.
// The equipped set's are drawn at 0.98, in 0.2 s. The scene is drawn into the panel's own size,
// so its glow ends at the card's edge (overflow: noclip does not widen what a scene panel draws)
function CardEdges({ base, name, rarity, equipped }) {
  const canvas = useRef(null);
  useEffect(() => startCardEdges(base, canvas.current, name), [base, name]);
  return (
    <canvas
      ref={canvas}
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full transition-transform duration-200"
      style={{
        transform: `${equipped ? "scale(0.98) " : ""}translateY(-2px)`,
        filter: rarity === "immortal" ? "hue-rotate(-90deg)" : undefined,
      }}
    />
  );
}

// A scrolled panel with Panorama's VerticalScrollBar: laid over the contents (layout-position:
// fixed), so it takes no width from them; 8 wide, a thumb of at least 32, shown in 0.1 s while
// the pointer is over the panel
function OverlayScroll({ width = 8, className = "", children }) {
  const view = useRef(null);
  const [thumb, setThumb] = useState(null);
  useEffect(() => {
    const element = view.current;
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = element;
      if (scrollHeight <= clientHeight + 1) {
        setThumb(null);
        return;
      }
      const height = Math.max(32, (clientHeight * clientHeight) / scrollHeight);
      setThumb({ top: (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - height), height });
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);
  // Dragging the thumb scrolls in proportion (the layer is zoomed, the pointer is in screen pixels)
  const drag = (event) => {
    event.preventDefault();
    const element = view.current;
    const start = event.clientY;
    const from = element.scrollTop;
    const zoom = element.getBoundingClientRect().height / element.clientHeight || 1;
    const ratio = (element.scrollHeight - element.clientHeight) / (element.clientHeight - thumb.height);
    const move = (moveEvent) => (element.scrollTop = from + ((moveEvent.clientY - start) / zoom) * ratio);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className={`group/scroll relative min-h-0 ${className}`}>
      <div ref={view} className="h-full overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
      {thumb && (
        <span
          onPointerDown={drag}
          className="absolute right-0 border-t border-r border-t-[#aaaaaa22] border-r-[#000000aa] bg-[#566767] opacity-0 transition-[opacity,background-color] duration-100 group-hover/scroll:opacity-100 hover:bg-[#86989f] active:brightness-50"
          style={{ top: thumb.top, height: thumb.height, width }}
        />
      )}
    </div>
  );
}

export function OutfitPicker({ catalog, outfit, start = "sets", onEquip, onEquipSet, onOutfit, onClose }) {
  const base = catalog.modelsBase;
  const icons = panoramaFile("control_icons/24px/");
  const hero = catalog.heroesById[outfit.hero];
  const persona = outfit.persona ?? 0;
  const { aspect } = useUiLayout();
  const { data } = useGameData(base, ["heroes.json"]);
  const background = useCardBackground(base, hero.id);
  const slots = useMemo(() => heroSlots(catalog, hero.id, persona), [catalog, hero, persona]);
  const sets = useMemo(
    () => catalog.sets.filter((set) => set.hero === hero.id && personaOf(set.items.map((id) => catalog.itemsById[id]).find(Boolean)?.slot) === persona),
    [catalog, hero, persona]
  );
  const [selected, setSelected] = useState(start === "sets" && sets.length === 0 ? slots[0]?.slot : start);
  // Owned / Purchasable / Unavailable: none ticked shows them all
  const [filters, setFilters] = useState({ owned: false, available: false, unavailable: false });
  // The style shown on each set's card
  const [cardStyles, setCardStyles] = useState({});
  const treasure = inTreasure(catalog);
  const worn = (slot) => outfit.slots[slot]?.id;
  const changed = Object.keys(outfit.slots).length > 0;

  // The slot's name as the hero's ItemSlots call it (Legion Commander's back: "Banners")
  const info = data?.heroes?.[`npc_dota_hero_${hero.id}`];
  const slotLabel = (slot) => {
    const entry = Object.values(info?.ItemSlots ?? {}).find((candidate) => candidate.SlotName === slot);
    return (entry?.SlotText && data.texts[entry.SlotText.replace(/^#/, "")]) || slotName(slot);
  };

  const first = (set) => catalog.itemsById[set.items[0]];
  // A set's rarity: its store bundle's, else its first item's
  const setRarity = (set) => {
    const id = set.rarity ?? first(set)?.rarity;
    return { ...rarity({ rarity: id }), id };
  };
  const wornSet = sets.find((set) => set.items.every((id) => worn(catalog.itemsById[id]?.slot) === id));
  const rows = [
    ...(sets.length
      ? [{ id: "sets", name: "Full Sets", image: wornSet?.icon ? portrait(wornSet.icon, outfit.slots[first(wornSet).slot]?.style) : portrait(`econ/sets/v2/npc_dota_hero_${hero.id}_${persona}`), tall: true }]
      : []),
    ...slots.map((slot) => {
      const item = worn(slot.slot) ? catalog.itemsById[worn(slot.slot)] : slot.defaultItem;
      return { id: slot.slot, name: slotLabel(slot.slot), image: item?.icon ? itemIcon(item) : emptySlotIcon(slot.slot), isDefault: !worn(slot.slot) };
    }),
  ];

  // The cards of what is picked, the hero's own first, then what can be had, then the rest
  const isSets = selected === "sets";
  let cards = [];
  if (isSets) {
    cards = [
      {
        key: "default",
        image: portrait(`econ/sets/v2/npc_dota_hero_${hero.id}_${persona}`),
        look: rarity({ rarity: "common" }),
        owned: true,
        worn: !changed,
        onPick: () => onOutfit({}),
      },
      // The newest first, then as the game's FullSetPicker sorts them (client.dll 0x182e30df0, qsort
      // with 0x182e2cb50): by the rarity of the set's bundle, highest value first
      ...[...sets]
        .sort((a, b) => (first(b)?.date ?? "").localeCompare(first(a)?.date ?? ""))
        .sort((a, b) => setRarity(b).value - setRarity(a).value)
        .map((set) => {
        const style = cardStyles[set.id] ?? (set === wornSet ? (outfit.slots[first(set).slot]?.style ?? 0) : 0);
        const look = setRarity(set);
        const id = look.id;
        return {
          key: set.id,
          name: set.name,
          files: set.items[0] ? `${FILES_SITE}item/${set.items[0]}/` : null,
          image: set.icon ? portrait(set.icon, style) : null,
          look: { ...look, id },
          styles: setStyles(catalog, set),
          style,
          onStyle: (index) => {
            setCardStyles((current) => ({ ...current, [set.id]: index }));
            if (set === wornSet) onEquipSet(set, index);
          },
          treasure: set.items.some((id) => treasure.has(id)),
          market: null,
          worn: set === wornSet,
          onPick: () => onEquipSet(set, style),
        };
      }),
    ];
  } else {
    const slot = slots.find((entry) => entry.slot === selected);
    const chosen = worn(selected);
    cards = [
      ...(slot?.defaultItem
        ? [{ key: "default", name: slot.defaultItem.name, image: itemIcon(slot.defaultItem), look: rarity(slot.defaultItem), owned: true, worn: !chosen, onPick: () => onEquip(selected, null) }]
        : []),
      ...(slot ? sortItems(itemsForSlot(catalog, hero.id, selected), "newest") : []).map((item) => ({
        key: item.id,
        name: item.name,
        files: `${FILES_SITE}item/${item.id}/`,
        image: itemIcon(item),
        look: { ...rarity(item), id: item.rarity },
        market: item.price ? `$${item.price < 10 ? item.price.toFixed(2) : Math.round(item.price)}` : null,
        treasure: treasure.has(item.id),
        worn: chosen === item.id,
        onPick: () => onEquip(selected, item.id),
      })),
    ];
  }
  // What can be had: from a treasure or the market
  const kindOf = (card) => (card.owned ? "owned" : card.treasure || card.market || (isSets && card.key !== "default" && hasPrices(catalog, card.key)) ? "available" : "unavailable");
  const counts = { owned: 0, available: 0, unavailable: 0 };
  for (const card of cards) counts[kindOf(card)] += 1;
  const order = { owned: 0, available: 1, unavailable: 2 };
  const anyFilter = filters.owned || filters.available || filters.unavailable;
  // The sets stay in the game's order (by rarity, above); the slots' items go by what can be had
  const shown = cards
    .filter((card) => !anyFilter || filters[kindOf(card)] || card.worn)
    .sort((a, b) => (isSets ? 0 : order[kindOf(a)] - order[kindOf(b)]));

  const title = rows.find((row) => row.id === selected)?.name ?? "";
  // The shuffle: something else of what is shown, at random
  const shuffle = () => {
    const pool = shown.filter((card) => !card.worn);
    pool.length && pool[Math.floor(Math.random() * pool.length)].onPick();
  };
  const marginLeft = PICKER_MARGIN[aspect] ?? 824;

  return (
    <>
      <div
        className="hero-customize pointer-events-auto absolute flex flex-col"
        style={{ top: 90 - TOP_BAR, bottom: 90, width: PICKER_WIDTH, left: `calc(50% - ${(marginLeft + PICKER_WIDTH) / 2}px + ${marginLeft}px)` }}
      >
        {/* .HeaderContainer: the hero, then the slot, TitleMedium */}
        <div className="mt-[8px] mb-[12px] flex h-[40px] shrink-0 items-start pr-[64px]">
          <h2 className="truncate font-display text-[26px] leading-[1.2] font-bold tracking-[1.5px] uppercase">
            <span className="text-white">{hero.name}</span>
            <span className="font-normal text-[#b0bcc2]/80"> - {title}</span>
          </h2>
        </div>
        {/* .DoneCustomizingButton, ButtonPrimary LightGrey, 36 below #HeroCustomize's top */}
        <button
          onClick={onClose}
          data-sound="ui_generic_button_click"
          aria-label="Close"
          title="Close"
          className={`${BUTTON} ${LIGHT_GREY} absolute top-[8px] right-0 group/close`}
        >
          <span className="mx-[4px] size-[20px] bg-[#dae2e5] group-hover/close:bg-white" style={washed(`${icons}x_close.svg`)} />
        </button>
        {/* .ContentsContainer */}
        <div className="relative flex min-h-0 flex-1 shadow-[0_28px_120px_-8px_rgb(0_0_0/0.4)]">
          {/* .LeftColumn: the full sets, then every slot with what it wears */}
          <OverlayScroll width={5} className="h-full w-[210px] shrink-0 bg-[linear-gradient(153deg,#12171f,#050609_55%)]">
            <div className="-mt-px flex flex-col">
              {rows.map((row) => (
                <SlotRow key={row.id} icons={icons} {...row} active={selected === row.id} onSelect={() => setSelected(row.id)} />
              ))}
            </div>
          </OverlayScroll>
          {/* .RightColumn */}
          <div className="flex h-full min-w-0 flex-1 flex-col border-l border-white/[0.02] bg-[radial-gradient(140%_100%_at_0_0,#202833e4,#06080e)] shadow-[0_-4px_40px_rgb(0_0_0/0.5)]">
            {/* .ItemStatusFilters */}
            <div className="flex min-h-[44px] shrink-0 items-center bg-gradient-to-b from-[#434f5e5e] to-[#17191f86] py-[6px] pr-[10px] pl-[12px] shadow-[inset_0_-1px_1px_rgb(0_0_0/0.2)]">
              <FilterCheck label={`Owned (${counts.owned})`} checked={filters.owned} onChange={(on) => setFilters({ ...filters, owned: on })} />
              <FilterCheck label={`Purchasable (${counts.available})`} checked={filters.available} onChange={(on) => setFilters({ ...filters, available: on })} />
              <FilterCheck label={`Unavailable (${counts.unavailable})`} checked={filters.unavailable} onChange={(on) => setFilters({ ...filters, unavailable: on })} />
              {/* .InfoIcon */}
              <span
                title="Items that were released for a limited time and are currently not purchasable."
                className="mt-px mr-[12px] -ml-[8px] size-[20px] bg-[#b0bcc2] opacity-60 hover:opacity-100"
                style={washed(`${icons}info.svg`)}
              />
              <span className="flex-1" />
              {/* .IconToggleButton.Shuffle */}
              <button
                onClick={shuffle}
                data-sound="ui_generic_button_click"
                title="Something at random"
                aria-label="Something at random"
                className="group/shuffle flex h-[32px] items-center rounded-[3px] border border-transparent py-[5px] pr-[8px] pl-[6px] transition duration-100 hover:border-white/[0.04] hover:bg-gradient-to-b hover:from-[#3a434f5e] hover:to-[#0d0e1186] hover:shadow-[0_2px_8px_rgb(0_0_0/0.3)] hover:brightness-200"
              >
                <span className="size-[18px] border-2 border-[#5e686966] bg-black shadow-[0_0_1px_3px_#00000055]" />
                <span className="ml-[10px] size-[18px] bg-white opacity-50 group-hover/shuffle:opacity-75" style={washed(`${icons}shuffle.svg`)} />
              </button>
            </div>
            {/* .CosmeticPickerContentsContainer */}
            <OverlayScroll className="flex-1 shadow-[inset_0_1px_0_rgb(238_245_255/0.02)]">
              <div className="pt-[12px] pr-[8px] pb-[12px] pl-[12px]">
              {shown.length > 0 ? (
                <ul key={selected} className="econ-contents flex flex-wrap">
                  {shown.map(({ key, ...card }) => (
                    <EconCard key={key} base={base} kind={isSets ? "set" : "item"} background={background} {...card} />
                  ))}
                </ul>
              ) : (
                <p className="p-[6px] text-[18px] text-[#b0bcc2]">Nothing else for this slot is exported yet.</p>
              )}
              </div>
            </OverlayScroll>
          </div>
          {/* .ViewerContainerBorder */}
          <span aria-hidden className="pointer-events-none absolute inset-0 border border-white/[0.03]" />
        </div>
      </div>
      <SetPreviewControls icons={icons} catalog={catalog} outfit={outfit} slots={slots} sets={sets} onOutfit={onOutfit} />
    </>
  );
}

// Whether every item of a set has a market price
function hasPrices(catalog, setId) {
  const set = catalog.setsById[setId];
  return Boolean(set?.items.length && set.items.every((id) => catalog.itemsById[id]?.price));
}

// DOTASetPreviewControls under the hero while customizing: EQUIPPED and the set's name (or, wearing
// what is not the hero's own, PREVIEWING with those items and REVERT), then RANDOMIZE and the demo
function SetPreviewControls({ icons, catalog, outfit, slots, onOutfit }) {
  const hero = catalog.heroesById[outfit.hero];
  const previewed = Object.entries(outfit.slots)
    .map(([, entry]) => catalog.itemsById[entry.id])
    .filter(Boolean);
  const previewing = previewed.length > 0;
  const [copied, setCopied] = useState(false);
  // DOTASetPreviewRandomizeSet: something of every slot at random, the hero's own among them
  const randomize = () => {
    const next = {};
    for (const slot of slots) {
      const pool = itemsForSlot(catalog, hero.id, slot.slot);
      const pick = Math.floor(Math.random() * (pool.length + (slot.defaultItem ? 1 : 0)));
      if (pick < pool.length) next[slot.slot] = { id: pool[pick].id, style: 0 };
    }
    onOutfit(next);
  };
  const save = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="set-preview-controls pointer-events-none absolute flex w-[800px] -translate-x-1/2 flex-col items-center" style={{ bottom: CONTROLS_BOTTOM, left: `calc(50% - ${SCENE_SHIFT}px)` }}>
      {/* .BackgroundShadow */}
      <span aria-hidden className="absolute bottom-0 left-[10%] h-full w-[80%] bg-[radial-gradient(50%_50%_at_50%_50%,rgb(0_0_0/0.7),rgb(0_0_0/0.5)_60%,rgb(0_0_0/0))] blur-[12px]" />
      <div key={previewing ? "previewing" : "equipped"} className={`relative flex flex-col items-center ${previewing ? "enter-from-below" : "enter-from-above"}`}>
        <p className="mb-[4px] text-[19px] leading-[24px] font-semibold tracking-[1.5px] text-white uppercase [text-shadow:0_0_12px_rgb(224_249_255/0.3)]">
          {previewing ? "Previewing" : "Equipped"}
        </p>
        {previewing ? (
          // #UnownedItemsContainer: the items not owned, then REVERT
          <div className="pointer-events-auto mt-[6px] flex items-center">
            <div className="mr-[8px] flex">
              {previewed.map((item) => (
                <img key={item.id} src={itemIcon(item)} alt={item.name} title={item.name} className="mx-px h-[36px] w-[36px] object-cover" />
              ))}
            </div>
            <button onClick={() => onOutfit({})} data-sound="ui_generic_button_click" className={`${BUTTON} ${LIGHT_GREY}`}>
              Revert
            </button>
          </div>
        ) : (
          <div className="pointer-events-auto flex h-[34px] items-center">
            <span className="my-[4px] text-[18px] tracking-[0.2px] text-white/80 [text-shadow:0_0_12px_rgb(0_0_0/0.4)]">{hero.name}</span>
            <button onClick={save} data-sound="ui_generic_button_click" title="Copy a link to this look" className={`${BUTTON} ${LIGHT_GREY} ml-[12px]`}>
              {copied ? "Copied" : "Save"}
            </button>
          </div>
        )}
      </div>
      {/* .BottomDash */}
      <span aria-hidden className="relative my-[12px] h-px w-[600px] bg-[linear-gradient(90deg,#fff0_10%,#fff_34%,#fff_66%,#fff0_90%)] opacity-[0.04]" />
      <div className="pointer-events-auto relative flex items-center">
        <button onClick={randomize} data-sound="ui_generic_button_click" title="Pick a random item for each slot" className={`${BUTTON} ${DARK_GREY}`}>
          Randomize
        </button>
        {/* DemoModeButton: the game's demo mode, which this site has not */}
        <span title="Demo mode is in the game only" className={`${BUTTON} ${GREEN} ml-[8px] cursor-default pr-0 hover:brightness-100`}>
          Demo Hero
          <span className="mx-[4px] size-[20px] bg-[#dae2e5]" style={washed(`${icons}arrow_top_right.svg`)} />
          <span className="ml-[8px] flex h-full w-[34px] items-center justify-center border-l border-black/30">
            <span className="size-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-[#dae2e5]" />
          </span>
        </span>
      </div>
    </div>
  );
}
