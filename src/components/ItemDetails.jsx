import { useEffect, useState } from "react";
import { formatPrice, itemIcon, rarity } from "../catalog.js";
import { ARMORY_CATEGORIES } from "../armory.js";
import { fetchData } from "../fetchData.js";
import { loadUiSounds } from "../uiSounds.js";
import { getViewSettings, onViewSettings, setViewSettings } from "../viewSettings.js";
import { GAME_BUTTON } from "./ui.jsx";
import { SoundList } from "./Voice.jsx";
import { DOTADEX_BASE, SOUNDS_BASE } from "../datasets.js";
import { menuMusicPack } from "./Music.jsx";
import { Emoticon, emoticonRange, useEmoticons } from "./Emoticons.jsx";

// An Armory item with nothing to stand in the scene (an Interface tab's: a loading screen, a
// music pack...), shown over the list until its own page is ported from the game's item details
// (dashboard_page_owned_item_details): its picture, rarity, category, date, whether the store
// sells it, and what it plays.

let library = null;
function loadLibrary(modelsBase) {
  library ??= fetchData(`${DOTADEX_BASE}data/audio-library.json`)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));
  return library;
}

// The sounds/music folder of a pack's events (<pack>.music.*): the same name, else the folder its
// menu music plays from (shop_jbrice_01 plays from jbrice_01)
async function musicFolder(modelsBase, pack) {
  const [files, sounds] = await Promise.all([loadLibrary(modelsBase), loadUiSounds(modelsBase)]);
  if (files.music?.[pack]) {
    return pack;
  }
  const first = sounds?.events?.[`${pack}.music.ui_main`]?.files?.[0];
  return first?.match(/^sounds\/music\/([^/]+)\//)?.[1] ?? null;
}

// A music pack with menu music is equipped as in the game's Armory: its tracks play in the menu
export function EquipMusic({ modelsBase, folder }) {
  const [playable, setPlayable] = useState(false);
  const [equipped, setEquipped] = useState(() => getViewSettings().musicPack === folder);
  useEffect(() => {
    let cancelled = false;
    loadUiSounds(modelsBase).then((data) => !cancelled && setPlayable(Boolean(menuMusicPack(data, folder))));
    const stop = onViewSettings((settings) => setEquipped(settings.musicPack === folder));
    setEquipped(getViewSettings().musicPack === folder);
    return () => {
      cancelled = true;
      stop();
    };
  }, [modelsBase, folder]);
  if (!playable) {
    return null;
  }
  return equipped ? (
    <p className="text-[16px] tracking-[1.5px] text-[#c5dcff] uppercase">Equipped</p>
  ) : (
    // #ActionButton:active, as the Armory's EQUIP
    <button onClick={() => setViewSettings({ musicPack: folder })} data-sound="ui_loadout_equipped" className={GAME_BUTTON}>
      Equip
    </button>
  );
}

// The sound files an item plays: a music pack's folder, an announcer's
function useSounds(modelsBase, item) {
  const [state, setState] = useState({ folder: null, files: null });
  useEffect(() => {
    let cancelled = false;
    setState({ folder: null, files: null });
    if (!item.music && !item.announcer) {
      return;
    }
    (async () => {
      const files = await loadLibrary(modelsBase);
      const folder = item.music ? await musicFolder(modelsBase, item.music) : item.announcer;
      const list = (item.music ? files.music : files.announcers)?.[folder] ?? [];
      !cancelled && setState({ folder, files: list });
    })();
    return () => {
      cancelled = true;
    };
  }, [modelsBase, item]);
  return state;
}

// The Armory's pictures by item (data/armory.json): a loading screen's full picture
let armoryData = null;
function useArmoryPicture(modelsBase, item) {
  const [picture, setPicture] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setPicture(null);
    if (item.category !== "loading_screens") {
      return;
    }
    armoryData ??= fetchData(`${DOTADEX_BASE}data/armory.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
    armoryData.then((data) => !cancelled && setPicture(data.loadingScreens?.[item.id] ?? null));
    return () => {
      cancelled = true;
    };
  }, [modelsBase, item]);
  return picture && `${DOTADEX_BASE}${picture}`;
}

// A cursor pack's cursors (data/cursors.json: { pack: { cursor: [hot x, hot y] } })
let cursorData = null;
function useCursors(modelsBase, pack) {
  const [cursors, setCursors] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setCursors(null);
    if (!pack) return;
    cursorData ??= fetchData(`${DOTADEX_BASE}data/cursors.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
    cursorData.then((data) => !cancelled && setCursors(data[pack] ?? {}));
    return () => {
      cancelled = true;
    };
  }, [modelsBase, pack]);
  return cursors;
}

// The cursors' names as the game's cursor.res has them: cursor_spell_enemy -> Spell enemy
const cursorName = (name) => {
  const words = name.replace(/^cursor_/, "").replace(/_/g, " ");
  return words[0].toUpperCase() + words.slice(1);
};

// The Modifiers section's names of an item's visuals' types (dashboard_page_store_item_details's
// ListedModifier rows, DOTA_tooltip_econ_item_modifier_*)
const MODIFIERS = {
  activity: "Animation",
  announcer: "Announcer",
  hud_skin: "HUD",
  ability_name: "Ability Name",
  loading_screen: "Loading Screen",
  cursor_pack: "Cursor Pack",
  portrait_game: "Portrait",
  particle_create: "Ambient Effects",
  custom_kill_effect: "Kill Effects",
  particle: "Custom Effects",
  particle_clientside: "Custom Effects",
  model: "Model",
  entity_clientside_model: "Model",
  additional_wearable: "Wearable",
  pet: "Pet",
  weather: "Weather",
  weather_effect: "Weather",
  sound: "Sound",
  sound_clientside: "Sound",
  soundscape: "Soundscape",
  speech: "Voice",
  icon_replacement: "Icon",
  mvp_map_override: "MVP Background",
};

// A Section of the list (#00000058, a black edge, 12 in) under its LabelLarge title
function Section({ title, children }) {
  return (
    <section className="mb-[8px] w-full border border-black/60 bg-black/[0.35] p-[12px]">
      {title && <h3 className="mb-[8px] text-[19px] leading-[24px] font-semibold tracking-[1.5px] text-[#dae2e5] uppercase">{title}</h3>}
      {children}
    </section>
  );
}

// An item's icon in a list (DOTAEconItem at 60%), opening it
function SmallItem({ item, onOpen }) {
  return (
    <button
      onClick={() => onOpen(item)}
      title={item.name}
      className="mr-[10px] mb-[6px] block h-[58px] w-[88px] overflow-hidden bg-gradient-to-b from-[#424142] from-50% to-[#9d9d9d] hover:brightness-150"
      style={{ boxShadow: `inset 0 -3px 0 ${rarity(item).color}` }}
    >
      <img src={itemIcon(item)} alt="" className="size-full object-cover" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />
    </button>
  );
}

// The item details page as the game's store shows an item (dashboard_page_store_item_details): the
// item's preview on the left (60%), the BodyBox on the right (776 wide, 71 below the page's top,
// 96 from the right, 120 above the bottom): the title bar, the rarity stripe, the banner with the
// rarity, treasure, date and slot, then the sections; the rarity and name under the preview
export default function ItemDetails({ catalog, item, onClose, onOpen }) {
  const look = rarity(item);
  const category = ARMORY_CATEGORIES[item.category];
  const row = category?.rows?.find(([id]) => id === item.row)?.[1];
  const { folder, files } = useSounds(catalog.modelsBase, item);
  const sounds = Boolean(item.music || item.announcer);
  const picture = useArmoryPicture(catalog.modelsBase, item);
  const emoticons = useEmoticons(catalog.modelsBase);
  const unlocked = item.emoticons && emoticons ? emoticonRange(emoticons, item.emoticons) : [];
  const cursors = useCursors(catalog.modelsBase, item.cursor);
  const cursorUrl = (name) => `${DOTADEX_BASE}images/cursors/${item.cursor}/${name}.png`;
  // The pack's default cursor over the whole page, to try it
  const cursorStyle = cursors?.cursor_default ? { cursor: `url(${cursorUrl("cursor_default")}) ${cursors.cursor_default[0]} ${cursors.cursor_default[1]}, auto` } : undefined;
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // The treasure it drops from, the bundles it comes in, the items a bundle holds
  const treasure = catalog.treasures.find((chest) => chest.tiers.some((tier) => tier.includes(item.id)));
  const bundles = catalog.items.filter((entry) => entry.contents?.includes(item.id));
  const contents = (item.contents ?? []).map((id) => catalog.itemsById[id]).filter(Boolean);
  const modifiers = [...new Set((item.modifiers ?? []).map((type) => MODIFIERS[type]).filter(Boolean))];

  return (
    <div role="dialog" aria-label={item.name} className="pointer-events-auto absolute inset-0 z-30 flex bg-[#0d0e12]" style={cursorStyle}>
      {/* .ModelContainer: the item's own picture where the game stands its model */}
      <div className="relative flex w-[60%] flex-col items-center justify-center pb-[120px]">
        <img
          src={picture ?? itemIcon(item)}
          alt=""
          className={
            picture
              ? "w-[92%] shadow-[0_0_40px_rgb(0_0_0/0.8)]"
              : "h-[420px] w-[630px] bg-gradient-to-b from-[#424142] from-50% to-[#9d9d9d] object-cover shadow-[0_0_40px_rgb(0_0_0/0.8)]"
          }
          onError={(event) => (event.currentTarget.style.visibility = "hidden")}
        />
        {/* .PrimaryControls' .ItemInfo: the rarity (18) and the name (24) at the bottom, right */}
        <div className="absolute right-[20px] bottom-[124px] flex flex-col items-end tracking-[1px] uppercase">
          <span className="mr-[7px] text-[18px] font-medium" style={{ color: look.color }}>
            {look.name}
          </span>
          <span className="mr-[6px] text-[24px] font-medium text-white/70">{item.name}</span>
          {item.music && folder && (
            <span className="mt-[10px]">
              <EquipMusic modelsBase={catalog.modelsBase} folder={folder} />
            </span>
          )}
        </div>
      </div>
      {/* .BodyBox */}
      <div className="mt-[71px] mr-[96px] mb-[120px] flex w-[776px] shrink-0 flex-col border-2 border-black bg-gradient-to-b from-[#2d2e30] to-[#202529] shadow-[0_0_12px_#000000aa]">
        <div className="relative flex items-center bg-[linear-gradient(110deg,#2b2e2fee,#2b2e2f)]">
          <img src={itemIcon(item)} alt="" className="h-[58px] w-[88px] shrink-0 object-cover" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />
          <h2 className="ml-[12px] w-[525px] truncate text-[32px] leading-[1.3] font-bold text-white">{item.name}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            data-sound="ui_generic_button_click"
            className="absolute top-0 right-0 grid size-[40px] place-items-center bg-black/70 text-[26px] leading-none text-white/70 hover:bg-black hover:text-white"
          >
            ×
          </button>
        </div>
        <span aria-hidden className="h-[12px] shrink-0" style={{ background: look.color }} />
        {/* #Banner: 100 high, the rarity, the treasure, the date and the slot */}
        <div className="flex h-[100px] shrink-0 border-y border-black">
          <div className="mt-[6px] ml-[16px] flex flex-col text-[16px] leading-[22px] text-[#b0bcc2]">
            <span>
              Rarity: <span style={{ color: look.color }}>{look.name}</span>
            </span>
            {treasure && (
              <button onClick={() => onOpen({ $treasure: treasure })} className="text-left hover:brightness-[4]">
                Included in: {treasure.name}
              </button>
            )}
            {item.date && <span>Released: {item.date}</span>}
            <span>Slot: {row ?? category?.label ?? "Item"}</span>
          </div>
          <div className="mt-[6px] mr-[16px] ml-auto flex flex-col items-end text-[16px] leading-[22px] text-[#8b989e]">
            <span>{item.store ? "Purchasable" : "Unavailable"}</span>
            {item.price !== undefined && <span title="The lowest offer on DMarket and Skinport">Market: from {formatPrice(item.price)}</span>}
          </div>
        </div>
        {/* .SectionList */}
        <div className="min-h-0 flex-1 overflow-y-auto p-[8px] pb-0 scrollbar-thin">
          {contents.length > 0 && (
            <Section title="Included in this Bundle">
              <div className="flex flex-wrap">
                {contents.map((entry) => (
                  <SmallItem key={entry.id} item={entry} onOpen={onOpen} />
                ))}
              </div>
            </Section>
          )}
          {bundles.length > 0 && (
            <Section title="Purchasing Options">
              <div className="flex flex-wrap">
                {bundles.map((entry) => (
                  <SmallItem key={entry.id} item={entry} onOpen={onOpen} />
                ))}
              </div>
            </Section>
          )}
          {unlocked.length > 0 && (
            <Section title="Emoticons">
              <div className="flex flex-wrap">
                {unlocked.map((emoticon) => (
                  <Emoticon key={emoticon.id} modelsBase={catalog.modelsBase} emoticon={emoticon} size={64} />
                ))}
              </div>
            </Section>
          )}
          {cursors && Object.keys(cursors).length > 0 && (
            <Section title="Cursors">
              {/* Each cursor of the pack, shown as itself when the pointer is over it */}
              <ul className="grid grid-cols-3 gap-[6px]">
                {Object.entries(cursors).map(([name, [x, y]]) => (
                  <li key={name} className="flex items-center gap-[10px] bg-black/30 px-[10px] py-[6px] hover:bg-white/[0.06]" style={{ cursor: `url(${cursorUrl(name)}) ${x} ${y}, auto` }}>
                    <img src={cursorUrl(name)} alt="" className="size-[32px] shrink-0 [image-rendering:pixelated]" />
                    <span className="truncate text-[15px] text-[#b0bcc2]">{cursorName(name)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {sounds && (
            <Section title={item.music ? "Tracks" : "Lines"}>
              {files === null ? (
                <p className="text-[16px] text-[#8b989e]">Loading the sounds</p>
              ) : files.length ? (
                <SoundList base={SOUNDS_BASE} files={files} />
              ) : (
                <p className="text-[16px] text-[#8b989e]">No sounds of this pack in the dataset</p>
              )}
            </Section>
          )}
          {modifiers.length > 0 && (
            <Section title="Modifiers">
              <ul className="flex flex-wrap">
                {modifiers.map((name) => (
                  <li key={name} className="my-[3px] ml-[6px] w-[180px] text-[16px] text-[#b0bcc2]">
                    {name}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
        {/* .ItemEditFooter */}
        <div className="h-[64px] shrink-0 border-t border-white/[0.01] bg-[#1d2023] shadow-[0_-1px_8px_rgb(0_0_0/0.6)]" />
      </div>
    </div>
  );
}
