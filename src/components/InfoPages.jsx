import { Box } from "lucide-react";
import { RARITIES, itemIcon, treasureScene } from "../catalog.js";
import { GAME_BUTTON, ItemCard } from "./ui.jsx";
import { SoundList, soundsBase } from "./Voice.jsx";
import { useEffect, useState } from "react";
import { fetchData } from "../fetchData.js";
import { loadUiSounds } from "../uiSounds.js";
import { menuMusicPack } from "./Music.jsx";
import { getViewSettings, onViewSettings, setViewSettings } from "../viewSettings.js";

function Page({ children }) {
  return (
    <section className="stage-backdrop h-full overflow-y-auto scrollbar-thin" style={{ "--rim": "#c9a45c" }}>
      <div className="mx-auto max-w-3xl px-5 pt-20 pb-12 sm:px-8 lg:pt-12">{children}</div>
    </section>
  );
}

export function TreasurePage({ catalog, id, onOpen }) {
  const treasure = catalog.treasuresById[id];
  const rarity = RARITIES[treasure.rarity] ?? RARITIES.common;
  const total = treasure.tiers.reduce((sum, tier) => sum + tier.length, 0);
  const scene = treasureScene(catalog, treasure);

  return (
    <Page>
      <div className="flex items-start gap-5">
        <img src={itemIcon(treasure)} alt="" className="h-[106px] w-[160px] shrink-0 rounded-lg object-contain" onError={(event) => (event.currentTarget.style.visibility = "hidden")} />
        <div className="min-w-0">
          <p className="flex flex-wrap gap-x-3 text-sm">
            <span style={{ color: rarity.color }}>{rarity.name} treasure</span>
            {treasure.date && <span className="text-ash">{treasure.date.slice(0, 4)}</span>}
            {treasure.retired && <span className="text-ash">No longer available</span>}
          </p>
          <h2 className="mt-1 font-display text-4xl leading-tight text-bone sm:text-5xl">{treasure.name}</h2>
          <p className="mt-2 text-sm text-ash">{total} items can drop from it.</p>
          {scene && (
            <button
              onClick={() => onOpen({ type: "scene", id: scene.id })}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-bone transition-colors hover:border-ash/50"
            >
              <Box className="size-4 text-ash" aria-hidden /> Open the chest in its scene
            </button>
          )}
        </div>
      </div>

      {treasure.tiers.map((tier, index) => {
        const ready = tier.map((itemId) => catalog.itemsById[itemId]).filter(Boolean);
        return (
          <section key={index} className="mt-10">
            <h3 className="mb-3 text-sm text-bone">
              {treasure.tiers.length > 1 ? `Tier ${index + 1}` : "Contents"}
              <span className="ml-2 text-xs text-ash tabular-nums">{tier.length}</span>
            </h3>
            {ready.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {ready.map((item) => (
                  <ItemCard key={item.id} item={item} caption={catalog.heroNames[item.hero] ?? undefined} onClick={() => onOpen({ type: "item", id: item.id })} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-ash">These items have no models to show.</p>
            )}
            {ready.length > 0 && ready.length < tier.length && (
              <p className="mt-2 text-xs text-ash">{tier.length - ready.length} more have no models to show.</p>
            )}
          </section>
        );
      })}
    </Page>
  );
}

// A music pack with menu music is equipped as in the game's Armory: its tracks play in the menu
function EquipMusic({ modelsBase, folder }) {
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
    <p className="mt-4 text-sm tracking-[1.5px] text-[#c5dcff] uppercase">Equipped</p>
  ) : (
    // #ActionButton:active, as the Armory's EQUIP
    <button onClick={() => setViewSettings({ musicPack: folder })} data-sound="ui_loadout_equipped" className={`${GAME_BUTTON} mt-4`}>
      Equip
    </button>
  );
}

export function AudioPage({ catalog, id }) {
  const pack = catalog.audioById[id];
  const [files, setFiles] = useState(null);
  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    fetchData(`${catalog.modelsBase}data/audio-library.json`)
      .then((res) => res.json())
      .then((library) => {
        const [kind, folder] = id.split("/");
        if (!cancelled) {
          setFiles(library[kind]?.[folder] ?? []);
        }
      })
      .catch(() => !cancelled && setFiles([]));
    return () => {
      cancelled = true;
    };
  }, [catalog, id]);

  return (
    <Page>
      <p className="text-sm text-ash">{pack.kind === "announcers" ? "Announcer pack" : "Music pack"}</p>
      <h2 className="mt-1 font-display text-4xl leading-tight text-bone sm:text-5xl">{pack.name}</h2>
      <p className="mt-2 text-sm text-ash">{pack.count} sounds.</p>
      {pack.kind === "music" && <EquipMusic modelsBase={catalog.modelsBase} folder={id.split("/")[1]} />}
      <div className="mt-8">{files ? <SoundList base={soundsBase(catalog.modelsBase)} files={files} /> : <p className="text-sm text-ash">Loading the list</p>}</div>
    </Page>
  );
}
