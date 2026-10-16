// The particle effects on the stage's model: the systems loaded from the dataset, their control
// points bound to the model's attachments (of the hero and of what it wears) as the game's
// effects ask, and points on the model's surface for effects that rise from it.
import * as THREE from "three";
import { ControlPoint, ParticleSystem } from "./system.js";
import { quaternionToSource, toSource, UNIT } from "./math.js";
import { unsupported } from "./operators.js";

const systemCache = new Map();
const textureCache = new Map();
const attachmentCache = new Map();
const textureLoader = new THREE.TextureLoader();

function fetchJson(url) {
  return fetch(url)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}

// The game's axes for an offset in a bone's own space: the permutation the export applies
const boneOffset = (offset, target) => target.set((offset[1] ?? 0) * UNIT, (offset[2] ?? 0) * UNIT, (offset[0] ?? 0) * UNIT);
const P = new THREE.Matrix4().set(0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 1);
const PT = P.clone().transpose();
const rotationMatrix = new THREE.Matrix4();
function boneRotation(rotation, target) {
  target.set(rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, rotation[3] ?? 1);
  rotationMatrix.makeRotationFromQuaternion(target).premultiply(P).multiply(PT);
  return target.setFromRotationMatrix(rotationMatrix);
}

const v1 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
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

  loadTexture(path) {
    const key = path.toLowerCase().replace(/\.vtex$/, "");
    if (!textureCache.has(key)) {
      const url = `${this.base}particles/textures/${key}`;
      textureCache.set(
        key,
        Promise.all([textureLoader.loadAsync(`${url}.png`).catch(() => null), fetchJson(`${url}.json`)]).then(([texture, sheet]) => {
          if (!texture) return null;
          texture.colorSpace = THREE.SRGBColorSpace;
          return { texture, sheet };
        })
      );
    }
    return textureCache.get(key);
  }

  // The model the effects are on, and the models it is made of (for their attachments)
  async setModel(group, urls) {
    const request = ++this.request;
    this.model = group;
    this.bones = new Map();
    this.meshes = [];
    group?.traverse((node) => {
      if (node.isBone && !this.bones.has(node.name)) this.bones.set(node.name, node);
      if (node.isMesh && node.visible && node.geometry?.attributes?.position) this.meshes.push(node);
    });
    this.totalVertices = this.meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
    const lists = await Promise.all(
      (urls ?? []).map((url) => {
        const file = url.split("#")[0].replace(/\.glb$/, ".attachments.json");
        if (!attachmentCache.has(file)) attachmentCache.set(file, fetchJson(file));
        return attachmentCache.get(file);
      })
    );
    if (request !== this.request) return;
    // The hero's own attachments first, what it wears adds its own
    this.attachments = Object.assign({}, ...lists.filter(Boolean).reverse());
    this.restart();
  }

  // [{ system, models }]: systems by their path in the game, and the models they rise from
  setEffects(list) {
    const sorted = [...list].sort((a, b) => a.system.localeCompare(b.system));
    const key = sorted.map((effect) => `${effect.system}@${(effect.models ?? []).join(",")}`).join("|");
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
    if (request !== this.request) return;
    for (const [index, def] of defs.entries()) {
      if (!def) continue;
      const host = this.hostFor(def, list[index].models);
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
  hostFor(def, models = []) {
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
    return {
      surface: {
        sample: (position, normal) => this.sampleSurface(position, normal, meshes, total),
        position: (binding, target) => this.surfacePosition(binding, target),
      },
      loadSystem: (path) => this.loadSystem(path),
      loadTexture: (path) => this.loadTexture(path),
      controlPoint(index) {
        let point = points.get(index);
        if (!point) {
          point = new ControlPoint();
          points.set(index, point);
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
    if (attachment && /POINT/.test(type)) {
      this.attachmentTransform(attachment, v1, q1);
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

  // An attachment's place and turn in the scene, from the bones it hangs on
  attachmentTransform(attachment, position, quaternion) {
    position.set(0, 0, 0);
    let weightSum = 0;
    let first = true;
    for (const [name, weight, offset, rotation] of attachment.bones) {
      const bone = this.bones.get(name);
      if (!bone || !weight) continue;
      bone.updateWorldMatrix(true, false);
      boneOffset(offset ?? [0, 0, 0], v1).applyMatrix4(bone.matrixWorld);
      position.addScaledVector(v1, weight);
      weightSum += weight;
      if (first) {
        bone.getWorldQuaternion(q2);
        quaternion.copy(q2).multiply(boneRotation(rotation ?? [0, 0, 0, 1], q1.clone()));
        first = false;
      }
    }
    if (weightSum > 0) {
      position.divideScalar(weightSum);
    } else if (this.model) {
      this.model.getWorldPosition(position);
      quaternion.identity();
    }
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
    console.warn(`[particles] ${lines.join("\n")}`);
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
  }
}
