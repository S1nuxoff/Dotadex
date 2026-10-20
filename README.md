<div align="center">

<a href="https://s1nuxoff.github.io/Dotadex/"><img src="docs/logo.png" alt="Dotadex" width="560" /></a>

### The complete Dota 2 encyclopedia in 3D

Every hero, cosmetic, courier, ward, treasure and scene of Dota 2, straight from the game files,
shown the way the game shows them.

[![Open Dotadex](https://img.shields.io/badge/Open-Dotadex-c9a45c?style=for-the-badge)](https://s1nuxoff.github.io/Dotadex/)
[![Deploy](https://img.shields.io/github/actions/workflow/status/S1nuxoff/Dotadex/deploy.yml?branch=main&style=for-the-badge&label=deploy)](https://github.com/S1nuxoff/Dotadex/actions/workflows/deploy.yml)
[![Models dataset](https://img.shields.io/badge/%F0%9F%A4%97%20dataset-dota2--models-ffcc4d?style=for-the-badge)](https://huggingface.co/datasets/Sqls1/dota2-models)

<a href="https://ko-fi.com/s1nuxoff"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support me on Ko-fi" /></a>

<br />

<a href="https://s1nuxoff.github.io/Dotadex/hero/pudge"><img src="https://huggingface.co/datasets/Sqls1/dota2-models/resolve/main/images/heroes/selection/npc_dota_hero_pudge_png.png" width="84" alt="Pudge" /></a>
<a href="https://s1nuxoff.github.io/Dotadex/hero/invoker"><img src="https://huggingface.co/datasets/Sqls1/dota2-models/resolve/main/images/heroes/selection/npc_dota_hero_invoker_png.png" width="84" alt="Invoker" /></a>
<a href="https://s1nuxoff.github.io/Dotadex/hero/juggernaut"><img src="https://huggingface.co/datasets/Sqls1/dota2-models/resolve/main/images/heroes/selection/npc_dota_hero_juggernaut_png.png" width="84" alt="Juggernaut" /></a>
<a href="https://s1nuxoff.github.io/Dotadex/hero/lina"><img src="https://huggingface.co/datasets/Sqls1/dota2-models/resolve/main/images/heroes/selection/npc_dota_hero_lina_png.png" width="84" alt="Lina" /></a>
<a href="https://s1nuxoff.github.io/Dotadex/hero/crystal_maiden"><img src="https://huggingface.co/datasets/Sqls1/dota2-models/resolve/main/images/heroes/selection/npc_dota_hero_crystal_maiden_png.png" width="84" alt="Crystal Maiden" /></a>
<a href="https://s1nuxoff.github.io/Dotadex/hero/nevermore"><img src="https://huggingface.co/datasets/Sqls1/dota2-models/resolve/main/images/heroes/selection/npc_dota_hero_nevermore_png.png" width="84" alt="Shadow Fiend" /></a>
<a href="https://s1nuxoff.github.io/Dotadex/hero/phantom_assassin"><img src="https://huggingface.co/datasets/Sqls1/dota2-models/resolve/main/images/heroes/selection/npc_dota_hero_phantom_assassin_png.png" width="84" alt="Phantom Assassin" /></a>
<a href="https://s1nuxoff.github.io/Dotadex/hero/axe"><img src="https://huggingface.co/datasets/Sqls1/dota2-models/resolve/main/images/heroes/selection/npc_dota_hero_axe_png.png" width="84" alt="Axe" /></a>

<sub>127 heroes · 11,600+ cosmetics · 900+ treasures · 360+ scenes</sub>

</div>

---

## ✨ What's inside

| | |
|---|---|
| 🦸 **Heroes** | The hero grid and hero page as in the game: the loadout scene with its lights, camera and pedestal, the hero's stats, abilities, talents and voice lines. |
| 👕 **Wardrobe** | Dress any hero in any cosmetic or whole set, switch styles, personas and arcanas. Every look has its own link to share. |
| 🎨 **The game's shading** | Models drawn with a port of Dota's hero shader: color warp, rim light, specular and metalness masks, self-illumination, soft shadows, animated materials. |
| 🔥 **Particle effects** | Ambient effects of heroes and items (fire, glows, trails, ropes) run from the game's own particle systems. |
| 🎬 **Animations** | Every animation of a model can be played; models can be downloaded as `.glb`. |
| 🎁 **Armory** | Treasures with their tiers, every courier, ward and other item. |
| ⚔️ **Items** | The shop's items with their stats, abilities and recipes. |
| 🎵 **Music and announcers** | Every music pack and announcer pack, to listen to. |
| 🏞️ **Scenes** | Dashboard backgrounds and showcase scenes in 3D, with their lights and cameras. |

> [!NOTE]
> Dotadex is made for desktop browsers, like the game's own interface.

## 🔗 Links and previews

Every page has a plain address you can share, such as
[`/Dotadex/hero/lina`](https://s1nuxoff.github.io/Dotadex/hero/lina) or
[`/Dotadex/item/4517`](https://s1nuxoff.github.io/Dotadex/item/4517). The look you put together stays in
the link (`/hero/pudge?head=4007.1`). Link previews in messengers and search engines show the page's
own title, description and picture.

## 🧩 How it works

Nothing on the site is drawn or tuned by hand: everything comes from the game files, through a chain of
trackers that follow every Dota 2 update.

```mermaid
flowchart LR
    G[("Dota 2<br/>game files")] --> F["dota2-file-tracker<br/><sub>items_game, scripts, texts</sub>"]
    G --> I["dota2-image-tracker<br/><sub>icons and pictures</sub>"]
    G --> M["dota2-model-tracker<br/><sub>models, materials, particles</sub>"]
    M --> D[("🤗 dota2-models<br/>dataset")]
    F --> C["catalog.json"]
    D --> C
    C --> S["🌐 Dotadex"]
    I --> S
    D --> S
```

- **[dota2-model-tracker](https://github.com/S1nuxoff/dota2-model-tracker)** exports every model with its
  materials, textures, animations and particle systems to the
  **[dota2-models](https://huggingface.co/datasets/Sqls1/dota2-models)** dataset.
- **[dota2-file-tracker](https://github.com/S1nuxoff/dota2-file-tracker)** and
  **[dota2-image-tracker](https://github.com/S1nuxoff/dota2-image-tracker)** keep the game's item data and
  pictures.
- The site is rebuilt on every push and every six hours, so new heroes and items show up on their own.

## 🛠️ Development

Built with React, three.js, Vite and Tailwind CSS; hosted on GitHub Pages.

```bash
npm install
npm run catalog   # writes public/catalog.json from the dataset and items_game.json
npm run dev       # http://localhost:5173/Dotadex/
npm run build     # the site, plus a static page per hero and item for link previews, and a sitemap
```

## ☕ Support

Dotadex is free and made in spare time. If you enjoy it, you can
[buy me a coffee on Ko-fi](https://ko-fi.com/s1nuxoff). ❤️

---

<sub>A fan project, not affiliated with or endorsed by Valve. Dota 2 and its content are trademarks and
property of Valve Corporation.</sub>
