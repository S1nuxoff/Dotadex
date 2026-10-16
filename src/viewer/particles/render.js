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

// The texture a renderer draws, and its sheet of frames
function textureOf(def) {
  return def.m_vecTexturesInput?.[0]?.m_hTexture ?? def.m_hTexture ?? null;
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
    vUv = iFrame.xy + uv * iFrame.zw;
    vColor = iColor;
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
  uniform float uOverbright;
  uniform float uHalf;
  uniform float uMod;
  uniform float uPremultiply;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec4 texel = uHasMap > 0.5 ? texture2D(uMap, vUv) : vec4(1.0);
    float alpha = texel.a * vColor.a;
    if (uMod > 0.5) {
      // Mid grey where the particle is see-through, so it leaves what is behind as it is
      vec3 mod2x = mix(vec3(0.5), texel.rgb * vColor.rgb, clamp(alpha, 0.0, 1.0));
      if (any(isnan(mod2x))) discard;
      gl_FragColor = vec4(clamp(mod2x, 0.0, 1.0), 1.0);
      return;
    }
    vec4 color = vec4(texel.rgb * vColor.rgb * uOverbright * uHalf, alpha);
    // Kept finite and within what the bloom can take: an infinite or broken value spreads into
    // black squares through the bloom's blur on graphics cards
    if (any(isnan(color)) || color.a < 0.002) discard;
    vec3 rgb = clamp(color.rgb, 0.0, 8.0);
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
      uOverbright: { value: num(def.m_flOverbrightFactor, 1) },
      uHalf: { value: 1 },
      uMod: { value: 0 },
      uPremultiply: { value: 0 },
      uOrientation: { value: orientation },
      uCameraBias: { value: num(def.VisibilityInputs?.m_flCameraBias, 0) * UNIT },
      uScreenSize: {
        value: new THREE.Vector4(num(def.m_flMinSize, 0), num(def.m_flMaxSize, 5000), num(def.m_flStartFadeSize, 1e8), num(def.m_flEndFadeSize, 2e8)),
      },
    },
    transparent: true,
    depthWrite: false,
    depthTest: !def.m_bDisableZBuffering,
  });
  blendingOf(def, result);
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
  const texture = textureOf(def);
  if (texture) {
    system.host.loadTexture(texture).then((loaded) => {
      if (!loaded) return;
      sheet = loaded.sheet;
      mat.uniforms.uMap.value = loaded.texture;
      mat.uniforms.uHasMap.value = 1;
    });
  }
  const radiusScale = num(def.m_flRadiusScale, 1) * UNIT;
  const alphaScale = num(def.m_flAlphaScale, 1);
  const sequenceOverride = def.m_nSequenceOverride ?? -1;
  const maxLength = num(def.m_flMaxLength, 2000) * UNIT;
  const minLength = num(def.m_flMinLength, 0) * UNIT;
  const lengthScale = num(def.m_flLengthScale, 1);

  return {
    object: mesh,
    render(system) {
      const n = system.count;
      mesh.visible = n > 0 && (!texture || sheet !== null);
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
          const speedScale = (trailLength[i] / (1 / 60)) * lengthScale;
          let vx = (p[j + 1] - q[j + 1]) * UNIT * speedScale;
          let vy = (p[j + 2] - q[j + 2]) * UNIT * speedScale;
          let vz = (p[j] - q[j]) * UNIT * speedScale;
          const length = Math.hypot(vx, vy, vz);
          const clamped = Math.min(Math.max(length, minLength), maxLength);
          const k = length > 1e-9 ? clamped / length : 0;
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
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vUv = uv;
    vColor = color;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// A ribbon through the particles in the order they were made, as wide as each is
function rope(def, system) {
  const max = system.maxParticles;
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
  const texture = textureOf(def);
  if (texture) {
    system.host.loadTexture(texture).then((loaded) => {
      if (!loaded) return;
      sheet = loaded.sheet;
      loaded.texture.wrapS = loaded.texture.wrapT = THREE.RepeatWrapping;
      mat.uniforms.uMap.value = loaded.texture;
      mat.uniforms.uHasMap.value = 1;
    });
  }
  const radiusScale = num(def.m_flRadiusScale, 1) * UNIT;
  const alphaScale = num(def.m_flAlphaScale, 1);
  const worldSize = num(def.m_flTextureVWorldSize, 10) || 10;
  const scroll = num(def.m_flTextureVScrollRate, 0);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();

  return {
    object: mesh,
    render(system, camera) {
      const n = system.count;
      mesh.visible = n > 1 && (!texture || sheet !== null);
      if (!mesh.visible) return;
      const p = system.float(0);
      const tint = system.float(6);
      const alpha = system.float(7);
      const alpha2 = system.float(16);
      const radius = system.float(3);
      let distance = 0;
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        a.set(p[j + 1] * UNIT, p[j + 2] * UNIT, p[j] * UNIT);
        const k = Math.min(i + 1, n - 1);
        const h = Math.max(i - 1, 0);
        tangent.set(p[k * 3 + 1] - p[h * 3 + 1], p[k * 3 + 2] - p[h * 3 + 2], p[k * 3] - p[h * 3]).normalize();
        toCamera.subVectors(camera.position, a).normalize();
        side.crossVectors(tangent, toCamera).normalize().multiplyScalar(Math.max(0, radius[i]) * radiusScale);
        if (i > 0) distance += a.distanceTo(b);
        b.copy(a);
        const v = distance / (worldSize * UNIT) + system.age * scroll * 0.01;
        for (let s = 0; s < 2; s++) {
          const o = (i * 2 + s) * 3;
          const sign = s === 0 ? 1 : -1;
          positions.array[o] = a.x + side.x * sign;
          positions.array[o + 1] = a.y + side.y * sign;
          positions.array[o + 2] = a.z + side.z * sign;
          uvs.array[(i * 2 + s) * 2] = s;
          uvs.array[(i * 2 + s) * 2 + 1] = v;
          const c = (i * 2 + s) * 4;
          colors.array[c] = Math.min(Math.max(tint[j] || 0, 0), 4);
          colors.array[c + 1] = Math.min(Math.max(tint[j + 1] || 0, 0), 4);
          colors.array[c + 2] = Math.min(Math.max(tint[j + 2] || 0, 0), 4);
          colors.array[c + 3] = Math.min(Math.max(alpha[i], 0), 1) * Math.min(Math.max(alpha2[i], 0), 1) * alphaScale;
        }
      }
      geometry.setDrawRange(0, (n - 1) * 6);
      for (const value of [positions, uvs, colors]) {
        value.addUpdateRange(0, n * 2 * value.itemSize);
        value.needsUpdate = true;
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

export const RENDERERS = {
  C_OP_RenderSprites: (def, system) => (kept("sprites", def) ? quads(def, system, false) : {}),
  C_OP_RenderTrails: (def, system) => (kept("trails", def) ? quads(def, system, true) : {}),
  C_OP_RenderRopes: (def, system) => (kept("ropes", def) ? rope(def, system) : {}),
};
