import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { List, X } from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import Viewer from "./components/Viewer.jsx";
import Wardrobe from "./components/Wardrobe.jsx";
import HeroInfo from "./components/HeroInfo.jsx";
import {
  isKnown,
  loadCatalog,
  loadExported,
  outfitFor,
  outfitUrls,
  parseRoute,
  routeHash,
  withExported,
} from "./catalog.js";

// How often to look for models exported since the page opened
const REFRESH_MS = 3 * 60 * 1000;

function tabFor(catalog, route) {
  if (!route || route.type === "hero") {
    return "heroes";
  }
  return catalog.itemsById[route.id]?.kind ?? "wearable";
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
function HeroPanel({ catalog, outfit, language, wardrobe }) {
  const [view, setView] = useState(outfit.focus ? "wardrobe" : "hero");
  const hero = catalog.heroesById[outfit.hero];
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex gap-1 border-b border-line px-4 pt-4 pb-3" role="tablist">
        {[
          ["hero", hero.name],
          ["wardrobe", "Wardrobe"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${view === id ? "bg-raised text-bone" : "text-ash hover:text-bone"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {view === "hero" ? <HeroInfo base={catalog.modelsBase} heroKey={`npc_dota_hero_${hero.id}`} language={language} /> : wardrobe}
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
                ? "absolute inset-y-0 right-0 w-[min(22rem,100%)] border-l border-line"
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
  const wide = useWide();
  const [language, setLanguage] = useLanguage();

  const catalog = useMemo(() => base && exported && withExported(base, exported), [base, exported]);

  useEffect(() => {
    loadCatalog()
      .then(async (loaded) => {
        const done = await loadExported(loaded.modelsBase);
        const ready = withExported(loaded, done);
        const fromLink = parseRoute(window.location.hash);
        const first = isKnown(ready, fromLink) ? fromLink : firstRoute(ready);
        setBase(loaded);
        setExported(done);
        setRoute(first);
        setTab(tabFor(ready, first));
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
    const onHash = () => {
      const next = parseRoute(window.location.hash);
      if (isKnown(catalog, next)) {
        setRoute(next);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
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

  const outfit = useMemo(() => catalog && route && outfitFor(catalog, route), [catalog, route]);
  const urls = useMemo(() => catalog && outfit && outfitUrls(catalog, outfit), [catalog, outfit]);

  const open = (next) => {
    window.history.replaceState(null, "", routeHash(next));
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
    open({ type: "hero", id: outfit.hero, slots });
  };
  const equipSet = (set) => {
    const slots = { ...outfit.slots };
    for (const id of set.items) {
      slots[catalog.itemsById[id].slot] = { id, style: 0 };
    }
    open({ type: "hero", id: outfit.hero, slots });
  };

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
    <Sidebar catalog={catalog} tab={tab} onTab={setTab} route={route} onOpen={open} language={language} onLanguage={setLanguage} />
  );
  const wardrobeView = outfit.hero && (
    <Wardrobe
      catalog={catalog}
      outfit={outfit}
      onEquip={equip}
      onEquipSet={equipSet}
      onReset={() => open({ type: "hero", id: outfit.hero, slots: {} })}
      onClose={wide ? null : () => setWardrobe(false)}
    />
  );
  const wardrobePanel = outfit.hero && (
    <HeroPanel key={outfit.hero} catalog={catalog} outfit={outfit} language={language} wardrobe={wardrobeView} />
  );

  return (
    <main className="flex h-full">
      <div className="hidden w-80 shrink-0 border-r border-line lg:block">{sidebar}</div>

      <div className="relative min-w-0 flex-1">
        <Viewer
          catalog={catalog}
          outfit={outfit}
          urls={urls}
          onStyle={(style) => open({ ...route, style })}
          onAlone={(alone) => open({ ...route, alone })}
          onVariant={(variant) => open({ ...route, variant })}
          onBare={(bare) => open({ ...route, bare })}
          onWardrobe={wide ? null : () => setWardrobe(true)}
        />
        <button
          onClick={() => setBrowse(true)}
          className="absolute top-4 left-4 inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-panel/80 px-3 text-sm text-bone lg:hidden"
        >
          <List className="size-4" /> Browse
        </button>
      </div>

      {wide && wardrobePanel && <div className="w-[22rem] shrink-0 border-l border-line">{wardrobePanel}</div>}

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
