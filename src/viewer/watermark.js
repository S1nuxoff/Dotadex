import * as THREE from "three";
import { stageTint } from "./effects.js";

// The site's mark, carved into the pedestal under the hero. It is drawn over the pedestal
// rather than as stone of its own, so it suits whatever pedestal the game gives. The carving is
// traced for real in the shader (parallax occlusion): from each point the view ray goes down
// into the letters until it meets a wall or the floor, so from any side it reads as sunk in,
// with the near walls hidden under the edge and the far ones in view. The light is the scene's.

const WATERMARK = `${import.meta.env.BASE_URL}stage/watermark.png`;

const carvingShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorld;
    varying vec3 vRay;
    void main() {
      vUv = uv;
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
    uniform float uAspect;
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
    varying vec2 vUv;
    varying vec3 vWorld;
    varying vec3 vRay;

    // Read without mipmaps: it is read inside loops, where a level can't be picked
    float inside(vec2 uv) { return textureLod(uShape, uv, 0.0).r; }

    // The card is uAspect wide and one high: a step in its space as a step in the texture
    vec2 toUv(vec2 step) { return vec2(step.x / uAspect, step.y); }

    void main() {
      float edge = inside(vUv);
      if (edge < 0.01) {
        discard;
      }
      float depth = uDepth * uTexel.y;
      vec3 ray = normalize(vRay);
      ray.z = min(ray.z, -0.05);
      // Down the view ray until it leaves the letter (a wall) or reaches the floor
      // (Looking along the ground the ray is cut short: it meets a wall long before anyway)
      vec2 slide = ray.xy / -ray.z;
      slide *= min(1.0, 6.0 / max(length(slide), 1e-4));
      vec2 across = toUv(slide * depth);
      const int STEPS = 48;
      vec2 uv = vUv;
      bool wall = false;
      float reached = 1.0;
      for (int i = 1; i <= STEPS; i++) {
        float f = float(i) / float(STEPS);
        vec2 at = vUv + across * f;
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
        // Lit from below: brightest at the foot of the wall
        glow = pow(reached, 1.5) * 0.9;
        // The wall faces into the letter
        vec2 s = uTexel * 2.0;
        vec2 slope = vec2(inside(uv + vec2(s.x, 0.0)) - inside(uv - vec2(s.x, 0.0)), inside(uv + vec2(0.0, s.y)) - inside(uv - vec2(0.0, s.y)));
        vec3 normal = length(slope) > 0.0 ? vec3(normalize(slope), 0.0) : vec3(0.0, 0.0, 1.0);
        bright = max(dot(normal, light), 0.0) / top;
        // Darker down the wall, toward the floor
        bright *= mix(0.9, 0.55, reached);
      } else {
        // The floor, in the shadow of the wall between it and the light
        vec2 up = toUv(light.xy / max(light.z, 0.05) * depth);
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
      float fade = smoothstep(0.01, 0.5, edge);
      fade *= 1.0 - smoothstep(uFogNear, uFogFar, dot(vWorld.xz, uFogDirection));
      fade *= 1.0 - smoothstep(uFogInner, uFogOuter, length(vWorld.xz));
      alpha *= fade;
      #ifdef GLOW_PASS
        // Drawn again in the stage's halo pass: only the light, which the pass blurs into a
        // halo and adds over the frame
        gl_FragColor = vec4(uGlowColor * uGlow * glow * fade, 1.0);
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

// A flat card of the mark, one unit high and as wide as the logo; fog: the pedestal's fog uniforms
export async function createWatermark(fog) {
  shape ??= shapeTexture();
  const loaded = await shape;
  if (!loaded) {
    return null;
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(loaded.aspect, 1),
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
        uAspect: { value: loaded.aspect },
        uLight: { value: new THREE.Vector3(0.4, -0.5, 0.75) },
        uDepth: { value: 24 },
        uGlowColor: stageTint,
        uGlow: { value: 0.6 },
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
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  mesh.userData.aspect = loaded.aspect;
  // The same in either shading, which swaps the pedestal's materials for these
  mesh.userData.dota = mesh.userData.pbr = mesh.material;
  return mesh;
}
