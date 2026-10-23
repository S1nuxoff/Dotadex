import { useEffect, useMemo, useRef, useState } from "react";
import { GamePills, useUiLayout } from "./ui.jsx";
import { SearchBox, SecondaryTabs } from "./Armory.jsx";

// The Scenes section: a scene of the game fills the screen, seen through the camera the game's
// interface shows it with; the game's tabs under the top bar sort the scenes by what they are, a
// column on the left lists them in groups, the scene's name and its cameras sit at the bottom.
// Laid out as the Armory (dashboard_page_collection), in the game's pixels on a 1080 high screen.

// What a scene is, by its folder: the tab it goes under, the group in it, and the name it is
// listed by once the group's words are taken off
const TABS = [
  ["heroes", "Heroes"],
  ["menu", "Main Menu"],
  ["events", "Events"],
  ["maps", "Maps"],
];

// Words read as the game writes them
const WORDS = { ti: "TI", bp: "BP", mvp: "MVP", dota: "Dota", cm: "CM", ui: "UI", fx: "FX", hud: "HUD", bg: "Background", fg: "Foreground" };
function words(text) {
  return text
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower in WORDS) {
        return WORDS[lower];
      }
      const ti = lower.match(/^ti(\d+)$/);
      if (ti) {
        return `TI${ti[1]}`;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .filter(Boolean)
    .join(" ");
}

// Hero ids inside a scene's name as the heroes' own names: "antimage_persona" -> "Anti-Mage Persona"
function withHeroes(text, heroes) {
  const parts = text.split("_");
  const out = [];
  let plain = [];
  for (let i = 0; i < parts.length; i++) {
    // The longest run of words that is a hero's id ("faceless_void")
    let end = parts.length;
    while (end > i && !heroes[parts.slice(i, end).join("_")]) {
      end--;
    }
    if (end > i) {
      out.push(words(plain.join("_")), heroes[parts.slice(i, end).join("_")].name);
      plain = [];
      i = end - 1;
    } else {
      plain.push(parts[i]);
    }
  }
  out.push(words(plain.join("_")));
  return out.filter(Boolean).join(" ");
}

// { tab, group, name } for a scene, or null for the pieces the game builds its maps from (prefabs,
// tilesets, test maps) that are no scene to look at. folders: the second level folders there are
// ("scenes/battlepass_ti7"), so a scene lying next to them joins the one its name starts with.
function placeOf(scene, heroes, folders) {
  const path = scene.id.split("/");
  const file = path[path.length - 1];
  const folder = path.length > 1 ? path[0] : "";
  const sub =
    path.length > 2
      ? path[1]
      : (folders.get(folder) ?? []).filter((name) => file.startsWith(`${name}_`)).sort((a, b) => b.length - a.length)[0] ?? "";
  if (path.some((part) => /^(prefabs|tilesets)$/.test(part)) || /(^|_)test(_|$)|^blackmap$|^creeptests$|^modular_library/.test(file)) {
    return null;
  }
  // The game's maps, played or shown as a preview of a terrain
  if (!folder || folder === "terrain_previews") {
    return { tab: "maps", group: folder === "terrain_previews" ? "Terrain Previews" : "Maps", name: withHeroes(file.replace(/_preview$/, ""), heroes) };
  }
  if (folder === "backgrounds") {
    const hero = file.match(/^(hero_showcase|hero_frontpage|tower_showcase)_(.+)$/);
    if (hero) {
      return { tab: "heroes", group: { hero_showcase: "Hero Showcases", hero_frontpage: "Hero Debuts", tower_showcase: "Tower Showcases" }[hero[1]], name: withHeroes(hero[2], heroes) };
    }
    const dashboard = file.match(/^dashboard_(?:background|parallax)_(.+)$/);
    return { tab: "menu", group: dashboard ? "Dashboard Backgrounds" : "Backgrounds", name: withHeroes(dashboard ? dashboard[1] : file, heroes) };
  }
  if (folder === "scenes" && /^(mvp|versus)$/.test(sub)) {
    return { tab: "heroes", group: sub === "mvp" ? "MVP Showcases" : "Versus Screens", name: withHeroes(file.replace(/^(mvp|versus)_/, ""), heroes) };
  }
  if (folder === "scenes" && /^(dashboard_background|treasure)$/.test(sub)) {
    return { tab: "menu", group: sub === "treasure" ? "Treasures" : "Dashboard Backgrounds", name: withHeroes(file, heroes) };
  }
  if (folder === "ui" || (folder === "scenes" && /^(hud|glossary|new_player|learn_model_preview|loadout_preview|dota_ui_mystery_box_reward)$/.test(sub || file))) {
    return { tab: "menu", group: "Interface", name: withHeroes(file, heroes) };
  }
  // Battle passes, events and the rest: the group is the folder the scene is in
  const group = sub || folder;
  const name = file.startsWith(`${group}_`) ? file.slice(group.length + 1) : file;
  return { tab: "events", group: group === "scenes" ? "Other" : words(group.replace(/^battlepass_/, "battle_pass_")), name: withHeroes(name || file, heroes) };
}

export function scenePlaces(catalog) {
  const heroes = catalog.heroesById;
  const folders = new Map();
  for (const scene of catalog.scenes) {
    const path = scene.id.split("/");
    if (path.length > 2) {
      folders.set(path[0], [...new Set([...(folders.get(path[0]) ?? []), path[1]])]);
    }
  }
  const places = {};
  for (const scene of catalog.scenes) {
    const place = placeOf(scene, heroes, folders);
    if (place) {
      places[scene.id] = place;
    }
  }
  return places;
}

// The column's rows, as the Armory's hero list draws them
const row = (active) =>
  `flex w-full items-center text-left [text-shadow:0_1px_4px_#000] ${
    active ? "bg-[linear-gradient(90deg,#b4e1ff14,#fff0_95%)] text-white" : "text-[#b0bcc2] hover:bg-[linear-gradient(90deg,#96d5ff09,#fff0_95%)] hover:text-[#dae2e5]"
  }`;

export default function Scenes({ catalog, route, viewer, onOpen }) {
  const { scale, aspect } = useUiLayout();
  const places = useMemo(() => scenePlaces(catalog), [catalog]);
  const current = route.type === "scene" ? catalog.scenesById[route.id] : null;
  const [tab, setTab] = useState(() => places[current?.id]?.tab ?? TABS[0][0]);
  const [query, setQuery] = useState("");

  // The tab's scenes in their groups, the groups in the order they first come, each sorted by name
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const map = new Map();
    for (const scene of catalog.scenes) {
      const place = places[scene.id];
      if (!place || place.tab !== tab || (needle && !`${place.name} ${place.group}`.toLowerCase().includes(needle))) {
        continue;
      }
      if (!map.has(place.group)) {
        map.set(place.group, []);
      }
      map.get(place.group).push({ scene, name: place.name });
    }
    return [...map.entries()]
      .map(([group, list]) => [group, list.sort((a, b) => a.name.localeCompare(b.name))])
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [catalog, places, tab, query]);
  const total = groups.reduce((sum, [, list]) => sum + list.length, 0);

  // A scene is always on screen: the tab's first when the one shown is not in it
  useEffect(() => {
    if (!query && groups[0]?.[1][0] && places[current?.id]?.tab !== tab) {
      onOpen({ type: "scene", id: groups[0][1][0].scene.id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // The row of the scene shown scrolls into view when the scene changes from elsewhere
  const listRef = useRef(null);
  useEffect(() => {
    listRef.current?.querySelector("[aria-current=true]")?.scrollIntoView({ block: "nearest" });
  }, [current?.id]);

  const place = current && places[current.id];
  const cameras = Object.keys(current?.cameras ?? {});
  const camera = route.camera && current?.cameras?.[route.camera] ? route.camera : current?.camera?.name;
  const sides = aspect === "16x10" ? 32 : 60;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0d0e12]">
      <div className="absolute inset-0">{viewer}</div>
      {/* The column's side of the scene darkened, so its names read over any scene */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[40%] bg-gradient-to-r from-black/75 via-black/40 to-transparent" />

      <div className="pointer-events-none absolute inset-0 flex flex-col" style={{ zoom: scale }}>
        <div className="pointer-events-auto">
          <SecondaryTabs
            tabs={TABS}
            tab={tab}
            onTab={(next) => {
              setTab(next);
              setQuery("");
            }}
          />
        </div>

        <div className="flex min-h-0 flex-1 pt-[17px]" style={{ paddingLeft: sides, paddingRight: sides }}>
          {/* The list of the tab's scenes, as the Armory's column of heroes */}
          <div className="pointer-events-auto flex w-[380px] shrink-0 flex-col pb-[60px]">
            <SearchBox value={query} onChange={setQuery} placeholder="Filter scenes" className="mt-[8px] mb-[4px]" />
            <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pt-[8px] pr-[6px] scrollbar-thin">
              {total === 0 && <p className="py-[32px] text-center text-[18px] text-[#8b989e]/50">Nothing to display</p>}
              {groups.map(([group, list]) => (
                <section key={group} className="mb-[18px]">
                  <h3 className="mb-[4px] ml-[6px] flex items-center">
                    <span className="text-[16px] leading-[20px] tracking-[1.5px] text-[#8b989e] uppercase">{group}</span>
                    <span className="ml-[6px] text-[14px] leading-[20px] text-[#8b989e]/60">({list.length})</span>
                  </h3>
                  <ul>
                    {list.map(({ scene, name }) => (
                      <li key={scene.id}>
                        <button
                          onClick={() => onOpen({ type: "scene", id: scene.id })}
                          aria-current={scene.id === current?.id}
                          className={`${row(scene.id === current?.id)} px-[12px] py-[6px]`}
                        >
                          <span className="truncate text-[18px] leading-[24px] font-semibold tracking-[1px] uppercase">{name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>

          {/* The cameras the game has in the scene, when there is more than one */}
          {place && cameras.length > 1 && (
            <div className="pointer-events-auto mt-auto mb-[60px] ml-[32px]">
              <GamePills
                label="Camera"
                value={camera}
                onChange={(name) => onOpen({ type: "scene", id: current.id, camera: name === current.camera?.name ? undefined : name })}
                options={cameras.map((name) => ({ value: name, label: words(name.replace(/(^|_)cam(era)?(_|$)/g, "$1$3")) || "Main" }))}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
