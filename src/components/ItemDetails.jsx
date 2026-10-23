import { useEffect, useState } from "react";
import { formatPrice, itemIcon, rarity } from "../catalog.js";
import { ARMORY_CATEGORIES } from "../armory.js";
import { fetchData } from "../fetchData.js";
import { loadUiSounds } from "../uiSounds.js";
import { getViewSettings, onViewSettings, setViewSettings } from "../viewSettings.js";
import { GAME_BUTTON } from "./ui.jsx";
import { SoundList, soundsBase } from "./Voice.jsx";
import { menuMusicPack } from "./Music.jsx";

// An Armory item with nothing to stand in the scene (an Interface tab's: a loading screen, a
// music pack...), shown over the list until its own page is ported from the game's item details
// (dashboard_page_owned_item_details): its picture, rarity, category, date, whether the store
// sells it, and what it plays.

let library = null;
function loadLibrary(modelsBase) {
  library ??= fetchData(`${modelsBase}data/audio-library.json`)
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

export default function ItemDetails({ catalog, item, onClose }) {
  const look = rarity(item);
  const category = ARMORY_CATEGORIES[item.category];
  const row = category?.rows?.find(([id]) => id === item.row)?.[1];
  const { folder, files } = useSounds(catalog.modelsBase, item);
  const sounds = Boolean(item.music || item.announcer);
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-label={item.name}
        onClick={(event) => event.stopPropagation()}
        className="relative flex max-h-[86%] w-[880px] flex-col overflow-hidden bg-[radial-gradient(140%_100%_at_0%_0%,#202833f4,#06080e)] shadow-[0_28px_120px_-8px_rgb(0_0_0/0.8)]"
      >
        <span aria-hidden className="h-[4px] shrink-0" style={{ background: look.color }} />
        <div className="flex gap-[24px] p-[24px]">
          <img
            src={itemIcon(item)}
            alt=""
            className="h-[220px] w-[330px] shrink-0 bg-gradient-to-b from-[#424142] from-50% to-[#9d9d9d] object-cover"
            onError={(event) => (event.currentTarget.style.visibility = "hidden")}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <h2 className="font-display text-[26px] leading-[1.2] font-bold tracking-[1.5px] text-white uppercase">{item.name}</h2>
            <p className="mt-[8px] text-[16px] tracking-[1px] uppercase">
              <span style={{ color: look.color }}>{look.name}</span>
              <span className="text-[#8b989e]"> · {row ?? category?.label ?? "Item"}</span>
            </p>
            {item.date && <p className="mt-[6px] text-[16px] text-[#8b989e]">Released {item.date}</p>}
            <p className="mt-[6px] text-[16px] text-[#8b989e]">
              {item.store ? "Purchasable in the store" : "Unavailable in the store"}
              {item.price !== undefined && ` · Market ${formatPrice(item.price)}`}
            </p>
            {item.music && folder && (
              <div className="mt-auto pt-[16px]">
                <EquipMusic modelsBase={catalog.modelsBase} folder={folder} />
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="absolute top-[14px] right-[16px] text-[26px] leading-none text-white/40 hover:text-white">
            ×
          </button>
        </div>
        {sounds && (
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/[0.04] px-[24px] py-[16px] scrollbar-thin">
            {files === null ? (
              <p className="text-[16px] text-[#8b989e]">Loading the sounds</p>
            ) : files.length ? (
              <SoundList base={soundsBase(catalog.modelsBase)} files={files} />
            ) : (
              <p className="text-[16px] text-[#8b989e]">No sounds of this pack in the dataset</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
