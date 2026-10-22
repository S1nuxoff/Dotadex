// Game data from the dataset's data/ folder: heroes, abilities, shop items, treasures,
// and the texts in the chosen language (English fills what a language lacks).
import { useEffect, useState } from "react";
import { fetchData } from "./fetchData.js";

export const LANGUAGES = [
  ["english", "English"],
  ["russian", "Русский"],
  ["ukrainian", "Українська"],
  ["german", "Deutsch"],
  ["french", "Français"],
  ["spanish", "Español"],
  ["latam", "Español (LatAm)"],
  ["portuguese", "Português"],
  ["brazilian", "Português (Brasil)"],
  ["polish", "Polski"],
  ["czech", "Čeština"],
  ["italian", "Italiano"],
  ["turkish", "Türkçe"],
  ["schinese", "简体中文"],
  ["tchinese", "繁體中文"],
  ["japanese", "日本語"],
  ["koreana", "한국어"],
  ["thai", "ไทย"],
  ["vietnamese", "Tiếng Việt"],
  ["romanian", "Română"],
  ["hungarian", "Magyar"],
  ["bulgarian", "Български"],
  ["greek", "Ελληνικά"],
  ["dutch", "Nederlands"],
  ["swedish", "Svenska"],
  ["danish", "Dansk"],
  ["finnish", "Suomi"],
  ["norwegian", "Norsk"],
];

const cache = new Map();

function load(base, file) {
  const url = `${base}data/${file}`;
  if (!cache.has(url)) {
    const promise = fetchData(url).then((res) => {
      if (!res.ok) {
        throw new Error(`${file} did not load (HTTP ${res.status}).`);
      }
      return res.json();
    });
    promise.catch(() => cache.delete(url));
    cache.set(url, promise);
  }
  return cache.get(url);
}

// { data, error } once loaded; files: ["heroes.json", ...]
export function useGameData(base, files, language = "english") {
  const [state, setState] = useState({ data: null, error: null });
  const key = `${files.join(",")}|${language}`;
  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ data: current.data, error: null }));
    Promise.all([
      ...files.map((file) => load(base, file)),
      load(base, "i18n/english.json"),
      language === "english" ? null : load(base, `i18n/${language}.json`).catch(() => ({})),
    ])
      .then((results) => {
        if (cancelled) {
          return;
        }
        const english = results[files.length];
        const local = results[files.length + 1] ?? {};
        // The game spells some keys DOTA_Tooltip_Ability_ and others DOTA_Tooltip_ability_,
        // so texts are looked up without regard to case
        const lower = {};
        for (const [key, value] of Object.entries({ ...english, ...local })) {
          lower[key.toLowerCase()] = value;
        }
        const texts = new Proxy(lower, { get: (target, key) => (typeof key === "string" ? target[key.toLowerCase()] : undefined) });
        const data = Object.fromEntries(files.map((file, index) => [file.replace(/\.json$/, ""), results[index]]));
        setState({ data: { ...data, texts }, error: null });
      })
      .catch((error) => !cancelled && setState({ data: null, error: error.message }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, key]);
  return state;
}

export function imageUrl(base, path) {
  return `${base}images/${path}_png.png`;
}

export function abilityIcon(base, name, ability) {
  return imageUrl(base, `spellicons/${ability?.AbilityTextureName ?? name}`);
}

export function shopItemIcon(base, name, item) {
  const texture = item?.AbilityTextureName?.replace(/^item_/, "") ?? name.replace(/^item_/, "");
  return imageUrl(base, `items/${texture}`);
}

// "150 220 290 360" -> "150 / 220 / 290 / 360"
function levels(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = typeof value === "object" ? value.value : value;
  if (text === undefined) {
    return null;
  }
  const parts = String(text).trim().split(/\s+/);
  const clean = parts.map((part) => part.replace(/^=/, "").replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1"));
  return [...new Set(clean)].length === 1 ? clean[0] : clean.join(" / ");
}

// An ability's value by key, from AbilityValues or the older AbilitySpecial
export function abilityValue(ability, key) {
  if (!ability) {
    return null;
  }
  if (ability.AbilityValues && key in ability.AbilityValues) {
    return levels(ability.AbilityValues[key]);
  }
  for (const entry of Object.values(ability.AbilitySpecial ?? {})) {
    if (key in entry) {
      return levels(entry[key]);
    }
  }
  if (key in ability) {
    return levels(ability[key]);
  }
  return null;
}

// Fills %key% placeholders, turns <br> into new lines and drops other markup
export function fillText(text, ability) {
  if (!text) {
    return "";
  }
  return text
    .replace(/%(\w+)%(%%)?/g, (match, key, percent) => {
      const value = abilityValue(ability, key) ?? abilityValue(ability, key.replace(/^d/, ""));
      return value === null ? match : `${value}${percent ? "%" : ""}`;
    })
    .replace(/%%/g, "%")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\\n/g, "\n")
    .trim();
}

// Labels and values of an ability's numbers the game lists under its description
export function abilityStats(ability, name, texts) {
  const result = [];
  for (const key of Object.keys(ability?.AbilityValues ?? {})) {
    const label = texts[`DOTA_Tooltip_ability_${name}_${key}`];
    const value = abilityValue(ability, key);
    if (label && value !== null && !label.startsWith("#")) {
      const percent = label.startsWith("%");
      result.push({ label: label.replace(/^[%+$]+/, "").replace(/:$/, ""), value: percent ? `${value}%` : value });
    }
  }
  return result;
}

export const ATTRIBUTES = {
  DOTA_ATTRIBUTE_STRENGTH: { name: "Strength", color: "#e0533e" },
  DOTA_ATTRIBUTE_AGILITY: { name: "Agility", color: "#3fc364" },
  DOTA_ATTRIBUTE_INTELLECT: { name: "Intelligence", color: "#3f9fe0" },
  DOTA_ATTRIBUTE_ALL: { name: "Universal", color: "#c58bf0" },
};
