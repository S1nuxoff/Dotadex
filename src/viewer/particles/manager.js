// The particle effects on the stage's model: the systems loaded from the dataset, their control
// points bound to the model's attachments (of the hero and of what it wears) as the game's
// effects ask, and points on the model's surface for effects that rise from it.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ControlPoint, ParticleSystem } from "./system.js";
import { attachmentTransform, bonesOf, quaternionToSource, toSource, UNIT } from "./math.js";
import { unsupported } from "./operators.js";
import { sheetTextureOf } from "./render.js";

const systemCache = new Map();
const snapshotCache = new Map();
const snapshots = new Map(); // the ones loaded, for the systems to read as they run
const textureCache = new Map();
const textures = new Map(); // the ones loaded, for initializers that read a sheet as particles are made
const attachmentCache = new Map();
let attachedModels = null; // loaded once: a Set of the models that have attachments, or null while the dataset has no list
const textureLoader = new THREE.TextureLoader();
const modelCache = new Map();
const models = new Map(); // the ones loaded, for the systems to find the moment they start
const modelLoader = new GLTFLoader();

// Whether an image has no see-through texel at all: a texture saved without its alpha
const probe = document.createElement("canvas");
probe.width = probe.height = 32;
function isOpaque(image) {
  try {
    const context = probe.getContext("2d", { willReadFrequently: true });
    context.clearRect(0, 0, 32, 32);
    context.drawImage(image, 0, 0, 32, 32);
    const pixels = context.getImageData(0, 0, 32, 32).data;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 250) return false;
    return true;
  } catch {
    return false;
  }
}

function fetchJson(url) {
  return fetch(url)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}

const v1 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const scale = new THREE.Vector3();

export class ParticleManager {
  constructor(scene, base) {
    this.base = base;
    this.group = new THREE.Group();
    this.group.name = "particles";
    scene.add(this.group);
    this.effects = [];
    this.paths = [];
    this.model = null;
    this.bones = new Map();
    this.attachments = {};
    this.meshes = [];
    this.request = 0;
    this.surface = {
      sample: (position, normal) => this.sampleSurface(position, normal),
      position: (binding, target) => this.surfacePosition(binding, target),
    };
  }

  loadSystem(path) {
    const key = path.toLowerCase().replace(/\.vpcf$/, "");
    if (!systemCache.has(key)) {
      systemCache.set(key, fetchJson(`${this.base}${key}.json`));
    }
    return systemCache.get(key);
  }

  // An effect with every system it spawns, in one request (particles/bundles/); its systems are
  // kept for the children to find, and a missing bundle falls back to the files one by one
  async loadEffect(path) {
    const key = path.toLowerCase().replace(/\.vpcf$/, "");
    if (!systemCache.has(key)) {
      const bundle = await fetchJson(`${this.base}particles/bundles/${key.replace(/^particles\//, "")}.json`);
      for (const [file, system] of Object.entries(bundle ?? {})) {
        const name = file.toLowerCase().replace(/\.vpcf$/, "");
        if (!systemCache.has(name)) systemCache.set(name, Promise.resolve(system));
      }
    }
    return this.loadSystem(path);
  }

  // A model particles are drawn as (.vmdl, exported as .glb next to the others), or null when the
  // dataset has none: { scene, clips, sequences, names, attachments }, its sequences in the
  // game's order ({ name: { looping, activities } } from the export, the clips' without it)
  loadModel(path) {
    const key = path.toLowerCase().replace(/\.vmdl$/, "");
    if (!modelCache.has(key)) {
      attachedModels ??= fetchJson(`${this.base}particles/attached-models.json`).then((list) => list && new Set(list));
      const attachments = attachedModels.then((attached) => (!attached || attached.has(`${key}.attachments.json`) ? fetchJson(`${this.base}${key}.attachments.json`) : null));
      modelCache.set(
        key,
        Promise.all([modelLoader.loadAsync(`${this.base}${key}.glb`).catch(() => null), fetchJson(`${this.base}${key}.sequences.json`), attachments]).then(([gltf, sequences, attachments]) => {
          if (!gltf) return null;
          const clips = gltf.animations ?? [];
          const model = { scene: gltf.scene, clips, sequences: sequences ?? Object.fromEntries(clips.map((clip) => [clip.name, {}])), attachments: attachments ?? {} };
          model.names = Object.keys(model.sequences);
          models.set(key, model);
          return model;
        })
      );
    }
    return modelCache.get(key);
  }

  // A model already loaded, or null
  loadedModel(path) {
    return models.get(path.toLowerCase().replace(/\.vmdl$/, "")) ?? null;
  }

  // A snapshot (.vsnap): its streams by name, positions in the model's own space in the game's
  // units ({ position: [[x, y, z]], radius: [r], ... }), or null when the dataset has none
  loadSnapshot(path) {
    const key = path.toLowerCase();
    if (!snapshotCache.has(key)) {
      snapshotCache.set(
        key,
        fetchJson(`${this.base}${key}.json`).then((data) => {
          snapshots.set(key, data);
          return data;
        })
      );
    }
    return snapshotCache.get(key);
  }

  // The snapshots and models an effect's systems use, all of them loaded before it starts (a
  // snapshot something worn puts in place of the effect's own: that one), and the textures of
  // systems whose particles live as long as their sheet's sequence
  async loadResources(def, swaps = {}, seen = new Set()) {
    if (!def || seen.has(def)) return;
    seen.add(def);
    const children = await Promise.all((def.m_Children ?? []).filter((child) => child?.m_ChildRef).map((child) => this.loadSystem(child.m_ChildRef)));
    const modelPaths = (def.m_Renderers ?? [])
      .filter((op) => op._class === "C_OP_RenderModels" && !op.m_bDisableOperator)
      .flatMap((op) => (op.m_ModelList ?? []).map((entry) => entry?.m_model).filter(Boolean));
    const snapshot = def.m_hSnapshot && (swaps[def.m_hSnapshot.toLowerCase()] ?? def.m_hSnapshot);
    const sheet = (def.m_Initializers ?? []).some((op) => op._class === "C_INIT_SequenceLifeTime" && !op.m_bDisableOperator) && sheetTextureOf(def);
    await Promise.all([snapshot && this.loadSnapshot(snapshot), sheet && this.loadTexture(sheet), ...modelPaths.map((path) => this.loadModel(path)), ...children.map((child) => this.loadResources(child, swaps, seen))]);
  }

  // A snapshot's points on a model: each at the vertex nearest to it in the model's own pose, so
  // it moves with the model as that vertex does. A snapshot is made on one model, in that model's
  // space, which need not be the effect's own (Void Spirit's blade points are on his weapon, kept
  // in the weapon's space, while the effect is the hero's): the model whose vertices lie nearest
  // to the points on average is taken, the effect's own ones (`meshes`) unless another fits far
  // better
  snapshotPoints(path, meshes) {
    const data = snapshots.get(path.toLowerCase());
    const positions = data?.position;
    if (!positions?.length || !this.meshes.length || !this.model) return null;
    this.model.updateWorldMatrix(true, true);
    const toModel = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    // The snapshot in metres with the scene's axes, the way the models' vertices are kept
    const points = positions.map((source) => new THREE.Vector3(source[1] * UNIT, source[2] * UNIT, source[0] * UNIT));
    const target = new THREE.Vector3();
    // Up to 32 of the points, spread over the snapshot, to tell which model it is on
    const sample = points.length <= 32 ? points : Array.from({ length: 32 }, (_, k) => points[Math.floor((k * points.length) / 32)]);
    const nearest = (group, points = sample) => {
      const found = points.map(() => ({ distance: Infinity, mesh: null, index: 0 }));
      for (const mesh of group) {
        const matrix = new THREE.Matrix4().multiplyMatrices(toModel, mesh.matrixWorld);
        const position = mesh.geometry.attributes.position;
        for (let i = 0; i < position.count; i++) {
          target.fromBufferAttribute(position, i).applyMatrix4(matrix);
          for (let k = 0; k < points.length; k++) {
            const distance = target.distanceToSquared(points[k]);
            if (distance < found[k].distance) found[k] = { distance, mesh, index: i };
          }
        }
      }
      const mean = found.reduce((sum, entry) => sum + Math.sqrt(entry.distance), 0) / found.length;
      return { found, mean };
    };
    const groups = new Map();
    for (const mesh of this.meshes) {
      const key = mesh.userData.model ?? mesh.uuid;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(mesh);
    }
    const own = meshes.length ? nearest(meshes) : null;
    let best = own && { ...own, group: meshes };
    for (const group of groups.values()) {
      if (own && group.every((mesh) => meshes.includes(mesh))) continue;
      const fit = nearest(group);
      if (!best || fit.mean < best.mean) best = { ...fit, group };
    }
    // The effect's own models while they fit about as well (within an inch or half again)
    const chosen = nearest(own && own.mean <= best.mean * 1.5 + UNIT ? meshes : best.group, points).found;
    return positions.map((source, k) => {
      const { mesh, index } = chosen[k];
      const found = { mesh, index };
      if (data.radius?.[k] !== undefined) found.radius = data.radius[k];
      if (data.normal?.[k]) found.normal = data.normal[k];
      const color = data.color?.[k];
      if (color) found.color = color.slice(0, 3).map((c) => (Math.max(...color.slice(0, 3)) > 1 ? c / 255 : c));
      return found;
    });
  }

  loadTexture(path) {
    const key = path.toLowerCase().replace(/\.vtex$/, "");
    if (!textureCache.has(key)) {
      const url = `${this.base}particles/textures/${key}`;
      textureCache.set(
        key,
        Promise.all([textureLoader.loadAsync(`${url}.png`).catch(() => null), fetchJson(`${url}.json`)]).then(([texture, sheet]) => {
          if (!texture) return null;
          texture.colorSpace = THREE.SRGBColorSpace;
          const loaded = { texture, sheet, opaque: isOpaque(texture.image) };
          textures.set(key, loaded);
          return loaded;
        })
      );
    }
    return textureCache.get(key);
  }

  // A texture already loaded, or null
  loadedTexture(path) {
    return textures.get(path.toLowerCase().replace(/\.vtex$/, "")) ?? null;
  }

  // The model the effects are on, and the models it is made of (for their attachments)
  async setModel(group, urls) {
    const request = ++this.request;
    this.model = group;
    this.bones = group ? bonesOf(group) : new Map();
    this.meshes = [];
    group?.traverse((node) => {
      if (node.isMesh && node.visible && node.geometry?.attributes?.position) this.meshes.push(node);
    });
    this.totalVertices = this.meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
    // Only the models the dataset lists as having attachments have a file of them
    attachedModels ??= fetchJson(`${this.base}particles/attached-models.json`).then((list) => list && new Set(list));
    const attached = await attachedModels;
    const lists = await Promise.all(
      (urls ?? []).map((url) => {
        const file = url.split("#")[0].replace(/\.glb$/, ".attachments.json");
        if (attached && file.startsWith(this.base) && !attached.has(file.slice(this.base.length))) return null;
        if (!attachmentCache.has(file)) attachmentCache.set(file, fetchJson(file));
        return attachmentCache.get(file);
      })
    );
    if (request !== this.request) return;
    // The hero's own attachments first, what it wears adds its own
    this.attachments = Object.assign({}, ...lists.filter(Boolean).reverse());
    this.restart();
  }

  // [{ system, models, snapshots }]: systems by their path in the game, the models they rise
  // from, and snapshots put in place of others ({ default: its own })
  setEffects(list) {
    const sorted = [...list].sort((a, b) => a.system.localeCompare(b.system));
    const key = sorted.map((effect) => `${effect.system}@${(effect.models ?? []).join(",")}${effect.snapshots ? JSON.stringify(effect.snapshots) : ""}`).join("|");
    if (key === this.key) return;
    this.key = key;
    this.list = sorted;
    this.paths = sorted.map((effect) => effect.system);
    this.restart();
  }

  async restart() {
    const request = ++this.request;
    this.clear();
    if (!this.model) return;
    const list = this.list ?? [];
    const defs = await Promise.all(list.map((effect) => this.loadEffect(effect.system)));
    await Promise.all(defs.map((def, index) => this.loadResources(def, list[index].snapshots)));
    if (request !== this.request) return;
    for (const [index, def] of defs.entries()) {
      if (!def) continue;
      const host = this.hostFor(def, list[index].models, list[index].snapshots);
      this.effects.push({ system: new ParticleSystem(def, host), host });
    }
    if (unsupported.size) {
      console.info("[particles] not drawn yet:", Object.fromEntries(unsupported));
    }
  }

  clear() {
    for (const effect of this.effects) effect.system.dispose();
    this.effects = [];
    this.group.clear();
  }

  // What a root system asks of the world: control points driven as its first configuration
  // says (attachments of the parent model, its origin), textures, children, the model surface
  hostFor(def, models = [], swaps = {}) {
    const drivers = def.m_controlPointConfigurations?.[0]?.m_drivers ?? [];
    const points = new Map();
    const driven = new Map();
    for (const driver of drivers) {
      driven.set(driver.m_iControlPoint ?? 0, driver);
    }
    if (!driven.has(0)) driven.set(0, { m_iControlPoint: 0, m_iAttachType: "PATTACH_ABSORIGIN_FOLLOW" });
    const manager = this;
    // The surface of the effect's own models, or the whole model when none of its meshes is there
    const wanted = new Set(models);
    const own = this.meshes.filter((mesh) => wanted.has(mesh.userData.model));
    const meshes = own.length ? own : this.meshes;
    const total = meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
    const placed = new Map();
    // The snapshot in use: something worn may put its own in place of the effect's (when the
    // dataset has it)
    const swapped = (path) => {
      const key = path.toLowerCase();
      return swaps[key] && snapshots.get(swaps[key]) ? swaps[key] : key;
    };
    return {
      // A snapshot's points found on this effect's models once
      snapshotPoints(path) {
        path = swapped(path);
        if (!placed.has(path)) placed.set(path, manager.snapshotPoints(path, meshes));
        return placed.get(path);
      },
      // A snapshot's streams as the file gives them, or null
      snapshotData: (path) => snapshots.get(swapped(path)) ?? null,
      surface: {
        sample: (position, normal) => this.sampleSurface(position, normal, meshes, total),
        position: (binding, target) => this.surfacePosition(binding, target),
      },
      loadSystem: (path) => this.loadSystem(path),
      loadTexture: (path) => this.loadTexture(path),
      loadedTexture: (path) => this.loadedTexture(path),
      loadModel: (path) => this.loadModel(path),
      loadedModel: (path) => this.loadedModel(path),
      controlPoint(index) {
        let point = points.get(index);
        if (!point) {
          point = new ControlPoint();
          points.set(index, point);
          // In place at once: particles made this step must not start at the world's origin
          if (driven.has(index)) {
            manager.drive(point, driven.get(index));
          } else {
            const origin = this.controlPoint(0);
            point.position.copy(origin.position);
            point.quaternion.copy(origin.quaternion);
          }
          point.previous.copy(point.position);
        }
        return point;
      },
      update() {
        for (const [index, driver] of driven) {
          manager.drive(this.controlPoint(index), driver);
        }
        // Control points nothing drives stand where the effect does
        const origin = this.controlPoint(0);
        for (const [index, point] of points) {
          if (!driven.has(index)) {
            point.position.copy(origin.position);
            point.quaternion.copy(origin.quaternion);
          }
        }
      },
    };
  }

  // A control point at an attachment of the model, or at its origin
  drive(point, driver) {
    point.previous.copy(point.position);
    const attachment = driver.m_attachmentName && this.attachments[driver.m_attachmentName];
    const type = driver.m_iAttachType ?? "PATTACH_ABSORIGIN_FOLLOW";
    if (attachment && /POINT/.test(type) && attachmentTransform(attachment, this.bones, v1, q1)) {
      // At the attachment
    } else if (this.model) {
      this.model.updateWorldMatrix(true, false);
      this.model.matrixWorld.decompose(v1, q1, scale);
    } else {
      v1.set(0, 0, 0);
      q1.identity();
    }
    toSource(v1, point.position);
    quaternionToSource(q1, point.quaternion);
    const offset = driver.m_vecOffset;
    if (Array.isArray(offset)) {
      point.position.x += offset[0];
      point.position.y += offset[1];
      point.position.z += offset[2];
    }
    point.speed = point.position.distanceTo(point.previous) * 60;
  }

  // A random point of the model's surface, in the game's space, and how to find it again
  sampleSurface(position, normal, meshes = this.meshes, total = this.totalVertices) {
    if (!meshes.length) return null;
    let pick = Math.random() * total;
    let mesh = meshes[0];
    for (const candidate of meshes) {
      const count = candidate.geometry.attributes.position.count;
      if (pick < count) {
        mesh = candidate;
        break;
      }
      pick -= count;
    }
    const binding = { mesh, index: Math.floor(Math.random() * mesh.geometry.attributes.position.count) };
    this.surfacePosition(binding, position);
    const normals = mesh.geometry.attributes.normal;
    if (normals && normal) {
      v1.fromBufferAttribute(normals, binding.index).transformDirection(mesh.matrixWorld);
      normal.set(v1.z, v1.x, v1.y);
    }
    return binding;
  }

  surfacePosition(binding, target) {
    const { mesh, index } = binding;
    if (mesh.isSkinnedMesh) {
      mesh.getVertexPosition(index, v1);
    } else {
      v1.fromBufferAttribute(mesh.geometry.attributes.position, index);
    }
    mesh.localToWorld(v1);
    return toSource(v1, target);
  }

  update(delta, camera) {
    if (!this.effects.length) return;
    for (const effect of this.effects) {
      effect.host.update();
      effect.system.update(Math.min(delta, 0.1));
      effect.system.render(camera);
    }
    this.report(delta);
    // Systems spawned along the way bring their own objects
    const objects = new Set();
    for (const effect of this.effects) effect.system.objects().forEach((object) => objects.add(object));
    for (const child of [...this.group.children]) if (!objects.has(child)) this.group.remove(child);
    for (const object of objects) if (object.parent !== this.group) this.group.add(object);
  }

  // A short account of the running systems in the console, every few seconds, while developing
  report(delta) {
    if (!import.meta.env.DEV) return;
    this.reportClock = (this.reportClock ?? 0) + delta;
    if (this.reportClock < 4) return;
    this.reportClock = 0;
    const lines = [];
    const describe = (system, depth) => {
      const cp = system.controlPoint(0).position;
      const mesh = system.renderers
        .map((renderer, index) => {
          const def = (system.def.m_Renderers ?? []).filter((op) => !op.m_bDisableOperator)[index] ?? {};
          const blend = (def.m_nOutputBlendMode ?? "ALPHA").replace("PARTICLE_OUTPUT_BLEND_MODE_", "");
          const object = renderer.object;
          if (!object) return "?";
          const map = object.material?.uniforms?.uMap?.value?.image;
          const frame = object.geometry?.getAttribute?.("iFrame")?.array;
          const size = object.geometry?.getAttribute?.("iSizeRoll")?.array;
          const extra = `${map ? ` tex=${map.width}x${map.height}` : " notex"}${frame ? ` uv=${[...frame.slice(0, 4)].map((v) => v.toFixed(3))}` : ""}${size ? ` size=${size[0].toFixed(2)}m` : ""}`;
          return `${def._class?.replace("C_OP_Render", "")}/${blend}:${object.visible ? "shown" : "hidden"}${extra}`;
        })
        .join(",");
      // Particles whose numbers went wrong draw black
      let broken = 0;
      for (let i = 0; i < system.count; i++) {
        const values = [system.float(3)[i], system.float(7)[i], system.float(16)[i], ...system.float(6).slice(i * 3, i * 3 + 3), ...system.float(0).slice(i * 3, i * 3 + 3)];
        if (values.some((value) => !Number.isFinite(value))) broken++;
      }
      const sample = system.count ? `r=${system.float(3)[0].toFixed(1)} a=${system.float(7)[0].toFixed(2)} c=${[...system.float(6).slice(0, 3)].map((v) => v.toFixed(2))} p=${[...system.float(0).slice(0, 3)].map((v) => v.toFixed(0))}` : "";
      lines.push(`${"  ".repeat(depth)}n=${system.count}/${system.maxParticles}${broken ? ` NaN=${broken}` : ""} [${mesh}] cp0=${cp.x.toFixed(0)},${cp.y.toFixed(0)},${cp.z.toFixed(0)} ${sample}`);
      for (const child of system.children) if (child.system) describe(child.system, depth + 1);
    };
    for (const [index, effect] of this.effects.entries()) {
      lines.push(`effect ${this.paths[index]}`);
      describe(effect.system, 1);
    }
    console.debug(`[particles] ${lines.join("\n")}`);
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
  }
}
