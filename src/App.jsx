import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { List, X } from "lucide-react";
import Sidebar from "./components/Sidebar.jsx";
import Viewer from "./components/Viewer.jsx";
import { loadCatalog, parseHash } from "./catalog.js";

function tabFor(catalog, selection) {
  if (!selection || selection.type === "hero") {
    return "heroes";
  }
  return catalog.itemsById[selection.id]?.kind ?? "wearable";
}

function isKnown(catalog, selection) {
  return Boolean(selection && (selection.type === "hero" ? catalog.heroesById : catalog.itemsById)[selection.id]);
}

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(null);
  const [selection, setSelection] = useState(null);
  const [tab, setTab] = useState("heroes");
  const [drawer, setDrawer] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    loadCatalog()
      .then((loaded) => {
        const fromLink = parseHash(window.location.hash);
        const first = isKnown(loaded, fromLink)
          ? fromLink
          : loaded.heroes[0]
            ? { type: "hero", id: loaded.heroes[0].id }
            : { type: "item", id: loaded.items[0].id };
        setCatalog(loaded);
        setSelection(first);
        setTab(tabFor(loaded, first));
      })
      .catch((reason) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!catalog) {
      return;
    }
    const onHash = () => {
      const next = parseHash(window.location.hash);
      if (isKnown(catalog, next)) {
        setSelection(next);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [catalog]);

  const select = (next) => {
    window.history.replaceState(null, "", `#/${next.type}/${encodeURIComponent(next.id)}`);
    setSelection(next);
    setDrawer(false);
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

  if (!catalog || !selection) {
    return (
      <main className="grid h-full place-items-center">
        <p className="font-display text-xl text-ash">Loading the model list</p>
      </main>
    );
  }

  const sidebar = <Sidebar catalog={catalog} tab={tab} onTab={setTab} selected={selection} onSelect={select} />;

  return (
    <main className="flex h-full">
      <div className="hidden w-80 shrink-0 border-r border-line lg:block">{sidebar}</div>

      <div className="relative min-w-0 flex-1">
        <Viewer catalog={catalog} selection={selection} />
        <button
          onClick={() => setDrawer(true)}
          className="absolute top-4 left-4 inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-panel/80 px-3 text-sm text-bone lg:hidden"
        >
          <List className="size-4" /> Browse models
        </button>
      </div>

      <AnimatePresence>
        {drawer && (
          <motion.div className="fixed inset-0 z-30 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} aria-label="Close the model list" />
            <motion.div
              initial={reduce ? false : { y: "100%" }}
              animate={{ y: 0 }}
              exit={reduce ? { opacity: 0 } : { y: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 320 }}
              className="absolute inset-x-0 bottom-0 h-[85%] overflow-hidden rounded-t-2xl border-t border-line"
              role="dialog"
              aria-label="Models"
            >
              {sidebar}
              <button
                onClick={() => setDrawer(false)}
                className="absolute top-5 right-4 grid size-8 place-items-center rounded-md text-ash hover:text-bone"
                aria-label="Close"
              >
                <X className="size-5" />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
