# How Dota 2 draws the hero page

Facts read from the game's own files (compiled shaders, `client.dll`, game data), for matching the
site to the game by its code and values. Each line says where it comes from. Unknowns are marked.

## Reading the game's shaders

- Shaders live in `game/dota/shaders_pc_dir.vpk` as `shaders/vfx/<name>_pc_50_{features,vs,ps}.vcs`.
  Extract: `Source2Viewer-CLI.exe -i shaders_pc_dir.vpk --vpk_filepath shaders/vfx/<file> -o <dir>`.
- Describe one: `Source2Viewer-CLI.exe -i <file>.vcs -b DATA > data.txt` (KV3: static and dynamic
  combos, variables, `m_staticComboData`, `m_byteCodeData`).
- Programs are zstd frames compressed with a dictionary kept inside `Source2Viewer-CLI.exe`
  (bytes 13614052..+65536, saved as `dota2-model-tracker/temp/v14sh/vcs.dict`).
- One static combo's programs: `dota2-model-tracker/temp/v14gl/tools/combo.js <vcs> <data.txt>
  <dict> <staticId> <out>`; the static id is the sum of `value × m_nComboIndexValue` over the
  `S_*` combos. `m_byteCodeData[i].m_nOffs` counts from the first program frame (not from the
  frame of the DATA block at the start of the file).
- A combo's material constants by name: `tools/vars.js <data.txt> <staticId>` (each
  `m_indexAndRegisterOffsetArray` entry is `variable << 16 | float offset`, 0xFFFF = no slot).
- Disassemble with `temp/v13/disasm.py` (system d3dcompiler, run with `temp/m06/re/venv` python -I).
- A variable's `m_pCompiledExpression` is how the shader gets its value from the vmat:
  `1D <hash>` reads the vmat value, `06 <n>` calls function n of the expression language
  (0x1F = `SrgbGammaToLinear`, 0x1E = `SrgbLinearToGamma`, 0x06 = `saturate`, 0x15 = `pow`).
  An empty expression takes the vmat value as it is.

## Colors from gamma to linear

- `global_lit_simple.vfx`: `g_vColorTint` (and `g_vColorTint2`) = `SrgbGammaToLinear(vmat)`.
  The pedestal top's tint 0.498 is 0.212 in the shader, its 2023 rim 0.227 is 0.042.
- `hero.vfx`: `g_vBloomColor`, `g_vDetail1ColorTint`, `g_vDetail2ColorTint` from gamma to linear;
  `g_vSpecularColor` has no expression (taken as it is); `g_vRimLightColor` is not in the pixel
  shader's list (not checked in the vertex shader yet).

## The global light constant buffer (`DotaGlobalParams_t`, cb2 in hero.vfx and global_lit_simple.vfx)

| Slot | Meaning | On the hero page |
| --- | --- | --- |
| cb2[0].xyz | sun direction (the way it shines; −cb2[0] is towards the light) | from `PortraitLightPosition` |
| cb2[1].xyz | sun color | `PortraitLightColor` × `PortraitLightScale` (checked against the game, V-13) |
| cb2[1].w | multiplies the specular part kept apart from the diffuse (global_lit_simple) | unknown |
| cb2[2].xyz, .w | specular direction, specular power | `PortraitSpecularDirection`, `PortraitSpecularPower` (assumed, same names on the map's global light) |
| cb2[3].xyz, .w | specular color, specular independence (share of the specular added on its own instead of times the light) | `PortraitSpecularColor`; independence unknown |
| cb2[4].xyz, .w | second light direction, its scale | `PortraitAmbientDirection`, `PortraitAmbientScale` |
| cb2[5].xyz | second light color (also the rim color in hero.vfx's vertex shader) | `PortraitAmbientColor` |
| cb2[5].w | sky/ground scale in global_lit_simple | unknown |
| cb2[6].xyz / cb2[17].xyz | sky / ground ambient colors, mixed by the normal's up | unknown (site: a share of the ambient color) |
| cb2[6].w | sky/ground scale in hero.vfx | unknown |
| cb2[7], cb2[8].w | clouds texture (`g_tClouds`) offset and size; the sun is multiplied by min of two samples | none on the page (taken as 1) |
| cb2[12..15], cb2[16].x | the sun's shadow matrix, PCF texel step (9 taps, weights 0.206 / 0.124 / 0.075) | three.js shadow map |
| cb2[17].w | how much the sun's shadow also darkens the second light | unknown (taken as 0) |
| cb1[26].xyz | camera position | |

The map's global light entity has the same set: `m_SpecularColor`, `m_SpecularDirection`,
`m_flSpecularPower`, `m_flSpecularIndependence` (`specular_*_day/_night` keys), strings in client.dll.

## global_lit_simple.vfx (pedestal, static props)

Forward pixel shader (static combo `S_MODE_FORWARD + S_SHADER_QUALITY + S_SPECULAR [+ S_NORMAL_MAP]`
= 16450 / 16578, dynamic `D_GLOBAL_LIGHT_SHADOWS`):

```
albedo = tColor × g_vColorTint × instance color (the scene object's tint, RGBA8 sRGB, white unless set)
key    = shadow × clouds × saturate(dot(N, −cb2[0]))
light  = key × cb2[1]
       + (1 + cb2[17].w × (shadow × clouds − 1)) × saturate(dot(N, cb2[4])) × cb2[4].w × cb2[5]
       + (1 − key) × lerp(cb2[17], cb2[6], N.z × 0.5 + 0.5) × cb2[5].w
spec   = pow(saturate(dot(cb2[2], reflect(V, N))), cb2[2].w) × tSpecular.r × g_flSpecularIntensity × cb2[3]
out    = light × (albedo + spec × (1 − sat(cb2[3].w))) + spec × cb2[1].w × sat(cb2[3].w) × key-shadow
```

Material constants: cb0[0].x `g_flBumpStrength` (scales the normal map's slope), cb0[0].yzw
`g_vColorTint`, cb0[2].x `g_flSpecularIntensity`, cb0[2].w `g_bRenderBackfaces` (flip the normal on
back faces). The normal map is read as X = alpha, Y = −green (DXT5nm layout; the glTF export
already converts it). The deferred mode writes albedo × tint × instance color, (specular R ×
intensity, G, B × `g_flSpecularBloom`) and the normal; lighting then happens in the deferred pass.
The vertex shader also outputs a vertex specular `pow(saturate(dot(−V, reflect(cb2[0], N))), 16)`.

With `PortraitSpecularDirection` 0 0 −1 the specular lights only reflections pointing down, which a
camera above the pedestal does not see; the site leaves it out.

## The hero page's light data (`scripts/npc/portraits_full_body_loadout.txt`)

Parsed by client.dll 0x1815bb580 into a 0x5c-byte struct (defaults in brackets, those the code uses
when a key is missing):

| Offset | Key | Default | Values in the file (201 entries) |
| --- | --- | --- | --- |
| 0x20 | PortraitLightColor | 243 237 230 | |
| 0x24 | PortraitLightScale | 1 | |
| 0x28 | PortraitShadowColor | 89 89 89 | 56 56 56 (144), 111, 74, 131 |
| 0x2c | PortraitShadowScale | 1.5 | 5 (136), 1.025, 1, 2.5 |
| 0x30 | PortraitGroundShadowScale | 1.5 | 1.5 (200), 1.2 |
| 0x34 | PortraitAmbientDirection | 400 −400 −50 | |
| 0x40 | PortraitAmbientColor | 123 168 168 | |
| 0x44 | PortraitAmbientScale | 2.5 | |
| 0x48 | PortraitSpecularColor | 251 74 84 | 251 74 84 (199) |
| 0x4c | PortraitSpecularDirection | 0 0 −1 | 0 0 −1 (197) |
| 0x58 | PortraitSpecularPower | 16 | 16 (200) |

Also per entry: `PortraitLightPosition`, `PortraitLightAngles`, `PortraitLightFOV` (63 / 32 / 120),
`PortraitLightDistance`, `PortraitShadowFarZ`, `PortraitHeroRotation`, `PortraitBackgroundModel`
(the pedestal), `PortraitBackgroundColor1..4`, `PortraitDesaturateHero`, `PortraitDesaturateParticles`,
`GroundfogFXColor`, `GodraysFXColor`, cameras with `PortraitPosition`, `PortraitAngles`, `PortraitFOV`
(horizontal, 4:3), `PortraitFar`. The key light casts its shadow through a separate renderer
(`PortraitLightShadowRenderer`, `PortraitLightShadowDepthTexture_%d_%d`). The page is drawn in the
deferred path (`rtGBufferAlbedo`, `rtGBufferNormalWs`, `rtGBufferLightingTerms`).

## The pedestal (`models/heroes/pedestal/loadout_pedestal_2023.vmdl`)

- Two materials, both `global_lit_simple.vfx`: `loadout_pedestal_bricks` (F_NORMAL_MAP, F_SPECULAR,
  tint 1; a 418-unit square whose color fades to black towards its edges, which is how the game
  hides the pedestal's surroundings) and `pedestal_2_color` (the round top, F_SPECULAR, tint 0.498,
  reflectance 0.082). `loadout_pedestal_2023.vmat` (tint 0.227 with a tint mask) is not used by it.
- Its effects come from the model (`particle_cfg`): `dota_hud_loadout_pedestal_groundfog.vpcf`
  (config `preview`), CP1 grey 0.5 set by the code. The god rays (`dota_hud_loadout_pedestal.vpcf`,
  colored by `GodraysFXColor`) and its `depthmaskfog` are not drawn on the site.

## The hero page's map (`maps/ui/dota_hud_loadout_2022.vmap`, `PortraitBackgroundMap` of 168 heroes)

A separate VPK (`game/dota/maps/ui/dota_hud_loadout_2022.vpk`). Its entities (`default_ents.vents_c`):
- `worldspawn`: background map, sky `sky_day01_01`.
- `point_camera` `[PR#]hero_camera` (parent `[PR#]loadout_camera_model`, attachment root): FOV 30.3,
  ZNear 25, ZFar 1000, no fog, depth of field on: near blurry 200, near crisp 300, far crisp 400,
  far blurry 900, tilt to ground 0.75 (an output sets `SetDOFFarBlurry`).
- `info_particle_system` `[PR#]pedestal_fx` at the origin: `particles/ui/dota_hud_loadout_pedestal.vpcf`
  (god rays: children `_godrays`, `_godrays_dust` → `_godrays_dust_particles`, `_godrays_front`;
  all additive). No light entity, no fog entity.
- Never started by anything (no map, no system, no client.dll string): `dota_hud_loadout_depthmaskfog`
  and `dota_hud_loadout_pedestal_depthmaskfog(_shadow)` (dark blue 4 7 15 cloud sprites behind the
  hero), `dota_hud_loadout_godrays_light` (a deferred light particle).

## Deferred lighting

- `deferred_global_light.vfx` (the sun pass): the same terms as global_lit_simple's forward shader,
  from the G-buffer (albedo; lighting terms: R specular mask, G how much the surface shows its albedo
  unlit, B how much the lights are desaturated towards their luminance 0.2125/0.7154/0.0721), then an
  HSV step: saturation × `g_flSaturationScale`, value × `g_flIntensityScale` (render attributes set by
  code, default 1). Its shadow sampler is BORDER with border 1: outside the sun's shadow frustum is lit.
  So the global light has no cone even as a spot light.
- The global light entity (C_GlobalLight) has `m_bSpotLight`, `m_SpotLightOrigin`, `m_SpotLightAngles`,
  `m_flFOV`, `m_flNearZ`, `m_flLightScale`, `m_AmbientColor1..3`, `m_flAmbientScale1/2`,
  `m_flGroundScale`, `m_flSunDistance`, clouds and FoW fields. Its shadow matrix is perspective in
  the shaders (divide by w).
- `deferred_local_light.vfx` (`env_deferred_light`: `spot_light_distance`, `spot_fov`, `start_falloff`,
  `distance_falloff`; `D_SPOT`, `D_SHADOWS` …): a spot light discards everything outside its square
  frustum and facing away; cone = smoothstep(saturate((1 − |2·uv − 1|) / cb0[2].z)), distance =
  smoothstep(saturate((1 − d / range) / cb0[2].w)); out = albedo × N·L × color × intensity × shadow
  (25-tap Poisson PCF) × (cone × distance)² × cb0[1].w.
- `portrait_world_light` is a client entity class client.dll creates with `lightcolor`, `intensity`,
  `latitude`, `longitude`, `spot_fov`, `additionalradius`, `hitboxsetname`, `boundsradiusmultiplier`,
  as three lights `__head_light`, `__fill_light`, `__rim_light` (client.dll 0x182faa500…; which page
  uses it not traced yet).

## Post-processing (V-13)

- `deferred_post_process.vfx`: adds the bloom, then tone maps `x(15.8x+2.12)/(x(1.2x+5.92)+1.9)` with
  x = 0.6c (nearly linear, white from 0.86); no color grade.
- `bloom_dota.vfx`: the bloom buffer's color × amount²; hero.vfx's deferred mode writes the amount
  (max(Masks1 A, `g_flSelfIllumBlendToFull`) + detail alpha for F_DETAIL 2) × `g_flBloomScale`.
- Particles reach the bloom only through renderers with `m_bOnlyRenderInEffectsBloomPass`.

## Particles

- Sprite texture coordinates (`spritecard_pc_50_vs.vcs`, `g_vecTextureControlsVertex_Base`):
  uv = rotate(uv − 0.5) / scale + 0.5 + offset (`m_flFinalTextureScaleU/V` divide).
- Frame blending of sequences (`m_bBlendFramesSeq0`) is on unless a renderer turns it off.
- A hero is scaled by `LoadoutScale`, else `ModelScale`, else 1 (client.dll 0x181940791).
