import * as THREE from "three";

// The site's mark, carved into the pedestal under the hero. It is drawn over the pedestal
// rather than as stone of its own, so it suits whatever pedestal the game gives: the bottom
// of the carving in shade, and its walls lit or shaded by a light from the upper left.

const WATERMARK = `${import.meta.env.BASE_URL}stage/watermark.png`;

const carvingShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = uv;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uShape;
    uniform vec2 uTexel;
    uniform float uDepth;
    uniform float uRim;
    uniform vec2 uFogDirection;
    uniform float uFogNear;
    uniform float uFogFar;
    uniform float uFogInner;
    uniform float uFogOuter;
    varying vec2 vUv;
    varying vec3 vWorld;
    void main() {
      float inside = texture2D(uShape, vUv).r;
      // The slope into the carving, and how its walls face the light: in a pit, the wall
      // whose slope points toward the light faces it
      vec2 step = uTexel * 2.0;
      vec2 slope = vec2(
        texture2D(uShape, vUv + vec2(step.x, 0.0)).r - texture2D(uShape, vUv - vec2(step.x, 0.0)).r,
        texture2D(uShape, vUv + vec2(0.0, step.y)).r - texture2D(uShape, vUv - vec2(0.0, step.y)).r
      );
      float lit = clamp(dot(slope, normalize(vec2(-0.6, 0.8))) * 3.0, -1.0, 1.0);
      float light = max(lit, 0.0);
      float shade = max(-lit, 0.0);
      // Black over the pedestal for the shade, a pale stone color for the lit walls
      vec3 color = vec3(0.32, 0.29, 0.26) * light;
      float alpha = clamp(inside * uDepth + shade * 0.6, 0.0, 1.0);
      alpha = max(alpha, light * uRim);
      // Fading into the dark behind the hero with the pedestal itself
      alpha *= 1.0 - smoothstep(uFogNear, uFogFar, dot(vWorld.xz, uFogDirection));
      alpha *= 1.0 - smoothstep(uFogInner, uFogOuter, length(vWorld.xz));
      gl_FragColor = vec4(color, alpha);
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
  // Softened a little, so the walls slope
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#000";
  context.fillRect(0, 0, width, height);
  context.filter = "blur(3px)";
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
        uDepth: { value: 0.55 },
        uRim: { value: 0.35 },
        uFogDirection: fog.direction,
        uFogNear: fog.near,
        uFogFar: fog.far,
        uFogInner: fog.inner,
        uFogOuter: fog.outer,
      },
    })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1;
  mesh.userData.skipGlow = true;
  mesh.userData.aspect = loaded.aspect;
  // The same in either shading, which swaps the pedestal's materials for these
  mesh.userData.dota = mesh.userData.pbr = mesh.material;
  return mesh;
}
