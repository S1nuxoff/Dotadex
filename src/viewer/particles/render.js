// The game's particle renderers drawn with three.js: sprites (facing the camera, lying flat,
// turned round the up axis or along the particle's normal), trails stretched along the
// particle's movement, and ropes through the particles in order. One draw a system, the
// particles' places, sizes, colors and frames written each frame.
import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { compileFloat, compileVector } from "./inputs.js";
import { attachmentTransform, bonesOf, UNIT } from "./math.js";

const toCamera = new THREE.Vector3();

// A number of a renderer's parameters, whatever the file gives: a number, an input's literal
// value, or the default for anything that varies
const num = (value, fallback) => (typeof value === "number" && Number.isFinite(value) ? value : typeof value?.m_flLiteralValue === "number" ? value.m_flLiteralValue : fallback);

// What the game draws where a layer names no texture: a soft white dot for sprites and trails,
// a soft band for ropes (2172 sprites' first layers name none)
const BASE_SPRITE = "materials/particle/base_sprite.vtex";
const BASE_ROPE = "materials/particle/base_rope.vtex";

// Layers that change how another is drawn instead of giving a picture of their own: a UV
// distortion bends the picture's lookup, a color lookup recolors it, a normal map lights it
const NOT_PICTURE = /UVDISTORTION|COLOR_LOOKUP|NORMALMAP/;

// A renderer's texture layers, those the file leaves on (m_bEnabled)
const layersOf = (def) => (def.m_vecTexturesInput ?? []).filter((input) => input && input.m_bEnabled !== false);

// The layer that gives the picture: the first that is one (a UV distortion map listed first,
// drawn as the picture, was a tiling square of its pattern)
function colorLayerOf(def) {
  const layers = layersOf(def);
  return layers.find((input) => !NOT_PICTURE.test(input.m_nTextureType ?? "")) ?? layers[0];
}

// The texture a renderer draws, and its sheet of frames; none where the picture layer is a
// gradient in place of a texture (drawn here it would be a square)
function textureOf(def, rope = false) {
  const layer = colorLayerOf(def);
  if (layer?.m_bReplaceTextureWithGradient) return null;
  return layer?.m_hTexture ?? def.m_hTexture ?? (layer ? (rope ? BASE_ROPE : BASE_SPRITE) : null);
}

// The texture of a system's first renderer that draws one, whose sheet gives the sequences
// particles play (null when none does)
export function sheetTextureOf(system) {
  for (const def of system.m_Renderers ?? []) {
    if (def.m_bDisableOperator) continue;
    if (def._class === "C_OP_RenderSprites" || def._class === "C_OP_RenderTrails") return textureOf(def);
    if (def._class === "C_OP_RenderRopes") return textureOf(def, true);
  }
  return null;
}

// Which channels of a layer count, and where its alpha comes from (uLayerChannels): all of
// it, its color only, its alpha only, its color with its brightness as alpha, its brightness as
// alpha only, or one channel as alpha
const LAYER_CHANNELS = [
  [/^(MIX_)?RGBA$|^$|^MIX_RGB_A$/, 0],
  [/^MIX_RGB(_ALPHAMASK|_RGBMASK)?$/, 1],
  [/^MIX_A$/, 2],
  [/^MIX_RGBA_RGBALPHA$|^MIX_RGB_A_RGBALPHA$/, 3],
  [/^MIX_A_RGBALPHA$/, 4],
  [/^MIX_RALPHA$/, 5],
  [/^MIX_GALPHA$/, 6],
  [/^MIX_BALPHA$/, 7],
];
const channelsOf = (layer) => {
  const name = (layer.m_nTextureChannels ?? "").replace("SPRITECARD_TEXTURE_CHANNEL_", "");
  return LAYER_CHANNELS.find(([pattern]) => pattern.test(name))?.[1] ?? 0;
};
// How a layer is put over the ones before it (uLayerBlend): times them when the file names nothing
const LAYER_BLENDS = {
  SPRITECARD_TEXTURE_BLEND_MULTIPLY: 0,
  SPRITECARD_TEXTURE_BLEND_MOD2X: 1,
  SPRITECARD_TEXTURE_BLEND_REPLACE: 2,
  SPRITECARD_TEXTURE_BLEND_ADD: 3,
  SPRITECARD_TEXTURE_BLEND_SUBTRACT: 4,
  SPRITECARD_TEXTURE_BLEND_AVERAGE: 5,
  SPRITECARD_TEXTURE_BLEND_LUMINANCE: 6,
};

// The next layer that is a picture too, put over the first (a tiling noise made round by a soft
// smoke over it, a mask giving the alpha only): its texture, or the base one when it names none
function layerOf(def) {
  const color = colorLayerOf(def);
  return layersOf(def).find((input) => input !== color && !input.m_bReplaceTextureWithGradient && !NOT_PICTURE.test(input.m_nTextureType ?? "")) ?? null;
}

// That layer loaded into the material once there: drawn over the whole quad with its own scale
// and offset (in the first frame of its sheet, if it has one), repeating; the picture's own
// texture again (its color from one sheet, its alpha from another channel) in the same frame
function useLayer(def, mat, system, rope = false) {
  const layer = layerOf(def);
  if (!layer) return;
  const same = layer.m_hTexture && layer.m_hTexture.toLowerCase() === textureOf(def, rope)?.toLowerCase();
  mat.uniforms.uLayerSameFrame.value = same ? 1 : 0;
  const controls = layer.m_TextureControls ?? {};
  mat.uniforms.uLayerTransform.value.set(num(controls.m_flFinalTextureScaleU, 1), num(controls.m_flFinalTextureScaleV, 1), num(controls.m_flFinalTextureOffsetU, 0), num(controls.m_flFinalTextureOffsetV, 0));
  mat.uniforms.uLayerChannels.value = channelsOf(layer);
  mat.uniforms.uLayerBlend.value = LAYER_BLENDS[layer.m_nTextureBlendMode] ?? 0;
  mat.uniforms.uLayerAmount.value = num(layer.m_flTextureBlend, 1);
  system.host.loadTexture(layer.m_hTexture ?? (rope ? BASE_ROPE : BASE_SPRITE)).then((loaded) => {
    if (!loaded) return;
    const frame = [0, 0, 1, 1];
    frameOf(loaded.sheet, 0, 0, 0, {}, frame, 0);
    mat.uniforms.uLayerRect.value.fromArray(frame);
    if (!loaded.sheet?.sequences?.length) loaded.texture.wrapS = loaded.texture.wrapT = THREE.RepeatWrapping;
    mat.uniforms.uLayer.value = loaded.texture;
    mat.uniforms.uHasLayer.value = 1;
  });
}

// The first texture's final scale and offset, u and v: (scale u, scale v, offset u, offset v)
function textureTransformOf(def) {
  const controls = colorLayerOf(def)?.m_TextureControls ?? {};
  return new THREE.Vector4(num(controls.m_flFinalTextureScaleU, 1), num(controls.m_flFinalTextureScaleV, 1), num(controls.m_flFinalTextureOffsetU, 0), num(controls.m_flFinalTextureOffsetV, 0));
}

// The same where it changes as the system runs (a tiling noise scrolled by the system's age):
// put in the material each frame
const TEXTURE_CONTROLS = ["m_flFinalTextureScaleU", "m_flFinalTextureScaleV", "m_flFinalTextureOffsetU", "m_flFinalTextureOffsetV"];
function textureScrollOf(def, mat) {
  const controls = colorLayerOf(def)?.m_TextureControls ?? {};
  if (!TEXTURE_CONTROLS.some((key) => controls[key] && typeof controls[key] === "object" && controls[key].m_nType !== "PF_TYPE_LITERAL")) return () => {};
  const inputs = TEXTURE_CONTROLS.map((key, k) => compileFloat(controls[key], k < 2 ? 1 : 0));
  return (system) => mat.uniforms.uTexTransform.value.set(...inputs.map((input) => input(system, -1)));
}

// A texture that is not a sheet repeats where its scale or offset moves it past its edges
function tiles(def) {
  const controls = colorLayerOf(def)?.m_TextureControls ?? {};
  return TEXTURE_CONTROLS.some((key, k) => controls[key] !== undefined && num(controls[key], NaN) !== (k < 2 ? 1 : 0));
}

// A trail's color and alpha at its tail, as scales of its head's
function tailOf(def) {
  const color = def.m_vecTailColorScale;
  const rgb = Array.isArray(color) ? color : Array.isArray(color?.m_vLiteralValue) ? color.m_vLiteralValue : [1, 1, 1];
  return new THREE.Vector4(rgb[0] ?? 1, rgb[1] ?? 1, rgb[2] ?? 1, num(def.m_flTailAlphaScale, 1));
}

// A layer that recolors the texture: its brightness looked up in a gradient
function lookupOf(def) {
  const layer = layersOf(def).find((input) => input.m_nTextureType === "SPRITECARD_TEXTURE_1D_COLOR_LOOKUP" && input.m_bReplaceTextureWithGradient);
  const stops = layer?.m_Gradient?.m_Stops;
  if (!stops?.length) return null;
  const sorted = [...stops].sort((a, b) => a.m_flPosition - b.m_flPosition);
  const data = new Uint8Array(256 * 4);
  for (let x = 0; x < 256; x++) {
    const t = x / 255;
    let i = 0;
    while (i < sorted.length - 1 && sorted[i + 1].m_flPosition < t) i++;
    const a = sorted[i];
    const b = sorted[Math.min(i + 1, sorted.length - 1)];
    const span = b.m_flPosition - a.m_flPosition;
    const k = span > 0 ? Math.min(Math.max((t - a.m_flPosition) / span, 0), 1) : 0;
    for (let c = 0; c < 3; c++) data[x * 4 + c] = Math.round((a.m_Color[c] ?? 0) + ((b.m_Color[c] ?? 0) - (a.m_Color[c] ?? 0)) * k);
    data[x * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 256, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// The texture's alpha from its brightness: asked for by the channel mix, or for a texture
// without alpha drawn over what is behind (a dark texel must not cover it)
function useTexture(def, mat, loaded) {
  mat.uniforms.uMap.value = loaded.texture;
  mat.uniforms.uHasMap.value = 1;
  const channels = colorLayerOf(def)?.m_nTextureChannels ?? "";
  const over = mat.uniforms.uMod.value < 0.5 && mat.blendDst === THREE.OneMinusSrcAlphaFactor;
  // One channel as the alpha (MIX_RALPHA: a grey texture without alpha, its red)
  const single = channels.match(/MIX_([RGB])ALPHA$/)?.[1];
  mat.uniforms.uAlphaChannel.value = single ? "RGB".indexOf(single) + 1 : 0;
  mat.uniforms.uAlphaFromColor.value = !single && (/RGBALPHA/.test(channels) || (loaded.opaque && over)) ? 1 : 0;
  // Only the alpha of the texture counts
  mat.uniforms.uWhite.value = /MIX_A($|_)/.test(channels.replace("SPRITECARD_TEXTURE_CHANNEL_", "")) ? 1 : 0;
}

function blendingOf(def, material) {
  const mode = def.m_nOutputBlendMode ?? (def.m_bAdditive ? "PARTICLE_OUTPUT_BLEND_MODE_ADD" : "PARTICLE_OUTPUT_BLEND_MODE_ALPHA");
  // The mode's own name, past "PARTICLE_OUTPUT_BLEND_MODE_" (which itself has "MOD" in it)
  const name = mode.replace("PARTICLE_OUTPUT_BLEND_MODE_", "");
  if (/^MOD/.test(name) || def.m_bMod2X) {
    // dst × src × 2: the particle darkens and brightens what is behind it, mid grey leaves it
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.DstColorFactor;
    material.blendDst = THREE.SrcColorFactor;
    material.blendSrcAlpha = THREE.ZeroFactor;
    material.blendDstAlpha = THREE.OneFactor;
    material.uniforms.uMod.value = 1;
  } else if (/ADD/.test(name)) {
    // The shader gives its color already times its alpha; it is added to the colors only, and
    // the see-through canvas's alpha is left as it is (a black texel must not cover anything)
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneFactor;
    material.blendSrcAlpha = THREE.ZeroFactor;
    material.blendDstAlpha = THREE.OneFactor;
    material.uniforms.uPremultiply.value = 1;
  } else {
    // Over what is behind as its alpha says, the color already times its alpha; with some of
    // itself added on top (m_flAddSelfAmount), brighter where it covers no more
    material.uniforms.uAddSelf.value = num(def.m_flAddSelfAmount, 0);
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    material.uniforms.uPremultiply.value = 1;
  }
  material.uniforms.uHalf.value = /HALF_BLEND/.test(name) ? 0.5 : 1;
}

function frameRect(sheet, frame, out, offset) {
  out[offset] = frame[0] / sheet.width;
  out[offset + 1] = 1 - (frame[1] + frame[3]) / sheet.height;
  out[offset + 2] = frame[2] / sheet.width;
  out[offset + 3] = frame[3] / sheet.height;
}

// The frame of a particle's sequence at its age, as a uv rectangle of the sheet; with next and
// blend, the frame after it and how far the sequence is towards it: the game blends the two
// unless the renderer says not to (m_bBlendFramesSeq0), which keeps a fire smooth at 24 frames
function frameOf(sheet, sequenceIndex, age, normalizedAge, def, out, offset, next, blend, blendIndex) {
  const sequences = sheet?.sequences;
  if (!sequences?.length) {
    out[offset] = 0;
    out[offset + 1] = 0;
    out[offset + 2] = 1;
    out[offset + 3] = 1;
    if (blend) blend[blendIndex] = 0;
    return;
  }
  const sequence = sequences[Math.abs(Math.floor(sequenceIndex)) % sequences.length];
  const frames = sequence.frames;
  const rate = num(def.m_flAnimationRate, 0.1);
  let cycle;
  if (def.m_nAnimationType === "ANIMATION_TYPE_FIT_LIFETIME" || def.m_bFitCycleToLifetime) {
    cycle = normalizedAge * (num(def.m_flAnimationRate2, 1) || 1);
  } else if (def.m_bAnimateInFPS) {
    cycle = (age * rate) / frames.length;
  } else {
    cycle = age * rate;
  }
  const looped = sequence.loop === false ? Math.min(cycle, 0.9999) : cycle - Math.floor(cycle);
  const at = looped * frames.length;
  const index = Math.min(Math.floor(at), frames.length - 1);
  frameRect(sheet, frames[index], out, offset);
  if (!next) return;
  const after = sequence.loop === false ? Math.min(index + 1, frames.length - 1) : (index + 1) % frames.length;
  frameRect(sheet, frames[after], next, offset);
  blend[blendIndex] = def.m_bBlendFramesSeq0 === false || after === index ? 0 : at - index;
}

// The scene's depth for depth feathering (soft edges where a particle meets the model or the
// ground), shared by every particle material: the stage writes it each frame as the distance from
// the camera, in a texture of the frame's size (none while it does not)
export const SCENE_DEPTH = {
  uSceneDepth: { value: null },
  uHasSceneDepth: { value: 0 },
  uSceneSize: { value: new THREE.Vector2(1, 1) },
};

// The renderer's own color over the particles' (m_vecColorScale), put together with it as
// m_nColorBlendType says (times it when the file names none)
const COLOR_BLENDS = {
  PARTICLE_COLOR_BLEND_MULTIPLY: 0,
  PARTICLE_COLOR_BLEND_MULTIPLY2X: 1,
  PARTICLE_COLOR_BLEND_MOD2X: 1,
  PARTICLE_COLOR_BLEND_REPLACE: 2,
  PARTICLE_COLOR_BLEND_ADD: 3,
  PARTICLE_COLOR_BLEND_MIN: 4,
  PARTICLE_COLOR_BLEND_MAX: 5,
};
function colorScaleOf(def, mat) {
  if (!def.m_vecColorScale) return () => {};
  const scale = compileVector(def.m_vecColorScale, [1, 1, 1]);
  const out = [1, 1, 1];
  mat.uniforms.uColorBlend.value = COLOR_BLENDS[def.m_nColorBlendType] ?? 0;
  return (system) => {
    scale(system, -1, out);
    mat.uniforms.uColorScale.value.set(out[0], out[1], out[2]);
  };
}

// The camera's near and far planes, for a particle's own distance from it (depth feathering)
function cameraRange(mat, camera) {
  if (!camera?.isPerspectiveCamera) return;
  mat.uniforms.uCameraNear.value = camera.near;
  mat.uniforms.uCameraFar.value = camera.far;
}

// Drawn nearer the camera by m_flDepthBias units than it is (farther, below nothing) for the
// depth test only, so what it lies on does not cut it, and it keeps its size on the screen
const DEPTH_BIAS = /* glsl */ `
  uniform float uDepthBias;
  vec4 depthBiased(vec4 clip) {
    if (uDepthBias == 0.0) return clip;
    float viewZ = min(-clip.w + uDepthBias, -1e-4);
    clip.z = (projectionMatrix[2][2] * viewZ + projectionMatrix[3][2]) / -viewZ * clip.w;
    return clip;
  }
`;

const SPRITE_VERTEX = /* glsl */ `
  attribute vec3 iPosition;
  attribute vec4 iColor;
  attribute vec4 iFrame;
  attribute vec4 iFrameNext;
  attribute float iFrameBlend;
  attribute vec2 iSizeRoll;
  attribute vec3 iNormal;
  attribute vec3 iVelocity;
  uniform int uOrientation;
  uniform vec4 uScreenSize;
  uniform float uCameraBias;
  uniform vec4 uTexTransform;
  uniform float uTexRotation;
  uniform vec4 uTail;
  varying vec2 vUv;
  varying vec2 vUvNext;
  varying float vFrameBlend;
  varying vec2 vLocal;
  varying vec4 vColor;
  ${DEPTH_BIAS}
  // Normalized, or a fallback where the vector is nothing (normalize gives NaN there on graphics cards)
  vec3 safeNormalize(vec3 v) {
    float l = length(v);
    return l > 1e-6 ? v / l : vec3(0.0, 1.0, 0.0);
  }
  void main() {
    // Drawn a little towards the camera, so particles inside the model show, as the game does
    vec3 center = iPosition + safeNormalize(cameraPosition - iPosition) * uCameraBias;
    // The texture as the game's spritecard shader places it: turned round its middle
    // (m_flFinalTextureUVRotation), divided by its scale there (a scale of 0.4 draws the picture
    // 0.4 as large: the pedestal's flat ground fog; -1 turns it round), then its offset, within the frame
    vec2 turned = uv - 0.5;
    if (uTexRotation != 0.0) {
      float c = cos(uTexRotation), s = sin(uTexRotation);
      turned = mat2(c, s, -s, c) * turned;
    }
    vec2 texScale = vec2(uTexTransform.x == 0.0 ? 1.0 : uTexTransform.x, uTexTransform.y == 0.0 ? 1.0 : uTexTransform.y);
    vec2 placed = turned / texScale + 0.5 + uTexTransform.zw;
    vUv = iFrame.xy + placed * iFrame.zw;
    vUvNext = iFrameNext.xy + placed * iFrameNext.zw;
    vFrameBlend = iFrameBlend;
    vLocal = uv;
    vColor = iColor;
    // A trail's color and alpha scaled towards its tail (uv.y 0), full at its head
    if (uOrientation == 4) vColor *= mix(uTail, vec4(1.0), uv.y);
    // The game keeps sprites within a share of the screen and fades them as they grow on it:
    // x min, y max, z fade start, w fade end, as shares of the screen's height
    float distance = max(-(modelViewMatrix * vec4(center, 1.0)).z, 1e-3);
    float onScreen = iSizeRoll.x * projectionMatrix[1][1] / distance;
    float size = iSizeRoll.x;
    if (onScreen > uScreenSize.y) size *= uScreenSize.y / onScreen;
    if (onScreen < uScreenSize.x && onScreen > 0.0) size *= uScreenSize.x / onScreen;
    vColor.a *= 1.0 - smoothstep(uScreenSize.z, uScreenSize.w, onScreen);
    vec2 corner = (uv - 0.5) * 2.0;
    float c = cos(iSizeRoll.y);
    float s = sin(iSizeRoll.y);
    corner = vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
    if (uOrientation == 0) {
      // Facing the camera
      vec4 view = modelViewMatrix * vec4(center, 1.0);
      view.xy += corner;
      gl_Position = depthBiased(projectionMatrix * view);
      return;
    }
    vec3 right;
    vec3 up;
    if (uOrientation == 1) {
      // Lying flat on the ground
      right = vec3(1.0, 0.0, 0.0);
      up = vec3(0.0, 0.0, 1.0);
    } else if (uOrientation == 2) {
      // Turned round the up axis to the camera
      vec3 toCamera = safeNormalize(cameraPosition - center);
      up = vec3(0.0, 1.0, 0.0);
      right = safeNormalize(cross(up, toCamera));
    } else if (uOrientation == 3) {
      // Along the particle's normal
      vec3 n = safeNormalize(iNormal + vec3(0.0, 1e-5, 0.0));
      right = safeNormalize(cross(abs(n.y) > 0.99 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), n));
      up = cross(n, right);
    } else {
      // Stretched along the movement, as a trail
      vec3 toCamera = safeNormalize(cameraPosition - center);
      vec3 along = length(iVelocity) > 1e-6 ? safeNormalize(iVelocity) : vec3(0.0, 1.0, 0.0);
      right = safeNormalize(cross(along, toCamera));
      float length = max(length(iVelocity), iSizeRoll.x);
      vec3 world = center + right * (uv.x - 0.5) * 2.0 * size - along * (1.0 - uv.y) * length;
      gl_Position = depthBiased(projectionMatrix * viewMatrix * vec4(world, 1.0));
      return;
    }
    gl_Position = depthBiased(projectionMatrix * viewMatrix * vec4(center + right * corner.x + up * corner.y, 1.0));
  }
`;

const FRAGMENT = /* glsl */ `
  #include <packing>
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform sampler2D uLookup;
  uniform float uHasLookup;
  uniform float uAlphaFromColor;
  uniform float uWhite;
  uniform float uOverbright;
  uniform float uHalf;
  uniform float uMod;
  uniform float uPremultiply;
  uniform float uGammaColor;
  uniform float uAddSelf;
  uniform float uAlphaChannel;
  uniform sampler2D uLayer;
  uniform float uHasLayer;
  uniform vec4 uLayerRect;
  uniform float uLayerSameFrame;
  uniform vec4 uLayerTransform;
  uniform int uLayerChannels;
  uniform int uLayerBlend;
  uniform float uLayerAmount;
  uniform vec3 uColorScale;
  uniform int uColorBlend;
  uniform float uDesaturation;
  uniform sampler2D uSceneDepth;
  uniform float uHasSceneDepth;
  uniform vec2 uSceneSize;
  uniform vec3 uFeather;
  uniform float uCameraNear;
  uniform float uCameraFar;
  varying vec2 vUv;
  varying vec2 vUvNext;
  varying float vFrameBlend;
  varying vec2 vLocal;
  varying vec4 vColor;
  // A layer's value put over the one before it, as uLayerBlend says, by uLayerAmount
  vec4 layered(vec4 c, vec4 l) {
    vec4 r = c * l;
    if (uLayerBlend == 1) r = c * l * 2.0;
    else if (uLayerBlend == 2) r = l;
    else if (uLayerBlend == 3) r = c + l;
    else if (uLayerBlend == 4) r = c - l;
    else if (uLayerBlend == 5) r = (c + l) * 0.5;
    else if (uLayerBlend == 6) r = c * vec4(vec3(dot(l.rgb, vec3(0.2126, 0.7152, 0.0722))), l.a);
    return mix(c, r, uLayerAmount);
  }
  vec3 colorScaled(vec3 c) {
    if (uColorBlend == 1) return c * uColorScale * 2.0;
    if (uColorBlend == 2) return uColorScale;
    if (uColorBlend == 3) return c + uColorScale;
    if (uColorBlend == 4) return min(c, uColorScale);
    if (uColorBlend == 5) return max(c, uColorScale);
    return c * uColorScale;
  }
  void main() {
    // The particle's color as the file gives it is in gamma space, the renderer's color over it;
    // the game turns it linear unless the renderer says not to (m_bGammaCorrectVertexColors)
    vec3 shown = colorScaled(vColor.rgb);
    // Turned towards grey by m_flDesaturation (the pedestal's dust, 0.8: nearly grey whatever its color)
    shown = mix(shown, vec3(dot(shown, vec3(0.299, 0.587, 0.114))), uDesaturation);
    vec3 tint = uGammaColor > 0.5 ? pow(max(shown, 0.0), vec3(2.2)) : shown;
    vec4 texel = uHasMap > 0.5 ? texture2D(uMap, vUv) : vec4(1.0);
    if (uHasMap > 0.5 && vFrameBlend > 0.0) texel = mix(texel, texture2D(uMap, vUvNext), vFrameBlend);
    float bright = max(texel.r, max(texel.g, texel.b));
    if (uAlphaFromColor > 0.5) texel.a *= bright;
    if (uAlphaChannel > 0.5) texel.a = uAlphaChannel < 1.5 ? texel.r : uAlphaChannel < 2.5 ? texel.g : texel.b;
    if (uWhite > 0.5) texel.rgb = vec3(1.0);
    if (uHasLayer > 0.5) {
      vec4 l = texture2D(uLayer, uLayerSameFrame > 0.5 ? vUv : uLayerRect.xy + (vLocal * uLayerTransform.xy + uLayerTransform.zw) * uLayerRect.zw);
      float lb = max(l.r, max(l.g, l.b));
      if (uLayerChannels == 3 || uLayerChannels == 4) l.a = lb;
      else if (uLayerChannels == 5) l.a = l.r;
      else if (uLayerChannels == 6) l.a = l.g;
      else if (uLayerChannels == 7) l.a = l.b;
      vec4 over = layered(texel, l);
      if (uLayerChannels != 2 && uLayerChannels != 4 && uLayerChannels < 5) texel.rgb = over.rgb;
      if (uLayerChannels != 1) texel.a = clamp(over.a, 0.0, 1.0);
    }
    if (uHasLookup > 0.5) texel.rgb = texture2D(uLookup, vec2(clamp(bright, 0.0, 1.0), 0.5)).rgb;
    float alpha = texel.a * vColor.a;
    // Feathered: fading out where the scene behind is nearer than m_flFeatheringMaxDist, gone
    // within m_flFeatheringMinDist (x on, y min, z max, in the scene's units)
    if (uFeather.x > 0.5 && uHasSceneDepth > 0.5) {
      float behind = texture2D(uSceneDepth, gl_FragCoord.xy / uSceneSize).r;
      float own = -perspectiveDepthToViewZ(gl_FragCoord.z, uCameraNear, uCameraFar);
      alpha *= clamp((behind - own - uFeather.y) / max(uFeather.z - uFeather.y, 1e-4), 0.0, 1.0);
    }
    if (uMod > 0.5) {
      // Mid grey where the particle is see-through, so it leaves what is behind as it is
      vec3 mod2x = mix(vec3(0.5), texel.rgb * tint, clamp(alpha, 0.0, 1.0));
      if (any(isnan(mod2x))) discard;
      gl_FragColor = vec4(clamp(mod2x, 0.0, 1.0), 1.0);
      return;
    }
    vec4 color = vec4(texel.rgb * tint * uOverbright * uHalf, alpha);
    // Kept finite
    if (any(isnan(color)) || color.a < 0.002) discard;
    vec3 rgb = clamp(color.rgb, 0.0, 16.0);
    float a = clamp(color.a, 0.0, 1.0);
    gl_FragColor = vec4(uPremultiply > 0.5 ? min(rgb * a * (1.0 + uAddSelf), vec3(16.0)) : rgb, a);
    #include <colorspace_fragment>
  }
`;

// While developing, ?flatparticles draws every particle as a see-through pink quad, nothing else
// (=tex the texture alone, =color the particle's color, =alpha its alpha as grey)
const flatMode = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("flatparticles") : null;
const flat = flatMode !== null;
const FLAT = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    ${
      flatMode === "tex"
        ? "gl_FragColor = vec4(texture2D(uMap, vUv).rgb, 1.0);"
        : flatMode === "color"
        ? "gl_FragColor = vec4(vColor.rgb, 1.0);"
        : flatMode === "alpha"
        ? "gl_FragColor = vec4(vec3(vColor.a), 1.0);"
        : "gl_FragColor = vec4(1.0, 0.2, 0.8, 0.5);"
    }
  }
`;

function material(def, vertexShader, orientation) {
  const result = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: flat ? FLAT : FRAGMENT,
    uniforms: {
      uMap: { value: null },
      uHasMap: { value: 0 },
      uLookup: { value: null },
      uHasLookup: { value: 0 },
      uAlphaFromColor: { value: 0 },
      uWhite: { value: 0 },
      uOverbright: { value: num(def.m_flOverbrightFactor, 1) },
      uDesaturation: { value: Math.min(Math.max(num(def.m_flDesaturation, 0), 0), 1) },
      uHalf: { value: 1 },
      uMod: { value: 0 },
      uPremultiply: { value: 0 },
      uGammaColor: { value: def.m_bGammaCorrectVertexColors === false ? 0 : 1 },
      // Colors are not turned by the hue shift at m_nHSVShiftControlPoint: it is the one a
      // prismatic gem gives (C_OP_HSVShiftToCP), none without a gem, and none are worn here
      uAddSelf: { value: 0 },
      uAlphaChannel: { value: 0 },
      uLayer: { value: null },
      uHasLayer: { value: 0 },
      uLayerRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uLayerSameFrame: { value: 0 },
      uLayerTransform: { value: new THREE.Vector4(1, 1, 0, 0) },
      uLayerChannels: { value: 0 },
      uLayerBlend: { value: 0 },
      uLayerAmount: { value: 1 },
      uColorScale: { value: new THREE.Vector3(1, 1, 1) },
      uColorBlend: { value: 0 },
      uDepthBias: { value: num(def.m_flDepthBias, 0) * UNIT },
      uFeather: {
        value: new THREE.Vector3(/_ON_/.test(def.m_nFeatheringMode ?? "") ? 1 : 0, num(def.m_flFeatheringMinDist, 0) * UNIT, num(def.m_flFeatheringMaxDist, 1) * UNIT),
      },
      uCameraNear: { value: 0.1 },
      uCameraFar: { value: 100 },
      ...SCENE_DEPTH,
      uOrientation: { value: orientation },
      uTexTransform: { value: textureTransformOf(def) },
      uTexRotation: { value: (num(colorLayerOf(def)?.m_TextureControls?.m_flFinalTextureUVRotation, 0) * Math.PI) / 180 },
      uTail: { value: tailOf(def) },
      uCameraBias: { value: num(def.VisibilityInputs?.m_flCameraBias, 0) * UNIT },
      uScreenSize: {
        value: new THREE.Vector4(num(def.m_flMinSize, 0), num(def.m_flMaxSize, 5000), num(def.m_flStartFadeSize, 1e8), num(def.m_flEndFadeSize, 2e8)),
      },
    },
    transparent: true,
    // Both faces, as the game draws them: a sprite lying on the ground faces down here
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: !def.m_bDisableZBuffering,
  });
  blendingOf(def, result);
  const lookup = lookupOf(def);
  if (lookup) {
    result.uniforms.uLookup.value = lookup;
    result.uniforms.uHasLookup.value = 1;
  }
  if (flat) {
    result.blending = THREE.NormalBlending;
  }
  return result;
}

const ORIENTATIONS = {
  PARTICLE_ORIENTATION_SCREEN_ALIGNED: 0,
  PARTICLE_ORIENTATION_WORLD_Z_ALIGNED: 1,
  PARTICLE_ORIENTATION_SCREEN_Z_ALIGNED: 2,
  PARTICLE_ORIENTATION_ALIGN_TO_PARTICLE_NORMAL: 3,
  PARTICLE_ORIENTATION_SCREENALIGN_TO_PARTICLE_NORMAL: 3,
  PARTICLE_ORIENTATION_FULL_3AXIS_ROTATION: 3,
};

// Sprites and trails: one instanced quad a particle
function quads(def, system, trail) {
  const max = system.maxParticles;
  const geometry = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  geometry.index = base.index;
  geometry.setAttribute("position", base.getAttribute("position"));
  geometry.setAttribute("uv", base.getAttribute("uv"));
  const attribute = (name, size) => {
    const value = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size);
    value.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, value);
    return value;
  };
  const position = attribute("iPosition", 3);
  const color = attribute("iColor", 4);
  const frame = attribute("iFrame", 4);
  const frameNext = attribute("iFrameNext", 4);
  const frameBlend = attribute("iFrameBlend", 1);
  const sizeRoll = attribute("iSizeRoll", 2);
  const normal = attribute("iNormal", 3);
  const velocity = attribute("iVelocity", 3);
  geometry.instanceCount = 0;
  const orientation = trail ? 4 : ORIENTATIONS[def.m_nOrientationType] ?? 0;
  const mat = material(def, SPRITE_VERTEX, orientation);
  const colorScale = colorScaleOf(def, mat);
  const moveTexture = textureScrollOf(def, mat);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.visible = false;

  let sheet = null;
  let ready = false;
  const texture = textureOf(def);
  if (texture) {
    system.host.loadTexture(texture).then((loaded) => {
      if (!loaded) return;
      sheet = loaded.sheet;
      ready = true;
      if (!sheet?.sequences?.length && tiles(def)) loaded.texture.wrapS = loaded.texture.wrapT = THREE.RepeatWrapping;
      useTexture(def, mat, loaded);
    });
  }
  useLayer(def, mat, system);
  const radiusScale = num(def.m_flRadiusScale, 1) * UNIT;
  const alphaScale = num(def.m_flAlphaScale, 1);
  const sequenceOverride = def.m_nSequenceOverride ?? -1;
  const maxLength = num(def.m_flMaxLength, 2000) * UNIT;
  const minLength = num(def.m_flMinLength, 0) * UNIT;
  const lengthScale = num(def.m_flLengthScale, 1);
  const ignoreDT = Boolean(def.m_bIgnoreDT);
  const lengthFadeIn = num(def.m_flLengthFadeInTime, 0);

  return {
    object: mesh,
    render(system, camera) {
      const n = system.count;
      mesh.visible = n > 0 && ready;
      geometry.instanceCount = n;
      if (!mesh.visible) return;
      colorScale(system);
      moveTexture(system);
      cameraRange(mat, camera);
      const p = system.float(0);
      const q = system.float(2);
      const tint = system.float(6);
      const alpha = system.float(7);
      const alpha2 = system.float(16);
      const radius = system.float(3);
      const roll = system.float(4);
      const seq = system.float(9);
      const trailLength = system.float(10);
      const normals = system.float(21);
      const creation = system.float(8);
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        // The game's axes to the scene's
        position.array[j] = p[j + 1] * UNIT;
        position.array[j + 1] = p[j + 2] * UNIT;
        position.array[j + 2] = p[j] * UNIT;
        normal.array[j] = normals[j + 1];
        normal.array[j + 1] = normals[j + 2];
        normal.array[j + 2] = normals[j];
        // The game draws a particle's values within range: no color below black, alpha 0 to 1
        color.array[i * 4] = Math.min(Math.max(tint[j] || 0, 0), 4);
        color.array[i * 4 + 1] = Math.min(Math.max(tint[j + 1] || 0, 0), 4);
        color.array[i * 4 + 2] = Math.min(Math.max(tint[j + 2] || 0, 0), 4);
        color.array[i * 4 + 3] = Math.min(Math.max(alpha[i], 0), 1) * Math.min(Math.max(alpha2[i], 0), 1) * alphaScale;
        sizeRoll.array[i * 2] = Math.max(0, radius[i]) * radiusScale;
        sizeRoll.array[i * 2 + 1] = roll[i];
        if (trail) {
          // The trail reaches back as far as the particle went in its trail time
          // (its direction from the movement alone: a trail held at its minimum length still points
          // the way the particle goes)
          // A speed (per second) times the trail time, or with m_bIgnoreDT the step of one frame
          // times it; growing to its length over m_flLengthFadeInTime
          const fadeIn = lengthFadeIn > 0 ? Math.min((system.age - creation[i]) / lengthFadeIn, 1) : 1;
          const speedScale = (ignoreDT ? trailLength[i] : trailLength[i] / (1 / 60)) * lengthScale * fadeIn;
          const vx = (p[j + 1] - q[j + 1]) * UNIT;
          const vy = (p[j + 2] - q[j + 2]) * UNIT;
          const vz = (p[j] - q[j]) * UNIT;
          const moved = Math.hypot(vx, vy, vz);
          const clamped = Math.min(Math.max(moved * Math.max(speedScale, 0), minLength), maxLength);
          const k = moved > 1e-9 ? clamped / moved : 0;
          velocity.array[j] = vx * k;
          velocity.array[j + 1] = vy * k;
          velocity.array[j + 2] = vz * k;
        }
        frameOf(sheet, sequenceOverride >= 0 ? sequenceOverride : seq[i], system.age - creation[i], system.normalizedAge(i), def, frame.array, i * 4, frameNext.array, frameBlend.array, i);
      }
      for (const value of [position, color, frame, frameNext, frameBlend, sizeRoll, normal, velocity]) {
        value.addUpdateRange(0, n * value.itemSize);
        value.needsUpdate = true;
      }
    },
    dispose() {
      geometry.dispose();
      mat.dispose();
    },
  };
}

const ROPE_VERTEX = /* glsl */ `
  attribute vec4 color;
  uniform vec4 uTexTransform;
  varying vec2 vUv;
  varying vec2 vUvNext;
  varying float vFrameBlend;
  varying vec2 vLocal;
  varying vec4 vColor;
  ${DEPTH_BIAS}
  void main() {
    vUv = uv * uTexTransform.xy + uTexTransform.zw;
    vUvNext = vUv;
    vFrameBlend = 0.0;
    vLocal = uv;
    vColor = color;
    gl_Position = depthBiased(projectionMatrix * modelViewMatrix * vec4(position, 1.0));
  }
`;

// A ribbon through the particles in the order they were made, as wide as each is
function rope(def, system) {
  // Each stretch between two particles cut into this many, along a smooth curve through them: the
  // game picks between the least and the most by the stretch's length, the most here (a rope
  // through a few particles round a fan stays round)
  const tess = Math.min(Math.max(Math.round(Math.max(num(def.m_nMinTesselation, 0), num(def.m_nMaxTesselation, 0))), 0), 8);
  const max = (system.maxParticles - 1) * (tess + 1) + 1;
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(max * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const uvs = new THREE.BufferAttribute(new Float32Array(max * 2 * 2), 2).setUsage(THREE.DynamicDrawUsage);
  const colors = new THREE.BufferAttribute(new Float32Array(max * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const index = [];
  for (let i = 0; i < max - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(index);
  geometry.setAttribute("position", positions);
  geometry.setAttribute("uv", uvs);
  geometry.setAttribute("color", colors);
  const mat = material(def, ROPE_VERTEX, 0);
  const colorScale = colorScaleOf(def, mat);
  const moveTexture = textureScrollOf(def, mat);
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.visible = false;
  let sheet = null;
  let ready = false;
  const texture = textureOf(def, true);
  if (texture) {
    system.host.loadTexture(texture).then((loaded) => {
      if (!loaded) return;
      sheet = loaded.sheet;
      ready = true;
      loaded.texture.wrapS = loaded.texture.wrapT = THREE.RepeatWrapping;
      useTexture(def, mat, loaded);
    });
  }
  useLayer(def, mat, system, true);
  const radiusScale = num(def.m_flRadiusScale, 1) * UNIT;
  const alphaScale = num(def.m_flAlphaScale, 1);
  const worldSize = num(def.m_flTextureVWorldSize, 10) || 10;
  // V along the rope: a texture's length every m_flTextureVWorldSize units, scrolling by
  // m_flTextureVScrollRate units a second
  const scroll = num(def.m_flTextureVScrollRate, 0);
  const vOffset = num(def.m_flTextureVOffset, 0);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();

  return {
    object: mesh,
    render(system, camera) {
      const n = system.count;
      mesh.visible = n > 1 && ready;
      if (!mesh.visible) return;
      colorScale(system);
      moveTexture(system);
      cameraRange(mat, camera);
      const p = system.float(0);
      const tint = system.float(6);
      const alpha = system.float(7);
      const alpha2 = system.float(16);
      const radius = system.float(3);
      // The particles' places, widths and colors, then points on a Catmull-Rom curve through them
      const at = (i, k) => p[Math.min(Math.max(i, 0), n - 1) * 3 + k];
      const value = (i) => {
        const j = Math.min(Math.max(i, 0), n - 1);
        return [
          Math.min(Math.max(tint[j * 3] || 0, 0), 4),
          Math.min(Math.max(tint[j * 3 + 1] || 0, 0), 4),
          Math.min(Math.max(tint[j * 3 + 2] || 0, 0), 4),
          Math.min(Math.max(alpha[j], 0), 1) * Math.min(Math.max(alpha2[j], 0), 1) * alphaScale,
          Math.max(0, radius[j]) * radiusScale,
        ];
      };
      const curve = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
      const count = (n - 1) * (tess + 1) + 1;
      const points = new Float32Array(count * 8);
      for (let q = 0; q < count; q++) {
        const i = Math.floor(q / (tess + 1));
        const t = (q % (tess + 1)) / (tess + 1);
        const o = q * 8;
        // Game axes to the scene's: x from y, y from z, z from x
        for (const [axis, k] of [[0, 1], [1, 2], [2, 0]]) {
          points[o + axis] = curve(at(i - 1, k), at(i, k), at(i + 1, k), at(i + 2, k), t) * UNIT;
        }
        const v0 = value(i);
        const v1 = value(i + 1);
        for (let c = 0; c < 5; c++) points[o + 3 + c] = v0[c] + (v1[c] - v0[c]) * t;
      }
      let distance = 0;
      for (let q = 0; q < count; q++) {
        const o = q * 8;
        a.set(points[o], points[o + 1], points[o + 2]);
        const next = Math.min(q + 1, count - 1) * 8;
        const prev = Math.max(q - 1, 0) * 8;
        tangent.set(points[next] - points[prev], points[next + 1] - points[prev + 1], points[next + 2] - points[prev + 2]).normalize();
        toCamera.subVectors(camera.position, a).normalize();
        side.crossVectors(tangent, toCamera).normalize().multiplyScalar(points[o + 7]);
        if (q > 0) distance += a.distanceTo(b) / UNIT;
        b.copy(a);
        const v = distance / worldSize + system.age * scroll / worldSize + vOffset;
        for (let e = 0; e < 2; e++) {
          const w = (q * 2 + e) * 3;
          const sign = e === 0 ? 1 : -1;
          positions.array[w] = a.x + side.x * sign;
          positions.array[w + 1] = a.y + side.y * sign;
          positions.array[w + 2] = a.z + side.z * sign;
          uvs.array[(q * 2 + e) * 2] = e;
          uvs.array[(q * 2 + e) * 2 + 1] = v;
          const c = (q * 2 + e) * 4;
          colors.array[c] = points[o + 3];
          colors.array[c + 1] = points[o + 4];
          colors.array[c + 2] = points[o + 5];
          colors.array[c + 3] = points[o + 6];
        }
      }
      geometry.setDrawRange(0, (count - 1) * 6);
      for (const attribute of [positions, uvs, colors]) {
        attribute.addUpdateRange(0, count * 2 * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    },
    dispose() {
      geometry.dispose();
      mat.dispose();
    },
  };
}

// While developing, ?pfilter=sprites,ropes,trails,add,alpha,mod2x keeps only those renderers
const filter = import.meta.env.DEV ? new URLSearchParams(window.location.search).get("pfilter") : null;
const kept = (kind, def) => {
  if (!filter) return true;
  const words = filter.toLowerCase().split(",");
  const blend = (def.m_nOutputBlendMode ?? "PARTICLE_OUTPUT_BLEND_MODE_ALPHA").replace("PARTICLE_OUTPUT_BLEND_MODE_", "").toLowerCase();
  const texture = (textureOf(def) ?? "").toLowerCase();
  return words.includes(kind) || words.includes(blend) || words.includes(`${kind}-${blend}`) || words.some((word) => word.length > 3 && texture.includes(word));
};

// Renderers drawn nowhere here: refraction bends what is behind through a normal map (drawn as
// a picture it is a pink square), some only feed the game's bloom, and one without a texture
// would be a bare square
const drawn = (def) => !def.m_bRefract && !def.m_bOnlyRenderInEffectsBloomPass && textureOf(def) !== null;

// A rope runs through its particles in order; particles put at a model snapshot's points follow
// them along a blade, but without the snapshot they land anywhere on the model and a rope
// through them would cut across the whole hero
const offSnapshot = (system) =>
  (system.def.m_Initializers ?? []).some((op) => {
    if (!/FromCPSnapshot|FromSnapshot/.test(op._class)) return false;
    const snapshot = system.snapshot(op.m_nSnapshotControlPointNumber ?? op.m_nControlPointNumber ?? 0);
    return !(snapshot && system.host.snapshotPoints?.(snapshot)?.length);
  });

// A model a particle: placed, turned by its roll, yaw and pitch and scaled by its radius, its
// texture tinted by the particle's color, unlit like the other particles. An animated one plays
// the sequence its field holds (the sequence's number in the model, as the named-sequence
// operators write it; the activity's, when the renderer names one) from when the particle took
// it, looping as the sequence does; operators find the model's attachments on it.
function models(def, system) {
  const group = new THREE.Group();
  group.visible = false;
  const path = (def.m_ModelList ?? []).find((entry) => entry?.m_model)?.m_model;
  // Loaded before the effect starts; a model still on its way is drawn once there
  let model = (path && system.host.loadedModel?.(path)) ?? null;
  if (path && !model) {
    system.host.loadModel?.(path).then((loaded) => {
      model = loaded;
    });
  }
  const pool = [];
  const radiusScale = num(def.m_flRadiusScale, 1);
  const alphaScale = num(def.m_flAlphaScale, 1);
  const animated = Boolean(def.m_bAnimated);
  const field = def.m_nAnimationField ?? 13;
  const rateField = def.m_nAnimationScaleField;
  // The rate in frames a second, the sequences' own being 30; scaled, in frames for each 1000
  // units the particle moves (birds, fish and butterflies beat their wings as fast as they fly:
  // the files give them 250 to 2000 there, and 30 to projectiles flying 1000 units a second)
  const rate = compileFloat(def.m_flAnimationRate, 30);
  const bySpeed = Boolean(def.m_bScaleAnimationRate);
  const forceLoop = Boolean(def.m_bForceLoopingAnimation);
  const activity = def.m_ActivityName;
  // What each particle plays, by its id: the sequence and when it took it
  const playing = new Map();

  // A model drawn with a material of the effect's own in place of its own (not in the dataset
  // yet, P-05): its own texture stands in, unless the model only has a stand-in material (a flat
  // gray or white the artist never meant to be seen), which would come out a blank shell
  const override = Boolean(def.m_hOverrideMaterial);
  const STAND_IN = /^(gray|grey|white|black)(_\d+)?$|^default$|^dev[_/]|primary_white/i;

  const instance = () => {
    const object = cloneSkinned(model.scene);
    const materials = [];
    object.traverse((node) => {
      if (!node.isMesh) return;
      const original = node.material;
      if (override && STAND_IN.test(original.name ?? "")) node.visible = false;
      node.material = new THREE.MeshBasicMaterial({ map: original.map ?? null, transparent: true, alphaTest: original.alphaTest || 0.5, side: THREE.DoubleSide, depthWrite: true });
      // Laid over what is behind it as the model's own material says: added (Terrorblade's
      // blade planes, black where nothing glows) or see-through
      const flags = original.userData?.vmat?.IntParams ?? {};
      if (flags.F_ADDITIVE_BLEND || flags.F_TRANSLUCENT || flags.F_BLEND_MODE) {
        node.material.alphaTest = 0;
        node.material.depthWrite = false;
        if (flags.F_ADDITIVE_BLEND || flags.F_BLEND_MODE === 2) {
          // Added to the colors only, the see-through canvas's alpha left as it is, as additive
          // sprites are (a black texel must not cover the page behind)
          Object.assign(node.material, {
            blending: THREE.CustomBlending,
            blendEquation: THREE.AddEquation,
            blendSrc: THREE.SrcAlphaFactor,
            blendDst: THREE.OneFactor,
            blendSrcAlpha: THREE.ZeroFactor,
            blendDstAlpha: THREE.OneFactor,
          });
        }
      }
      node.frustumCulled = false;
      materials.push(node.material);
    });
    object.userData.materials = materials;
    object.userData.bones = bonesOf(object);
    if (animated && model.clips.length) object.userData.mixer = new THREE.AnimationMixer(object);
    group.add(object);
    return object;
  };

  // The sequence a particle plays: by the renderer's activity, else its field's number
  // Null when the activity is not found: another of the model's sequences may carry it far from
  // where it stands (a debut moves the orb metres away), so it keeps its rest pose
  const sequenceOf = (system, i) => {
    if (activity) return model.names.find((name) => model.sequences[name].activities?.includes(activity)) ?? null;
    return model.names[Math.round(system.float(field)[i])] ?? model.names[0];
  };

  // Particle i's model where the particle is, posed as its sequence is now
  const place = (system, i, object) => {
    const p = system.float(0);
    const j = i * 3;
    object.position.set(p[j + 1] * UNIT, p[j + 2] * UNIT, p[j] * UNIT);
    // The game's turns about its up, left and ahead axes, in the scene's
    object.rotation.set(system.float(20)[i], system.float(12)[i], system.float(4)[i], "YXZ");
    object.scale.setScalar(Math.max(0, system.float(3)[i]) * radiusScale);
    const mixer = object.userData.mixer;
    if (!mixer) return;
    const id = system.ids[i];
    const name = sequenceOf(system, i);
    if (!name) return;
    let state = playing.get(id);
    if (!state || state.name !== name) {
      state = { name, time: 0, last: system.age };
      playing.set(id, state);
    }
    state.seen = system.age;
    // The animation the sequence plays (the export's `clip`; older files: its name, or it with an @)
    const wanted = [model.sequences[name]?.clip, name, `@${name}`];
    const clip = wanted.map((clipName) => clipName && model.clips.find((entry) => entry.name === clipName)).find(Boolean);
    if (!clip) return;
    if (object.userData.clip !== clip) {
      mixer.stopAllAction();
      object.userData.action = mixer.clipAction(clip).play();
      object.userData.clip = clip;
    }
    const frames = rate(system, i) * (rateField !== undefined ? system.float(rateField)[i] : 1) * (bySpeed ? system.speed(i) / 1000 : 1);
    state.time += Math.max(0, system.age - state.last) * (frames / 30);
    state.last = system.age;
    const elapsed = state.time;
    const looping = forceLoop || (model.sequences[name]?.looping ?? true);
    const length = clip.duration || 1;
    object.userData.action.time = looping ? elapsed % length : Math.min(elapsed, length - 1e-4);
    mixer.update(0);
    object.updateMatrixWorld(true);
  };

  return {
    object: group,
    // The place and turn of attachment name on particle i's model, in the scene; false
    // without the model or the attachment
    attachment(system, i, name, position, quaternion) {
      const attachment = model?.attachments[name];
      if (!attachment || i >= system.count) return false;
      while (pool.length <= i) pool.push(instance());
      place(system, i, pool[i]);
      return attachmentTransform(attachment, pool[i].userData.bones, position, quaternion);
    },
    render(system) {
      const n = system.count;
      group.visible = n > 0 && model !== null;
      if (!group.visible) return;
      while (pool.length < n) pool.push(instance());
      const tint = system.float(6);
      const alpha = system.float(7);
      for (const [i, object] of pool.entries()) {
        object.visible = i < n;
        if (i >= n) continue;
        place(system, i, object);
        const j = i * 3;
        for (const material of object.userData.materials) {
          material.color.setRGB(Math.min(Math.max(tint[j], 0), 1), Math.min(Math.max(tint[j + 1], 0), 1), Math.min(Math.max(tint[j + 2], 0), 1), THREE.SRGBColorSpace);
          material.opacity = Math.min(Math.max(alpha[i], 0), 1) * alphaScale;
        }
      }
      // Particles gone since
      for (const [id, state] of playing) if (state.seen !== system.age) playing.delete(id);
    },
    // A sequence's number in the model by its name, -1 when it has none of that name
    sequence(name) {
      return model ? model.names.indexOf(name) : -1;
    },
    dispose() {
      for (const object of pool) for (const material of object.userData.materials) material.dispose();
    },
  };
}

// The lights particles cast this frame (C_OP_RenderDeferredLight), gathered by the stage for its
// materials: { x, y, z, radius } in the scene's metres, width the share of the radius the light
// fades over, r, g, b linear and times the light's intensity. Emptied by the stage every frame.
export const frameLights = [];

// Each particle a point light, as particles.dll hands it to the renderer (0x1803155c5): at the
// particle, radius = its radius × m_flRadiusScale, color = its color with m_vecColorScale as
// m_nColorBlendType says, clamped and passed as bytes (taken as they are, linear: the gamma
// reading made Ember Spirit's sword flashes dark red where the game lights the floor orange),
// intensity = alpha × the second alpha field × m_flAlphaScale. Defaults from the renderer's
// constructor (0x18033c440): scales 1, m_flStartFalloff 0.25. deferred_local_light_cs lights
// a surface by color × N·L × smoothstep(saturate((1 - d / radius) / (1 - start falloff)));
// Valve's wiki: a start falloff of 1 is no falloff over the radius.
// Not drawn: spot lights (m_flLightDistance, 2 renderers), projected textures (m_bUseTexture).
function deferredLights(def, system) {
  const radiusScale = num(def.m_flRadiusScale, 1);
  const alphaScale = num(def.m_flAlphaScale, 1);
  const start = Math.min(Math.max(num(def.m_flStartFalloff, 0.25), 0), 1);
  const width = 1 - start;
  const scale = def.m_vecColorScale ? compileVector(def.m_vecColorScale, [1, 1, 1]) : null;
  const blend = COLOR_BLENDS[def.m_nColorBlendType] ?? 0;
  const alpha2Field = typeof def.m_nAlpha2Field === "number" ? def.m_nAlpha2Field : 16;
  const out = [1, 1, 1];
  const mix = (c, s) => [c * s, c * s * 2, s, c + s, Math.min(c, s), Math.max(c, s)][blend];
  return {
    render(system) {
      const n = system.count;
      if (!n) return;
      if (scale) scale(system, -1, out);
      const p = system.float(0);
      const tint = system.float(6);
      const alpha = system.float(7);
      const alpha2 = system.float(alpha2Field);
      const radius = system.float(3);
      for (let i = 0; i < n; i++) {
        const size = Math.max(0, radius[i]) * radiusScale;
        const intensity = Math.min(Math.max(alpha[i], 0), 1) * Math.min(Math.max(alpha2[i] ?? 1, 0), 1) * alphaScale;
        if (!(size > 0) || !(intensity > 0)) continue;
        const j = i * 3;
        const channel = (k) => Math.min(Math.max(scale ? mix(tint[j + k] || 0, out[k]) : tint[j + k] || 0, 0), 1) * intensity;
        frameLights.push({
          x: p[j + 1] * UNIT,
          y: p[j + 2] * UNIT,
          z: p[j] * UNIT,
          radius: size * UNIT,
          width,
          r: channel(0),
          g: channel(1),
          b: channel(2),
        });
      }
    },
  };
}

export const RENDERERS = {
  C_OP_RenderDeferredLight: (def, system) => deferredLights(def, system),
  C_OP_RenderSprites: (def, system) => (drawn(def) && kept("sprites", def) ? quads(def, system, false) : {}),
  C_OP_RenderTrails: (def, system) => (drawn(def) && kept("trails", def) ? quads(def, system, true) : {}),
  C_OP_RenderRopes: (def, system) => (drawn(def) && !offSnapshot(system) && kept("ropes", def) ? rope(def, system) : {}),
  C_OP_RenderModels: (def, system) => (kept("models", def) ? models(def, system) : {}),
};
