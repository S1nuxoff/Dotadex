<div align="center">

<a href="https://s1nuxoff.github.io/Dotadex/"><img src="docs/logo.png" alt="Dotadex" width="560" /></a>

### The complete Dota 2 encyclopedia in 3D

Every hero, cosmetic, courier, ward, treasure and scene of Dota 2, straight from the game files,
shown the way the game shows them.

[![Open Dotadex](https://img.shields.io/badge/Open-Dotadex-c9a45c?style=for-the-badge)](https://s1nuxoff.github.io/Dotadex/)
[![Deploy](https://img.shields.io/github/actions/workflow/status/S1nuxoff/Dotadex/deploy.yml?branch=main&style=for-the-badge&label=deploy)](https://github.com/S1nuxoff/Dotadex/actions/workflows/deploy.yml)
[![Models dataset](https://img.shields.io/badge/dataset-dota2--models-ffcc4d?style=for-the-badge)](https://huggingface.co/datasets/Sqls1/dota2-models)

<a href="https://ko-fi.com/s1nuxoff"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support me on Ko-fi" /></a>

<br />

<a href="https://s1nuxoff.github.io/Dotadex/hero/pudge"><img src="https://huggingface.co/datasets/Sqls1/dota2-images/resolve/main/panorama/images/heroes/selection/npc_dota_hero_pudge_png.png" width="84" alt="Pudge" /></a>
<a href="https://s1nuxoff.github.io/Dotadex/hero/invoker"><img src="https://huggingface.co/datasets/Sqls1/dota2-images/resolve/main/panorama/images/heroes/selection/npc_dota_hero_invoker_png.png" width="84" alt="Invoker" /></a>
<a href="https://s1nuxoff.github.io/Dotadex/hero/juggernaut"><img src="https://huggingface.co/datasets/Sqls1/dota2-images/resolve/main/panorama/images/heroes/selection/npc_dota_hero_juggernaut_png.png" width="84" alt="Juggernaut" /></a>
<a href="https://s1nuxoff.github.io/Dotadex/hero/lina"><img src="https://huggingface.co/datasets/Sqls1/dota2-images/resolve/main/panorama/images/heroes/selection/npc_dota_hero_lina_png.png" width="84" alt="Lina" /></a>
<a href="https://s1nuxoff.github.io/Dotadex/hero/crystal_maiden"><img src="https://huggingface.co/datasets/Sqls1/dota2-images/resolve/main/panorama/images/heroes/selection/npc_dota_hero_crystal_maiden_png.png" width="84" alt="Crystal Maiden" /></a>
<a href="https://s1nuxoff.github.io/Dotadex/hero/nevermore"><img src="https://huggingface.co/datasets/Sqls1/dota2-images/resolve/main/panorama/images/heroes/selection/npc_dota_hero_nevermore_png.png" width="84" alt="Shadow Fiend" /></a>
<a href="https://s1nuxoff.github.io/Dotadex/hero/phantom_assassin"><img src="https://huggingface.co/datasets/Sqls1/dota2-images/resolve/main/panorama/images/heroes/selection/npc_dota_hero_phantom_assassin_png.png" width="84" alt="Phantom Assassin" /></a>
<a href="https://s1nuxoff.github.io/Dotadex/hero/axe"><img src="https://huggingface.co/datasets/Sqls1/dota2-images/resolve/main/panorama/images/heroes/selection/npc_dota_hero_axe_png.png" width="84" alt="Axe" /></a>

<sub>127 heroes · 11,600+ cosmetics · 900+ treasures · 360+ scenes</sub>

</div>

---

## What's inside

| | | |
|:-:|---|---|
| <img src="docs/icons/hero.svg" width="28" alt="" /> | **Heroes** | The hero grid and hero page as in the game: the loadout scene with its lights, camera and pedestal, the hero's stats, abilities, talents and voice lines. |
| <img src="docs/icons/armory.svg" width="28" alt="" /> | **Wardrobe** | Dress any hero in any cosmetic or whole set, switch styles, personas and arcanas. Every look has its own link to share. |
| <img src="docs/icons/brightness.svg" width="28" alt="" /> | **The game's shading** | Models drawn with a port of Dota's hero shader: color warp, rim light, specular and metalness masks, self-illumination, soft shadows, animated materials. |
| <img src="docs/icons/modifier_ambient_effects.svg" width="28" alt="" /> | **Particle effects** | Ambient effects of heroes and items (fire, glows, trails, ropes) run from the game's own particle systems. |
| <img src="docs/icons/modifier_animation.svg" width="28" alt="" /> | **Animations** | Every animation of a model can be played; models can be downloaded as `.glb`. |
| <img src="docs/icons/treasure.svg" width="28" alt="" /> | **Armory** | Treasures with their tiers, every courier, ward and other item. |
| <img src="docs/icons/secret_shop.svg" width="28" alt="" /> | **Items** | The shop's items with their stats, abilities and recipes. |
| <img src="docs/icons/music.svg" width="28" alt="" /> | **Music and announcers** | Every music pack and announcer pack, to listen to. |
| <img src="docs/icons/terrain.svg" width="28" alt="" /> | **Scenes** | Dashboard backgrounds and showcase scenes in 3D, with their lights and cameras. |

> [!NOTE]
> Dotadex is made for desktop browsers, like the game's own interface.

## Screenshots

<img src="docs/screenshots/hero.jpg" alt="Lina's hero page" width="100%" />

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/heroes.jpg" alt="The hero grid" /></td>
    <td width="50%"><img src="docs/screenshots/armory.jpg" alt="The Armory with Queen of Pain's weapons" /></td>
  </tr>
  <tr>
    <td align="center"><sub>The hero grid</sub></td>
    <td align="center"><sub>The Armory</sub></td>
  </tr>
</table>

<img src="docs/screenshots/items.jpg" alt="Abyssal Blade's page" width="100%" />

## Links and previews

Every page has a plain address you can share, such as
[`/Dotadex/hero/lina`](https://s1nuxoff.github.io/Dotadex/hero/lina) or
[`/Dotadex/item/4517`](https://s1nuxoff.github.io/Dotadex/item/4517). The look you put together stays in
the link (`/hero/pudge?head=4007.1`). Link previews in messengers and search engines show the page's
own title, description and picture.

## How it works

Nothing on the site is drawn or tuned by hand: everything comes from the game files, through a chain of
trackers that follow every Dota 2 update.

```mermaid
flowchart LR
    G[("Dota 2<br/>game files")] --> T["dota2-game-tracker<br/><sub>one export after every update</sub>"]
    T --> DA[("dota2-data<br/><sub>scripts, texts, files made for the site</sub>")]
    T --> IM[("dota2-images<br/>dota2-videos")]
    T --> MO[("dota2-models<br/><sub>models, materials, particles</sub>")]
    T --> SO[("dota2-sounds<br/>dota2-maps")]
    DA --> C["catalog.json"]
    C --> S["Dotadex"]
    DA --> S
    IM --> S
    MO --> S
    SO --> S
```

- **[dota2-game-tracker](https://github.com/S1nuxoff/dota2-game-tracker)** exports the game to Hugging Face
  datasets after every update: [dota2-data](https://huggingface.co/datasets/Sqls1/dota2-data) (every script
  and localization as JSON, and under `dotadex/` the files made for this site),
  [dota2-images](https://huggingface.co/datasets/Sqls1/dota2-images) and
  [dota2-videos](https://huggingface.co/datasets/Sqls1/dota2-videos) (the interface's pictures and videos as
  the game keeps them), [dota2-models](https://huggingface.co/datasets/Sqls1/dota2-models) (models with
  their materials, textures, animations and particle systems),
  [dota2-sounds](https://huggingface.co/datasets/Sqls1/dota2-sounds) and
  [dota2-maps](https://huggingface.co/datasets/Sqls1/dota2-maps). Its `DATA.md` maps every file.
- Market prices come from [dota2-price-tacker](https://github.com/S1nuxoff/dota2-price-tacker).
- The site is rebuilt on every push and every six hours, so new heroes and items show up on their own.

## Checked against the game, pixel by pixel

The shading is not eyeballed from screenshots. Dotadex runs the game's own hero shader, ported
instruction by instruction from its compiled code, and its lighting, shadows and particle defaults are
taken from what the game itself does:

- **Frame captures of the real game.** The hero page and the Armory are captured with
  [RenderDoc](https://renderdoc.org/), and the constants the game hands its shaders (the light, the
  shadow's projection, every material parameter) are compared with the site's, value for value.
- **Pixel traces.** A single pixel of a hero is stepped through the game's shader in RenderDoc, and the
  same pixel through the site's: every intermediate term (N·L, the highlight, the fresnel, the warp) is
  printed side by side until the two agree.
- **The engine's own data.** Particle operators take their defaults from the engine's class schema, and
  the hero page's light, camera and shadow follow the game's code and portrait data, not a guess.

## Support

Dotadex is free and made in spare time. If you enjoy it, you can
[buy me a coffee on Ko-fi](https://ko-fi.com/s1nuxoff).

---

<sub>A fan project, not affiliated with or endorsed by Valve. Dota 2 and its content are trademarks and
property of Valve Corporation.</sub>
