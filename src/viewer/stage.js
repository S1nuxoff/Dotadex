import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import { colorParam, createDotaMaterial, createLitSimpleMaterial, loadCubeMaps, setDotaFillDir, setDotaKeyDir, setDotaLighting, setParticleLights, stageRim } from "./dotaMaterial.js";
import { loadMaterialPrograms } from "./materialPrograms.js";
import { StageEffects, stageTint } from "./effects.js";
import { RockStage } from "./rocks.js";
import { createWatermark } from "./watermark.js";
import { ParticleManager } from "./particles/manager.js";
import { Cloth, loadCloth } from "./cloth.js";
import { frameLights, SCENE_DEPTH } from "./particles/render.js";
import { playLoaded, playWhenReady, preloadSound } from "./soundPlayer.js";
import { playUiSound } from "../uiSounds.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Loaded models are kept, switching back and forth does not download them again
const cache = new Map();
const loader = new GLTFLoader();
// The models are exported in metres, the game's positions are in its units (inches)
const SOURCE_TO_METRES = 0.0254;
// Source's axes (x ahead of a hero, y to its left, z up) to the scene's (y up, the hero facing +z)
const sourceToScene = ([x, y, z]) => new THREE.Vector3(y, z, x).multiplyScalar(SOURCE_TO_METRES);
// The models drawn into the shadow map as the game draws them: depth pushed back by the slope of the
// surface (client.dll's mat_slopescaledepthbias_shadowmap, 4); its constant mat_depthbias_shadowmap
// (0.0005) is the light's shadow.bias. Without it a surface facing the light shadows itself in stripes
const shadowDepthMaterial = new THREE.MeshDepthMaterial({ polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 0 });

// The shadow caster for a material: an alpha-tested one (hair cards, fringes) is cut by its color's
// alpha as in its own pass, else it casts its whole quads; a blended one (F_TRANSLUCENT,
// F_ADDITIVE_BLEND) writes no depth and casts nothing. null: no shadow
function shadowDepthFor(material) {
  if (!material || material.transparent) {
    return null;
  }
  const main = material.uniforms;
  if (main?.uAlphaTest) {
    if (!(main.uAlphaTest.value > 0)) {
      return shadowDepthMaterial;
    }
    const depth = shadowDepthMaterial.clone();
    depth.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        tColor: main.tColor,
        uBaseUv: main.uBaseUv,
        uAlphaUv: main.uAlphaUv,
        uSeparateAlpha: main.uSeparateAlpha,
        uAlphaTest: main.uAlphaTest,
      });
      shader.vertexShader = shader.vertexShader
        .replace("void main() {", "varying vec2 vShadowUv;\nvoid main() {\n  vShadowUv = uv;");
      shader.fragmentShader = shader.fragmentShader.replace(
        "void main() {",
        /* glsl */ `uniform sampler2D tColor;
uniform mat3 uBaseUv;
uniform mat3 uAlphaUv;
uniform float uSeparateAlpha;
uniform float uAlphaTest;
varying vec2 vShadowUv;
void main() {
  float shadowAlpha = texture2D(tColor, (uBaseUv * vec3(vShadowUv, 1.0)).xy).a;
  if (uSeparateAlpha > 0.5) shadowAlpha = texture2D(tColor, (uAlphaUv * vec3(vShadowUv, 1.0)).xy).a;
  if (shadowAlpha < uAlphaTest) discard;`
      );
    };
    depth.customProgramCacheKey = () => "dota-alpha-test-shadow";
    return depth;
  }
  if (material.alphaTest > 0 && material.map) {
    // three's own depth pass cuts by map and alphaTest
    const depth = shadowDepthMaterial.clone();
    depth.map = material.map;
    depth.alphaTest = material.alphaTest;
    return depth;
  }
  return shadowDepthMaterial;
}

// The effects models start on their own, as the game's pedestal does its ground fog
// (particles/model-effects.json: { "<model>.vmdl": [{ system, config }] }), loaded once
let modelEffects = null;
// The effects the heroes' page maps start (particles/map-effects.json: { "<map>.vmap": [{ system,
// name, origin, angles }] }), loaded once
let mapEffects = null;
// Values the game's code puts in control points of a map's effects, by the entity's name: the
// hero page gives pedestal_fx (the god rays and their dust, colored by CP1) grey 0.25, the same
// for every hero (client.dll 0x182edf580, called with constants 0.5 for the fog and 0.25 for it)
const MAP_EFFECT_VALUES = { pedestal_fx: { 1: [0.25, 0.25, 0.25] } };

// Source's field of view is the horizontal one of a 4:3 screen (the engine has a separate
// point_camera_vertical_fov for the other kind); wider screens keep its vertical angle.
// The hero page's portrait cameras are the exception: their PortraitFOV is the vertical angle
// (so econ_set_preview frames each hero as large as the game shows it)
const verticalFov = (fov) => THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * 0.75));

// The height of the letters of the site's mark round the pedestal's edge, as a share of its radius
const WATERMARK_BAND = 0.06;

// Starts downloading models ahead of time (the pointer resting on a hero in the list), so
// they are ready, or nearly, when picked
export function prefetchModels(urls) {
  for (const url of urls) {
    loadModel(url.split("#")[0]).catch(() => {});
  }
}

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

// A model's sequences with their activities ({ name: { looping, activities: [activity, ...modifiers] } }),
// next to the model; null where there is none
const sequenceFiles = new Map();
function loadSequences(modelUrl) {
  const url = modelUrl.replace(/\.glb$/, ".sequences.json");
  if (!sequenceFiles.has(url)) {
    sequenceFiles.set(url, fetch(url).then((res) => (res.ok ? res.json() : null)).catch(() => null));
  }
  return sequenceFiles.get(url);
}

// The clip a sequence plays: the glb's clips are the model's animations, named apart from the
// sequences that play them (vs_spawn_loadout plays @vs_spawn_loadout); the export gives it as
// `clip`, older files do not, where the animation is the sequence's name or it with an @
function clipOf(name, sequence, names) {
  return [sequence?.clip, name, `@${name}`].find((clip) => clip && names.includes(clip));
}

// The sequence for each clip of the model (the first that plays it)
function sequencesByClip(sequences, names) {
  const byClip = new Map();
  for (const [name, sequence] of Object.entries(sequences ?? {})) {
    const clip = clipOf(name, sequence, names);
    if (clip && !byClip.has(clip)) byClip.set(clip, sequence);
  }
  return byClip;
}

// The clip of the sequence the game picks for an activity under the modifiers set: of the
// sequences of that activity whose modifiers are all set, the one matching most of them (the
// first in the model's order among equals). With "loadout" and Sven's TI7 sword's "ti7" set,
// his spawn is loadout_ti7_spawn (ti7 + loadout), not loadout_spawn (loadout); a sequence needing
// a modifier not set (Void Spirit's vs_debut_spawn: debut + loadout) is never picked
function sequenceFor(byClip, names, activity, modifiers = []) {
  const set = new Set(modifiers);
  let best = null;
  let bestCount = -1;
  for (const name of names) {
    const [act, ...mods] = byClip?.get(name)?.activities ?? [];
    if (act !== activity || !mods.every((mod) => set.has(mod))) continue;
    if (mods.length > bestCount) {
      best = name;
      bestCount = mods.length;
    }
  }
  return best ?? undefined;
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
          textures[param] = await loadVariantTexture(base + path, param === "g_tColor" || param === "g_tCubeMap" || param === "g_tDetail" || param === "g_tDetail2").catch(() => null);
        })
      );
      result[name] = { vmat, textures };
    })
  );
  return result;
}

function dotaMaterialFor(material, textures) {
  const vmat = material.userData?.vmat;
  // hero.vfx, and global_lit_simple.vfx (the pedestal, static props)
  if (!vmat || (vmat.ShaderName !== "hero.vfx" && vmat.ShaderName !== "global_lit_simple.vfx")) {
    return null;
  }
  // Found by name, or else from the glTF slots Source2Viewer put them in
  const slots = { g_tColor: material.map, g_tNormal: material.normalMap, g_tMasks1: material.emissiveMap };
  const byParam = {};
  for (const [param, name] of Object.entries(vmat.TextureParams ?? {})) {
    const texture = textures[name] ?? slots[param];
    if (texture) {
      texture.colorSpace = param === "g_tColor" || param === "g_tCubeMap" || param === "g_tDetail" || param === "g_tDetail2" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.needsUpdate = true;
      byParam[param] = texture;
    }
  }
  return vmat.ShaderName === "hero.vfx" ? createDotaMaterial(material, vmat, byParam) : createLitSimpleMaterial(material, vmat, byParam);
}

// The plain material with what the hero shader adds on top, the way the game's hero.vfx
// does it: Masks1 is R detail mask, G diffuse warp mask, B metalness, A self-illumination
// (Source2Viewer puts it in the emissive slot with no strength). Self-illuminated parts
// show their color as it is instead of the light on it. The detail textures (F_DETAIL and
// F_DETAIL_2) go where Masks1 R says: 1 add, 2 add and self-illuminate, 3 multiply by twice.
// textures(param) gives the material's texture for a vmat parameter.
function plainMaterial(material, textures) {
  const vmat = material.userData?.vmat;
  if (vmat?.ShaderName !== "hero.vfx") {
    return material;
  }
  const flags = vmat.IntParams ?? {};
  const floats = vmat.FloatParams ?? {};
  const masks = material.emissiveMap;
  // How the material is laid over what is behind it
  const blended = flags.F_TRANSLUCENT || flags.F_ADDITIVE_BLEND || (flags.F_RENDER_BACKFACES && material.side !== THREE.DoubleSide);
  const setBlend = (target) => {
    if (flags.F_TRANSLUCENT || flags.F_ADDITIVE_BLEND) {
      target.transparent = true;
      target.depthWrite = false;
    }
    if (flags.F_ADDITIVE_BLEND) {
      target.blending = THREE.AdditiveBlending;
    }
    if (flags.F_RENDER_BACKFACES) {
      target.side = THREE.DoubleSide;
    }
    return target;
  };
  if (!masks) {
    return blended ? setBlend(material.clone()) : material;
  }
  const vec = vmat.VectorParams ?? {};
  const layers = [
    { mode: flags.F_DETAIL ?? 0, texture: textures("g_tDetail"), scale: vec.g_vDetailTexCoordScale, tint: vec.g_vDetail1ColorTint, amount: floats.g_flDetailBlendFactor },
    { mode: flags.F_DETAIL_2 ?? 0, texture: textures("g_tDetail2"), scale: vec.g_vDetail2TexCoordScale, tint: vec.g_vDetail2ColorTint, amount: floats.g_flDetail2BlendFactor },
  ].filter((layer) => layer.mode > 0 && layer.texture && (layer.amount ?? 1) > 0);

  const uniforms = {};
  layers.forEach((layer, index) => {
    layer.texture.colorSpace = THREE.SRGBColorSpace;
    layer.texture.wrapS = layer.texture.wrapT = THREE.RepeatWrapping;
    layer.texture.needsUpdate = true;
    uniforms[`tDetail${index}`] = { value: layer.texture };
    uniforms[`uDetailScale${index}`] = { value: new THREE.Vector2(layer.scale?.[0] || 1, layer.scale?.[1] || 1) };
    uniforms[`uDetailTint${index}`] = { value: new THREE.Color(...(colorParam(layer.tint) ?? [1, 1, 1]).slice(0, 3)) };
    uniforms[`uDetailAmount${index}`] = { value: layer.amount ?? 1 };
  });
  const declarations = layers
    .map((_, index) => `uniform sampler2D tDetail${index}; uniform vec2 uDetailScale${index}; uniform vec3 uDetailTint${index}; uniform float uDetailAmount${index};`)
    .join("\n");
  const blend = layers
    .map((layer, index) => {
      const sample = `texture2D( tDetail${index}, vEmissiveMapUv * uDetailScale${index} ).rgb * uDetailTint${index}`;
      const amount = `masks1.r * uDetailAmount${index}`;
      if (layer.mode === 3) {
        return `diffuseColor.rgb *= mix( vec3( 1.0 ), ${sample} * 2.0, ${amount} );`;
      }
      const add = `diffuseColor.rgb += ${sample} * ${amount};`;
      return layer.mode === 2 ? `${add}\nselfIllum = max( selfIllum, ${amount} );` : add;
    })
    .join("\n");

  // "Blend to full" turns a mask all the way on for the whole material
  const selfIllumToFull = floats.g_flSelfIllumBlendToFull ?? 0;
  const detailToFull = floats.g_flDetailBlendToFull ?? 0;
  const result = setBlend(material.clone());
  result.emissive = new THREE.Color(0, 0, 0);
  result.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${declarations}\nfloat selfIllum = 0.0;`)
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        vec4 masks1 = texture2D( emissiveMap, vEmissiveMapUv );
        selfIllum = mix( masks1.a, 1.0, ${selfIllumToFull.toFixed(3)} );
        masks1.r = mix( masks1.r, 1.0, ${detailToFull.toFixed(3)} );
        ${blend}`
      )
      .replace("#include <emissivemap_fragment>", "")
      // Glowing parts show their color as it is
      .replace("#include <opaque_fragment>", "outgoingLight = mix( outgoingLight, diffuseColor.rgb, selfIllum );\n#include <opaque_fragment>");
  };
  result.customProgramCacheKey = () => `dota-plain-${layers.map((layer) => layer.mode).join("-")}`;
  return result;
}

// Helpers only the map editor shows: camera markers, the stand-in heroes scenes are laid
// out with, and the like in red dev materials
function editorOnly(node) {
  const name = node.material?.userData?.vmat?.Name ?? "";
  if (/^materials\/(dev|tools)\//.test(name)) {
    return true;
  }
  for (let parent = node; parent; parent = parent.parent) {
    if (/camera|_layout|debut_creep/i.test(parent.name)) {
      return true;
    }
  }
  return false;
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

// A part whose bone the animation puts this far below the model's origin (metres) is one the game
// hides under the ground (see hideParked)
const PARKED_DEPTH = 5;

// The bone that moves most of a skinned mesh
function mainBone(mesh) {
  if (!mesh.userData.mainBone) {
    const { skinIndex, skinWeight } = mesh.geometry.attributes;
    const totals = new Float32Array(mesh.skeleton.bones.length);
    for (let i = 0; i < skinIndex.count; i++) {
      for (let k = 0; k < 4; k++) {
        totals[skinIndex.getComponent(i, k)] += skinWeight.getComponent(i, k);
      }
    }
    mesh.userData.mainBone = mesh.skeleton.bones[totals.indexOf(Math.max(...totals))];
  }
  return mesh.userData.mainBone;
}

// Makes the skinned meshes of `part` follow the bones of `root` with the same names, in any
// letter case as the game matches them (Anti-Mage's base has Spine_0, many of his items spine_0).
// Bones only the part has (chains, cloth) are moved under their parent in the root skeleton.
function attach(root, part) {
  const bones = new Map();
  const key = (bone) => bone.name.toLowerCase();
  root.traverse((node) => node.isBone && bones.set(key(node), node));

  const partBones = [];
  part.traverse((node) => node.isBone && partBones.push(node));

  for (const bone of partBones) {
    if (bones.has(key(bone)) || !bone.parent?.isBone) {
      continue;
    }
    const parent = bones.get(key(bone.parent));
    if (parent && parent !== bone.parent) {
      parent.add(bone);
      bone.traverse((node) => node.isBone && !bones.has(key(node)) && bones.set(key(node), node));
    }
  }

  part.traverse((node) => {
    if (node.isSkinnedMesh) {
      const skeleton = node.skeleton;
      const shared = skeleton.bones.map((bone) => bones.get(key(bone)) ?? bone);
      node.bind(new THREE.Skeleton(shared, skeleton.boneInverses), node.bindMatrix);
    }
  });

  // Drop the part's own copies of shared bones so animation tracks resolve to one node per name
  for (const bone of partBones) {
    if (bones.get(key(bone)) !== bone && bone.parent) {
      bone.removeFromParent();
    }
  }
  root.add(part);
}

// Fog over the whole view while one model gives way to another: it rolls in in billows,
// the model changes behind it, and it parts again
const veilShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uCover;
    uniform float uTime;
    uniform float uAspect;
    uniform vec3 uTint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    float fbm(vec2 p) {
      float sum = 0.0, amp = 0.5;
      for (int i = 0; i < 5; i++) {
        sum += noise(p) * amp;
        p = p * 2.03 + vec2(1.7, 9.2);
        amp *= 0.5;
      }
      return sum;
    }
    void main() {
      vec2 p = vec2(vUv.x * uAspect, vUv.y) * 3.0;
      float fog = fbm(p + vec2(uTime * 0.3, uTime * 0.12) + fbm(p * 1.7 - uTime * 0.2));
      // The billows close in from the edges first and clear from the middle first
      float edge = length(vUv - 0.5) * 0.6;
      float alpha = smoothstep(0.0, 0.25, uCover * 1.5 - (1.0 - fog) + edge * (1.0 - uCover));
      vec3 color = mix(vec3(0.05, 0.06, 0.08), uTint * 0.35, fog * 0.6);
      gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0) * min(uCover * 3.0, 1.0));
      #include <colorspace_fragment>
    }
  `,
};

// The scene's depth as the distance from the camera, in a texture the particles read (they are
// drawn against the frame's own depth, which they cannot read while drawing into it)
class SceneDepthPass extends Pass {
  constructor(camera) {
    super();
    this.needsSwap = false;
    this.camera = camera;
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 100 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
        fragmentShader: `#include <packing>
          uniform sampler2D tDepth; uniform float uNear; uniform float uFar; varying vec2 vUv;
          void main() { gl_FragColor = vec4(vec3(-perspectiveDepthToViewZ(texture2D(tDepth, vUv).r, uNear, uFar)), 1.0); }`,
        depthTest: false,
        depthWrite: false,
      })
    );
  }

  render(renderer, writeBuffer, readBuffer) {
    if (!readBuffer.depthTexture || !this.camera.isPerspectiveCamera) {
      SCENE_DEPTH.uHasSceneDepth.value = 0;
      return;
    }
    if (this.target.width !== readBuffer.width || this.target.height !== readBuffer.height) {
      this.target.setSize(readBuffer.width, readBuffer.height);
    }
    const uniforms = this.quad.material.uniforms;
    uniforms.tDepth.value = readBuffer.depthTexture;
    uniforms.uNear.value = this.camera.near;
    uniforms.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    SCENE_DEPTH.uSceneDepth.value = this.target.texture;
    SCENE_DEPTH.uSceneSize.value.set(readBuffer.width, readBuffer.height);
    SCENE_DEPTH.uHasSceneDepth.value = 1;
  }

  dispose() {
    this.target.dispose();
    this.quad.dispose();
  }
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    // While developing, the stage is at hand in the console
    if (import.meta.env.DEV) window.__stage = this;

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
    this.hemi = new THREE.HemisphereLight(0xb8c4d6, 0x1a1714, 1.2);
    this.scene.add(this.hemi);
    // The sun of a scene of the game, when one is shown
    this.sun = new THREE.DirectionalLight(0xffffff, 0);
    this.scene.add(this.sun, this.sun.target);
    this.sceneLights = new THREE.Group();
    this.scene.add(this.sceneLights);
    const key = new THREE.DirectionalLight(0xfff6ea, 2.2);
    this.key = key;
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
    this.veil = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        ...veilShader,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uCover: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 }, uTint: stageTint },
      })
    );
    this.veil.frustumCulled = false;
    this.veil.renderOrder = 1000;
    // The stage opens in fog, which parts once the first model is in and framed
    this.veil.material.uniforms.uCover.value = 1;
    this.veil.visible = true;
    this.veil.userData.skipGlow = true;
    this.scene.add(this.veil);
    this.veilTarget = 1;
    this.veilSince = performance.now();
    // Stony ground instead of the stone pedestal, with real shadows
    this.rockStage = new RockStage(this.scene);
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.fog = new THREE.FogExp2(0x0b1017, 0.001);


    this.timer = new THREE.Timer();
    this.timer.connect(document);
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

    // The game has no bloom over its whole frame: only materials with a bloom scale glow (the
    // glow composer below). The frame keeps its depth as a texture, for the particles' soft edges
    // (SceneDepthPass)
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1) }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // The particles over the frame and against its depth
    this.particleScene = new THREE.Scene();
    this.composer.addPass(new SceneDepthPass(this.camera));
    const particlePass = new RenderPass(this.particleScene, this.camera);
    particlePass.clear = false;
    this.composer.addPass(particlePass);
    // The materials' own halos (see createGlowMaterial): the model drawn again with only its
    // glow, everything else black so it still hides what is behind it, then blurred
    this.glowComposer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    this.glowComposer.renderToScreen = false;
    this.glowComposer.addPass(new RenderPass(this.scene, this.camera, null, new THREE.Color(0, 0, 0), 0));
    this.glowComposer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.65, 0.3, 0));
    this.glowBlack = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.glowMix = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, tGlow: { value: null } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tGlow; varying vec2 vUv;
        void main() { vec4 base = texture2D(tDiffuse, vUv); gl_FragColor = vec4(base.rgb + texture2D(tGlow, vUv).rgb, base.a); }`,
    });
    // ShaderPass copies its uniforms, and a copied render target texture comes out empty
    this.glowMix.uniforms.tGlow.value = this.glowComposer.renderTarget2.texture;
    this.glowMix.enabled = false;
    this.composer.addPass(this.glowMix);
    this.composer.addPass(new OutputPass());

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
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(clientWidth, clientHeight);
    this.glowComposer.setPixelRatio(this.renderer.getPixelRatio());
    this.glowComposer.setSize(clientWidth, clientHeight);
    this.applyShift();
    this.effects.hazeMaterial.uniforms.uAspect.value = clientWidth / clientHeight;
  }

  // urls[0] is the base (a hero), the rest are worn on it. The model with the most
  // animations becomes the skeleton everything follows, so a body-replacing arcana
  // takes the place of the hero base.
  // An url may end with #skin=N for a material variant of the model.
  async show(urls, onProgress) {
    // A model on show is veiled in fog while the next one loads
    if (this.group && !reducedMotion.matches) {
      if (this.veilTarget !== 1) {
        playUiSound("veil-in", 0.8);
      }
      this.veilTarget = 1;
      this.veilSince = performance.now();
    }
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
    const [gltfs, skins, sequences, cloths] = await Promise.all([
      Promise.all(
        entries.map(({ url }) =>
          loadModel(url, (event) => {
            loaded.set(url, { loaded: event.loaded, total: event.total });
            report();
          })
        )
      ),
      Promise.all(entries.map(({ url, skin }) => (skin ? loadSkin(url, skin) : null))),
      Promise.all(entries.map(({ url }) => loadSequences(url))),
      // The cloth, hair and beards each model moves on its own
      Promise.all(entries.map(({ url }) => loadCloth(url))),
      // Materials whose parameters change over time, needed before the materials are made
      loadMaterialPrograms(entries[0].url.slice(0, entries[0].url.indexOf("/models/") + 1)),
      // The cube maps the materials reflect, before the materials are made
      loadCubeMaps(entries[0].url.slice(0, entries[0].url.indexOf("/models/") + 1)),
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
    // The cloth of the models shown (not of a hero base a body-replacing model hides)
    const shownCloth = [];
    const root = cloneSkinned(gltfs[rootIndex].scene);
    this.applyMaterials(root, gltfs[rootIndex].userData.textures, skins[rootIndex]);
    // Each mesh knows the model it came from, for effects that rise from one model's surface
    const tag = (object, url) => object.traverse((node) => node.isMesh && (node.userData.model = url.split("#")[0]));
    tag(root, entries[rootIndex].url);
    group.add(root);
    shownCloth.push(cloths[rootIndex]);

    gltfs.forEach((gltf, index) => {
      // A hero base is hidden when a body-replacing model took over
      if (index === rootIndex || (index === 0 && rootIndex !== 0 && gltf.animations.length > 10)) {
        return;
      }
      shownCloth.push(cloths[index]);
      const part = cloneSkinned(gltf.scene);
      this.applyMaterials(part, gltf.userData.textures, skins[index]);
      tag(part, entries[index].url);
      attach(root, part);
    });

    this.rootModel = entries[rootIndex].url.slice(entries[rootIndex].url.indexOf("/models/") + 1);
    this.rootUrl = entries[rootIndex].url;
    // The swap happens behind the fog once it has closed over the view
    while (this.veilTarget === 1 && this.veil.material.uniforms.uCover.value < 0.95) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (request !== this.request) {
        return null;
      }
    }
    this.sequences = sequences[rootIndex];
    this.replace(group, gltfs[rootIndex].animations);
    this.cloths = [];
    // The bones the hero's animations move, by name in lower case
    const animatedBones = new Set(gltfs[rootIndex].animations.flatMap((clip) => clip.tracks.map((track) => track.name.slice(0, track.name.lastIndexOf(".")).toLowerCase())));
    // The new cloth's effects start with the animation playing now
    this.clothClip = null;
    for (const fe of shownCloth) {
      try {
        const cloth = fe && new Cloth(fe, group, animatedBones);
        if (cloth && !cloth.empty) {
          this.cloths.push(cloth);
        }
      } catch (error) {
        console.warn("Cloth not set up", error);
      }
    }
    // A bone one cloth moves is left to the last that moves it: the bones are shared here, while in
    // the game each model moves its own, so a worn part's cloth (Tidehunter's fish) moves the bones
    // its mesh hangs on and the hero's own cloth, which has the same chain, must not move them too
    const claimed = new Set();
    for (let k = this.cloths.length - 1; k >= 0; k--) {
      const cloth = this.cloths[k];
      cloth.driven = cloth.driven.filter((driven) => !claimed.has(driven.bone));
      cloth.driven.forEach((driven) => claimed.add(driven.bone));
    }
    this.modelUrls = entries.map((entry) => entry.url);
    this.particles?.setModel(group, this.modelUrls);
    if (this.veilTarget === 1) {
      playUiSound("veil-out", 0.7);
    }
    this.veilTarget = 0;
    // Told once the fog has parted enough to see the model, not when it is swapped in behind it
    this.pendingShow = true;
    try {
      this.measureTint(group);
    } catch {}
    // Models whose materials glow with a halo light the rocks around them more
    let glowing = false;
    group.traverse((node) => {
      glowing ||= Boolean(node.isMesh && node.userData.dota?.userData?.glow);
    });
    this.rockStage.setGlowStrength(glowing ? 3 : 1);
    // The animations' sounds once the model is up, not competing with its download
    setTimeout(() => request === this.request && this.preloadSounds(), 1200);
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
        node.userData.pbr = plainMaterial(plain, (param) => variant.textures[param] ?? textures?.[variant.vmat.TextureParams?.[param]]);
        node.userData.dota = createDotaMaterial(original, variant.vmat, variant.textures);
      } else {
        node.userData.pbr = plainMaterial(original, (param) => textures?.[original.userData?.vmat?.TextureParams?.[param]]);
        node.userData.dota = dotaMaterialFor(original, textures) ?? environmentMaterial(original.clone());
      }
      node.material = this.shading === "dota" ? node.userData.dota : node.userData.pbr;
    });
  }

  replace(group, animations) {
    if (this.group) {
      this.mixer?.stopAllAction();
      this.dropModel(this.group);
      // The camera swings round onto the new model
      this.swing = true;
    }
    // A flash of the new model's light as it comes in
    this.flash = 1;

    this.group = group;
    // A new hero comes in facing ahead, its pedestal with it
    if (this.pedestal) {
      this.pedestal.rotation.y = 0;
    }
    group.traverse((node) => {
      // The model's shadow falls on the rocks
      if (node.isMesh) {
        const depth = shadowDepthFor(node.userData.dota ?? node.material);
        node.castShadow = depth !== null;
        node.receiveShadow = true;
        // Both faces into the shadow map: three draws only the back faces by default, so a
        // one-sided sheet turned to the light (hair, a cape) cast no shadow at all; the normal
        // offset keeps the surfaces from shadowing themselves
        for (const material of [node.material, node.userData.dota, node.userData.pbr].flat()) {
          if (material) material.shadowSide = THREE.DoubleSide;
        }
        if (depth) node.customDepthMaterial = depth;
      }
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

    // As the game's hero preview: the loadout stance (ACT_DOTA_LOADOUT, or the idle made for the
    // loadout, or the plain idle), come into with the loadout's spawn. By the sequences' activities;
    // by the clips' names for models without them (a name like run_to_idle was taken for idle)
    const names = Object.keys(this.actions).sort((a, b) => a.startsWith("@") - b.startsWith("@"));
    const seq = this.sequences && sequencesByClip(this.sequences, names);
    this.clipSequences = seq ?? new Map();
    // The effects the new model's animations start, and what they say, begin with its first animation
    this.effectClip = null;
    this.effectAction = null;
    this.speechClip = null;
    this.speechAction = null;
    // What is worn sets its modifiers (for every activity, or one); the spawn and a plain idle
    // standing in for the stance are the loadout's ("loadout"). The stance is not: the portrait
    // names ACT_DOTA_LOADOUT alone, and the only stance with "loadout" is Disruptor's one-off roar
    const modifiers = (activity, loadout) => [...(loadout ? ["loadout"] : []), ...(this.activityModifiers ?? []).filter(([act]) => act === "ALL" || act === activity).map(([, mod]) => mod)];
    const idle = sequenceFor(seq, names, "ACT_DOTA_LOADOUT", modifiers("ACT_DOTA_LOADOUT", false))
      ?? sequenceFor(seq, names, "ACT_DOTA_IDLE", modifiers("ACT_DOTA_IDLE", true))
      ?? names.find((name) => /^idle$|^idle_anim$/i.test(name))
      ?? names.find((name) => /idle/i.test(name) && !/_to_|to_idle|transition/i.test(name))
      ?? names[0];
    this.idleName = idle;
    // Heroes come in with their spawn animation, as in the game, then settle into idle
    const spawn = sequenceFor(seq, names, "ACT_DOTA_SPAWN", modifiers("ACT_DOTA_SPAWN", true))
      ?? (seq ? undefined : names.find((name) => /spawn/i.test(name) && !/respawn|loadout/i.test(name)));
    // Whether the spawn says its own line (AE_CL_SPEECH), so no other is said for it
    this.spawnSpeaks = Boolean(spawn && !reducedMotion.matches && seq?.get(spawn)?.speech?.length);
    // The frame and the ground are set from the idle pose: a spawn starts mid-leap or crouched.
    // The first model of a stage is framed at once, with no flight in from the starting camera.
    if (idle) {
      this.play(idle, 0);
      this.mixer.update(0);
    }
    this.frameModel(!this.framedOnce);
    this.framedOnce = true;
    if (spawn && idle && !reducedMotion.matches) {
      const action = this.actions[spawn];
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      this.play(spawn, 0);
      const settle = (event) => {
        if (event.action === action) {
          this.mixer.removeEventListener("finished", settle);
          if (this.current === action) {
            this.play(idle, 0.35);
            this.onAnimation?.(idle);
          }
        }
      };
      this.mixer.addEventListener("finished", settle);
    }
    this.mixer.update(0);
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
      // The cloth's bones start from the pose too, not from the animation's last frame
      for (const cloth of this.cloths ?? []) {
        cloth.capture();
      }
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
      if (node.isSkinnedMesh) {
        result.set(node, mainBone(node).getWorldPosition(new THREE.Vector3()));
      }
    });
    return result;
  }

  // The game hides some parts by parking their bone far under the ground in every animation
  // (Mirana persona's arrow, 12.7 m down): the ground hides them there, but our stage has none
  // to see through, so a mesh whose main bone the animation puts that deep is not drawn
  hideParked() {
    if (!this.group) {
      return;
    }
    const toModel = (this.parkInverse ??= new THREE.Matrix4()).copy(this.group.matrixWorld).invert();
    const at = (this.parkAt ??= new THREE.Vector3());
    this.group.traverse((node) => {
      if (!node.isSkinnedMesh || (!node.visible && !node.userData.parked)) {
        return;
      }
      const parked = at.setFromMatrixPosition(mainBone(node).matrixWorld).applyMatrix4(toModel).y < -PARKED_DEPTH;
      if (parked !== Boolean(node.userData.parked)) {
        node.userData.parked = parked;
        node.visible = !parked;
      }
    });
  }

  // The activity modifiers what is worn sets ([[activity or "ALL", modifier]]), by which the next
  // model's loadout stance and spawn are picked
  setActivityModifiers(list) {
    this.activityModifiers = list ?? [];
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  setPaused(paused) {
    this.paused = paused;
  }

  // The light and camera of a scene of the game: { light, camera, points } from the scene
  // list, or null for the studio. The camera is taken when the scene says where it was.
  setSceneLook(info, { camera = true } = {}) {
    this.useSceneCamera = camera;
    const light = info?.light;
    this.sceneLook = light ? info : null;
    this.sceneLights.clear();
    if (!light) {
      setDotaLighting(null);
      this.sun.intensity = 0;
      this.key.intensity = 2.2;
      this.hemi.color.set(0xb8c4d6);
      this.hemi.groundColor.set(0x1a1714);
      this.hemi.intensity = 1.2;
      this.scene.environmentIntensity = 0.6;
      this.camera.fov = 28;
      this.camera.updateProjectionMatrix();
      // A hero's page keeps the game's light for the hero
      this.portraitLit = false;
      this.updatePortraitLight();
      this.frameModel();
      return;
    }
    const color = (values, scale = 1) => new THREE.Color(...(values ?? [0, 0, 0]).map((value) => value * scale));
    const [sky, fill, ground] = light.ambient ?? [];
    const look = {
      key: color(light.color, 1.6),
      fill: color(fill, 0.8),
      sky: color(sky, 0.35),
      ground: color(ground, 0.6),
    };
    setDotaLighting(look);
    // The direction the light comes from, the opposite of where it shines
    this.sunDir = new THREE.Vector3(...light.direction).negate().normalize();
    this.sun.color.copy(look.key);
    this.sun.intensity = 2;
    this.sun.position.copy(this.sunDir).multiplyScalar(1000);
    this.key.intensity = 0;
    this.hemi.color.copy(look.sky);
    this.hemi.groundColor.copy(look.ground);
    this.hemi.intensity = 2;
    this.scene.environmentIntensity = 0.15;
    for (const point of info.points ?? []) {
      const lamp = new THREE.PointLight(color(point.color, 0.5), 1, 600 * SOURCE_TO_METRES, 1);
      lamp.position.set(...point.position);
      this.sceneLights.add(lamp);
    }
    this.frameModel(true);
  }

  // The pedestal and its particles, unless a scene of the game is shown
  // The hero page's light as the game sets it for the hero: its key light from where the game puts
  // it, in its color, the ambient in the hero's own, and a sun casting the hero's shadow on the pedestal
  updatePortraitLight() {
    const on = Boolean(this.loadout && this.portrait?.light && !this.sceneLook);
    if (on && !this.portraitSun) {
      // The page's light is the portrait world's env_global_light "default_light", spawned with no
      // keys but its name (client.dll 0x182c85826), so not in spot mode: its shadow is the sun's,
      // orthographic and fitted to the view each frame (fitPortraitShadow), in
      // DotaSunLightShadowDepthTexture, 2048 square (0x1822014f0 by cl_globallight_shadow_mode,
      // default 2). The shaders push each point 1 unit out along its normal before reading it
      this.portraitSun = new THREE.DirectionalLight(0xffffff, 0);
      this.portraitSun.castShadow = true;
      this.portraitSun.shadow.mapSize.set(2048, 2048);
      this.portraitSun.shadow.bias = -0.0005;
      this.portraitSun.shadow.normalBias = SOURCE_TO_METRES;
      this.scene.add(this.portraitSun, this.portraitSun.target);
    }
    if (this.portraitSun) {
      this.portraitSun.visible = on;
    }
    if (on) {
      const { light, ambient } = this.portrait;
      // The global light's colors go from gamma to linear on their way to the shaders (client.dll
      // 0x181762f90 reads each Color through 0x18384f430, a 256-entry sRGB-to-linear table at
      // 0x18501e200), the scales multiply after
      const color = (values, scale) => {
        const [r, g, b] = values ?? [1, 1, 1];
        return new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace).multiplyScalar(scale);
      };
      // As the game hands them to hero.vfx: the key light in its color times its scale; the second
      // light in the ambient color, its scale for the diffuse only (the rim takes the color alone).
      // While developing, ?key=<times> and ?amb=<times> scale them (V-13)
      const search = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
      const keyTimes = Number(search?.get("key") ?? 1);
      const ambientTimes = Number(search?.get("amb") ?? 1);
      const look = {
        key: color(light.color, (light.scale ?? 1) * keyTimes),
        fill: color(ambient.color, 1),
        fillScale: (ambient.scale ?? 1) * ambientTimes,
        // The sky/ground pair both shaders lerp by the normal's up, cb2[6] and cb2[17] (the global
        // light's m_AmbientColor2 and m_AmbientColor3, client.dll 0x181762f90 → 0x182224610): on the
        // page the shadow's color, PortraitShadowColor, for both. hero.vfx scales it by cb2[6].w
        // (m_flAmbientScale2: PortraitShadowScale) and shows it only in the key light's shadow;
        // global_lit_simple (the pedestal) by cb2[5].w (m_flGroundScale: PortraitGroundShadowScale)
        // where the key does not reach. client.dll's defaults: 89 89 89, 1.5, 1.5
        sky: color(this.portrait.shadow?.color ?? [89 / 255, 89 / 255, 89 / 255], this.portrait.shadow?.ground ?? 1.5),
        ground: color(this.portrait.shadow?.color ?? [89 / 255, 89 / 255, 89 / 255], this.portrait.shadow?.ground ?? 1.5),
        fillFollows: Boolean(ambient.direction),
        shadowFill: color(this.portrait.shadow?.color ?? [89 / 255, 89 / 255, 89 / 255], this.portrait.shadow?.scale ?? 1.5),
      };
      // The second light from PortraitAmbientDirection: angles the light points along, as the key
      // light's (whose position lies the other way), so it comes from the opposite side
      this.portraitFillDir = null;
      if (ambient.direction?.length === 3) {
        const [pitch, yaw] = ambient.direction.map(THREE.MathUtils.degToRad);
        this.portraitFillDir = sourceToScene([Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch)]).normalize().negate();
      }
      setDotaLighting(look);
      // The direction towards the light. hero.vfx's sun direction and the shadow's are the global
      // light's m_ShadowDirection (client.dll 0x18173e8e0); which portrait key fills it is not
      // found in the code. For 135 of the 201 entries PortraitLightAngles point from
      // PortraitLightPosition at the hero within 5 degrees; for Wei's they are 35 apart, and the
      // game's shot of her decides: the whole face under the hat's shadow and a matte thigh fit a
      // light 45 degrees up (the position: the brim's shadow 15 units long, the thigh's highlight
      // 0.2), not 11 (the angles: 3 units, 0.9). So the position; ?sunangles takes the angles
      this.portraitDir = sourceToScene(light.position).normalize();
      if (search?.has("sunangles") && light.angles?.length === 3) {
        const [pitch, yaw] = light.angles.map(THREE.MathUtils.degToRad);
        this.portraitDir = sourceToScene([Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch)]).normalize().negate();
      }
      this.portraitSun.color.copy(look.key);
      this.portraitSun.intensity = 2;
      this.fitPortraitShadow(new THREE.Quaternion());
      this.key.intensity = 0;
      this.hemi.color.copy(look.sky);
      this.hemi.groundColor.copy(look.ground);
      this.hemi.intensity = 2;
      this.scene.environmentIntensity = 0.2;
      this.portraitLit = true;
    } else if (this.portraitLit) {
      this.portraitLit = false;
      setDotaLighting(null);
      this.key.intensity = 2.2;
      this.hemi.color.set(0xb8c4d6);
      this.hemi.groundColor.set(0x1a1714);
      this.hemi.intensity = 1.2;
      this.scene.environmentIntensity = 0.6;
    }
    // On a hero's page the shadows go with the game's light, whoever turned it on
    if (this.loadout) {
      this.setShadows(Boolean(this.portraitLit));
    }
    if (import.meta.env.DEV && window.location.search.includes("shadowview")) {
      console.info("[shadowview] game light", on, "portrait", Boolean(this.portrait), "light data", Boolean(this.portrait?.light), "scene look", Boolean(this.sceneLook), "loadout", Boolean(this.loadout), "shadows", this.renderer.shadowMap.enabled);
    }
  }

  // Shadows on or off; lit materials compile again with or without them (the hero's own, kept
  // aside for the other shading, too)
  setShadows(on) {
    if (this.renderer.shadowMap.enabled === on) {
      return;
    }
    this.renderer.shadowMap.enabled = on;
    this.scene.traverse((node) => {
      if (node.isMesh) {
        for (const material of [node.material, node.userData.dota, node.userData.pbr].flat()) {
          if (material) material.needsUpdate = true;
        }
      }
    });
  }

  // The sun's shadow fitted to the view as client.dll's CGlobalLightBase does it (0x18173e8e0 with
  // cl_globallight_use_optimized_calc_frustum, default 1): the camera's frustum, from the portrait
  // camera's near plane (4, set by 0x182c85826) to its far one (PortraitFar, or
  // PortraitShadowFarZ given as the point_camera's override_shadow_farz), cut to the world's
  // heights 0 to 4096 (cl_globallight_world_bottom_height / _top_height); the box round what is
  // left, seen along the light, reaches 1500 further towards the light (for casters above) and,
  // the lower the sun, up to half its depth more (cl_globallight_use_shaadow_near_offset). Its
  // sides are rounded up to 32 units and its edges put on whole texels, so it does not shimmer.
  // The light turns round the hero with the free camera
  fitPortraitShadow(turn) {
    const shot = this.portraitCamera();
    if (!this.portraitSun || !shot) {
      return;
    }
    const unit = SOURCE_TO_METRES;
    const near = 4 * unit;
    const far = (shot.shadowFar ?? shot.far ?? 1000) * unit;
    const top = 4096 * unit;
    this.camera.updateMatrixWorld();
    const eye = new THREE.Vector3().setFromMatrixPosition(this.camera.matrixWorld);
    const ahead = new THREE.Vector3(0, 0, -1).transformDirection(this.camera.matrixWorld);
    const corners = [];
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const ray = new THREE.Vector3(x, y, 0.5).unproject(this.camera).sub(eye).normalize();
      const along = 1 / ray.dot(ahead);
      corners.push(eye.clone().addScaledVector(ray, near * along), eye.clone().addScaledVector(ray, far * along));
    }
    // The frustum's corners between the heights, and where its edges cross them
    const points = corners.filter((p) => p.y >= 0 && p.y <= top);
    const edges = [];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      edges.push([corners[i * 2], corners[i * 2 + 1]], [corners[i * 2], corners[j * 2]], [corners[i * 2 + 1], corners[j * 2 + 1]]);
    }
    for (const [a, b] of edges) {
      for (const h of [0, top]) {
        if ((a.y - h) * (b.y - h) < 0) {
          points.push(a.clone().lerp(b, (h - a.y) / (b.y - a.y)));
        }
      }
    }
    if (points.length === 0) {
      return;
    }
    const toLight = this.portraitDir.clone().applyQuaternion(turn);
    const along = toLight.clone().negate();
    let nearest = Infinity;
    let farthest = -Infinity;
    for (const p of points) {
      nearest = Math.min(nearest, p.dot(along));
      farthest = Math.max(farthest, p.dot(along));
    }
    const low = 1 - THREE.MathUtils.clamp(toLight.y, 0, 1);
    const start = nearest - 1500 * unit - (farthest - nearest) * THREE.MathUtils.clamp(low * low * 1.5, 0, 0.5);
    const sun = this.portraitSun;
    sun.position.copy(along).multiplyScalar(start);
    sun.target.position.copy(sun.position).add(along);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    // The box's sides across the light, in the shadow camera's own frame
    const camera = sun.shadow.camera;
    camera.position.copy(sun.position);
    camera.lookAt(sun.target.position);
    camera.updateMatrixWorld();
    const box = new THREE.Box3().setFromPoints(points.map((p) => p.clone().applyMatrix4(camera.matrixWorldInverse)));
    const side = (min, max, texels) => {
      const size = Math.ceil((max - min) / (32 * unit)) * 32 * unit;
      const texel = size / texels;
      const pad = (size - (max - min)) / 2;
      return [Math.floor((min - pad) / texel) * texel, Math.floor((max + pad) / texel) * texel];
    };
    [camera.left, camera.right] = side(box.min.x, box.max.x, sun.shadow.mapSize.x);
    [camera.bottom, camera.top] = side(box.min.y, box.max.y, sun.shadow.mapSize.y);
    camera.near = 0;
    camera.far = farthest - start;
    camera.updateProjectionMatrix();
  }

  // On a hero's page the camera stays where the game puts it and a drag turns the hero round, as
  // in the game, unless the free camera is chosen in the settings
  setFreeCamera(on) {
    this.freeCamera = on;
    this.applyControls();
  }

  // The logo carved into the pedestal, shown or not
  setWatermark(on) {
    this.watermarkOn = on;
    if (this.watermark) {
      this.watermark.visible = on;
    }
  }

  applyControls() {
    const locked = Boolean(this.loadout && this.portrait && !this.freeCamera);
    this.controls.enableRotate = !locked;
    this.controls.enableZoom = !locked;
    this.controls.enablePan = !locked;
    this.turnLocked = locked;
    if (!locked && this.group) {
      this.group.rotation.y = 0;
      if (this.pedestal) {
        this.pedestal.rotation.y = 0;
      }
    }
    if (this.turnListeners) {
      return;
    }
    let last = null;
    this.turnListeners = true;
    this.canvas.addEventListener("pointerdown", (event) => {
      if (this.turnLocked && event.button === 0) {
        last = event.clientX;
        this.canvas.setPointerCapture(event.pointerId);
      }
    });
    this.canvas.addEventListener("pointermove", (event) => {
      if (last === null || !this.turnLocked || !this.group) {
        return;
      }
      // The pedestal turns with the hero, as in the game
      this.group.rotation.y += (event.clientX - last) * 0.01;
      if (this.pedestal) {
        this.pedestal.rotation.y = this.group.rotation.y;
      }
      last = event.clientX;
    });
    const stop = () => {
      last = null;
    };
    this.canvas.addEventListener("pointerup", stop);
    this.canvas.addEventListener("pointercancel", stop);
  }

  setLoadout(on) {
    const changed = on !== this.loadout;
    this.loadout = on;
    this.applyControls();
    this.updatePortraitLight();
    this.updateShowcase();
    if (changed && this.group) {
      this.frameModel();
    }
  }

  setShowcase(on) {
    this.showcase = on;
    this.updateShowcase();
  }

  // The hero's page scene as the game sets it (loadout_portraits.json): the pedestal it stands on
  // and the cameras of the page, the set picker and each slot. shot picks the camera.
  setPortrait(portrait, pedestalUrl, shot = "default") {
    const changed = portrait !== this.portrait || shot !== this.portraitShot;
    this.portrait = portrait;
    this.portraitShot = shot;
    if (pedestalUrl !== this.pedestalUrl) {
      this.pedestalUrl = pedestalUrl;
      if (this.pedestal) {
        this.dropModel(this.pedestal);
        this.pedestal = null;
        this.watermark = null;
        this.pedestalParticles?.setModel(null, []);
      }
      if (pedestalUrl) {
        loadModel(pedestalUrl).then(
          (gltf) => {
            if (this.pedestalUrl !== pedestalUrl) {
              return;
            }
            // Shaded as the game does (global_lit_simple.vfx under the page's lights) and taking the
            // hero's shadow; it fades into the dark by its own textures, as in the game
            // A copy of its own: the loaded model is kept for the next time it is shown
            this.pedestal = gltf.scene.clone();
            this.pedestal.rotation.y = this.group?.rotation.y ?? 0;
            this.applyMaterials(this.pedestal, gltf.userData.textures);
            const size = new THREE.Box3().setFromObject(this.pedestal).getSize(new THREE.Vector3());
            const radius = Math.max(size.x, size.z) / 2;
            this.pedestal.traverse((node) => {
              if (node.isMesh) {
                node.receiveShadow = true;
              }
            });
            this.scene.add(this.pedestal);
            this.carveWatermark(this.pedestal, radius);
            this.updateShowcase();
            this.updatePedestalParticles();
          },
          () => {}
        );
      }
    }
    this.applyControls();
    this.updatePortraitLight();
    this.updateShowcase();
    this.updatePedestalParticles();
    if (changed && this.group) {
      this.frameModel();
    }
  }

  // The site's mark carved in a ring along the edge of the pedestal's top, turning with the pedestal
  async carveWatermark(pedestal, radius) {
    // Where the flat top ends: down onto the pedestal along lines out from the center, the last
    // point still at the center's height, the middle one of all the lines
    pedestal.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pedestal);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const heightAt = (x, z) => {
      ray.set(new THREE.Vector3(x, box.max.y + 1, z), down);
      return ray.intersectObject(pedestal, true)[0]?.point.y;
    };
    const top = heightAt(0, 0) ?? box.max.y;
    const edges = [];
    for (let line = 0; line < 16; line++) {
      const angle = (line / 16) * Math.PI * 2;
      let edge = 0;
      for (let step = 1; step <= 80; step++) {
        const r = (step / 80) * radius;
        const y = heightAt(Math.cos(angle) * r, Math.sin(angle) * r);
        if (y === undefined || Math.abs(y - top) > radius * 0.008) {
          break;
        }
        edge = r;
      }
      edges.push(edge);
    }
    edges.sort((a, b) => a - b);
    const ring = (edges[8] || radius * 0.7) - radius * 0.02;
    const mark = await createWatermark(Math.min((radius * WATERMARK_BAND) / ring, 0.5));
    if (!mark || this.pedestal !== pedestal) {
      return;
    }
    mark.position.copy(pedestal.worldToLocal(new THREE.Vector3(0, top, 0)));
    mark.scale.setScalar(ring / pedestal.scale.x);
    this.watermark = mark;
    mark.visible = this.watermarkOn !== false;
    pedestal.add(mark);
  }

  // The pedestal and its smoke on their own; behind a model in a scene of the game, only the
  // embers and the haze, with fog that sinks the scene's distance into the dark
  updateShowcase() {
    // A part shown alone (a weapon off the hero) floats in the view, without the pedestal
    if (this.pedestal) {
      this.pedestal.visible = Boolean(this.loadout && this.portrait) && this.standing !== false;
    }
    // A hero's page as the game has it now: the hero on its pedestal with a soft shadow, over the
    // page's own backdrop; no rocks, embers or fog
    if (this.loadout) {
      this.effects.group.visible = false;
      this.rockStage.group.visible = false;
      this.floor.visible = this.standing !== false;
      this.setShadows(Boolean(this.portraitLit));
      if (!this.portraitLit) {
        this.key.intensity = 2.2;
        this.scene.environmentIntensity = 0.6;
        this.hemi.intensity = 1.2;
      }
      this.scene.fog = null;
      return;
    }
    // A scene of the Scenes section: a treasure's chest on the pedestal, else the scene alone
    const on = this.showcase !== false;
    this.effects.group.visible = on;
    this.effects.setPedestal(on);
    // The rocks stand in for the stone pedestal, and their shadows for the soft disc under the model
    const rocks = on && this.standing !== false;
    this.rockStage.group.visible = rocks;
    this.effects.pedestalMesh.visible = false;
    // The rocks have the model's own light; the pedestal's pool of light would glow on bare ground
    this.effects.pool.visible = !rocks;
    this.setShadows(rocks);
    // On the rocks the light from the camera and the room is turned down, so the stage's sun
    // gives the stones their shape
    this.key.intensity = rocks ? 1.1 : 2.2;
    this.scene.environmentIntensity = rocks ? 0.18 : 0.6;
    this.hemi.intensity = rocks ? 0.45 : 1.2;
    if (!on || rocks) {
      this.floor.visible = false;
    }
    this.scene.fog = null;
  }

  // Takes a model off the stage for good
  dropModel(group) {
    this.scene.remove(group);
    group.traverse((node) => {
      if (node.isMesh && node.userData.dota !== node.userData.pbr) {
        node.userData.dota.dispose();
      }
    });
  }

  // Moves the picture sideways by a share of the view's width, keeping the model framed:
  // on a hero's page the model stands in the left half, under no text
  setFrameShift(shift) {
    this.frameShift = shift;
    this.applyShift();
  }

  applyShift() {
    const { clientWidth, clientHeight } = this.canvas.parentElement;
    if (!clientWidth || !clientHeight) {
      return;
    }
    // Through the game's camera on a hero's page the picture is cut from one the size of the
    // window, as the game draws its hero over the whole screen, under its top bar too: the hero
    // stands where it stands in the game (measured on game screenshots of Sniper: not the
    // stylesheet's 1020-high #HeroSceneBody, whose hero would be 0.94 times as large)
    const whole = Boolean(this.portraitCamera());
    const { left, top } = whole ? this.canvas.parentElement.getBoundingClientRect() : { left: 0, top: 0 };
    const width = whole ? Math.max(window.innerWidth, clientWidth) : clientWidth;
    const height = whole ? Math.max(window.innerHeight, clientHeight) : clientHeight;
    this.camera.aspect = width / height;
    if (whole || this.frameShift) {
      this.camera.setViewOffset(width, height, left + clientWidth * this.frameShift, top, clientWidth, clientHeight);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  // The game's camera for the hero on its page, unless another page is on screen
  portraitCamera() {
    return this.loadout && this.group && (this.portrait?.cameras?.[this.portraitShot] ?? this.portrait?.cameras?.default);
  }

  // The hero's size on its page: the game's LoadoutScale, or its ModelScale
  setHeroScale(scale) {
    this.heroScale = scale > 0 ? scale : 1;
    this.applyHeroScale();
  }

  applyHeroScale() {
    this.group?.scale.setScalar(this.loadout && this.portrait ? this.heroScale ?? 1 : 1);
  }

  setShading(mode) {
    this.shading = mode;
    [this.group, this.pedestal].forEach((object) => object?.traverse((node) => {
      if (node.isMesh) {
        node.material = mode === "dota" ? node.userData.dota : node.userData.pbr;
      }
    }));
  }

  // The model's main color from its color textures: saturated, lit pixels count most
  measureTint(group) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 24;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const sum = new THREE.Color(0, 0, 0);
    let weight = 0;
    const seen = new Set();
    group.traverse((node) => {
      const image = node.isMesh && node.visible && node.userData.pbr?.map?.image;
      if (!image?.width || seen.has(image)) {
        return;
      }
      seen.add(image);
      context.clearRect(0, 0, 24, 24);
      context.drawImage(image, 0, 0, 24, 24);
      const pixels = context.getImageData(0, 0, 24, 24).data;
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i] / 255;
        const g = pixels[i + 1] / 255;
        const b = pixels[i + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const w = (max - min) * max * (pixels[i + 3] / 255);
        sum.r += r * w;
        sum.g += g * w;
        sum.b += b * w;
        weight += w;
      }
    });
    if (weight < 1) {
      return;
    }
    const tint = new THREE.Color(sum.r / weight, sum.g / weight, sum.b / weight);
    // Bright enough to see on the dark stage, whatever the model's colors
    const hsl = tint.getHSL({});
    this.tintTarget = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.2 + 0.1), THREE.MathUtils.clamp(hsl.l, 0.5, 0.65));
  }

  setRim(color) {
    this.rimTarget.set(color);
    if (reducedMotion.matches) {
      stageRim.value.copy(this.rimTarget);
    }
  }

  // Fits the camera to the model, gliding there unless reduced motion is on
  frameModel(immediate = false) {
    // On a hero's page, the game's own camera for the hero: Source units and axes (x ahead of the
    // hero, y to its left, z up) to the scene's metres with y up and the hero facing +z
    const portrait = this.portraitCamera();
    this.applyHeroScale();
    this.applyShift();
    if (portrait) {
      const [pitch, yaw] = portrait.angles.map((angle) => THREE.MathUtils.degToRad(angle));
      const position = sourceToScene(portrait.position);
      const direction = sourceToScene([Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), -Math.sin(pitch)]).normalize();
      // Aimed at the point of the view nearest the hero's upright axis
      const across = Math.hypot(position.x, position.z);
      const target = position.clone().add(direction.clone().multiplyScalar(across / Math.max(Math.hypot(direction.x, direction.z), 0.01)));
      this.camera.fov = portrait.fov;
      this.camera.near = across / 100;
      this.camera.far = across * 20;
      this.camera.updateProjectionMatrix();
      this.controls.minDistance = across * 0.3;
      this.controls.maxDistance = across * 3;
      this.group.position.y = 0;
      // Where the game's camera looks from, round the hero: the free camera turns the light by
      // how far it has gone round from there
      this.portraitAzimuth = Math.atan2(position.x - target.x, position.z - target.z);
      if (immediate || reducedMotion.matches || !this.framedOnce) {
        this.tween = null;
        this.controls.target.copy(target);
        this.camera.position.copy(position);
        return;
      }
      this.tween = {
        start: performance.now(),
        duration: 700,
        fromTarget: this.controls.target.clone(),
        fromPosition: this.camera.position.clone(),
        target,
        position,
        lift: 0,
        sweep: 0,
      };
      return;
    }
    const shot = this.useSceneCamera && this.sceneLook?.camera;
    // Back from a hero page's camera to the stage's own lens
    if (!shot && this.camera.fov !== 28) {
      this.camera.fov = 28;
      this.camera.updateProjectionMatrix();
    }
    if (shot) {
      this.camera.fov = verticalFov(shot.fov);
      // The scenes are in metres
      this.camera.near = 0.1;
      this.camera.far = 1500;
      this.camera.updateProjectionMatrix();
      const position = new THREE.Vector3(...shot.position);
      // Orbiting round a point ahead of the camera; a camera at the origin still needs one
      const target = position.clone().add(new THREE.Vector3(...shot.direction).multiplyScalar(Math.max(position.length(), 5)));
      this.controls.minDistance = 0.5;
      this.controls.maxDistance = 500;
      this.controls.target.copy(target);
      this.camera.position.copy(position);
      this.tween = null;
      if (this.group) {
        this.group.position.y = 0;
      }
      return;
    }
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
    this.standing = standing;
    this.rockStage.place(new THREE.Vector3(center.x, box.min.y, center.z), pedestal, size.y, distance);
    // The ground fades out from just past the model to well before its edge
    this.rockStage.viewFade.near.value = distance * 1.05;
    this.rockStage.viewFade.far.value = distance * 2.2;

    this.updateShowcase();

    this.camera.near = distance / 100;
    // Fog for scenes behind the model: thick enough to hide their far edges
    this.fog.density = this.sceneLook?.fog?.density ?? 1 / (pedestal * 14);
    // Far enough for the scenes behind the model
    this.camera.far = Math.max(distance * 20, pedestal * 50);
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = radius * 0.4;
    this.controls.maxDistance = distance * 4;

    // Aim a little below the middle so the model sits above the title
    const target = center.clone().add(new THREE.Vector3(0, standing ? -size.y * 0.16 : -radius * 0.15, 0));
    const position = target.clone().add(direction.normalize().multiplyScalar(distance));

    if (immediate || reducedMotion.matches) {
      this.swing = false;
      this.controls.target.copy(target);
      this.camera.position.copy(position);
      this.tween = null;
      return;
    }
    this.tween = {
      start: performance.now(),
      duration: this.swing ? 1400 : 900,
      fromTarget: this.controls.target.clone(),
      fromPosition: this.camera.position.clone(),
      target,
      position,
      lift: size.y * 0.06,
      // Swinging in along an arc round the model after a change of model
      sweep: this.swing ? THREE.MathUtils.degToRad(70) : 0,
    };
    this.swing = false;
  }

  // Draws the halos of the model's glowing materials into the glow composer, when it has any
  renderGlow() {
    const glowing = [];
    this.group?.traverse((node) => {
      const glow = node.isMesh && node.visible && node.userData.dota?.userData?.glow;
      if (glow) {
        glowing.push([node, glow]);
      }
    });
    // The light in the carved mark on the pedestal
    if (this.watermark?.visible && this.watermark.parent?.visible && this.watermark.parent.parent) {
      glowing.push([this.watermark, this.watermark.userData.glowMaterial]);
    }
    this.glowMix.enabled = glowing.length > 0;
    if (!glowing.length) {
      return;
    }
    const swapped = [];
    const hidden = [];
    // Anything of the particles, however deep (the meshes of the models particles draw too)
    const inParticles = (node) => {
      for (let parent = node.parent; parent; parent = parent.parent) if (parent.name === "particles") return true;
      return false;
    };
    this.scene.traverse((node) => {
      // Particles are left out of the glow pass, they glow with the bloom of the frame
      if (node.isPoints || node.isSprite || node.userData.skipGlow || inParticles(node)) {
        if (node.visible) {
          node.visible = false;
          hidden.push(node);
        }
      } else if (node.isMesh) {
        swapped.push([node, node.material]);
        node.material = this.glowBlack;
      }
    });
    for (const [node, glow] of glowing) {
      node.material = glow;
    }
    // The shadows of this frame are drawn with the frame itself
    const shadows = this.renderer.shadowMap.autoUpdate;
    this.renderer.shadowMap.autoUpdate = false;
    this.glowComposer.render();
    this.renderer.shadowMap.autoUpdate = shadows;
    for (const [node, material] of swapped) {
      node.material = material;
    }
    for (const node of hidden) {
      node.visible = true;
    }
  }

  // Cloth, hair and beards on top of the animation. With the camera going round the hero (the
  // free camera, or any stage but a hero's page) the cloth moves as if the hero were turned
  // instead, as the game turns its heroes under a fixed camera
  updateCloth(delta) {
    if (!this.cloths?.length || !this.group) {
      return;
    }
    this.group.updateMatrixWorld(true);
    let view = null;
    if (!this.turnLocked) {
      const angle = Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z);
      view = (this.clothView ??= new THREE.Matrix4()).makeRotationY(-angle);
    }
    for (const cloth of this.cloths) {
      cloth.update(reducedMotion.matches ? 0 : delta, view);
    }
  }

  frame() {
    this.timer.update();
    const delta = Math.min(this.timer.getDelta(), 0.1);
    // The cloth's bones back as the animation left them, before it moves them again
    for (const cloth of this.cloths ?? []) {
      cloth.restore();
    }
    // A new model waits on its first frame behind the fog until it is shown, so its spawn and
    // what the spawn and its page start (Broodmother's web growing in) are seen from their start
    const held = Boolean(this.pendingShow);
    if (this.mixer && !this.paused && !held) {
      this.mixer.update(delta * this.speed);
      this.playAnimationSounds();
      this.startClothEffects();
      this.startAnimationEffects();
      this.speakAnimationLines();
    }

    this.effects.update(delta);
    // Materials the game moves every frame: scrolling details, pulsing glows
    const time = this.timer.getElapsed();
    this.group?.traverse((node) => node.isMesh && node.material?.userData.animate?.(time));
    this.flash = Math.max(0, (this.flash ?? 0) - delta * 1.6);
    // Never left hanging if a load fails
    if (this.veilTarget === 1 && this.group && performance.now() - (this.veilSince ?? 0) > 6000) {
      this.veilTarget = 0;
    }
    const veil = this.veil.material.uniforms;
    const cover = veil.uCover.value;
    // Even both ways: about half a second to close, a little longer to part
    const speed = this.veilTarget > cover ? 1.8 : 1.4;
    veil.uCover.value = THREE.MathUtils.clamp(cover + Math.sign(this.veilTarget - cover) * delta * speed, 0, 1);
    veil.uTime.value += delta;
    veil.uAspect.value = this.canvas.parentElement.clientWidth / Math.max(this.canvas.parentElement.clientHeight, 1);
    this.veil.visible = veil.uCover.value > 0.01;
    if (this.pendingShow && veil.uCover.value < 0.35) {
      this.pendingShow = false;
      this.onShow?.();
    }
    this.rockStage.flash = this.flash;
    // How the camera has turned round the model and tilted, for the background haze to follow:
    // a full turn slides it by about four screen widths
    const look = this.camera.position.clone().sub(this.controls.target);
    const angle = Math.atan2(look.x, look.z);
    // Added up turn by turn, so going all the way round never jumps
    let step = angle - (this.lastAngle ?? angle);
    step -= Math.round(step / (Math.PI * 2)) * Math.PI * 2;
    this.lastAngle = angle;
    this.turn = (this.turn ?? 0) + step;
    const tilt = Math.atan2(look.y, Math.hypot(look.x, look.z));
    this.effects.hazeMaterial.uniforms.uView.value.set((-this.turn / (Math.PI * 2)) * 4 * 2.2 * veil.uAspect.value, tilt * 1.5);
    this.rockStage.update(delta);

    if (this.sceneLook) {
      setDotaKeyDir(this.sunDir.clone().transformDirection(this.camera.matrixWorldInverse));
    } else if (this.portraitLit) {
      // In the game the camera stays and the hero turns; the free camera goes round the hero
      // instead, so the lights go round with it and the hero is lit as the game shows it
      const turn = new THREE.Quaternion();
      if (this.freeCamera && this.portraitAzimuth !== undefined) {
        const angle = Math.atan2(this.camera.position.x - this.controls.target.x, this.camera.position.z - this.controls.target.z) - this.portraitAzimuth;
        turn.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      }
      const keyDir = this.portraitDir.clone().applyQuaternion(turn);
      setDotaKeyDir(keyDir.clone().transformDirection(this.camera.matrixWorldInverse));
      if (this.portraitFillDir) setDotaFillDir(this.portraitFillDir.clone().applyQuaternion(turn).transformDirection(this.camera.matrixWorldInverse));
      this.fitPortraitShadow(turn);
    }
    if (this.pedestal?.visible) {
      // The carved mark is shaded by the light that lights the hero: the game's, or the key from the camera
      if (this.watermark) {
        const light = this.portraitLit ? this.portraitDir.clone() : this.key.position.clone().transformDirection(this.camera.matrixWorld);
        this.watermark.material.uniforms.uLight.value.copy(light.transformDirection(this.watermark.matrixWorld.clone().invert()));
      }
    }
    stageRim.value.lerp(this.rimTarget, reducedMotion.matches ? 1 : Math.min(delta * 3, 1));
    if (this.tintTarget) {
      stageTint.value.lerp(this.tintTarget, reducedMotion.matches ? 1 : Math.min(delta * 2, 1));
    }
    // A scene's own fog color, or a dark one in the model's tint
    if (this.sceneLook?.fog) {
      this.fog.color.setRGB(...this.sceneLook.fog.color);
    } else {
      this.fog.color.copy(stageTint.value).multiplyScalar(0.12).add(new THREE.Color(0.03, 0.04, 0.055));
    }

    if (this.tween) {
      const t = Math.min((performance.now() - this.tween.start) / this.tween.duration, 1);
      const ease = 1 - Math.pow(1 - t, 4);
      this.controls.target.lerpVectors(this.tween.fromTarget, this.tween.target, ease);
      this.camera.position.lerpVectors(this.tween.fromPosition, this.tween.position, ease);
      if (this.tween.sweep) {
        // Round the target: the end position turned back by what is left of the sweep
        const offset = this.tween.position.clone().sub(this.tween.target);
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.tween.sweep * (1 - ease));
        const radius = this.tween.fromPosition.distanceTo(this.tween.fromTarget) * (1 - ease) + offset.length() * ease;
        this.camera.position.copy(this.controls.target).add(offset.setLength(radius));
      }
      // The model rises onto the stage as the camera settles
      if (this.group) {
        this.group.position.y = -this.tween.lift * (1 - ease);
      }
      if (t === 1) {
        this.tween = null;
      }
    }

    this.controls.update();
    this.updateCloth(delta);
    this.group?.updateMatrixWorld(true);
    this.hideParked();
    // The lights the particles cast this frame, gathered as their renderers run
    frameLights.length = 0;
    this.particles?.update(held ? 0 : delta, this.camera);
    if (this.pedestalParticles) {
      this.pedestalParticles.group.visible = Boolean(this.pedestal?.visible);
      if (this.pedestal?.visible) {
        this.pedestalParticles.update(delta, this.camera);
      }
    }
    for (const { manager } of this.mapParticles ?? []) {
      manager.group.visible = Boolean(this.pedestal?.visible);
      if (this.pedestal?.visible) {
        manager.update(delta, this.camera);
      }
    }
    this.camera.updateMatrixWorld();
    setParticleLights(frameLights, this.camera);
    // While developing, ?opaque draws the scene on black instead of see-through
    if (import.meta.env.DEV && window.location.search.includes("opaque") && !this.scene.background) {
      this.scene.background = new THREE.Color(0x000000);
    }
    // While developing, ?nobloom draws the frame without the halos
    if (import.meta.env.DEV && window.location.search.includes("nobloom")) {
      SCENE_DEPTH.uHasSceneDepth.value = 0;
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = false;
      this.renderer.render(this.particleScene, this.camera);
      this.renderer.autoClear = true;
      return;
    }
    this.renderGlow();
    this.composer.render();
    if (import.meta.env.DEV && this.probeRequested) {
      this.probeRequested = false;
      this.probeParticles();
    }
  }

  // While developing, K: the frame drawn with and without the particles on this graphics card,
  // and what the particles darkened, by the renderer whose sprite lies there, in the console
  probeParticles() {
    const gl = this.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const read = () => {
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const group = this.particles?.group;
    if (!group) return;
    // The blend state WebGL really has while each particle mesh draws, and its material's
    const states = [];
    const names = { 0: "ZERO", 1: "ONE", 768: "SRC_COLOR", 769: "1-SRC_COLOR", 770: "SRC_ALPHA", 771: "1-SRC_ALPHA", 772: "DST_ALPHA", 774: "DST_COLOR" };
    group.children.forEach((mesh) => {
      mesh.onAfterRender = () => {
        const m = mesh.material;
        states.push(
          `blend=${gl.isEnabled(gl.BLEND)} src=${names[gl.getParameter(gl.BLEND_SRC_RGB)]} dst=${names[gl.getParameter(gl.BLEND_DST_RGB)]} srcA=${names[gl.getParameter(gl.BLEND_SRC_ALPHA)]} dstA=${names[gl.getParameter(gl.BLEND_DST_ALPHA)]} | material blending=${m.blending} src=${m.blendSrc} dst=${m.blendDst} transparent=${m.transparent} premult=${m.uniforms?.uPremultiply?.value} visible=${mesh.visible} count=${mesh.geometry.instanceCount}`
        );
        mesh.onAfterRender = () => {};
      };
    });
    this.renderGlow();
    this.composer.render();
    const withParticles = read();
    group.visible = false;
    this.renderGlow();
    this.composer.render();
    const without = read();
    group.visible = true;
    // Each sprite's place on screen, to name what darkened a pixel
    const quads = [];
    const v = new THREE.Vector3();
    for (const effect of this.particles.effects) {
      const visit = (system) => {
        system.renderers.forEach((renderer, index) => {
          const def = (system.def.m_Renderers ?? []).filter((op) => !op.m_bDisableOperator)[index] ?? {};
          const name = `${def._class?.replace("C_OP_Render", "")}/${(def.m_nOutputBlendMode ?? "ALPHA").replace("PARTICLE_OUTPUT_BLEND_MODE_", "")} ${(def.m_vecTexturesInput?.[0]?.m_hTexture ?? "").split("/").pop()} ${renderer.object?.material?.blending}`;
          const p = system.float(0);
          const r = system.float(3);
          for (let i = 0; i < system.count; i++) {
            v.set(p[i * 3 + 1] * 0.0254, p[i * 3 + 2] * 0.0254, p[i * 3] * 0.0254).project(this.camera);
            const size = (r[i] * 0.0254 * this.camera.projectionMatrix.elements[5]) / Math.max(this.camera.position.distanceTo(v.clone().unproject(this.camera)), 0.01);
            quads.push({ name, x: ((v.x + 1) / 2) * width, y: ((v.y + 1) / 2) * height, half: (size * height) / 2 });
          }
        });
        for (const child of system.children) if (child.system) visit(child.system);
      };
      visit(effect.system);
    }
    const blame = new Map();
    let darker = 0;
    let brighter = 0;
    let sample = null;
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        const change = withParticles[i] + withParticles[i + 1] + withParticles[i + 2] - (without[i] + without[i + 1] + without[i + 2]);
        if (change > 30) brighter++;
        if (change < -30) {
          darker++;
          sample ??= `at ${x},${y}: with ${[...withParticles.slice(i, i + 4)]} without ${[...without.slice(i, i + 4)]}`;
          for (const quad of quads) {
            if (Math.abs(quad.x - x) < quad.half && Math.abs(quad.y - y) < quad.half) blame.set(quad.name, (blame.get(quad.name) ?? 0) + 1);
          }
        }
      }
    }
    console.warn(
      `[particles probe] ${width}x${height}: ${darker} darker, ${brighter} brighter; ${sample ?? ""}\n` +
        [...new Set(states)].map((state) => `  GL ${state}`).join("\n") +
        "\n" +
        [...blame.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => `  ${count}  ${name}`).join("\n")
    );
  }

  // The game's particle effects on the model, systems by their path in the game; shown: whether
  // particles are drawn at all (the pedestal's own effects too)
  setParticles(base, paths, shown = true) {
    if (import.meta.env.DEV && !this.probeKey) {
      this.probeKey = (event) => {
        if (event.key === "k" || event.key === "K" || event.code === "KeyK") this.probeRequested = true;
      };
      window.addEventListener("keydown", this.probeKey);
    }
    if (!this.particles) {
      this.particles = new ParticleManager(this.particleScene, base);
      if (this.group) {
        this.particles.setModel(this.group, this.modelUrls);
      }
    }
    this.particles.setEffects(paths);
    this.particleBase = base;
    this.particlesShown = shown;
    this.updatePedestalParticles();
  }

  // The effects the pedestal starts itself, as its model does in the game: the ground fog, and the
  // dust it raises as it turns (emitted by how fast its edge moves, a control point on its rim)
  updatePedestalParticles() {
    const { particleBase: base, pedestal, pedestalUrl: url } = this;
    if (!base || !pedestal || !url?.startsWith(base) || !this.particlesShown) {
      this.pedestalParticles?.setEffects([]);
      this.setMapEffects([]);
      return;
    }
    mapEffects ??= fetch(`${base}particles/map-effects.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
    const map = this.portrait?.map;
    mapEffects.then((all) => {
      if (this.pedestal === pedestal && this.particlesShown && this.portrait?.map === map) {
        this.setMapEffects(all[map] ?? []);
      }
    });
    modelEffects ??= fetch(`${base}particles/model-effects.json`)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
    modelEffects.then((all) => {
      if (this.pedestal !== pedestal || !this.particlesShown) {
        return;
      }
      const model = url.slice(base.length).replace(/\.glb$/, ".vmdl");
      // The game's code gives the 2023 pedestal's ground fog its color in control point 1
      // (client.dll 0x182edf5d0); on the hero page always grey 0.5, the same for every hero (its
      // other caller hands it a GroundfogFXColor, not the hero page's); without it the fog is black
      const tinted = model === "models/heroes/pedestal/loadout_pedestal_2023.vmdl";
      const color = [0.5, 0.5, 0.5];
      const effects = (all[model] ?? []).map((effect) =>
        tinted && effect.system === "particles/ui/dota_hud_loadout_pedestal_groundfog.vpcf" ? { ...effect, controlPoints: { 1: color } } : effect
      );
      this.pedestalParticles ??= new ParticleManager(this.particleScene, base);
      if (this.pedestalParticles.model !== pedestal) {
        this.pedestalParticles.setModel(pedestal, [url]);
      }
      this.pedestalParticles.setEffects(effects);
    });
  }

  // The effects the page's map starts (the god rays over the pedestal): each at its entity's place,
  // which stays where it is while the hero and pedestal turn; its control points as the game's
  // code sets them
  setMapEffects(effects) {
    const key = JSON.stringify(effects);
    if (key === this.mapEffectsKey) {
      return;
    }
    this.mapEffectsKey = key;
    for (const { manager, anchor } of this.mapParticles ?? []) {
      manager.dispose();
      anchor.removeFromParent();
    }
    this.mapParticles = effects.map((effect) => {
      const anchor = new THREE.Group();
      anchor.position.copy(sourceToScene(effect.origin ?? [0, 0, 0]));
      // Only the yaw: the maps' effects stand upright (pitch and roll are 0 on every page map)
      anchor.rotation.y = THREE.MathUtils.degToRad(effect.angles?.[1] ?? 0);
      this.scene.add(anchor);
      const manager = new ParticleManager(this.particleScene, this.particleBase);
      manager.setModel(anchor, []);
      const values = MAP_EFFECT_VALUES[effect.name];
      manager.setEffects([{ system: effect.system, ...(values ? { controlPoints: values } : {}) }]);
      return { manager, anchor };
    });
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

  // The cloth effects (wind) the current animation starts between the last frame's point and this
  // one's, as the game's AE_CL_CLOTH_EFFECT events do; from the start when the animation changed.
  // Each shown model's events reach every shown cloth, which knows its effects by name.
  startClothEffects() {
    if (!this.cloths?.length || !this.current) {
      return;
    }
    const clip = this.current.getClip();
    const now = this.cycle();
    const changed = clip !== this.clothClip;
    const last = changed ? -1 : this.clothCycle;
    this.clothClip = clip;
    this.clothCycle = now;
    if (changed) {
      this.cloths.forEach((cloth) => cloth.endHeldEffects());
    }
    const started = new Set();
    for (const source of this.cloths) {
      for (const [at, name, peak, tail, end, operation] of source.events[clip.name] ?? []) {
        const crossed = now >= last ? at > last && at <= now : at > last || at <= now;
        if (crossed && !started.has(`${at} ${name}`)) {
          started.add(`${at} ${name}`);
          this.cloths.forEach((cloth) => cloth.startEffect(name, [peak, tail, end], operation));
        }
      }
    }
  }

  // The particle effects the current animation starts and stops between the last frame's point and
  // this one's, as its AE_CL_CREATE_PARTICLE_EFFECT events do in the game (the export gives them
  // with the sequence: [{ at, system, config, stopOnChange, immediately, stop }]); from the start
  // when the animation changed, which ends the effects the last one marked stop_on_seq_change.
  // Void Spirit's loadout spawn opens his portal so. Waits while the particles are not on this
  // model yet (it just loaded) and while they are hidden.
  startAnimationEffects() {
    const particles = this.particles;
    if (!particles || !this.current || particles.model !== this.group || !this.particlesShown) {
      return;
    }
    const clip = this.current.getClip();
    const changed = clip !== this.effectClip;
    // A clip that ended this frame hands over to the next at once (the spawn to the stance): its
    // events up to its end still happen
    if (changed && this.effectAction) {
      this.fireAnimationEvents(this.effectClip, this.effectCycle, this.cycleOf(this.effectAction), particles);
    }
    const now = this.cycleOf(this.current);
    const last = changed ? -1 : this.effectCycle;
    this.effectClip = clip;
    this.effectAction = this.current;
    this.effectCycle = now;
    if (changed) {
      for (const running of this.animationEffects ?? []) {
        if (running.event.stopOnChange) {
          running.fired.then((fired) => fired && particles.stopFired(fired, running.event.immediately));
        }
      }
      this.animationEffects = [];
    }
    this.fireAnimationEvents(clip, last, now, particles);
  }

  // How far an animation is through its clip, 0 to 1; a clip played once stops at its end, which
  // the looping cycle would read as its start again
  cycleOf(action) {
    const duration = action.getClip().duration || 1;
    return action.loop === THREE.LoopOnce ? Math.min(action.time / duration, 1) : (action.time % duration) / duration;
  }

  // What the current animation says between the last frame's point and this one's (AE_CL_SPEECH:
  // { concept, criteria }, handed to onSpeech, which the hero's response rules turn into a line),
  // with or without particles; a clip that just ended says what was left of it (Broodmother
  // speaks at her spawn's last frame, the frame it hands over to the stance)
  speakAnimationLines() {
    if (!this.current) return;
    const clip = this.current.getClip();
    const changed = clip !== this.speechClip;
    const lines = (from, last, now) => {
      const crossed = (at) => (now >= last ? at > last && at <= now : at > last || at <= now);
      for (const speech of this.clipSequences?.get(from.name)?.speech ?? []) {
        if (crossed(speech.at)) this.onSpeech?.(speech);
      }
    };
    if (changed && this.speechAction) lines(this.speechClip, this.speechCycle, this.cycleOf(this.speechAction));
    const now = this.cycleOf(this.current);
    lines(clip, changed ? -1 : this.speechCycle, now);
    this.speechClip = clip;
    this.speechAction = this.current;
    this.speechCycle = now;
  }

  // The particle effects a clip starts or stops between two of its points (wrapping round when
  // the second is lower)
  fireAnimationEvents(clip, last, now, particles) {
    const crossed = (at) => (now >= last ? at > last && at <= now : at > last || at <= now);
    const sequence = this.clipSequences?.get(clip.name);
    for (const event of sequence?.effects ?? []) {
      if (!crossed(event.at)) continue;
      if (event.stop) {
        // Ends the effects of that system this animation started
        for (const running of this.animationEffects.filter((entry) => entry.event.system === event.system)) {
          running.fired.then((fired) => fired && particles.stopFired(fired, event.immediately));
        }
        continue;
      }
      // Made on the model whose animation it is: its surface, its attachments first
      const fired = particles.fire({ system: event.system, config: event.config, models: this.rootUrl ? [this.rootUrl] : [] });
      this.animationEffects.push({ event, fired });
    }
  }

  // Plays an animation once, then settles back into the idle pose
  playOnce(name) {
    const action = this.actions[name];
    if (!action) {
      return false;
    }
    const idle = this.idleName;
    this.play(name, 0.12);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    this.onAnimation?.(name);
    const settle = (event) => {
      if (event.action !== action) {
        return;
      }
      this.mixer.removeEventListener("finished", settle);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
      if (this.current === action && idle) {
        this.play(idle, 0.3);
        this.onAnimation?.(idle);
      }
    };
    this.mixer.addEventListener("finished", settle);
    return true;
  }

  // The first animation whose name matches one of the patterns, in their order
  findAnimation(patterns) {
    const names = Object.keys(this.actions).filter((name) => !/loadout|portrait|@/i.test(name));
    for (const pattern of patterns) {
      const found = names.find((name) => pattern.test(name));
      if (found) {
        return found;
      }
    }
    return null;
  }

  // Casts an ability: its own cast animation when one is named after it, else the hero's cast
  // animations in turn by the ability's place; its sound plays as soon as it has loaded
  castAbility(ability, index, sounds = []) {
    const words = ability.split("_").slice(1).filter((word) => word.length > 2);
    const own = words.length ? this.findAnimation([new RegExp(`cast.*(${words.join("|")})|(${words.join("|")}).*cast`, "i")]) : null;
    const casts = Object.keys(this.actions).filter((name) => /cast|ability/i.test(name) && !/loadout|portrait|@/i.test(name));
    const name = own ?? casts.find((cast) => new RegExp(`(cast|ability)_?${index + 1}\b`, "i").test(cast)) ?? casts[index % Math.max(casts.length, 1)];
    if (name) {
      this.playOnce(name);
    }
    const event = sounds[0] && this.sound?.events[sounds[0]];
    if (event?.files.length) {
      playWhenReady(this.sound.base + event.files[Math.floor(Math.random() * event.files.length)], { volume: Math.min((event.volume ?? 1) * 0.8, 1) });
      event.layers?.forEach((layer) => this.playEvent(layer, 1));
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
    this.timer.dispose();
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
