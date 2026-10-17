# Dotadex tasks

Goals for the site (`dota2-model-viewer`) and the dataset export (`dota2-model-tracker`).

Status: `[ ]` open · `[~]` in progress · `[x]` done · `[-]` cancelled (with the reason).
Every task has an ID. Done and cancelled tasks move to the archive at the bottom; nothing is deleted.

Order: cosmetics first (every particle and effect as in the game), abilities as in a match later.

---

## Particles: data (export, `dota2-model-tracker/particles.js`)

- [~] **P-01 Snapshots (`.vsnap`) in the dataset.** Export written (commit `a510272`): 3105 files at `particles/<path>.vsnap.json`. First upload done. Left: push the exporter with `particles-state.json` so the workflow carries on from there.
- [ ] **P-02 Textures from the `core` VPK.** 28 textures live in `game/core/pak01_dir.vpk`; the exporter reads only `dota`. 641 of 3428 effects (19%) use one: common flares and glows (`particle_flare_004_mod`, `light_glow_01`, `beam_laser_soft_01`…). A renderer without its texture draws nothing. Biggest win for the effort.
- [ ] **P-03 Snapshot swaps by cosmetics (`particle_snapshot` in `items_game`).** 231 items replace the default weapon's snapshot with their own (`asset` → `modifier`). Needs: export the items' snapshots (no `.vpcf` refers to them, so P-01 missed them), the swaps in the catalog (`scripts/build-catalog.mjs`), the swap applied on the site.
- [ ] **P-04 Control point values from items (`particle_control_point`).** 34 items set a CP, often a color (Doom's Molten Fracture: CP26 = `1.0 0.9 0.7`). Into the catalog, set on the site.
- [ ] **P-05 Particle materials (`.vmat`).** 236 effects (7%): models with an override material (`m_hOverrideMaterial`, 130), ground projections (`RenderProjected`, 158), `RenderCables`, `RenderBlobs`. Export the material's parameters and textures.
- [ ] **P-06 Model hitboxes.** Used by `CreateOnModel` (329), `LockToBone` (237), `MoveToHitbox` (41), `SetHitboxToModel`/`Closest`; we use random vertices instead. Read them from the model data next to the attachments (`readAttachments`).
- [ ] **P-07 `attribute_controlled_attached_particles`.** 828 entries in `items_game`: which attachments an effect's CPs follow. Needed for unusual courier/ward effects.
- [ ] **P-08 9 `dota` textures that fail to convert.** Smoke `smoke3b`, `vistasmokev1(_gray)` and the status-effect `colorwarp_*`. Retried every run; find out why `buildTexture` gives nothing.
- [ ] **P-09 "What's missing" report in the export.** Count the resources effects refer to (textures, models, snapshots, materials) that the dataset lacks, next to `coverage.json`, so gaps show up by themselves.
- [ ] **P-10 Animations of particle models** (`m_ActivityName`, 58; `m_sequenceName`).

## Particles: site (`src/viewer/particles/`)

- [ ] **V-01 `InitFromCPSnapshot` in the attachment's space.** Its points are local to a CP (`m_nLocalSpaceCP`), not the model's space; we still put them on a random vertex and `MovementRigidAttachToCP` moves them a second time. White dots in the air on default Anti-Mage (`antimage_blade_primary`, snapshot `antimage_weapon_primary.vsnap`); likely many weapons.
- [ ] **V-02 Lit particle models.** `C_OP_RenderModels` draws unlit (`MeshBasicMaterial`), not with the Dota shader.
- [ ] **V-03 Operators by how often they are used.** Take the top of `npm run particles:coverage` (e.g. `C_OP_RotateVector`).
- [ ] **V-04 Every way control points are driven.** Only the `.vpcf`'s first configuration now; add hitboxes, `CUSTOMORIGIN`, CPs from `items_game` (P-04, P-07).
- [ ] **V-05 Renderers skipped now.** Refraction (`m_bRefract`), bloom-only renderers, lights from particles (`RenderDeferredLight`).
- [ ] **V-06 Check Sakura after P-01.** Without its snapshot the petals and glow are huge (radius 18.75 and 47 against 2.8 and 3.65 with it).

## Models and other

- [ ] **M-01 Head showing through the helmet.** Seen on Anti-Mage with a helmet; common across the site. After the particles.

## Later: abilities as in a match

- [ ] **A-01 Data sources for abilities.** Which effects an ability makes, with which CPs and when, is mostly in the game's code. From data: animation events in models (`AE_CL_CREATE_PARTICLE_EFFECT`, `AE_CL_PLAYSOUND`), preview configurations in `.vpcf`, abilities' precache lists, `asset_modifier` swaps, cast animations and timings (`AbilityCastPoint`). Decide whether a small hand-written table for well-known abilities is acceptable (against the everything-from-the-dataset rule).
- [ ] **A-02 A scene for abilities.** Target dummy, ground, projectile movement, status effects (`status_effect`), ground projections.
- [ ] **A-03 Performance.** Particle pools, skipping what is not visible.

---

## Archive

### 2026-10-17
- [x] **Sakura petals never spawned.** A noise input as a system's emission rate gave 0 (`inputs.js`). Commit `492e1dc`.
- [x] **`InheritFromParentParticles` inherited the tint instead of the radius.** The default is field 3: across 65k `.vpcf` field 6 is written out 606 times, field 3 never. Commit `492e1dc`.
- [x] **`InitFloat` honours `m_InputStrength`.** Commit `492e1dc`.
- [x] **Particles on snapshots (`InitSkinnedPositionFromCPSnapshot`).** Each snapshot point bound to the nearest model vertex, with its radius; `InstantaneousEmitter` emits one particle a point; ropes through snapshot points drawn. Commit `492e1dc`.
- [x] **`C_OP_RenderModels`** (3D flowers). Commit `492e1dc`.
- [x] **Particles made from killed parent particles** (`m_bInitFromKilledParentParticles`, `C_INIT_InitFromParentKilled`): flowers on the ground, bubbles, drops. Commits `492e1dc`, `e5b53ff`.
- [x] **Bound to the model where the parent is; `LockToBone` lets go over its fade.** Commit `492e1dc`.
