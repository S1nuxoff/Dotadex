import * as THREE from "three";
import { stageTint } from "./effects.js";

// The site's mark, carved in a ring into the pedestal round the hero's feet, the logo repeated
// all the way round, its letters' tops toward the center so the near side reads upright. It is drawn over the pedestal
// rather than as stone of its own, so it suits whatever pedestal the game gives. The carving is
// traced for real in the shader (parallax occlusion): from each point the view ray goes down
// into the letters until it meets a wall or the floor, so from any side it reads as sunk in,
// with the near walls hidden under the edge and the far ones in view. The light is the scene's.

const WATERMARK = `${import.meta.env.BASE_URL}stage/watermark.png`;

const carvingShader = {
  vertexShader: /* glsl */ `
    varying vec2 vPos;
    varying vec3 vWorld;
    varying vec3 vRay;
    void main() {
      vPos = position.xy;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      // From the camera to this point, in the card's own space (its z is up out of the ground)
      vRay = position - (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uShape;
    uniform vec2 uTexel;
    // The ring, in the card's space where its outer edge is at 1: the letters' height, how many
    // times the logo goes round, and the gap after each, as a share of the logo's width
    uniform float uBand;
    uniform float uRepeat;
    uniform float uGap;
    // Toward the light, in the card's own space (set each frame by the stage)
    uniform vec3 uLight;
    // How deep the carving goes, in texels of the logo
    uniform float uDepth;
    // A soft glow from the bottom of the carving, in the hero's color
    uniform vec3 uGlowColor;
    uniform float uGlow;
    uniform vec2 uFogDirection;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform float uFogInner;
    uniform float uFogOuter;
    varying vec2 vPos;
    varying vec3 vWorld;
    varying vec3 vRay;

    // Whether a point of the card lies in a letter: round the ring, a copy of the logo centered
    // in front (toward -y). Read without mipmaps: it is read inside loops, where a level can't be picked
    float inside(vec2 p) {
      float v = (1.0 - length(p)) / uBand;
      if (v <= 0.0 || v >= 1.0) {
        return 0.0;
      }
      float turn = (atan(p.y, p.x) + 1.5707963) / 6.2831853;
      float u = (fract(turn * uRepeat + 0.5) - 0.5) * (1.0 + uGap) + 0.5;
      if (u <= 0.0 || u >= 1.0) {
        return 0.0;
      }
      return textureLod(uShape, vec2(u, v), 0.0).r;
    }

    void main() {
      float edge = inside(vPos);
      if (edge < 0.01) {
        discard;
      }
      // One texel of the logo, in the card's space
      float texel = uBand * uTexel.y;
      float depth = uDepth * texel;
      vec3 ray = normalize(vRay);
      ray.z = min(ray.z, -0.05);
      // Down the view ray until it leaves the letter (a wall) or reaches the floor
      // (Looking along the ground the ray is cut short: it meets a wall long before anyway)
      vec2 slide = ray.xy / -ray.z;
      slide *= min(1.0, 6.0 / max(length(slide), 1e-4));
      vec2 across = slide * depth;
      const int STEPS = 48;
      vec2 uv = vPos;
      bool wall = false;
      float reached = 1.0;
      for (int i = 1; i <= STEPS; i++) {
        float f = float(i) / float(STEPS);
        vec2 at = vPos + across * f;
        if (inside(at) < 0.5) {
          wall = true;
          reached = f;
          break;
        }
        uv = at;
      }
      vec3 light = normalize(uLight);
      // How bright the surface is against the pedestal's top around it, which faces up
      float top = max(light.z, 0.15);
      float bright;
      float glow = 1.0;
      if (wall) {
        // Lit from below: only the foot of the wall catches the light
        glow = pow(reached, 5.0) * 0.8;
        // The wall faces into the letter
        float s = texel * 2.0;
        vec2 slope = vec2(inside(uv + vec2(s, 0.0)) - inside(uv - vec2(s, 0.0)), inside(uv + vec2(0.0, s)) - inside(uv - vec2(0.0, s)));
        vec3 normal = length(slope) > 0.0 ? vec3(normalize(slope), 0.0) : vec3(0.0, 0.0, 1.0);
        bright = max(dot(normal, light), 0.0) / top;
        // Darker down the wall, toward the floor
        bright *= mix(0.9, 0.55, reached);
      } else {
        // The floor, in the shadow of the wall between it and the light
        vec2 up = light.xy / max(light.z, 0.05) * depth;
        float lit = 1.0;
        for (int i = 1; i <= 24; i++) {
          if (inside(uv + up * (float(i) / 24.0)) < 0.5) {
            lit = 0.0;
            break;
          }
        }
        bright = mix(0.18, 0.5, lit);
      }
      // Darkened or lightened stone over the pedestal
      vec3 color = bright > 1.0 ? vec3(0.35, 0.32, 0.29) : vec3(0.0);
      float alpha = bright > 1.0 ? min((bright - 1.0) * 0.5, 0.4) : 1.0 - bright;
      // Fading into the dark behind the hero with the pedestal itself
      float fog = 1.0 - smoothstep(uFogNear, uFogFar, dot(vWorld.xz, uFogDirection));
      fog *= 1.0 - smoothstep(uFogInner, uFogOuter, length(vWorld.xz));
      float fade = smoothstep(0.01, 0.5, edge) * fog;
      alpha *= fade;
      #ifdef GLOW_PASS
        // Drawn again in the stage's halo pass: only the light, which the pass blurs into a
        // halo and adds over the frame
        // A light shines through the dark the stone sinks into: the fog takes only half of it.
        // Its core runs hot, toward white, the halo keeps the hero's color
        vec3 hot = mix(uGlowColor, vec3(1.0), 0.35);
        gl_FragColor = vec4(hot * uGlow * glow * smoothstep(0.01, 0.5, edge) * mix(1.0, fog, 0.5), 1.0);
      #else
        gl_FragColor = vec4(color, alpha);
      #endif
      #include <colorspace_fragment>
    }
  `,
};

// The logo's shape (from its alpha) in white on black, in the logo's proportions with room
// around it for the softened edges
async function shapeTexture() {
  const image = await new THREE.ImageLoader().loadAsync(WATERMARK).catch(() => null);
  if (!image) {
    return null;
  }
  const pad = 32;
  const width = 2048;
  const w = width - pad * 2;
  const h = Math.round((w * image.height) / image.width);
  const height = h + pad * 2;
  const shape = document.createElement("canvas");
  shape.width = width;
  shape.height = height;
  const shapeContext = shape.getContext("2d");
  shapeContext.drawImage(image, pad, pad, w, h);
  shapeContext.globalCompositeOperation = "source-in";
  shapeContext.fillStyle = "#fff";
  shapeContext.fillRect(0, 0, width, height);
  // White on black, with crisp edges
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  context.drawImage(shape, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  return { texture, aspect: width / height, texel: new THREE.Vector2(1 / width, 1 / height) };
}

let shape = null;

// A flat round card of the mark, its ring's outer edge at 1 and its letters band high (a share of
// that); fog: the pedestal's fog uniforms
export async function createWatermark(fog, band) {
  shape ??= shapeTexture();
  const loaded = await shape;
  if (!loaded) {
    return null;
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      ...carvingShader,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      uniforms: {
        uShape: { value: loaded.texture },
        uTexel: { value: loaded.texel },
        uBand: { value: band },
        uRepeat: { value: 1 },
        uGap: { value: 0 },
        uLight: { value: new THREE.Vector3(0.4, -0.5, 0.75) },
        uDepth: { value: 70 },
        uGlowColor: stageTint,
        uGlow: { value: 1.1 },
        uFogDirection: fog.direction,
        uFogNear: fog.near,
        uFogFar: fog.far,
        uFogInner: fog.inner,
        uFogOuter: fog.outer,
      },
    })
  );
  // Its light alone, for the stage's halo pass
  mesh.userData.glowMaterial = new THREE.ShaderMaterial({
    ...carvingShader,
    defines: { GLOW_PASS: "" },
    uniforms: mesh.material.uniforms,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  // As many logos round the ring as fit at their own proportions, with a gap of at least a
  // quarter of one after each, the rest shared out among the gaps
  const round = 2 * Math.PI * (1 - band / 2);
  const logo = loaded.aspect * band;
  const repeat = Math.max(1, Math.floor(round / (logo * 1.25)));
  mesh.material.uniforms.uRepeat.value = repeat;
  mesh.material.uniforms.uGap.value = round / repeat / logo - 1;
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  mesh.userData.watermark = true;
  // The same in either shading, which swaps the pedestal's materials for these
  mesh.userData.dota = mesh.userData.pbr = mesh.material;
  return mesh;
}
