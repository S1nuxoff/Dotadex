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

  setEffects(paths) {
    const key = [...paths].sort().join("|");
    if (key === this.paths.join("|")) return;
    this.paths = [...paths].sort();
    this.restart();
  }

  async restart() {
    const request = ++this.request;
    this.clear();
    if (!this.model) return;
    const defs = await Promise.all(this.paths.map((path) => this.loadSystem(path)));
    if (request !== this.request) return;
    for (const def of defs) {
      if (!def) continue;
      const host = this.hostFor(def);
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
  hostFor(def) {
    const drivers = def.m_controlPointConfigurations?.[0]?.m_drivers ?? [];
    const points = new Map();
    const driven = new Map();
    for (const driver of drivers) {
      driven.set(driver.m_iControlPoint ?? 0, driver);
    }
    if (!driven.has(0)) driven.set(0, { m_iControlPoint: 0, m_iAttachType: "PATTACH_ABSORIGIN_FOLLOW" });
    const manager = this;
    return {
      surface: this.surface,
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
  sampleSurface(position, normal) {
    if (!this.meshes.length) return null;
    let pick = Math.random() * this.totalVertices;
    let mesh = this.meshes[0];
    for (const candidate of this.meshes) {
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
    // Systems spawned along the way bring their own objects
    const objects = new Set();
    for (const effect of this.effects) effect.system.objects().forEach((object) => objects.add(object));
    for (const child of [...this.group.children]) if (!objects.has(child)) this.group.remove(child);
    for (const object of objects) if (object.parent !== this.group) this.group.add(object);
  }

  dispose() {
    this.clear();
    this.group.removeFromParent();
  }
}
