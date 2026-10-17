import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { stageTint } from "./effects.js";

// Stony ground the model stands on, from the game's own rock props: Dota's river rocks and
// ground stones around it, on a ground of their stone texture that fades into the dark.
// A light from above casts the model's and the rocks' shadows, and a light in the model's
// color lights the stones around it.

const ROCKS = `${import.meta.env.BASE_URL}stage/`;

// Where the rocks lie, in units of the model's footprint radius: [file, angle°, distance, size, turn°]
const LAYOUT = [
  ["riveredge_rock009a", 200, 2.1, 0.75, 20],
  ["riveredge_rock005a", 235, 2.6, 0.95, 140],
  ["riveredge_rock001a", 160, 2.4, 0.6, 260],
  ["riveredge_rock010a", 300, 2.9, 1.1, 80],
  ["riveredge_rock003a", 40, 2.5, 0.65, 310],
  ["riveredge_rock007a", 120, 2.2, 0.5, 30],
  ["riveredge_rocks_small001", 260, 1.45, 0.6, 60],
  ["riveredge_rocks_small002", 20, 1.5, 0.6, 170],
  ["riveredge_rocks_small001", 140, 1.6, 0.5, 300],
];

// Fires around the model, each a prop of the game with a flame on it and a light that
// flickers: [file, angle°, distance, size, turn°, flame size, light strength]
const FIRES = [
  ["cf_palace_brazier", 215, 2.0, 0.55, 30, 0.55, 1],
  ["lantern002", 330, 1.85, 0.32, 200, 0.22, 0.55],
  ["candles001", 105, 1.45, 0.38, 70, 0.12, 0.35],
];

// A flame on a camera-facing card: a tongue of fire rising and flickering, added to the light
const flameShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      // Turned to the camera, standing upright
      vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      vec2 scale = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
      gl_Position = projectionMatrix * (center + vec4(position.xy * scale, 0.0, 0.0));
    }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform float uSeed;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    void main() {
      vec2 p = vUv - vec2(0.5, 0.1);
      float t = uTime * 2.2 + uSeed * 10.0;
      // Rising turbulence bends the tongue
      float n = noise(vec2(p.x * 4.0, p.y * 3.0 - t)) * 0.6 + noise(vec2(p.x * 9.0, p.y * 7.0 - t * 1.7)) * 0.4;
      float width = 0.32 * (1.0 - p.y * 1.1) + 0.02;
      float body = smoothstep(width, width * 0.2, abs(p.x + (n - 0.5) * 0.18 * p.y * 2.0));
      body *= smoothstep(0.0, 0.08, p.y + 0.1) * smoothstep(1.0, 0.25, p.y + n * 0.25);
      vec3 hot = vec3(1.0, 0.95, 0.75);
      vec3 warm = vec3(1.0, 0.55, 0.15);
      vec3 deep = vec3(0.8, 0.2, 0.05);
      vec3 color = mix(deep, mix(warm, hot, smoothstep(0.5, 0.95, body)), smoothstep(0.1, 0.6, body));
      gl_FragColor = vec4(color * body * 1.6, 0.0);
    }
  `,
};

const loader = new GLTFLoader();
const models = new Map();
function loadRock(name) {
  if (!models.has(name)) {
    models.set(name, loader.loadAsync(`${ROCKS}${name}.glb`).catch(() => null));
  }
  return models.get(name);
}

// A radial fade for the ground's edge
function fadeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  // A long, eased fade, so the ground melts into the background with no visible edge
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const fade = t < 0.3 ? 1 : Math.pow(1 - (t - 0.3) / 0.7, 2.2);
    const v = Math.round(fade * 255);
    gradient.addColorStop(t, `rgb(${v},${v},${v})`);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

export class RockStage {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(1, 96),
      new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 1, metalness: 0, transparent: true, alphaMap: fadeTexture(), depthWrite: false })
    );
    // Far from the camera the ground turns see-through rather than taking a fog color, so the
    // page's background shows through it whatever its color there, and there is no seam
    this.viewFade = { near: { value: 1 }, far: { value: 2 } };
    this.ground.material.onBeforeCompile = (shader) => {
      shader.uniforms.uFadeNear = this.viewFade.near;
      shader.uniforms.uFadeFar = this.viewFade.far;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>
        uniform float uFadeNear;
        uniform float uFadeFar;`)
        .replace(
          "#include <alphamap_fragment>",
          `#include <alphamap_fragment>
          diffuseColor.a *= 1.0 - smoothstep( uFadeNear, uFadeFar, length( vViewPosition ) );`
        );
    };
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.ground.renderOrder = -1;
    this.group.add(this.ground);

    this.rocks = new THREE.Group();
    this.group.add(this.rocks);

    // From above and in front on the left; only the rocks, the ground and plain models take it
    this.sun = new THREE.DirectionalLight(0xdfe6f2, 4.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.6;
    this.group.add(this.sun, this.sun.target);

    // Falls off slowly, so it reaches the rocks around the model
    this.glow = new THREE.PointLight(0xffffff, 0, 0, 1);
    this.group.add(this.glow);
    // From behind in the model's color, outlining the stones
    this.back = new THREE.DirectionalLight(0xffffff, 1.6);
    this.group.add(this.back, this.back.target);
    // Fog in the page's own background color: the far ground ends in exactly that color, so
    // there is no line where it meets the background
    this.fog = new THREE.Fog(0x131b26, 1, 2);
    this.fires = [];
    this.firesGroup = new THREE.Group();
    this.group.add(this.firesGroup);
    this.ready = this.build();
  }

  // The props with fires: each gets its flame card on top and a flickering light in it
  async buildFires() {
    const loaded = await Promise.all(FIRES.map(([name]) => loadRock(name)));
    FIRES.forEach(([, angle, distance, size, turn, flameSize, strength], index) => {
      const gltf = loaded[index];
      if (!gltf) {
        return;
      }
      const prop = gltf.scene.clone();
      const box = new THREE.Box3().setFromObject(prop);
      const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, box.max.y - box.min.y) || 1;
      const holder = new THREE.Group();
      prop.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      holder.add(prop);
      holder.scale.setScalar(size / span);
      const a = THREE.MathUtils.degToRad(angle);
      holder.position.set(Math.cos(a) * distance, 0, Math.sin(a) * distance);
      holder.rotation.y = THREE.MathUtils.degToRad(turn);
      prop.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
          const material = node.material.clone();
          material.emissiveMap = null;
          material.emissive?.set(0x000000);
          material.envMapIntensity = 0.12;
          node.material = material;
        }
      });
      // The flame and the light sit on top of the prop, in units of the stage
      const top = new THREE.Vector3(holder.position.x, (box.max.y - box.min.y) * (size / span) * 0.92, holder.position.z);
      const flame = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1.6).translate(0, 0.65, 0),
        new THREE.ShaderMaterial({
          ...flameShader,
          transparent: true,
          depthWrite: false,
          blending: THREE.CustomBlending,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneFactor,
          blendSrcAlpha: THREE.ZeroFactor,
          blendDstAlpha: THREE.OneFactor,
          uniforms: { uTime: { value: 0 }, uSeed: { value: index * 1.7 } },
        })
      );
      flame.position.copy(top);
      flame.scale.setScalar(flameSize);
      flame.frustumCulled = false;
      flame.userData.skipGlow = true;
      const light = new THREE.PointLight(0xff9a45, 0, 0, 1);
      light.position.copy(top).add(new THREE.Vector3(0, flameSize * 0.6, 0));
      this.firesGroup.add(holder, flame, light);
      this.fires.push({ flame, light, strength, seed: index * 3.1 });
    });
  }

  async build() {
    this.buildFires();
    const loaded = await Promise.all(LAYOUT.map(([name]) => loadRock(name)));
    // The ground takes the stone texture of the ground rocks, repeated
    const groundRock = await loadRock("rock_ground001");
    let stoneMap = null;
    groundRock?.scene.traverse((node) => {
      if (node.isMesh && node.material.map && !stoneMap) {
        stoneMap = node.material.map.clone();
      }
    });
    if (stoneMap) {
      stoneMap.wrapS = stoneMap.wrapT = THREE.RepeatWrapping;
      stoneMap.repeat.set(5, 5);
      stoneMap.needsUpdate = true;
      this.ground.material.map = stoneMap;
      this.ground.material.bumpMap = stoneMap;
      this.ground.material.bumpScale = 5;
      this.ground.material.color.set(0x3c3e44);
      this.ground.material.needsUpdate = true;
    }

    LAYOUT.forEach(([, angle, distance, size, turn], index) => {
      const gltf = loaded[index];
      if (!gltf) {
        return;
      }
      const rock = gltf.scene.clone();
      // Each prop brought to a unit size, then sized by the layout
      const box = new THREE.Box3().setFromObject(rock);
      const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) || 1;
      const holder = new THREE.Group();
      rock.position.set(-(box.min.x + box.max.x) / 2, -box.min.y - (box.max.y - box.min.y) * 0.15, -(box.min.z + box.max.z) / 2);
      holder.add(rock);
      holder.scale.setScalar(size / span);
      const a = THREE.MathUtils.degToRad(angle);
      holder.position.set(Math.cos(a) * distance, 0, Math.sin(a) * distance);
      holder.rotation.y = THREE.MathUtils.degToRad(turn);
      rock.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
          node.userData.stage = true;
          // Lit by the stage's sun rather than the room around: matte stone, no glow
          const material = node.material.clone();
          material.emissiveMap = null;
          material.emissive?.set(0x000000);
          material.roughness = 0.95;
          material.metalness = 0;
          material.envMapIntensity = 0.12;
          material.color?.multiplyScalar(0.85);
          // No normal map in the game files: the relief comes from the painted texture,
          // light cracks standing out and dark ones sunk in
          if (material.map) {
            material.bumpMap = material.map;
            material.bumpScale = 6;
          }
          node.material = material;
        }
      });
      this.rocks.add(holder);
    });
  }

  // center: the model's footprint center on the ground, radius: footprint radius, height: model height
  // view: how far the camera stands, so the ground always reaches past the fog, whatever
  // the model's shape
  place(center, radius, height, view) {
    this.group.position.copy(center);
    this.ground.scale.setScalar(Math.max(radius * 6, view * 3));
    this.rocks.scale.setScalar(radius);
    this.firesGroup.scale.setScalar(radius);
    this.fireBase = radius * 4;
    for (const fire of this.fires) {
      fire.light.distance = radius * 4;
    }
    // From the upper left and a little behind, so the rocks show their faces and cast shadows forward
    this.sun.position.set(-radius * 3.5, height * 2.6, -radius * 0.8);
    this.sun.target.position.set(0, 0, 0);
    const camera = this.sun.shadow.camera;
    Object.assign(camera, { left: -radius * 4, right: radius * 4, top: radius * 4, bottom: -radius * 4, near: 1, far: height * 8 + radius * 8 });
    camera.updateProjectionMatrix();
    this.back.position.set(radius * 1.5, height * 1.2, -radius * 4);
    this.glow.position.set(0, height * 0.45, 0);
    this.glow.distance = radius * 6;
    this.glowBase = radius * 6;
    this.glow.intensity = this.glowBase * (this.glowStrength ?? 1);
  }

  // Glowing models light the stones around them more
  setGlowStrength(strength) {
    this.glowStrength = strength;
    this.glow.intensity = (this.glowBase ?? 0) * strength;
  }

  update(delta = 0.016) {
    this.time = (this.time ?? 0) + delta;
    // Fires flicker: two waves and a little noise on each light
    for (const fire of this.fires) {
      const t = this.time * 7 + fire.seed;
      const flicker = 0.82 + Math.sin(t) * 0.07 + Math.sin(t * 2.3 + 1.7) * 0.06 + (Math.random() - 0.5) * 0.06;
      fire.light.intensity = (this.fireBase ?? 0) * fire.strength * flicker;
      fire.light.distance = (this.fireBase ?? 0);
      fire.flame.material.uniforms.uTime.value = this.time;
    }
    this.glow.color.copy(stageTint.value);
    // A model coming in flares up its light for a moment
    this.glow.intensity = (this.glowBase ?? 0) * (this.glowStrength ?? 1) * (1 + (this.flash ?? 0) * 3);
    this.back.color.copy(stageTint.value).lerp(new THREE.Color(1, 1, 1), 0.3);
  }
}
