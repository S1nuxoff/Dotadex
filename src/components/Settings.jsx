import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LANGUAGES } from "../gamedata.js";
import { getVolume, onVolume, setVolume, VOLUME_DEFAULTS } from "../volume.js";
import { playUiSound } from "../uiSounds.js";
import { getViewSettings, onViewSettings, setViewSettings } from "../viewSettings.js";
import { useDismiss, useUiLayout, VALVE_NOTICE } from "./ui.jsx";
import "./Settings.css";
import { panoramaFile, panoramaImage } from "../datasets.js";

// The game's settings window (popup_settings_reborn.xml / .css): the navigation on the left with
// its search, the sections below each other on the right. Sizes are the game's layout pixels,
// scaled with the screen as the rest of the interface. Only the sections the site has a setting
// for are shown, under the game's names (dota_english.txt).
const SECTIONS = [
  {
    id: "game",
    title: "Game",
    icon: "settings_options",
    subsections: [
      {
        id: "camera",
        title: "Camera",
        settings: [{ kind: "check", name: "freeCamera", label: "Free Camera", hint: "Turn, zoom and pan on hero pages" }],
      },
    ],
  },
  {
    id: "video",
    title: "Video",
    icon: "display",
    subsections: [
      {
        id: "rendering",
        title: "Rendering",
        settings: [
          { kind: "check", name: "particles", label: "Particles", hint: "The game's effects on heroes and items" },
          { kind: "check", name: "fog", label: "Fog Between Heroes", hint: "Drifting fog instead of the game's crossfade" },
        ],
      },
    ],
  },
  {
    id: "audio",
    title: "Audio",
    icon: "volume_max",
    reset: () => setVolume({ ...VOLUME_DEFAULTS }),
    subsections: [
      {
        id: "volume",
        title: "Volume",
        settings: [
          { kind: "volume", name: "master", label: "Master Volume" },
          { kind: "volume", name: "music", label: "Music" },
          { kind: "volume", name: "effects", label: "Game Sounds", hint: "Voice lines, animation sounds and previews" },
        ],
      },
    ],
  },
  {
    // The game's Language section has no subsections: Text and Audio side by side
    id: "language",
    title: "Language",
    icon: "globe",
    settings: [{ kind: "language", name: "language", label: "Text", hint: "Hero, ability and item texts" }],
  },
];

// Every setting with where it is, for the search
const ALL = SECTIONS.flatMap((section) =>
  section.subsections
    ? section.subsections.flatMap((sub) => sub.settings.map((setting) => ({ ...setting, section: section.id, subsection: sub.id })))
    : section.settings.map((setting) => ({ ...setting, section: section.id }))
);

// dota_settings_no_results_message_0..9, one picked for each search that finds nothing
const NO_RESULTS = [
  "No results.",
  "No results!",
  "Try again.",
  "Search harder.",
  "Misplaced by smeevils.",
  "Snatched by greevils.",
  "Eaten by Tidehunter.",
  "Last seen with Riki.",
  "Lost in the void.",
  "No, none of that.",
];

// @define NavigationSectionPanelHeight / NavigationSubsectionPanelHeight / NavigationSearchResultHeight
const SECTION_HEIGHT = 48;
const SUBSECTION_HEIGHT = 38;
const RESULT_HEIGHT = 30;

const matches = (text, query) => query !== "" && text.toLowerCase().includes(query.toLowerCase());

// A label with the searched text marked (.SearchedText)
function Searched({ text, query }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, at)}
      <span className="gs-searched">{text.slice(at, at + query.length)}</span>
      {text.slice(at + query.length)}
    </>
  );
}

// An interface icon (control_icons/24px), drawn by the colour the class gives it
function Icon({ base, name, className }) {
  const url = `url(${panoramaFile(`control_icons/24px/${name}.svg`)}) center / contain no-repeat`;
  return <span aria-hidden className={`block ${className}`} style={{ mask: url, WebkitMask: url }} />;
}

// DOTASettingsCheckbox: a tick box and its label
function Checkbox({ name, label, hint, query }) {
  const [on, setOn] = useState(() => getViewSettings()[name]);
  useEffect(() => onViewSettings((settings) => setOn(settings[name])), [name]);
  return (
    <button role="checkbox" aria-checked={on} title={hint} onClick={() => setViewSettings({ [name]: !on })} className="gs-checkbox" data-setting={name}>
      <span className="gs-tickbox" />
      <span className="gs-checkbox-label">
        <Searched text={label} query={query} />
      </span>
    </button>
  );
}

// DOTASettingsSlider with percentage="true": the title and value over a horizontal Slider
function VolumeSlider({ name, label, hint, query }) {
  const [levels, setLevels] = useState(getVolume);
  useEffect(() => onVolume(setLevels), []);
  const value = levels[name];
  return (
    <label className="gs-slider" title={hint} data-setting={name}>
      <span className="flex">
        <span className="grow">
          <Searched text={label} query={query} />
        </span>
        <span>{Math.round(value * 100)}%</span>
      </span>
      <span className="gs-slider-body" style={{ "--value": value }}>
        <span className="gs-slider-track">
          <span className="gs-slider-progress" />
        </span>
        <span className="gs-slider-thumb" />
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={value}
          aria-label={label}
          onChange={(event) => setVolume({ [name]: Number(event.target.value) })}
        />
      </span>
    </label>
  );
}

// DropDown and its DropDownMenu
function DropDown({ label, value, options, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, setOpen);
  const current = options.find((option) => option.value === value);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={label} className={`gs-dropdown ${open ? "gs-dropdown-open" : ""}`}>
        <span className="truncate">{current?.label}</span>
      </button>
      <div role="listbox" className={`gs-dropdown-menu ${open ? "gs-dropdown-menu-visible" : ""}`}>
        {options.map((option) => (
          <button
            key={option.value}
            role="option"
            aria-selected={option.value === value}
            tabIndex={open ? 0 : -1}
            onClick={() => {
              onChange(option.value);
              setOpen(false);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Setting({ setting, query, language, onLanguage }) {
  if (setting.kind === "check") {
    return <Checkbox {...setting} query={query} />;
  }
  if (setting.kind === "volume") {
    return <VolumeSlider {...setting} query={query} />;
  }
  return (
    <div title={setting.hint} data-setting={setting.name}>
      <span className="gs-label">
        <Searched text={setting.label} query={query} />
      </span>
      <div className="h-[8px]" />
      <DropDown label={setting.label} value={language} onChange={onLanguage} options={LANGUAGES.map(([value, label]) => ({ value, label }))} />
    </div>
  );
}

// Settings in two columns side by side (.SettingsSectionColumnContainer), or one under the other
// with 8 pixels between (the Volume box's sliders)
function SettingsBox({ settings, stacked, active, ...rest }) {
  const items = (list) => list.map((setting) => <Setting key={setting.name} setting={setting} {...rest} />);
  if (stacked) {
    return (
      <div className={`gs-filled flex flex-col gap-[8px] ${active ? "gs-filled-active" : ""}`}>
        {items(settings)}
      </div>
    );
  }
  const half = Math.ceil(settings.length / 2);
  return (
    <div className={`gs-filled flex ${active ? "gs-filled-active" : ""}`}>
      <div className="flex min-w-0 flex-1 flex-col">{items(settings.slice(0, half))}</div>
      <div className="w-[24px] shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">{items(settings.slice(half))}</div>
    </div>
  );
}

// ButtonPrimary (LightGrey with the close button's class)
function ButtonPrimary({ light, className = "", children, ...rest }) {
  return (
    <button className={`gs-button ${light ? "gs-button-light" : ""} ${className}`} {...rest}>
      {children}
    </button>
  );
}

function Navigation({ base, query, onQuery, active, activeSub, onSection, onSubsection, results, picked, onResult }) {
  const searching = query !== "";
  const [message, setMessage] = useState(0);
  const none = searching && results.length === 0;
  useEffect(() => {
    if (none) setMessage(Math.floor(Math.random() * NO_RESULTS.length));
  }, [none, query]);
  // The list's mask once it has loaded: a mask that fails to load would hide the whole list
  const [scrollMask, setScrollMask] = useState(null);
  useEffect(() => {
    const image = new Image();
    image.onload = () => setScrollMask(`url(${image.src})`);
    image.src = panoramaImage("masks/soft_top_bottom_vscroll_psd");
    return () => (image.onload = null);
  }, [base]);
  return (
    <nav aria-label="Settings sections" className={`gs-nav ${none ? "gs-nav-none" : ""}`}>
      <div aria-hidden className="gs-nav-rock" style={{ backgroundImage: `url(${panoramaImage("settings/settings_rock_texture_png")})` }} />
      <div className="gs-search">
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search" aria-label="Search the settings" spellCheck={false} />
        <Icon base={base} name="search" className="gs-search-icon" />
        <button
          aria-label="Clear the search"
          onClick={() => onQuery("")}
          className={`gs-search-clear ${searching ? "gs-search-clear-shown" : ""}`}
          style={{ backgroundImage: `url(${panoramaImage("control_icons/x_close_filled_png")})` }}
        />
      </div>
      <div className="gs-nav-buttons" style={scrollMask ? { "--scroll-mask": scrollMask } : undefined}>
        {SECTIONS.map((section) => {
          const found = results.filter((result) => result.section === section.id);
          const hidden = searching && found.length === 0;
          const subs = !searching && section.id === active ? section.subsections ?? [] : [];
          return (
            <Fragment key={section.id}>
              <div className="gs-nav-anim" style={{ height: hidden ? 0 : SECTION_HEIGHT, opacity: hidden ? 0 : 1 }}>
                <button onClick={() => onSection(section.id)} aria-current={section.id === active} className={`gs-nav-section ${section.id === active ? "gs-selected" : ""}`}>
                  <Icon base={base} name={section.icon} className="gs-nav-icon" />
                  <span className="gs-nav-text">{section.title}</span>
                </button>
              </div>
              {/* .SettingsSectionSubNavigationContainer: the open section's subsections */}
              <div className="gs-nav-anim" style={{ height: subs.length * SUBSECTION_HEIGHT }}>
                {(section.subsections ?? []).map((sub) => (
                  <button
                    key={sub.id}
                    tabIndex={subs.length ? 0 : -1}
                    onClick={() => onSubsection(section.id, sub.id)}
                    className={`gs-nav-sub ${section.id === active && sub.id === activeSub ? "gs-selected" : ""}`}
                  >
                    <span className="gs-nav-sub-text">{sub.title}</span>
                  </button>
                ))}
              </div>
              {/* .SearchResultsContainer: what the search found in this section */}
              <div className="gs-nav-anim" style={{ height: found.length * RESULT_HEIGHT }}>
                {found.map((result) => (
                  <button key={result.name} onClick={() => onResult(result)} className={`gs-result ${picked === result.name ? "gs-selected" : ""}`}>
                    <span className="gs-result-text">
                      <Searched text={result.label} query={query} />
                    </span>
                  </button>
                ))}
              </div>
            </Fragment>
          );
        })}
      </div>
      <div className="gs-none" aria-live="polite">
        <span aria-hidden className="gs-none-image" style={{ backgroundImage: `url(${panoramaImage("hud/icon_courier_dead_settings_png")})` }} />
        <span className="gs-none-text">{none ? NO_RESULTS[message] : ""}</span>
      </div>
      <div aria-hidden className="gs-nav-shadow" />
    </nav>
  );
}

function SettingsWindow({ base, language, onLanguage, onClose, visible }) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const [activeSub, setActiveSub] = useState(SECTIONS[0].subsections[0].id);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null);
  const bodyRef = useRef(null);
  // Set while the body scrolls to what was picked, so the sections passed on the way do not light up
  const steering = useRef(0);
  const trimmed = query.trim();
  const results = useMemo(() => ALL.filter((setting) => matches(setting.label, trimmed)), [trimmed]);

  const scrollTo = (selector, offset = 0) => {
    const body = bodyRef.current;
    const target = body?.querySelector(selector);
    if (!target) {
      return null;
    }
    steering.current = performance.now();
    const top = target.getBoundingClientRect().top - body.getBoundingClientRect().top;
    // The body is scaled with the interface; its scroll is in its own pixels
    const scale = body.offsetHeight / body.getBoundingClientRect().height || 1;
    body.scrollTo({ top: body.scrollTop + top * scale - offset, behavior: "smooth" });
    return target;
  };

  // .SearchResultSelected: a title or setting pulses twice once scrolled to
  const pulse = (element) => {
    if (!element) {
      return;
    }
    element.classList.remove("gs-pulse");
    void element.offsetWidth;
    element.classList.add("gs-pulse");
  };

  const onSection = (id) => {
    const section = SECTIONS.find((entry) => entry.id === id);
    setActive(id);
    setActiveSub(section.subsections?.[0].id ?? null);
    scrollTo(`[data-section="${id}"]`);
  };
  const onSubsection = (id, sub) => {
    setActive(id);
    setActiveSub(sub);
    scrollTo(`[data-subsection="${id}/${sub}"]`, 24);
  };
  const onResult = (result) => {
    setPicked(result.name);
    setActive(result.section);
    setActiveSub(result.subsection ?? null);
    const target = scrollTo(`[data-setting="${result.name}"]`, 160);
    pulse(target);
  };

  // The section (and subsection) at the top of the body is the active one
  const onScroll = () => {
    if (performance.now() - steering.current < 700) {
      return;
    }
    const body = bodyRef.current;
    const line = body.getBoundingClientRect().top + body.getBoundingClientRect().height * 0.25;
    let section = SECTIONS[0].id;
    let sub = null;
    body.querySelectorAll("[data-section], [data-subsection]").forEach((element) => {
      if (element.getBoundingClientRect().top > line) {
        return;
      }
      if (element.dataset.section) {
        section = element.dataset.section;
        sub = SECTIONS.find((entry) => entry.id === section).subsections?.[0].id ?? null;
      } else {
        sub = element.dataset.subsection.split("/")[1];
      }
    });
    setActive(section);
    setActiveSub(sub);
  };

  const shared = { query: trimmed, language, onLanguage };
  return (
    <div
      className={`gs-popup ${visible ? "" : "gs-hidden"}`}
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      style={{ "--arrow": `url(${panoramaImage("control_icons/arrow_dropdown_png")})` }}
    >
      <ButtonPrimary light onClick={onClose} aria-label="Close the settings" data-sound="ui_settings_out_multi" className="gs-close">
        <Icon base={base} name="x_close" className="gs-button-image" />
      </ButtonPrimary>
      <div className="gs-container">
        <div aria-hidden className="gs-container-border" />
        <Navigation
          base={base}
          query={query}
          onQuery={(value) => {
            setQuery(value);
            setPicked(null);
          }}
          active={active}
          activeSub={activeSub}
          onSection={onSection}
          onSubsection={onSubsection}
          results={results}
          picked={picked}
          onResult={onResult}
        />
        <div aria-hidden className="gs-body-border" />
        <div ref={bodyRef} onScroll={onScroll} className="gs-body">
          {SECTIONS.map((section) => (
            <section key={section.id} data-section={section.id} className={`gs-section ${section.id === active ? "gs-active" : ""}`}>
              <div className="gs-section-title-row">
                <Icon base={base} name={section.icon} className="gs-section-icon" />
                <h2 className="gs-section-title">
                  <Searched text={section.title} query={trimmed} />
                </h2>
                {section.reset && (
                  <ButtonPrimary onClick={section.reset} data-sound="ui_generic_button_click" className="ml-auto">
                    <span className="gs-button-label">Reset to defaults</span>
                  </ButtonPrimary>
                )}
              </div>
              {section.subsections ? (
                section.subsections.map((sub) => {
                  const on = section.id === active && sub.id === activeSub;
                  return (
                    <div key={sub.id} data-subsection={`${section.id}/${sub.id}`} className={`gs-subsection ${on ? "gs-active" : ""}`}>
                      <h3 className="gs-subtitle">
                        <Searched text={sub.title} query={trimmed} />
                      </h3>
                      <SettingsBox settings={sub.settings} stacked={sub.id === "volume"} active={on} {...shared} />
                    </div>
                  );
                })
              ) : (
                <SettingsBox settings={section.settings} active={false} {...shared} />
              )}
            </section>
          ))}
          <p className="gs-notice">{VALVE_NOTICE}</p>
        </div>
      </div>
    </div>
  );
}

// The window over the whole screen while the dashboard behind it blurs (popupbackground="blur")
export default function Settings({ open, onClose, base, language, onLanguage }) {
  const { scale } = useUiLayout();
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);

  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
      // One frame hidden first, so the window comes in by its transition
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
      return () => cancelAnimationFrame(frame);
    }
    setVisible(false);
    // PopupSettingsReborn.Hidden: 0.3 s out
    const timer = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(timer);
  }, [open]);

  // DOTADashboard.PopupBackgroundBlur on everything behind the window
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--popup-blur", `${4 / (window.devicePixelRatio || 1)}px`);
    root.classList.toggle("popup-blur", open);
    return () => root.classList.remove("popup-blur");
  }, [open]);

  // oncancel: Escape closes it
  useEffect(() => {
    if (!open) {
      return;
    }
    // The close button's sound, which a click plays by its data-sound
    const escape = (event) => {
      if (event.key === "Escape") {
        playUiSound("ui_settings_out_multi");
        onClose();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, onClose]);

  if (!mounted) {
    return null;
  }
  const { clientWidth, clientHeight } = document.documentElement;
  return createPortal(
    <>
      {/* Its own layer in the page's stacking context: inside the window's container the
          multiply would blend with nothing and draw a flat grey */}
      <div aria-hidden className={`gs-wash ${visible ? "" : "opacity-0"}`} />
      <div className="fixed inset-0 z-[70] overflow-hidden">
        <div className="absolute top-0 left-0 origin-top-left" style={{ width: clientWidth / scale, height: clientHeight / scale, transform: `scale(${scale})` }}>
          <SettingsWindow base={base} language={language} onLanguage={onLanguage} onClose={onClose} visible={visible} />
        </div>
      </div>
    </>,
    document.body
  );
}
