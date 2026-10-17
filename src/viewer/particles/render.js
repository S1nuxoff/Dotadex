// The game's particle renderers drawn with three.js: sprites (facing the camera, lying flat,
// turned round the up axis or along the particle's normal), trails stretched along the
// particle's movement, and ropes through the particles in order. One draw a system, the
// particles' places, sizes, colors and frames written each frame.
import * as THREE from "three";
import { UNIT } from "./math.js";

const toCamera = new THREE.Vector3();

// A number of a renderer's parameters, whatever the file gives: a number, an input's literal
// value, or the default for anything that varies
const num = (value, fallback) => (typeof value === "number" && Number.isFinite(value) ? value : typeof value?.m_flLiteralValue === "number" ? value.m_flLiteralValue : fallback);

// The texture a renderer draws, and its sheet of frames; none where the first layer is a
// gradient in place of a texture (drawn here it would be a square)
function textureOf(def) {
  const layer = def.m_vecTexturesInput?.[0];
  if (layer?.m_bReplaceTextureWithGradient) return null;
  return layer?.m_hTexture ?? def.m_hTexture ?? null;
}

// The first texture's final scale and offset, u and v: (scale u, scale v, offset u, offset v)
function textureTransformOf(def) {
  const controls = def.m_vecTexturesInput?.[0]?.m_TextureControls ?? {};
  return new THREE.Vector4(num(controls.m_flFinalTextureScaleU, 1), num(controls.m_flFinalTextureScaleV, 1), num(controls.m_flFinalTextureOffsetU, 0), num(controls.m_flFinalTextureOffsetV, 0));
}

// A trail's color and alpha at its tail, as scales of its head's
function tailOf(def) {
  const color = def.m_vecTailColorScale;
  const rgb = Array.isArray(color) ? color : Array.isArray(color?.m_vLiteralValue) ? color.m_vLiteralValue : [1, 1, 1];
  return new THREE.Vector4(rgb[0] ?? 1, rgb[1] ?? 1, rgb[2] ?? 1, num(def.m_flTailAlphaScale, 1));
}

// A layer that recolors the texture: its brightness looked up in a gradient
function lookupOf(def) {
  const layer = (def.m_vecTexturesInput ?? []).find((input) => input.m_nTextureType === "SPRITECARD_TEXTURE_1D_COLOR_LOOKUP" && input.m_bReplaceTextureWithGradient);
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
  const channels = def.m_vecTexturesInput?.[0]?.m_nTextureChannels ?? "";
  const over = mat.uniforms.uMod.value < 0.5 && mat.blendDst === THREE.OneMinusSrcAlphaFactor;
  mat.uniforms.uAlphaFromColor.value = /RGBALPHA/.test(channels) || (loaded.opaque && over) ? 1 : 0;
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
    // Over what is behind as its alpha says, the color already times its alpha
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

// The frame of a particle's sequence at its age, as a uv rectangle of the sheet
function frameOf(sheet, sequenceIndex, age, normalizedAge, def, out, offset) {
  const sequences = sheet?.sequences;
  if (!sequences?.length) {
    out[offset] = 0;
    out[offset + 1] = 0;
    out[offset + 2] = 1;
    out[offset + 3] = 1;
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
  const frame = frames[Math.min(Math.floor(looped * frames.length), frames.length - 1)];
  out[offset] = frame[0] / sheet.width;
  out[offset + 1] = 1 - (frame[1] + frame[3]) / sheet.height;
  out[offset + 2] = frame[2] / sheet.width;
  out[offset + 3] = frame[3] / sheet.height;
}

const SPRITE_VERTEX = /* glsl */ `
  attribute vec3 iPosition;
  attribute vec4 iColor;
  attribute vec4 iFrame;
  attribute vec2 iSizeRoll;
  attribute vec3 iNormal;
  attribute vec3 iVelocity;
  uniform int uOrientation;
  uniform vec4 uScreenSize;
  uniform float uCameraBias;
  uniform vec4 uTexTransform;
  uniform vec4 uTail;
  varying vec2 vUv;
  varying vec4 vColor;
  // Normalized, or a fallback where the vector is nothing (normalize gives NaN there on graphics cards)
  vec3 safeNormalize(vec3 v) {
    float l = length(v);
    return l > 1e-6 ? v / l : vec3(0.0, 1.0, 0.0);
  }
  void main() {
    // Drawn a little towards the camera, so particles inside the model show, as the game does
    vec3 center = iPosition + safeNormalize(cameraPosition - iPosition) * uCameraBias;
    // The texture's own scale and offset (a scale of -1 turns it round), within the frame
    vUv = iFrame.xy + (uv * uTexTransform.xy + uTexTransform.zw) * iFrame.zw;
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
      gl_Position = projectionMatrix * view;
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
      gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
      return;
    }
    gl_Position = projectionMatrix * viewMatrix * vec4(center + right * corner.x + up * corner.y, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
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
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    // The particle's color as the file gives it is in gamma space; the game turns it linear
    // unless the renderer says not to (m_bGammaCorrectVertexColors)
    vec3 tint = uGammaColor > 0.5 ? pow(max(vColor.rgb, 0.0), vec3(2.2)) : vColor.rgb;
    vec4 texel = uHasMap > 0.5 ? texture2D(uMap, vUv) : vec4(1.0);
    float bright = max(texel.r, max(texel.g, texel.b));
    if (uAlphaFromColor > 0.5) texel.a *= bright;
    if (uWhite > 0.5) texel.rgb = vec3(1.0);
    if (uHasLookup > 0.5) texel.rgb = texture2D(uLookup, vec2(clamp(bright, 0.0, 1.0), 0.5)).rgb;
    float alpha = texel.a * vColor.a;
    if (uMod > 0.5) {
      // Mid grey where the particle is see-through, so it leaves what is behind as it is
      vec3 mod2x = mix(vec3(0.5), texel.rgb * tint, clamp(alpha, 0.0, 1.0));
      if (any(isnan(mod2x))) discard;
      gl_FragColor = vec4(clamp(mod2x, 0.0, 1.0), 1.0);
      return;
    }
    vec4 color = vec4(texel.rgb * tint * uOverbright * uHalf, alpha);
    // Kept finite and little above white: the frame's bloom starts at 1.3, and an overbright
    // particle let through spreads into a halo far bigger than the game's
    if (any(isnan(color)) || color.a < 0.002) discard;
    vec3 rgb = clamp(color.rgb, 0.0, 1.5);
    float a = clamp(color.a, 0.0, 1.0);
    gl_FragColor = vec4(uPremultiply > 0.5 ? rgb * a : rgb, a);
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
      uHalf: { value: 1 },
      uMod: { value: 0 },
      uPremultiply: { value: 0 },
      uGammaColor: { value: def.m_bGammaCorrectVertexColors === false ? 0 : 1 },
      uOrientation: { value: orientation },
      uTexTransform: { value: textureTransformOf(def) },
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
  const sizeRoll = attribute("iSizeRoll", 2);
  const normal = attribute("iNormal", 3);
  const velocity = attribute("iVelocity", 3);
  geometry.instanceCount = 0;
  const orientation = trail ? 4 : ORIENTATIONS[def.m_nOrientationType] ?? 0;
  const mat = material(def, SPRITE_VERTEX, orientation);
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
      useTexture(def, mat, loaded);
    });
  }
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
    render(system) {
      const n = system.count;
      mesh.visible = n > 0 && ready;
      geometry.instanceCount = n;
      if (!mesh.visible) return;
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
        frameOf(sheet, sequenceOverride >= 0 ? sequenceOverride : seq[i], system.age - creation[i], system.normalizedAge(i), def, frame.array, i * 4);
      }
      for (const value of [position, color, frame, sizeRoll, normal, velocity]) {
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
  varying vec4 vColor;
  void main() {
    vUv = uv * uTexTransform.xy + uTexTransform.zw;
    vColor = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A ribbon through the particles in the order they were made, as wide as each is
function rope(def, system) {
  // Each stretch between two particles cut into this many, along a smooth curve through them
  const tess = Math.min(Math.max(Math.round(num(def.m_nMinTesselation, 0)), 0), 8);
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
      loaded.texture.wrapS = loaded.texture.wrapT = THREE.RepeatWrapping;
      useTexture(def, mat, loaded);
    });
  }
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
// texture tinted by the particle's color, unlit like the other particles
function models(def, system) {
  const group = new THREE.Group();
  group.visible = false;
  const path = (def.m_ModelList ?? []).find((entry) => entry?.m_model)?.m_model;
  let template = null;
  const pool = [];
  if (path) {
    system.host.loadModel?.(path).then((scene) => {
      template = scene;
    });
  }
  const radiusScale = num(def.m_flRadiusScale, 1);
  const alphaScale = num(def.m_flAlphaScale, 1);
  const instance = () => {
    const object = template.clone(true);
    const materials = [];
    object.traverse((node) => {
      if (!node.isMesh) return;
      const original = node.material;
      node.material = new THREE.MeshBasicMaterial({ map: original.map ?? null, transparent: true, alphaTest: original.alphaTest || 0.5, side: THREE.DoubleSide, depthWrite: true });
      node.frustumCulled = false;
      materials.push(node.material);
    });
    object.userData.materials = materials;
    group.add(object);
    return object;
  };
  return {
    object: group,
    render(system) {
      const n = system.count;
      group.visible = n > 0 && template !== null;
      if (!group.visible) return;
      while (pool.length < n) pool.push(instance());
      const p = system.float(0);
      const tint = system.float(6);
      const alpha = system.float(7);
      const radius = system.float(3);
      const roll = system.float(4);
      const yaw = system.float(12);
      const pitch = system.float(20);
      for (const [i, object] of pool.entries()) {
        object.visible = i < n;
        if (i >= n) continue;
        const j = i * 3;
        object.position.set(p[j + 1] * UNIT, p[j + 2] * UNIT, p[j] * UNIT);
        // The game's turns about its up, left and ahead axes, in the scene's
        object.rotation.set(pitch[i], yaw[i], roll[i], "YXZ");
        object.scale.setScalar(Math.max(0, radius[i]) * radiusScale);
        for (const material of object.userData.materials) {
          material.color.setRGB(Math.min(Math.max(tint[j], 0), 1), Math.min(Math.max(tint[j + 1], 0), 1), Math.min(Math.max(tint[j + 2], 0), 1), THREE.SRGBColorSpace);
          material.opacity = Math.min(Math.max(alpha[i], 0), 1) * alphaScale;
        }
      }
    },
    dispose() {
      for (const object of pool) for (const material of object.userData.materials) material.dispose();
    },
  };
}

export const RENDERERS = {
  C_OP_RenderSprites: (def, system) => (drawn(def) && kept("sprites", def) ? quads(def, system, false) : {}),
  C_OP_RenderTrails: (def, system) => (drawn(def) && kept("trails", def) ? quads(def, system, true) : {}),
  C_OP_RenderRopes: (def, system) => (drawn(def) && !offSnapshot(system) && kept("ropes", def) ? rope(def, system) : {}),
  C_OP_RenderModels: (def, system) => (kept("models", def) ? models(def, system) : {}),
};
