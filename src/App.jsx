import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { prefetchModels } from "./viewer/stage.js";
import { installUiSounds } from "./uiSounds.js";
import TopNav, { SECTIONS, sectionOf } from "./components/TopNav.jsx";
import HeroGrid from "./components/HeroGrid.jsx";
import HeroPage, { Backdrop } from "./components/HeroPage.jsx";
import Armory from "./components/Armory.jsx";
import { useUiScale } from "./components/ui.jsx";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { List, X } from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import Scenes from "./components/Scenes.jsx";
import Viewer from "./components/Viewer.jsx";
import Wardrobe, { EquippedSummary, OutfitPicker } from "./components/Wardrobe.jsx";
import HeroInfo from "./components/HeroInfo.jsx";
import Voice from "./components/Voice.jsx";
import { AudioPage, ShopPage, TreasurePage } from "./components/InfoPages.jsx";
import {
  HOME_TITLE,
  isKnown,
  listOf,
  loadCatalog,
  loadExported,
  outfitFor,
  outfitParticles,
  outfitActivities,
  outfitUrls,
  homePath,
  pageMeta,
  parseRoute,
  personaOf,
  routePath,
  withExported,
} from "./catalog.js";

// How often to look for models exported since the page opened
const REFRESH_MS = 3 * 60 * 1000;

function tabFor(catalog, route) {
  if (!route || route.type === "hero") {
    return "heroes";
  }
  if (route.type === "shop") {
    return "shop";
  }
  if (route.type === "treasure") {
    return "armory";
  }
  if (route.type === "audio") {
    return catalog.audioById[route.id]?.kind ?? "music";
  }
  if (route.type === "scene") {
    return "scenes";
  }
  return "armory";
}

// A light model to open with: heroes carry hundreds of animations and take a while
const WELCOME_ITEM = "10096";

function firstRoute(catalog) {
  if (catalog.itemsById[WELCOME_ITEM]) {
    return { type: "item", id: WELCOME_ITEM };
  }
  if (catalog.heroes[0]) {
    return { type: "hero", id: catalog.heroes[0].id, slots: {} };
  }
  return catalog.items[0] ? { type: "item", id: catalog.items[0].id } : null;
}

// The right panel of a hero: its data, or what it wears
function HeroPanel({ catalog, outfit, language, wardrobe, onView }) {
  const [view, setView] = useState(outfit.focus ? "wardrobe" : "hero");
  // The loadout needs room: the panel widens while it is open
  useEffect(() => onView?.(view), [view, onView]);
  const hero = catalog.heroesById[outfit.hero];
  return (
    <div className="flex h-full flex-col bg-panel">
      {/* Tabs as the game's hero pick has them: STRATEGY / LOADOUT, spaced capitals parted by slashes */}
      <div className="flex items-center gap-3 border-b border-line px-5 pt-5 pb-4" role="tablist">
        {[
          ["hero", "Hero"],
          ["voice", "Voice"],
          ["wardrobe", "Loadout"],
        ].map(([id, label], index) => (
          <Fragment key={id}>
            {index > 0 && (
              <span className="text-lg text-ash/40" aria-hidden>
                /
              </span>
            )}
            <button
              role="tab"
              data-sound="toptab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`font-display text-[15px] tracking-[0.14em] transition-colors ${
                view === id ? "text-bone [text-shadow:0_0_12px_rgb(255_255_255/0.25)]" : "text-ash/70 hover:text-bone"
              }`}
            >
              {label}
            </button>
          </Fragment>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {view === "hero" && <HeroInfo base={catalog.modelsBase} heroKey={`npc_dota_hero_${hero.id}`} language={language} />}
        {view === "voice" && <Voice modelsBase={catalog.modelsBase} heroKey={`npc_dota_hero_${hero.id}`} />}
        {view === "wardrobe" && wardrobe}
      </div>
    </div>
  );
}

function useLanguage() {
  const [language, setLanguage] = useState(() => {
    try {
      return localStorage.getItem("language") ?? "english";
    } catch {
      return "english";
    }
  });
  const change = (value) => {
    setLanguage(value);
    try {
      localStorage.setItem("language", value);
    } catch {}
  };
  return [language, change];
}

function useWide() {
  const query = "(min-width: 1280px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}

function Sheet({ open, onClose, label, side, children }) {
  const reduce = useReducedMotion();
  const from = side === "right" ? { x: "100%" } : { y: "100%" };
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button className="absolute inset-0 bg-black/50" onClick={onClose} aria-label={`Close ${label}`} />
          <motion.div
            initial={reduce ? false : from}
            animate={{ x: 0, y: 0 }}
            exit={reduce ? { opacity: 0 } : from}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className={
              side === "right"
                ? "absolute inset-y-0 right-0 w-[min(26rem,100%)] border-l border-line"
                : "absolute inset-x-0 bottom-0 h-[85%] overflow-hidden rounded-t-2xl border-t border-line"
            }
            role="dialog"
            aria-label={label}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function App() {
  const [base, setBase] = useState(null);
  const [exported, setExported] = useState(null);
  const [error, setError] = useState(null);
  const [route, setRoute] = useState(null);
  const [tab, setTab] = useState("heroes");
  const [browse, setBrowse] = useState(false);
  const [wardrobe, setWardrobe] = useState(false);
  // Where CHANGE OUTFIT opens: the full sets, or the slot whose tile was clicked
  const [pickerStart, setPickerStart] = useState("sets");
  // Each hero's page scene as the game sets it: pedestal, light, cameras
  const [portraits, setPortraits] = useState({});
  useEffect(() => {
    if (!base) {
      return;
    }
    fetch(`${base.modelsBase}data/loadout_portraits.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .then(setPortraits, () => {});
  }, [base]);
  // Another hero opens on its page, not in the picker left open for the last one
  const routeHero = route?.type === "hero" ? route.id : null;
  useEffect(() => setWardrobe(false), [routeHero]);
  const [panelView, setPanelView] = useState("hero");
  // The hero grid, as the game opens on it, until a hero is picked; a link to a page opens that page
  const [heroGrid, setHeroGrid] = useState(() => !parseRoute(window.location));
  const wide = useWide();
  const uiScale = useUiScale();
  const [language, setLanguage] = useLanguage();

  const catalog = useMemo(() => base && exported && withExported(base, exported), [base, exported]);

  useEffect(() => {
    loadCatalog()
      .then(async (loaded) => {
        const done = await loadExported(loaded.modelsBase);
        const ready = withExported(loaded, done);
        const fromLink = parseRoute(window.location);
        const known = isKnown(ready, fromLink);
        const first = known ? fromLink : firstRoute(ready);
        setBase(loaded);
        setExported(done);
        setRoute(first);
        // A page not shown (yet) opens the hero grid, the first page waiting behind it
        if (known) {
          setTab(tabFor(ready, first));
        } else {
          setHeroGrid(true);
        }
      })
      .catch((reason) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!base) {
      return;
    }
    const timer = setInterval(() => {
      loadExported(base.modelsBase)
        .then((next) => setExported((current) => (current && next.size === current.size ? current : next)))
        .catch(() => {});
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [base]);

  useEffect(() => {
    if (!catalog) {
      return;
    }
    // The browser's back and forward buttons
    const onPop = () => {
      const next = parseRoute(window.location);
      if (isKnown(catalog, next)) {
        setRoute(next);
        setTab(tabFor(catalog, next));
        setHeroGrid(false);
      } else {
        setTab("heroes");
        setHeroGrid(true);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [catalog]);

  // The first model to arrive is shown when the page opened before any was exported
  useEffect(() => {
    if (catalog && !route) {
      const first = firstRoute(catalog);
      if (first) {
        setRoute(first);
        setTab(tabFor(catalog, first));
      }
    }
  }, [catalog, route]);

  const page = ["shop", "treasure", "audio"].includes(route?.type);
  const outfit = useMemo(() => catalog && route && !page && outfitFor(catalog, route), [catalog, route, page]);

  // The pages visited, for the back and forward arrows of the top bar; a change of look on the
  // same hero or item is not a new page
  const [visited, setVisited] = useState({ stack: [], index: -1 });
  const travelling = useRef(false);
  const pageKey = route && (heroGrid && sectionOf(tab).id === "heroes" ? "grid" : `${tab}|${route.type}:${route.id}`);
  useEffect(() => {
    if (!pageKey) {
      return;
    }
    if (travelling.current) {
      travelling.current = false;
      return;
    }
    setVisited(({ stack, index }) => {
      if (stack[index]?.key === pageKey) {
        return { stack, index };
      }
      const next = [...stack.slice(0, index + 1), { key: pageKey, route, tab, heroGrid }].slice(-100);
      return { stack: next, index: next.length - 1 };
    });
    // Only a new page is recorded
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);
  const travel = (step) => {
    const target = visited.stack[visited.index + step];
    if (!target) {
      return;
    }
    travelling.current = true;
    setVisited({ ...visited, index: visited.index + step });
    setRoute(target.route);
    setTab(target.tab);
    setHeroGrid(target.heroGrid);
  };
  // The address follows what is on screen: a new page is a new entry of the browser's history,
  // a change of look on the same page replaces it (the first one too, so an old #/ link is
  // rewritten). The tab's title is the page's, as the static page of the link has it.
  const address = pageKey && (pageKey === "grid" ? homePath() : routePath(route));
  const addressed = useRef(false);
  useEffect(() => {
    if (!address) {
      return;
    }
    const here = window.location.pathname + window.location.search;
    if (address !== here || window.location.hash) {
      const samePage = address.split("?")[0] === window.location.pathname;
      window.history[samePage || !addressed.current ? "replaceState" : "pushState"](null, "", address);
    }
    addressed.current = true;
    const entry = pageKey !== "grid" && listOf(catalog, route.type)?.[route.id];
    document.title = entry ? pageMeta(route.type, entry, catalog).title : HOME_TITLE;
    // The address is made from the route
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);
  const urls = useMemo(() => catalog && outfit && outfitUrls(catalog, outfit), [catalog, outfit]);
  const particles = useMemo(() => (catalog && outfit ? outfitParticles(catalog, outfit) : []), [catalog, outfit]);
  const activities = useMemo(() => (catalog && outfit ? outfitActivities(catalog, outfit) : []), [catalog, outfit]);

  // A hero or item the pointer rests on starts downloading, after a moment so a sweep down
  // the list does not start them all
  const prefetchTimer = useRef(null);
  const prefetch = (next) => {
    clearTimeout(prefetchTimer.current);
    if (!next || next.type !== "hero") {
      return;
    }
    prefetchTimer.current = setTimeout(() => {
      const look = outfitFor(catalog, next);
      prefetchModels(outfitUrls(catalog, look));
    }, 450);
  };

  const open = (next) => {
    setHeroGrid(false);
    setRoute(next);
    setBrowse(false);
  };

  // Dressing up always ends on the hero's route, with what is worn in the link
  const equip = (slot, id) => {
    const slots = { ...outfit.slots };
    if (id) {
      slots[slot] = { id, style: 0 };
    } else {
      delete slots[slot];
    }
    open({ type: "hero", id: outfit.hero, slots, persona: outfit.persona });
  };
  // A persona's set switches to the persona, a plain set back from it
  const equipSet = (set) => {
    const persona = personaOf(set.items.map((id) => catalog.itemsById[id]).find(Boolean)?.slot);
    const slots = persona === outfit.persona ? { ...outfit.slots } : {};
    for (const id of set.items) {
      slots[catalog.itemsById[id].slot] = { id, style: 0 };
    }
    open({ type: "hero", id: outfit.hero, slots, persona });
  };
  // The hero's own body or one of its personas, keeping what is worn in that body's slots
  const choosePersona = (persona) => {
    const slots = Object.fromEntries(Object.entries(outfit.slots).filter(([slot]) => personaOf(slot) === persona));
    open({ type: "hero", id: outfit.hero, slots, persona, bare: outfit.bare });
  };

  // The game's interface sounds for the whole page
  useEffect(() => {
    if (catalog) {
      installUiSounds(catalog.modelsBase.replace("dota2-models", "dota2-sounds"));
    }
  }, [catalog]);

  if (error) {
    return (
      <main className="grid h-full place-items-center p-6">
        <div className="max-w-sm">
          <p className="font-display text-2xl text-bone">The viewer could not start</p>
          <p className="mt-2 text-sm text-ash">{error} Reload the page to try again.</p>
        </div>
      </main>
    );
  }

  if (!catalog) {
    return (
      <main className="grid h-full place-items-center">
        <p className="font-display text-xl text-ash">Loading the model list</p>
      </main>
    );
  }

  if (!route) {
    return (
      <main className="grid h-full place-items-center p-6">
        <div className="max-w-sm">
          <p className="font-display text-2xl text-bone">No models are exported yet</p>
          <p className="mt-2 text-sm text-ash">They show up here as the export runs. This page checks for new ones every few minutes.</p>
        </div>
      </main>
    );
  }

  const sidebar = (
    <Sidebar catalog={catalog} tab={tab} onTab={setTab} route={route} onOpen={open} onPrefetch={prefetch} language={language} onLanguage={setLanguage} embedded />
  );
  const wardrobeView = outfit?.hero && (
    <Wardrobe
      catalog={catalog}
      outfit={outfit}
      onEquip={equip}
      onEquipSet={equipSet}
      onReset={() => open({ type: "hero", id: outfit.hero, slots: {}, persona: outfit.persona })}
      onClose={wide ? null : () => setWardrobe(false)}
    />
  );
  const wardrobePanel = outfit?.hero && (
    <HeroPanel key={outfit.hero} catalog={catalog} outfit={outfit} language={language} wardrobe={wardrobeView} onView={setPanelView} />
  );
  const section = sectionOf(tab);
  // The game's loadout scene for what is on screen (loadout_portraits): the hero's own, else its
  // entries for a courier, a ward or anything else
  const shownItem = route?.type === "item" ? catalog.itemsById[route.id] : null;
  // A persona has its own entry (npc_dota_hero_antimage_persona1: its light, shadow and cameras)
  // (dev switch ?herolight: the hero's entry for a persona too, as before 6c9ef56, to compare)
  const heroLight = import.meta.env.DEV && window.location.search.includes("herolight");
  const personaKey = outfit?.persona && !heroLight ? `npc_dota_hero_${outfit.hero}_persona${outfit.persona}` : null;
  const portraitKey = outfit?.hero
    ? (personaKey && portraits[personaKey] ? personaKey : `npc_dota_hero_${outfit.hero}`)
    : shownItem?.kind === "courier"
    ? "default_courier"
    : shownItem?.kind === "ward"
    ? "default_ward"
    : "default_entity_replacement";
  // The Armory's scene is the hero page's, moved 600 right (#SceneGroup)
  const armory = section.id === "armory";
  // The Scenes section puts the scene's name and cameras on its own page
  const scenes = section.id === "scenes";
  const viewer = !page && (
    <Viewer
      catalog={catalog}
      language={language}
      hideTitle={(route.type === "hero" && section.id === "heroes") || armory || scenes}
      controlsRight={scenes}
      loadout={(route.type === "hero" && section.id === "heroes") || armory}
      armory={armory}
      frameShift={armory ? (-600 * uiScale) / document.documentElement.clientWidth : route.type === "hero" && section.id === "heroes" && wardrobe ? 0.26 : 0}
      portrait={portraits[portraitKey] ?? null}
      // The game's hero page opens on this camera (its panel starts on the set preview slot)
      portraitShot={armory ? "default" : "econ_set_preview"}
      outfit={outfit}
      urls={urls}
      particles={particles}
      activities={activities}
      onStyle={(style) => open({ ...route, style })}
      onAlone={(alone) => open({ ...route, alone })}
      onVariant={(variant) => open({ ...route, variant })}
      onBare={(bare) => open({ ...route, bare })}
      onPersona={choosePersona}
      onWardrobe={wide ? null : () => setWardrobe(true)}
    />
  );
  // The heroes in the game's order of names, for the arrows to the previous and next one
  const heroOrder = catalog.heroes.filter((entry) => entry.id !== "target_dummy").sort((a, b) => a.name.localeCompare(b.name));
  const heroIndex = route.type === "hero" ? heroOrder.findIndex((entry) => entry.id === route.id) : -1;
  const pickSection = (entry) => {
    setTab(entry.tabs[0][0]);
    setHeroGrid(entry.id === "heroes");
  };

  return (
    <main className="flex h-full flex-col">
      <TopNav
        catalog={catalog}
        tab={tab}
        onTab={setTab}
        onSection={pickSection}
        onHome={() => pickSection(SECTIONS[0])}
        onBack={() => travel(-1)}
        onForward={() => travel(1)}
        canBack={visited.index > 0}
        canForward={visited.index < visited.stack.length - 1}
        onRandom={() => {
          setTab("heroes");
          open({ type: "hero", id: heroOrder[Math.floor(Math.random() * heroOrder.length)].id });
        }}
        language={language}
        onLanguage={setLanguage}
      />

      {section.id === "heroes" && heroGrid ? (
        <HeroGrid catalog={catalog} onOpen={open} onPrefetch={prefetch} />
      ) : section.id === "heroes" && route.type === "hero" && heroIndex >= 0 ? (
        <HeroPage
          catalog={catalog}
          hero={heroOrder[heroIndex]}
          language={language}
          viewer={viewer}
          summary={
            <EquippedSummary
              catalog={catalog}
              outfit={outfit}
              onChange={(start) => {
                setPickerStart(start);
                setWardrobe(true);
              }}
            />
          }
          wardrobe={
            <OutfitPicker
              key={`${route.id}-${outfit.persona ?? 0}-${pickerStart}`}
              start={pickerStart}
              catalog={catalog}
              outfit={outfit}
              onEquip={equip}
              onEquipSet={equipSet}
              onReset={() => open({ type: "hero", id: outfit.hero, slots: {}, persona: outfit.persona })}
              onClose={() => setWardrobe(false)}
            />
          }
          persona={outfit.persona ?? 0}
          onPersona={choosePersona}
          wardrobeOpen={wardrobe}
          onCloseWardrobe={() => setWardrobe(false)}
          previous={heroOrder[(heroIndex - 1 + heroOrder.length) % heroOrder.length]}
          next={heroOrder[(heroIndex + 1) % heroOrder.length]}
          onOpen={open}
        />
      ) : armory ? (
        <Armory
          catalog={catalog}
          route={route}
          outfit={outfit}
          viewer={viewer}
          backdrop={outfit?.hero ? <Backdrop base={catalog.modelsBase} heroId={outfit.hero} /> : null}
          onOpen={open}
        />
      ) : scenes ? (
        <Scenes catalog={catalog} route={route} viewer={viewer} onOpen={open} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-[23rem] shrink-0 border-r border-line lg:block xl:w-[26rem]">{sidebar}</div>

          <div className="relative min-w-0 flex-1">
            {route.type === "shop" && <ShopPage catalog={catalog} id={route.id} language={language} onOpen={open} />}
            {route.type === "treasure" && <TreasurePage catalog={catalog} id={route.id} onOpen={open} />}
            {route.type === "audio" && <AudioPage catalog={catalog} id={route.id} />}
            {viewer}
            <button
              onClick={() => setBrowse(true)}
              className="absolute top-4 left-4 inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-panel/80 px-3 text-sm text-bone lg:hidden"
            >
              <List className="size-4" /> Browse
            </button>
          </div>

          {wide && wardrobePanel && (
            <div
              className={`shrink-0 border-l border-line transition-[width] duration-300 ${
                panelView === "wardrobe" ? "w-[44rem] 2xl:w-[54rem]" : "w-[26rem] xl:w-[29rem]"
              }`}
            >
              {wardrobePanel}
            </div>
          )}
        </div>
      )}

      <Sheet open={browse} onClose={() => setBrowse(false)} label="the model list" side="bottom">
        {sidebar}
        <button onClick={() => setBrowse(false)} className="absolute top-5 right-4 grid size-8 place-items-center rounded-md text-ash hover:text-bone" aria-label="Close">
          <X className="size-5" />
        </button>
      </Sheet>
      <Sheet open={!wide && wardrobe && Boolean(wardrobePanel)} onClose={() => setWardrobe(false)} label="the wardrobe" side="right">
        {wardrobePanel}
      </Sheet>
    </main>
  );
}
