import { useLayoutEffect, useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import { listOf, pageMeta, routePath } from "../catalog.js";

// A hero or an item shown on another site, in an iframe (/Dotadex/embed/hero/pudge): the scene
// alone, as the page shows it. It waits behind its picture until clicked, so a page with several
// does not load them all at once (?autoplay=1 starts it at once); a link opens the full page
// (?link=0 leaves it out). ?bg=0: no background of its own (no stage color, no hero backdrop), the
// model standing on the other site's page

export default function Embed({ catalog, route, viewer, backdrop }) {
  const settings = new URLSearchParams(window.location.search);
  const [started, setStarted] = useState(() => settings.get("autoplay") === "1");
  const withLink = settings.get("link") !== "0";
  const clear = settings.get("bg") === "0";
  // The page under the scene let through: the frame's document clear, in the dark scheme (a frame
  // whose scheme differs from its page's gets an opaque canvas from the browser)
  useLayoutEffect(() => {
    if (!clear) {
      return;
    }
    for (const el of [document.documentElement, document.body, document.getElementById("root")]) {
      if (el) {
        el.style.background = "transparent";
      }
    }
    document.documentElement.style.colorScheme = "dark";
  }, [clear]);
  const entry = listOf(catalog, route.type)?.[route.id];
  const meta = entry ? pageMeta(route.type, entry, catalog) : null;
  const name = entry?.name?.trim() ?? "";
  const full = `${window.location.origin}${routePath(route)}`;

  return (
    <main className={`relative h-full overflow-hidden ${clear ? "" : "bg-stage"}`}>
      {started ? (
        <>
          {!clear && backdrop}
          {viewer}
        </>
      ) : (
        <button onClick={() => setStarted(true)} className="group absolute inset-0 grid place-items-center" aria-label={`View ${name} in 3D`}>
          {meta?.image && <img src={meta.image} alt="" className="absolute inset-0 size-full scale-110 object-cover opacity-35 blur-md" />}
          {meta?.image && <img src={meta.image} alt="" className="relative max-h-[45%] max-w-[60%] rounded-lg object-contain shadow-2xl" />}
          <span className="absolute bottom-[12%] inline-flex items-center gap-2 rounded-full bg-white/90 px-5 py-2.5 text-[15px] font-medium text-black shadow-xl transition-transform group-hover:scale-105">
            <Play className="size-4 fill-current" /> View {name} in 3D
          </span>
        </button>
      )}
      {withLink && (
      <a
        href={full}
        target="_blank"
        rel="noreferrer"
        title={`Open ${name} in Dotadex`}
        className="absolute right-3 bottom-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1.5 text-[12px] text-white/80 backdrop-blur transition-colors hover:bg-black/65 hover:text-white"
      >
        Dotadex <ExternalLink className="size-3" />
      </a>
      )}
    </main>
  );
}
