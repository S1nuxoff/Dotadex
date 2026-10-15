# Dotadex

Every Dota 2 hero, cosmetic, courier and ward in 3D, from the game files: https://s1nuxoff.github.io/Dotadex/

- Heroes are shown with their default items, and a cosmetic is shown worn by its hero in place of the default item of the same slot.
- Models are drawn with a take on Dota's hero shader (diffuse warp, rim light, specular and metalness masks from the game's materials). Switch to plain shading to compare.
- Every animation of a model can be played, and each model can be downloaded as `.glb`.

The models come from the [dota2-models](https://huggingface.co/datasets/Sqls1/dota2-models) dataset, exported by [dota2-model-tracker](https://github.com/S1nuxoff/dota2-model-tracker). Item data and icons come from [dota2-file-tracker](https://github.com/S1nuxoff/dota2-file-tracker) and [dota2-image-tracker](https://github.com/S1nuxoff/dota2-image-tracker).

## Development

```bash
npm install
npm run catalog   # writes public/catalog.json from the dataset and items_game.json
npm run dev
```

The site is rebuilt on every push and every six hours, so newly exported models show up on their own.
