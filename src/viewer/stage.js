import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createDotaMaterial, stageRim } from "./dotaMaterial.js";
import { StageEffects } from "./effects.js";
import { playLoaded, preloadSound } from "./soundPlayer.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Loaded models are kept, switching back and forth does not download them again
const cache = new Map();
const loader = new GLTFLoader();

function loadModel(url, onProgress) {
  if (!cache.has(url)) {
    const promise = new Promise((resolve, reject) => {
      loader.load(url, resolve, onProgress, reject);
    }).then(prepareTextures);
    promise.catch(() => cache.delete(url));
    cache.set(url, promise);
  }
  return cache.get(url);
}

// Textures by their vmat names, which is how the Dota materials refer to them.
// Only the textures in glTF material slots have texture entries, the masks and
// warp ramps are kept as bare images, so every image is loaded as a texture.
async function prepareTextures(gltf) {
  const { parser } = gltf;
  const images = parser.json.images ?? [];
  const textures = {};
  await Promise.all(
    images.map(async (image, index) => {
      const texture = await parser.loadImageSource(index, parser.textureLoader);
      texture.flipY = false;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.name = image.name;
      textures[image.name] = texture;
    })
  );
  gltf.userData.textures = textures;
  return gltf;
}

// Material variants: <model>.skins.json next to the model, with the textures in the
// dataset's textures/ folder. A model without variants answers 404 and keeps its own.
const skinFiles = new Map();
const variantTextures = new Map();
const textureLoader = new THREE.TextureLoader();

function loadVariantTexture(url, color) {
  if (!variantTextures.has(url)) {
    variantTextures.set(
      url,
      textureLoader.loadAsync(url).then((texture) => {
        texture.flipY = false;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        return texture;
      })
    );
  }
  return variantTextures.get(url);
}

// { "<material name>": { vmat, textures: { g_tColor: Texture, ... } } } for skin N of a model
async function loadSkin(modelUrl, skin) {
  const url = modelUrl.replace(/\.glb$/, ".skins.json");
  if (!skinFiles.has(url)) {
    skinFiles.set(url, fetch(url).then((res) => (res.ok ? res.json() : null)).catch(() => null));
  }
  const materials = (await skinFiles.get(url))?.[skin];
  if (!materials) {
    return null;
  }
  const base = modelUrl.slice(0, modelUrl.indexOf("/models/") + 1);
  const result = {};
  await Promise.all(
    Object.entries(materials).map(async ([name, vmat]) => {
      const textures = {};
      await Promise.all(
        Object.entries(vmat.TextureParams).map(async ([param, path]) => {
          textures[param] = await loadVariantTexture(base + path, param === "g_tColor" || param === "g_tCubeMap" || param === "g_tDetail").catch(() => null);
        })
      );
      result[name] = { vmat, textures };
    })
  );
  return result;
}

function dotaMaterialFor(material, textures) {
  const vmat = material.userData?.vmat;
  if (!vmat || vmat.ShaderName !== "hero.vfx") {
    return null;
  }
  const byParam = {};
  for (const [param, name] of Object.entries(vmat.TextureParams ?? {})) {
    const texture = textures[name];
    if (texture) {
      texture.colorSpace = param === "g_tColor" || param === "g_tCubeMap" || param === "g_tDetail" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.needsUpdate = true;
      byParam[param] = texture;
    }
  }
  return createDotaMaterial(material, vmat, byParam);
}

// Helpers only the map editor shows: camera markers and the like, in red dev materials
function editorOnly(node) {
  const name = node.material?.userData?.vmat?.Name ?? "";
  return /^materials\/(dev|tools)\//.test(name) || /camera/i.test(node.name) || /camera/i.test(node.parent?.name ?? "");
}

// Environment materials of the game's scenes, from the flags in their vmat: unlit parts,
// glowing parts, cut-outs, see-through and additive ones, two-sided leaves and cloth
function environmentMaterial(material) {
  const vmat = material.userData?.vmat;
  if (!vmat) {
    return material;
  }
  const flags = vmat.IntParams ?? {};
  const floats = vmat.FloatParams ?? {};
  let result = material;
  if (flags.F_FULLBRIGHT || flags.F_UNLIT || vmat.ShaderName?.includes("unlit")) {
    result = new THREE.MeshBasicMaterial({ name: material.name, map: material.map, color: material.color, vertexColors: material.vertexColors });
    result.userData = material.userData;
    material.dispose();
  } else if (!flags.F_SELF_ILLUM) {
    // Only self-illuminated parts glow
    result.emissiveMap = null;
    result.emissive?.set(0x000000);
  }
  if (flags.F_ALPHA_TEST) {
    result.alphaTest = floats.g_flAlphaTestReference ?? 0.5;
  }
  if (flags.F_TRANSLUCENT || flags.F_ADDITIVE_BLEND || flags.F_BLEND_MODE) {
    result.transparent = true;
    result.depthWrite = false;
    result.alphaTest = 0;
  }
  if (flags.F_ADDITIVE_BLEND || flags.F_BLEND_MODE === 2) {
    result.blending = THREE.AdditiveBlending;
  }
  if (flags.F_RENDER_BACKFACES || flags.F_TRANSLUCENT) {
    result.side = THREE.DoubleSide;
  }
  result.needsUpdate = true;
  return result;
}

// Not an animation: the model standing in the pose it was made in
export const T_POSE = "T-pose";

// Makes the skinned meshes of `part` follow the bones of `root` with the same names.
// Bones only the part has (chains, cloth) are moved under their parent in the root skeleton.
function attach(root, part) {
  const bones = new Map();
  root.traverse((node) => node.isBone && bones.set(node.name, node));

  const partBones = [];
  part.traverse((node) => node.isBone && partBones.push(node));

  for (const bone of partBones) {
    if (bones.has(bone.name) || !bone.parent?.isBone) {
      continue;
    }
    const parent = bones.get(bone.parent.name);
    if (parent && parent !== bone.parent) {
      parent.add(bone);
      bone.traverse((node) => node.isBone && !bones.has(node.name) && bones.set(node.name, node));
    }
  }

  part.traverse((node) => {
    if (node.isSkinnedMesh) {
      const skeleton = node.skeleton;
      const shared = skeleton.bones.map((bone) => bones.get(bone.name) ?? bone);
      node.bind(new THREE.Skeleton(shared, skeleton.boneInverses), node.bindMatrix);
    }
  });

  // Drop the part's own copies of shared bones so animation tracks resolve to one node per name
  for (const bone of partBones) {
    if (bones.get(bone.name) !== bone && bone.parent) {
      bone.removeFromParent();
    }
  }
  root.add(part);
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 1, 10000);

    // Lights for plain shading only; the Dota material lights itself.
    // The key light rides with the camera, like the Dota shader's rig.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xb8c4d6, 0x1a1714, 1.2));
    const key = new THREE.DirectionalLight(0xfff6ea, 2.2);
    key.position.set(-0.45, 0.75, 0.5);
    key.target.position.set(0, 0, -1);
    this.camera.add(key, key.target);
    this.scene.add(this.camera);
    this.camera.position.set(0, 120, 420);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 90, 0);

    // A soft round shadow the model stands on
    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `varying vec2 vUv;
          void main(){ float d = distance(vUv, vec2(0.5)) * 2.0;
            gl_FragColor = vec4(vec3(0.0), smoothstep(1.0, 0.0, d) * 0.6); }`,
      })
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.renderOrder = 1;
    this.scene.add(this.floor);
    this.effects = new StageEffects(this.scene, reducedMotion);

    this.clock = new THREE.Clock();
    this.group = null;
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.speed = 1;
    this.paused = false;
    this.shading = "dota";
    this.rimTarget = new THREE.Color("#c9a45c");
    this.tween = null;
    this.request = 0;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const { clientWidth, clientHeight } = this.canvas.parentElement;
    if (!clientWidth || !clientHeight) {
      return;
    }
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }

  // urls[0] is the base (a hero), the rest are worn on it. The model with the most
  // animations becomes the skeleton everything follows, so a body-replacing arcana
  // takes the place of the hero base.
  // An url may end with #skin=N for a material variant of the model.
  async show(urls, onProgress) {
    const request = ++this.request;
    const loaded = new Map();
    const report = () => {
      let done = 0;
      let total = 0;
      for (const { loaded: l, total: t } of loaded.values()) {
        done += l;
        total += t || l;
      }
      onProgress?.(total ? done / total : 0);
    };

    const entries = urls.map((entry) => {
      const [url, skin] = entry.split("#skin=");
      return { url, skin: Number(skin) || 0 };
    });
    const [gltfs, skins] = await Promise.all([
      Promise.all(
        entries.map(({ url }) =>
          loadModel(url, (event) => {
            loaded.set(url, { loaded: event.loaded, total: event.total });
            report();
          })
        )
      ),
      Promise.all(entries.map(({ url, skin }) => (skin ? loadSkin(url, skin) : null))),
    ]);
    if (request !== this.request) {
      return null;
    }

    let rootIndex = 0;
    gltfs.forEach((gltf, index) => {
      if (gltf.animations.length > gltfs[rootIndex].animations.length) {
        rootIndex = index;
      }
    });

    const group = new THREE.Group();
    const root = cloneSkinned(gltfs[rootIndex].scene);
    this.applyMaterials(root, gltfs[rootIndex].userData.textures, skins[rootIndex]);
    group.add(root);

    gltfs.forEach((gltf, index) => {
      // A hero base is hidden when a body-replacing model took over
      if (index === rootIndex || (index === 0 && rootIndex !== 0 && gltf.animations.length > 10)) {
        return;
      }
      const part = cloneSkinned(gltf.scene);
      this.applyMaterials(part, gltf.userData.textures, skins[index]);
      attach(root, part);
    });

    this.rootModel = entries[rootIndex].url.slice(entries[rootIndex].url.indexOf("/models/") + 1);
    this.replace(group, gltfs[rootIndex].animations);
    this.preloadSounds();
    return Object.keys(this.actions);
  }

  // skin: { "<material name>": { vmat, textures } } of a material variant, swapped in
  applyMaterials(object, textures, skin) {
    object.traverse((node) => {
      if (!node.isMesh) {
        return;
      }
      node.frustumCulled = false;
      node.visible = !editorOnly(node);
      const original = node.material;
      const variant = skin?.[original.name];
      if (variant) {
        const plain = original.clone();
        plain.map = variant.textures.g_tColor ?? plain.map;
        plain.normalMap = variant.textures.g_tNormal ?? plain.normalMap;
        node.userData.pbr = plain;
        node.userData.dota = createDotaMaterial(original, variant.vmat, variant.textures);
      } else {
        node.userData.pbr = original;
        node.userData.dota = dotaMaterialFor(original, textures) ?? environmentMaterial(original.clone());
      }
      node.material = this.shading === "dota" ? node.userData.dota : node.userData.pbr;
    });
  }

  replace(group, animations) {
    if (this.group) {
      this.scene.remove(this.group);
      this.group.traverse((node) => {
        if (node.isMesh && node.userData.dota !== node.userData.pbr) {
          node.userData.dota.dispose();
        }
      });
      this.mixer?.stopAllAction();
    }

    this.group = group;
    group.traverse((node) => {
      if (node.isBone) {
        node.userData.rest = { position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() };
      }
    });
    this.animated = animations.length > 0;
    this.scene.add(group);
    this.mixer = new THREE.AnimationMixer(group);
    this.actions = {};
    for (const clip of animations) {
      this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    this.current = null;

    const idle = Object.keys(this.actions).find((name) => /^idle$|_idle$|^idle_anim$/i.test(name))
      ?? Object.keys(this.actions).find((name) => /idle/i.test(name))
      ?? Object.keys(this.actions)[0];
    if (idle) {
      this.play(idle, 0);
    }
    this.mixer.update(0);
    this.frameModel();
    this.effects.burst();
  }

  play(name, fade = 0.25) {
    this.group?.traverse((node) => {
      if (node.userData.offInTPose) {
        node.visible = true;
        node.userData.offInTPose = false;
      }
    });
    if (name === T_POSE) {
      // The pose the model was made in, with no animation on it
      const before = this.mainBonePositions();
      this.mixer?.stopAllAction();
      // Every bone back where the files put it: posing each skeleton instead would let a
      // weapon's own skeleton move the hand bones it shares with the body
      this.group?.traverse((node) => {
        const rest = node.isBone && node.userData.rest;
        if (rest) {
          node.position.copy(rest.position);
          node.quaternion.copy(rest.quaternion);
          node.scale.copy(rest.scale);
        }
      });
      // Weapons are put in the hand only by animations and drop to the ground without one:
      // a part that fell from where it was to near the floor is hidden until the next animation
      this.group?.updateMatrixWorld(true);
      const height = new THREE.Box3().setFromObject(this.group).getSize(new THREE.Vector3()).y || 1;
      const floor = new THREE.Box3().setFromObject(this.group).min.y;
      for (const [mesh, position] of before) {
        const now = mesh.userData.mainBone.getWorldPosition(new THREE.Vector3());
        if (now.y - floor < height * 0.12 && now.distanceTo(position) > height * 0.2) {
          mesh.visible = false;
          mesh.userData.offInTPose = true;
        }
      }
      this.current = null;
      this.currentName = name;
      return;
    }
    const next = this.actions[name];
    if (!next) {
      return;
    }
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (this.current && this.current !== next) {
      this.current.crossFadeTo(next, fade, false);
    }
    this.current = next;
    this.lastCycle = 0;
    this.currentName = name;
  }

  // Where the bone that moves most of each skinned mesh is now
  mainBonePositions() {
    const result = new Map();
    this.group?.updateMatrixWorld(true);
    this.group?.traverse((node) => {
      if (!node.isSkinnedMesh) {
        return;
      }
      if (!node.userData.mainBone) {
        const { skinIndex, skinWeight } = node.geometry.attributes;
        const totals = new Float32Array(node.skeleton.bones.length);
        for (let i = 0; i < skinIndex.count; i++) {
          for (let k = 0; k < 4; k++) {
            totals[skinIndex.getComponent(i, k)] += skinWeight.getComponent(i, k);
          }
        }
        node.userData.mainBone = node.skeleton.bones[totals.indexOf(Math.max(...totals))];
      }
      result.set(node, node.userData.mainBone.getWorldPosition(new THREE.Vector3()));
    });
    return result;
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  setPaused(paused) {
    this.paused = paused;
  }

  // A scene of the game behind the model instead of the pedestal; null takes it away
  async setBackdrop(url) {
    const request = (this.backdropRequest = (this.backdropRequest ?? 0) + 1);
    if (this.backdrop) {
      this.scene.remove(this.backdrop);
      this.backdrop.traverse((node) => {
        if (node.isMesh) {
          node.userData.pbr.dispose();
          node.userData.dota.dispose();
        }
      });
      this.backdrop = null;
    }
    this.updateShowcase();
    if (!url) {
      return;
    }
    const gltf = await loadModel(url);
    if (request !== this.backdropRequest) {
      return;
    }
    const backdrop = cloneSkinned(gltf.scene);
    // Statues and props of the scenes are drawn like heroes, the rest with their own flags
    backdrop.traverse((node) => {
      if (!node.isMesh) {
        return;
      }
      node.frustumCulled = false;
      node.visible = !editorOnly(node);
      const pbr = environmentMaterial(node.material.clone());
      node.userData.pbr = pbr;
      node.userData.dota = dotaMaterialFor(node.material, gltf.userData.textures) ?? pbr;
      node.material = this.shading === "dota" ? node.userData.dota : node.userData.pbr;
    });
    this.backdrop = backdrop;
    this.scene.add(backdrop);
    this.updateShowcase();
  }

  // The pedestal and its particles, unless a scene of the game is shown
  setShowcase(on) {
    this.showcase = on;
    this.updateShowcase();
  }

  updateShowcase() {
    const on = this.showcase !== false && !this.backdrop;
    this.effects.group.visible = on;
    if (!on) {
      this.floor.visible = false;
    }
  }

  setShading(mode) {
    this.shading = mode;
    [this.group, this.backdrop].forEach((object) => object?.traverse((node) => {
      if (node.isMesh) {
        node.material = mode === "dota" ? node.userData.dota : node.userData.pbr;
      }
    }));
  }

  setRim(color) {
    this.rimTarget.set(color);
    if (reducedMotion.matches) {
      stageRim.value.copy(this.rimTarget);
    }
  }

  // Fits the camera to the model, gliding there unless reduced motion is on
  frameModel(immediate = false) {
    if (!this.group) {
      return;
    }
    this.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.group, true);
    if (box.isEmpty()) {
      return;
    }
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z) * 0.5;

    // Animated models (heroes, couriers) stand and are seen from the front. A weapon or another part
    // shown alone lies the way it sits on the hero, so look at its broadest side instead.
    const standing = this.animated || size.y >= 0.6 * Math.max(size.x, size.z);
    let direction = new THREE.Vector3(0.35, 0.18, 1);
    if (!standing) {
      const axes = [
        { size: size.x, axis: new THREE.Vector3(1, 0, 0) },
        { size: size.y, axis: new THREE.Vector3(0, 1, 0) },
        { size: size.z, axis: new THREE.Vector3(0, 0, 1) },
      ].sort((a, b) => a.size - b.size);
      direction = axes[0].axis.clone().add(axes[1].axis.clone().multiplyScalar(0.45)).add(new THREE.Vector3(0, 0.25, 0));
    }
    // A standing model is fitted by its height and width as seen from the front,
    // so a long tail behind it does not shrink it; anything else by its bounding sphere
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const distance = standing
      ? Math.max(size.y / 2 / tan, size.x / 2 / (tan * this.camera.aspect)) * 1.9 + size.z * 0.25
      : (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.3;

    // Seen from above, the floor ring would frame the whole view
    const pedestal = size.x * 0.52 + size.y * 0.1;
    this.floor.visible = standing;
    this.floor.position.set(center.x, box.min.y + pedestal * 0.002, center.z);
    this.floor.scale.setScalar(size.x * 0.55 + size.y * 0.1);
    this.effects.place(new THREE.Vector3(center.x, box.min.y, center.z), pedestal, size.y, standing);
    this.updateShowcase();

    this.camera.near = distance / 100;
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = radius * 0.4;
    this.controls.maxDistance = distance * 4;

    // Aim a little below the middle so the model sits above the title
    const target = center.clone().add(new THREE.Vector3(0, standing ? -size.y * 0.16 : -radius * 0.15, 0));
    const position = target.clone().add(direction.normalize().multiplyScalar(distance));

    if (immediate || reducedMotion.matches) {
      this.controls.target.copy(target);
      this.camera.position.copy(position);
      this.tween = null;
      return;
    }
    this.tween = {
      start: performance.now(),
      duration: 900,
      fromTarget: this.controls.target.clone(),
      fromPosition: this.camera.position.clone(),
      target,
      position,
      lift: size.y * 0.06,
    };
  }

  frame() {
    const delta = Math.min(this.clock.getDelta(), 0.1);
    if (this.mixer && !this.paused) {
      this.mixer.update(delta * this.speed);
      this.playAnimationSounds();
    }

    this.effects.update(delta);
    stageRim.value.lerp(this.rimTarget, reducedMotion.matches ? 1 : Math.min(delta * 3, 1));

    if (this.tween) {
      const t = Math.min((performance.now() - this.tween.start) / this.tween.duration, 1);
      const ease = 1 - Math.pow(1 - t, 4);
      this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.target, ease);
      this.camera.position.lerpVectors(this.tween.fromPosition, this.tween.position, ease);
      // The model rises onto the stage as the camera settles
      if (this.group) {
        this.group.position.y = -this.tween.lift * (1 - ease);
      }
      if (t === 1) {
        this.tween = null;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // sound: { base, events, byModel, attack: { [model]: { event, point } } } or null to mute
  setSound(sound) {
    this.sound = sound;
    this.lastCycle = this.current ? this.cycle() : 0;
    this.preloadSounds();
  }

  // Loads every sound the current model's animations can play, so they play on time
  preloadSounds() {
    if (!this.sound || !this.rootModel) {
      return;
    }
    const names = new Set(Object.values(this.sound.byModel[this.rootModel] ?? {}).flatMap((list) => list.map(([, name]) => name)));
    const attack = this.sound.attack[this.rootModel];
    if (attack) {
      names.add(attack.event);
    }
    const visit = (name, depth) => {
      const event = this.sound.events[name];
      if (!event || depth > 3) {
        return;
      }
      event.files.forEach((file) => preloadSound(this.sound.base + file));
      event.layers?.forEach((layer) => visit(layer, depth + 1));
    };
    names.forEach((name) => visit(name, 0));
  }

  cycle() {
    const duration = this.current.getClip().duration || 1;
    return (this.current.time % duration) / duration;
  }

  // The sounds of the current animation between the last frame's point and this one's
  playAnimationSounds() {
    if (!this.sound || !this.current) {
      return;
    }
    const clip = this.current.getClip();
    const list = [...(this.sound.byModel[this.rootModel]?.[clip.name] ?? [])];
    const attack = this.sound.attack[this.rootModel];
    // The game plays a hero's attack sound on the hit, not from the animation
    if (attack && /attack/i.test(clip.name) && clip.duration > 0) {
      list.push([Math.min(attack.point / clip.duration, 0.95), attack.event]);
    }
    const now = this.cycle();
    const last = this.lastCycle ?? now;
    this.lastCycle = now;
    for (const [at, name] of list) {
      const crossed = now >= last ? at > last && at <= now : at > last || at <= now;
      if (crossed) {
        this.playEvent(name, 0);
      }
    }
  }

  playEvent(name, depth) {
    const event = this.sound?.events[name];
    if (!event || depth > 3) {
      return;
    }
    if (event.files.length) {
      playLoaded(this.sound.base + event.files[Math.floor(Math.random() * event.files.length)], {
        volume: Math.min(Math.max((event.volume ?? 1) * 0.7, 0), 1),
        rate: Math.min(Math.max((event.pitch ?? 1) * this.speed, 0.5), 2),
      });
    }
    event.layers?.forEach((layer) => this.playEvent(layer, depth + 1));
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
