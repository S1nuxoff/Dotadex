import * as THREE from "three";


// The showcase around a model: a stone pedestal with an inlaid ring in the rarity
// color, motes drifting up, and a burst of sparks with a
// shockwave on the pedestal when a model appears.

const pedestalShader = {
  vertexShader: /* glsl */ `
    varying vec3 vLocal;
    varying vec3 vNormal;
    void main() {
      vLocal = position;
      vNormal = normal;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uRim;
    uniform float uTime;
    uniform float uWave;
    varying vec3 vLocal;
    varying vec3 vNormal;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }

    void main() {
      float d = length(vLocal.xz);
      float angle = atan(vLocal.z, vLocal.x);
      bool top = vNormal.y > 0.5;

      // Worn stone: radial slabs with seams and grain
      float grain = noise(vLocal.xz * 9.0) * 0.5 + noise(vLocal.xz * 31.0) * 0.25;
      vec3 stone = mix(vec3(0.075, 0.085, 0.1), vec3(0.15, 0.155, 0.165), grain);
      float slab = abs(fract(angle / 6.2831 * 16.0 + floor(d * 3.0) * 0.5) - 0.5);
      float ringSeam = abs(fract(d * 3.0) - 0.5);
      float seam = top ? smoothstep(0.03, 0.0, min(slab * d * 0.7, ringSeam * 0.35)) : 0.0;
      stone *= 1.0 - seam * 0.55;

      // Inlaid ring near the edge, glowing in the rarity color, plus the shockwave
      float inlay = top ? smoothstep(0.025, 0.0, abs(d - 0.86)) : 0.0;
      float pulse = 0.75 + 0.25 * sin(uTime * 1.6);
      float wave = top ? smoothstep(0.06, 0.0, abs(d - uWave)) * max(1.0 - uWave, 0.0) : 0.0;
      vec3 glow = uRim * (inlay * pulse * 1.6 + wave * 2.5);

      // Side faces darker, a little lit from the top edge
      float side = top ? 1.0 : 0.55 + 0.25 * smoothstep(-0.5, 0.0, vLocal.y);
      // Light falls off towards the rim, like a spotlight from above
      float spot = top ? mix(1.25, 0.55, smoothstep(0.0, 1.0, d)) : 1.0;
      gl_FragColor = vec4(stone * side * spot + glow, 1.0);
      #include <colorspace_fragment>
    }
  `,
};

const motesShader = {
  vertexShader: /* glsl */ `
    attribute float aSeed;
    uniform float uTime;
    uniform float uHeight;
    uniform float uRadius;
    uniform float uSize;
    varying float vAlpha;
    varying float vWarm;
    varying float vCore;
    void main() {
      float speed = 0.05 + fract(aSeed * 7.13) * 0.07;
      float rise = fract(fract(aSeed * 3.71) + uTime * speed);
      // Embers spiral up around the model and drift outwards as they rise
      float turn = (fract(aSeed * 5.3) - 0.5) * 2.0;
      float angle = aSeed * 6.2831 * 13.0 + uTime * 0.25 * turn + rise * 2.5 * turn;
      float r = uRadius * (0.3 + 0.7 * sqrt(fract(aSeed * 11.7))) * (0.85 + rise * 0.35);
      float sway = sin(uTime * 1.3 + aSeed * 50.0) * uRadius * 0.03;
      vec3 p = vec3(cos(angle) * r + sway, rise * uHeight, sin(angle) * r);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      float big = step(0.93, fract(aSeed * 31.0));
      gl_PointSize = uSize * (0.5 + fract(aSeed * 17.0) * 0.8 + big * 1.4) / -mv.z;
      float twinkle = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(uTime * (2.0 + fract(aSeed * 9.0) * 4.0) + aSeed * 40.0), 2.0);
      vAlpha = smoothstep(0.0, 0.12, rise) * smoothstep(1.0, 0.55, rise) * twinkle;
      vWarm = fract(aSeed * 23.0);
      vCore = 1.0 - big * 0.6;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uTint;
    varying float vAlpha;
    varying float vWarm;
    varying float vCore;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      // A hot core in a soft halo
      float halo = exp(-d * d * 5.0);
      float core = exp(-d * d * 40.0) * vCore;
      float a = (halo * 0.55 + core) * vAlpha;
      vec3 color = mix(uTint, vec3(1.0, 0.9, 0.75), vWarm * 0.15);
      color = mix(color, vec3(1.0, 0.97, 0.9), core * 0.55);
      gl_FragColor = vec4(color * a * 1.6, a);
    }
  `,
};

// Soft drifting smoke on the floor around the pedestal
const smokeShader = {
  vertexShader: /* glsl */ `
    attribute float aSeed;
    uniform float uTime;
    uniform float uRadius;
    uniform float uSize;
    varying float vSeed;
    varying float vAlpha;
    void main() {
      vSeed = aSeed;
      // Puffs circle the pedestal slowly, breathe in and out and rise a little
      float angle = aSeed * 6.2831 * 7.0 + uTime * (0.06 + fract(aSeed * 3.1) * 0.08) * (fract(aSeed * 7.7) > 0.5 ? 1.0 : -1.0);
      float r = uRadius * (0.75 + fract(aSeed * 13.3) * 0.75 + 0.12 * sin(uTime * 0.35 + aSeed * 12.0));
      float lift = fract(aSeed * 5.7) * 0.18 + 0.08 * sin(uTime * 0.45 + aSeed * 20.0);
      vec3 p = vec3(cos(angle) * r, lift * uRadius, sin(angle) * r);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * (0.8 + fract(aSeed * 19.0) * 0.7) / -mv.z;
      vAlpha = 0.5 + 0.5 * sin(uTime * 0.6 + aSeed * 30.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uTint;
    uniform float uTime;
    varying float vSeed;
    varying float vAlpha;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
    }
    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float d = length(uv) * 2.0;
      // Billowing: noise turning slowly inside a soft round puff
      float c = cos(uTime * 0.25 + vSeed * 6.0), s = sin(uTime * 0.25 + vSeed * 6.0);
      vec2 q = mat2(c, -s, s, c) * uv * 2.5 + vSeed * 10.0;
      // Soft billows that keep changing
      float n = noise(q + uTime * 0.15) * 0.5 + noise(q * 2.1 - uTime * 0.2) * 0.3 + noise(q * 4.3 + uTime * 0.3) * 0.2;
      float a = smoothstep(1.0, 0.0, d) * smoothstep(0.2, 0.7, n) * 0.2 * (0.55 + 0.45 * vAlpha);
      // Darker than the model, so it sits behind and below it
      vec3 color = uTint * 0.55;
      gl_FragColor = vec4(color, a * 0.8);
    }
  `,
};

// A pool of light on the pedestal under the model
const poolShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uRim;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      float d = length(vUv - 0.5) * 2.0;
      float a = exp(-d * d * 3.5) * (0.85 + 0.15 * sin(uTime * 1.2)) * smoothstep(1.0, 0.85, d);
      vec3 color = mix(vec3(1.0, 0.95, 0.88), uRim, 0.45);
      gl_FragColor = vec4(color * a * 0.35, 0.0);
    }
  `,
};

const sparksShader = {
  vertexShader: /* glsl */ `
    attribute vec3 aVelocity;
    attribute float aSeed;
    uniform float uAge;
    uniform float uSize;
    varying float vAlpha;
    void main() {
      float life = 0.7 + aSeed * 0.9;
      float t = clamp(uAge / life, 0.0, 1.0);
      // Fast out, slowing down, drifting up as they cool
      float travel = 1.0 - pow(1.0 - t, 3.0);
      vec3 p = position + aVelocity * travel + vec3(0.0, t * t * 0.35, 0.0) * length(aVelocity);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize * (1.0 - t * 0.6) / -mv.z;
      vAlpha = (1.0 - t) * step(uAge, life);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uRim;
    varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float a = smoothstep(0.5, 0.05, d) * vAlpha;
      vec3 color = mix(uRim, vec3(1.0), smoothstep(0.25, 0.0, d) * 0.7);
      gl_FragColor = vec4(color * a, a);
    }
  `,
};

const MOTES = 180;
const SMOKE = 28;
const SPARKS = 110;

// The main color of the model on show, from its textures: smoke, haze and embers take it
export const stageTint = { value: new THREE.Color("#8fa6c8") };

// Haze drifting behind everything, over the whole view, in the model's color
const hazeShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      // Fills the screen, at the far end of the depth range
      gl_Position = vec4(position.xy, 0.9999, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uTint;
    uniform float uTime;
    uniform float uAspect;
    uniform vec2 uView;
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
      // Slides with the camera's turn, as far-off haze round the stage would
      vec2 p = vec2(vUv.x * uAspect, vUv.y) * 2.2 + uView;
      // Two layers drifting in different directions, warped by each other
      float a = fbm(p + vec2(uTime * 0.025, uTime * 0.01));
      float b = fbm(p * 1.6 + vec2(-uTime * 0.04, uTime * 0.015) + a * 1.5);
      float fog = smoothstep(0.35, 0.85, b);
      // Thicker low down and towards the sides, clear above the model's head
      float shape = mix(1.0, 0.45, smoothstep(0.15, 0.85, vUv.y));
      gl_FragColor = vec4(uTint * 0.45, fog * shape * 0.11);
    }
  `,
};

export class StageEffects {
  constructor(scene, reducedMotion) {
    this.reducedMotion = reducedMotion;
    this.time = 0;
    this.age = Infinity;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.pedestalMaterial = new THREE.ShaderMaterial({
      ...pedestalShader,
      uniforms: { uRim: stageTint, uTime: { value: 0 }, uWave: { value: 2 } },
    });
    // Unit size, scaled to the model: radius 1, height 0.12, top at y = 0
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.04, 0.12, 96, 1), this.pedestalMaterial);
    pedestal.position.y = -0.06;
    this.pedestalMesh = pedestal;
    this.pedestal = new THREE.Group();
    this.pedestal.add(pedestal);
    this.group.add(this.pedestal);

    const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

    const seeds = new Float32Array(MOTES).map(() => Math.random());
    const motesGeometry = new THREE.BufferGeometry();
    motesGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    motesGeometry.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    this.motesMaterial = new THREE.ShaderMaterial({
      ...motesShader,
      ...additive,
      uniforms: { uTint: stageTint, uTime: { value: 0 }, uHeight: { value: 1 }, uRadius: { value: 1 }, uSize: { value: 1 } },
    });
    this.motes = new THREE.Points(motesGeometry, this.motesMaterial);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);

    const smokeGeometry = new THREE.BufferGeometry();
    smokeGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SMOKE * 3), 3));
    smokeGeometry.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(SMOKE).map(() => Math.random()), 1));
    this.smokeMaterial = new THREE.ShaderMaterial({
      ...smokeShader,
      transparent: true,
      depthWrite: false,
      uniforms: { uTint: stageTint, uTime: { value: 0 }, uRadius: { value: 1 }, uSize: { value: 1 } },
    });
    this.smoke = new THREE.Points(smokeGeometry, this.smokeMaterial);
    this.smoke.frustumCulled = false;
    this.smoke.renderOrder = 2;
    this.group.add(this.smoke);

    this.hazeMaterial = new THREE.ShaderMaterial({
      ...hazeShader,
      transparent: true,
      depthWrite: false,
      uniforms: { uTint: stageTint, uTime: { value: 0 }, uAspect: { value: 1 }, uView: { value: new THREE.Vector2() } },
    });
    this.haze = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.hazeMaterial);
    this.haze.frustumCulled = false;
    // Drawn after the ground, so it lies the same over the sky and the far ground and leaves no
    // seam between them; the model and the rocks still stand in front of it
    this.haze.renderOrder = 10;
    this.haze.userData.skipGlow = true;
    this.group.add(this.haze);

    this.poolMaterial = new THREE.ShaderMaterial({
      ...poolShader,
      // Light added to the colors only, never darkening or covering the page
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      uniforms: { uRim: stageTint, uTime: { value: 0 } },
    });
    const pool = new THREE.Mesh(new THREE.CircleGeometry(0.8, 64), this.poolMaterial);
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.002;
    pool.renderOrder = 1;
    this.pool = pool;
    this.pedestal.add(pool);

    this.sparksGeometry = new THREE.BufferGeometry();
    this.sparksGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    this.sparksGeometry.setAttribute("aVelocity", new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));
    this.sparksGeometry.setAttribute("aSeed", new THREE.BufferAttribute(new Float32Array(SPARKS), 1));
    this.sparksMaterial = new THREE.ShaderMaterial({
      ...sparksShader,
      ...additive,
      uniforms: { uRim: stageTint, uAge: { value: 10 }, uSize: { value: 1 } },
    });
    this.sparks = new THREE.Points(this.sparksGeometry, this.sparksMaterial);
    this.sparks.frustumCulled = false;
    this.group.add(this.sparks);
  }

  // The pedestal with its smoke and pool of light; the embers and the haze stay
  setPedestal(on) {
    this.pedestalShown = on;
    this.pedestal.visible = on && this.standing !== false;
    this.smoke.visible = on && this.standing !== false;
  }

  // center: the model's footprint center on the ground, radius: pedestal radius, height: model height
  place(center, radius, height, standing) {
    this.group.position.copy(center);
    this.pedestal.scale.set(radius, radius, radius);
    this.motesMaterial.uniforms.uHeight.value = height * 1.4;
    this.motesMaterial.uniforms.uRadius.value = radius * 1.05;
    this.motesMaterial.uniforms.uSize.value = radius * 70;
    this.sparksMaterial.uniforms.uSize.value = radius * 90;
    this.smokeMaterial.uniforms.uRadius.value = radius;
    this.smokeMaterial.uniforms.uSize.value = radius * 900;
    this.smoke.visible = standing && this.pedestalShown !== false;
    this.radius = radius;
    this.height = height;
    // Parts shown alone float in the view without a pedestal
    this.standing = standing;
    this.pedestal.visible = standing && this.pedestalShown !== false;
  }

  burst() {
    if (this.reducedMotion.matches) {
      return;
    }
    const positions = this.sparksGeometry.attributes.position.array;
    const velocities = this.sparksGeometry.attributes.aVelocity.array;
    const seeds = this.sparksGeometry.attributes.aSeed.array;
    const r = this.radius ?? 1;
    for (let i = 0; i < SPARKS; i++) {
      const angle = Math.random() * Math.PI * 2;
      const start = r * (0.75 + Math.random() * 0.15);
      positions.set([Math.cos(angle) * start, 0.02 * r, Math.sin(angle) * start], i * 3);
      const out = r * (0.15 + Math.random() * 0.5);
      const up = (this.height ?? r) * (0.25 + Math.random() * 0.75);
      velocities.set([Math.cos(angle) * out, up, Math.sin(angle) * out], i * 3);
      seeds[i] = Math.random();
    }
    this.sparksGeometry.attributes.position.needsUpdate = true;
    this.sparksGeometry.attributes.aVelocity.needsUpdate = true;
    this.sparksGeometry.attributes.aSeed.needsUpdate = true;
    this.age = 0;
  }

  update(delta) {
    const still = this.reducedMotion.matches;
    if (!still) {
      this.time += delta;
      this.age += delta;
    }
    this.motesMaterial.uniforms.uTime.value = this.time;
    this.smokeMaterial.uniforms.uTime.value = this.time;
    this.hazeMaterial.uniforms.uTime.value = this.time;
    this.poolMaterial.uniforms.uTime.value = this.time;
    this.pedestalMaterial.uniforms.uTime.value = this.time;
    this.sparksMaterial.uniforms.uAge.value = this.age;
    this.pedestalMaterial.uniforms.uWave.value = Math.min(this.age / 1.1, 2);
    this.sparks.visible = this.age < 2;
  }
}
