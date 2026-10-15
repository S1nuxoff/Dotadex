import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { createDotaMaterial, stageRim } from "./dotaMaterial.js";

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

// Textures by their vmat names, which is how the Dota materials refer to them
async function prepareTextures(gltf) {
  const definitions = gltf.parser.json.textures ?? [];
  const textures = {};
  await Promise.all(
    definitions.map(async (definition, index) => {
      const texture = await gltf.parser.getDependency("texture", index);
      textures[definition.name] = texture;
    })
  );
  gltf.userData.textures = textures;
  return gltf;
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
      texture.colorSpace = param === "g_tColor" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      texture.needsUpdate = true;
      byParam[param] = texture;
    }
  }
  return createDotaMaterial(material, vmat, byParam);
}

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
        uniforms: { uColor: stageRim },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 uColor; varying vec2 vUv;
          void main(){ float d = distance(vUv, vec2(0.5)) * 2.0;
            float shadow = smoothstep(1.0, 0.0, d) * 0.55;
            float ring = smoothstep(0.06, 0.0, abs(d - 0.92)) * 0.35;
            gl_FragColor = vec4(mix(vec3(0.0), uColor, ring / max(shadow + ring, 0.001)), shadow + ring); }`,
      })
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.scene.add(this.floor);

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

    const gltfs = await Promise.all(
      urls.map((url) =>
        loadModel(url, (event) => {
          loaded.set(url, { loaded: event.loaded, total: event.total });
          report();
        })
      )
    );
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
    this.applyMaterials(root, gltfs[rootIndex].userData.textures);
    group.add(root);

    gltfs.forEach((gltf, index) => {
      // A hero base is hidden when a body-replacing model took over
      if (index === rootIndex || (index === 0 && rootIndex !== 0 && gltf.animations.length > 10)) {
        return;
      }
      const part = cloneSkinned(gltf.scene);
      this.applyMaterials(part, gltf.userData.textures);
      attach(root, part);
    });

    this.replace(group, gltfs[rootIndex].animations);
    return Object.keys(this.actions);
  }

  applyMaterials(object, textures) {
    object.traverse((node) => {
      if (!node.isMesh) {
        return;
      }
      node.frustumCulled = false;
      const original = node.material;
      node.userData.pbr = original;
      node.userData.dota = dotaMaterialFor(original, textures) ?? original;
      node.material = this.shading === "dota" ? node.userData.dota : original;
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
  }

  play(name, fade = 0.25) {
    const next = this.actions[name];
    if (!next) {
      return;
    }
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (this.current && this.current !== next) {
      this.current.crossFadeTo(next, fade, false);
    }
    this.current = next;
    this.currentName = name;
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  setPaused(paused) {
    this.paused = paused;
  }

  setShading(mode) {
    this.shading = mode;
    this.group?.traverse((node) => {
      if (node.isMesh) {
        node.material = mode === "dota" ? node.userData.dota : node.userData.pbr;
      }
    });
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
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.75;

    this.floor.position.set(center.x, box.min.y, center.z);
    this.floor.scale.setScalar(Math.max(size.x, size.z) * 0.75 + radius * 0.2);

    this.camera.near = distance / 100;
    this.camera.far = distance * 20;
    this.camera.updateProjectionMatrix();
    this.controls.minDistance = radius * 0.4;
    this.controls.maxDistance = distance * 4;

    // Aim a little below the middle so the model sits above the title
    const target = center.clone().add(new THREE.Vector3(0, -size.y * 0.12, 0));
    const position = center.clone().add(new THREE.Vector3(0.35, 0.18, 1).normalize().multiplyScalar(distance));

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
    }

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

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
