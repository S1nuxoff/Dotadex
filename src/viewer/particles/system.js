import * as THREE from "three";
import { createOperator } from "./operators.js";

// A particle system of the game running: its particles in fields as the game numbers them, its
// emitters, initializers, forces, operators and constraints, its control points (taken from its
// host, or its parent system), and the systems it spawns.
//
// Fields (PARTICLE_ATTRIBUTE_*): 0 position, 1 lifetime, 2 previous position, 3 radius, 4 roll,
// 5 roll speed, 6 tint, 7 alpha, 8 creation time, 9 sequence, 10 trail length, 11 id, 12 yaw,
// 13 second sequence, 15 hitbox offset, 16 second alpha, 17 scratch vector, 18 scratch float,
// 20 pitch, 21 normal, 22 glow color, 23 glow alpha; the rest are scratch.
export const VECTOR_FIELDS = new Set([0, 2, 6, 15, 17, 21, 22, 26, 27]);
const DEFAULT_MAX = 1000;
export const STEP = 1 / 60;

export class ControlPoint {
  constructor() {
    this.position = new THREE.Vector3();
    this.previous = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    // A control point may carry a value instead of a place (a radius, a count, a color)
    this.value = new THREE.Vector3();
    this.speed = 0;
    this.set = false;
  }

  // The control point's axes in the game's space: forward, left, up
  axis(index, target = new THREE.Vector3()) {
    return target.set(index === 0 ? 1 : 0, index === 1 ? 1 : 0, index === 2 ? 1 : 0).applyQuaternion(this.quaternion);
  }
}

export class ParticleSystem {
  constructor(def, host, parent = null) {
    this.def = def;
    this.host = host;
    this.parent = parent;
    this.maxParticles = Math.max(1, Math.min(def.m_nMaxParticles ?? DEFAULT_MAX, 5000));
    this.count = 0;
    this.nextId = 0;
    this.age = 0;
    this.endcap = false;
    this.endcapAge = 0;
    this.fields = new Map();
    this.initial = new Map();
    this.ids = new Int32Array(this.maxParticles);
    this.dead = new Uint8Array(this.maxParticles);
    this.accel = new Float32Array(this.maxParticles * 3);
    this.points = new Map();
    this.keepKilled = false;
    this.killed = [];

    const constant = def.m_ConstantColor ?? [255, 255, 255, 255];
    this.constants = {
      radius: def.m_flConstantRadius ?? 5,
      lifetime: def.m_flConstantLifespan ?? 1,
      // In degrees in the file
      roll: ((def.m_flConstantRotation ?? 0) * Math.PI) / 180,
      rollSpeed: ((def.m_flConstantRotationSpeed ?? 0) * Math.PI) / 180,
      sequence: def.m_nConstantSequenceNumber ?? 0,
      sequence2: def.m_nConstantSequenceNumber1 ?? 0,
      color: [constant[0] / 255, constant[1] / 255, constant[2] / 255],
      alpha: (constant[3] ?? 255) / 255,
      normal: def.m_ConstantNormal ?? [0, 0, 1],
    };
    for (const field of [0, 2, 6, 21]) this.vector(field);
    for (const field of [1, 3, 4, 5, 7, 8, 9, 10, 12, 13, 16, 20]) this.float(field);

    const build = (list, kind) => (list ?? []).filter((op) => !op.m_bDisableOperator).map((op) => createOperator(op, kind, this)).filter(Boolean);
    this.preEmission = build(def.m_PreEmissionOperators, "preEmission");
    this.emitters = build(def.m_Emitters, "emitter");
    this.initializers = build(def.m_Initializers, "initializer");
    this.forces = build(def.m_ForceGenerators, "force");
    this.operators = build(def.m_Operators, "operator");
    this.constraints = build(def.m_Constraints, "constraint");
    this.renderers = build(def.m_Renderers, "renderer");

    // Spawned systems: started after their delay, end-cap ones when this one ends; kept in the
    // order the file lists them, as operators setting one child after another count them
    this.children = [];
    (def.m_Children ?? []).forEach((child, order) => {
      if (!child?.m_ChildRef || child.m_bDisableChild) {
        return;
      }
      host.loadSystem(child.m_ChildRef).then((childDef) => {
        if (childDef && !this.disposed) {
          this.children.push({ system: null, def: childDef, order, delay: child.m_flDelay ?? 0, endcap: Boolean(child.m_bEndCap) });
          this.children.sort((a, b) => a.order - b.order);
        }
      });
    });
    this.accumulator = 0;
  }

  float(field) {
    let data = this.fields.get(field);
    if (!data) {
      data = new Float32Array(this.maxParticles * (VECTOR_FIELDS.has(field) ? 3 : 1));
      this.fields.set(field, data);
    }
    return data;
  }

  vector(field) {
    return this.float(field);
  }

  // A field's values as they were when each particle was made
  initialFloat(field) {
    let data = this.initial.get(field);
    if (!data) {
      data = this.float(field).slice();
      this.initial.set(field, data);
    }
    return data;
  }

  initialVector(field) {
    return this.initialFloat(field);
  }

  normalizedAge(index) {
    const life = this.float(1)[index];
    return life > 0 ? Math.min((this.age - this.float(8)[index]) / life, 1) : 1;
  }

  speed(index) {
    const p = this.float(0);
    const q = this.float(2);
    const i = index * 3;
    return Math.hypot(p[i] - q[i], p[i + 1] - q[i + 1], p[i + 2] - q[i + 2]) / STEP;
  }

  // A named value (m_NamedValueLocals): the parent's, when it names the same one, else the system's
  // own default; undefined when neither names it. The card edges' children declare SideCount at 0
  // and emit one particle per particle of their edge, which gives its own (40 or 60)
  namedValue(name) {
    this.named ??= new Map();
    if (!this.named.has(name)) {
      const own = this.def.m_bEnableNamedValues ? this.def.m_NamedValueLocals?.find((local) => local.m_Name === name) : undefined;
      this.named.set(name, this.parent?.namedValue(name) ?? own?.m_DefaultConfig?.m_ConfigValue);
    }
    return this.named.get(name);
  }

  // The system's own control point, else its parent's, else the host's
  controlPoint(index) {
    const own = this.points.get(index);
    if (own?.set) {
      return own;
    }
    return this.parent ? this.parent.controlPoint(index) : this.host.controlPoint(index);
  }

  // A control point a system or the effect's configuration puts somewhere, or null for one
  // nothing sets (the game's stand at the world's origin)
  controlPointIfSet(index) {
    const own = this.points.get(index);
    if (own?.set) {
      return own;
    }
    if (this.parent) {
      return this.parent.controlPointIfSet(index);
    }
    return this.host.drives?.(index) === false ? null : this.host.controlPoint(index);
  }

  // The snapshot (points the artist placed on the model) at a control point: the system's own,
  // or the one a parent put there, which its children read
  snapshot(index) {
    const own = this.def.m_hSnapshot;
    if (own && (this.def.m_nSnapshotControlPoint ?? 0) === index) {
      return own;
    }
    return this.parent ? this.parent.snapshot(index) : null;
  }

  // A control point this system sets for itself (and its children)
  ownControlPoint(index) {
    let point = this.points.get(index);
    if (!point) {
      point = new ControlPoint();
      this.points.set(index, point);
    }
    point.set = true;
    return point;
  }

  kill(index) {
    this.dead[index] = 1;
  }

  // Makes n particles with the system's constants at control point 0, then runs the initializers
  spawn(n) {
    n = Math.min(Math.floor(n), this.maxParticles - this.count);
    if (n <= 0) {
      return;
    }
    const start = this.count;
    const end = start + n;
    const c = this.constants;
    const origin = this.controlPoint(0).position;
    const pos = this.float(0);
    const prev = this.float(2);
    const color = this.float(6);
    const normal = this.float(21);
    for (let i = start; i < end; i++) {
      this.ids[i] = this.nextId++;
      this.dead[i] = 0;
      pos[i * 3] = prev[i * 3] = origin.x;
      pos[i * 3 + 1] = prev[i * 3 + 1] = origin.y;
      pos[i * 3 + 2] = prev[i * 3 + 2] = origin.z;
      color[i * 3] = c.color[0];
      color[i * 3 + 1] = c.color[1];
      color[i * 3 + 2] = c.color[2];
      normal[i * 3] = c.normal[0];
      normal[i * 3 + 1] = c.normal[1];
      normal[i * 3 + 2] = c.normal[2];
      this.float(1)[i] = c.lifetime;
      this.float(3)[i] = c.radius;
      this.float(4)[i] = c.roll;
      this.float(5)[i] = c.rollSpeed;
      this.float(7)[i] = c.alpha;
      this.float(8)[i] = this.age;
      this.float(9)[i] = c.sequence;
      this.float(10)[i] = 0.1;
      this.float(12)[i] = 0;
      this.float(13)[i] = c.sequence2;
      this.float(16)[i] = 1;
      this.float(20)[i] = 0;
      for (const [field, data] of this.fields) {
        if (![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 16, 20, 21].includes(field)) {
          const width = VECTOR_FIELDS.has(field) ? 3 : 1;
          data.fill(0, i * width, (i + 1) * width);
        }
      }
    }
    this.count = end;
    for (const op of this.initializers) {
      op.init?.(this, start, end);
    }
    for (const [field, data] of this.initial) {
      const width = VECTOR_FIELDS.has(field) ? 3 : 1;
      data.set(this.float(field).subarray(start * width, end * width), start * width);
    }
  }

  // Removes the particles marked dead, keeping the others in their order (ropes need it); what
  // they were is kept for children made from killed particles (keepKilled), until they take it
  compact() {
    let write = 0;
    for (let read = 0; read < this.count; read++) {
      if (this.dead[read]) {
        if (this.keepKilled && this.killed.length < this.maxParticles) {
          const record = new Map();
          for (const [field, data] of this.fields) {
            const width = VECTOR_FIELDS.has(field) ? 3 : 1;
            record.set(field, data.slice(read * width, (read + 1) * width));
          }
          this.killed.push(record);
        }
        continue;
      }
      if (write !== read) {
        this.ids[write] = this.ids[read];
        if (this.bindings) {
          this.bindings[write] = this.bindings[read];
        }
        for (const store of [this.fields, this.initial]) {
          for (const [field, data] of store) {
            const width = VECTOR_FIELDS.has(field) ? 3 : 1;
            data.copyWithin(write * width, read * width, (read + 1) * width);
          }
        }
      }
      this.dead[write] = 0;
      write++;
    }
    this.count = write;
  }

  // Ends the system: no more emission, end-cap operators and children take over
  stop() {
    if (!this.endcap) {
      this.endcap = true;
      this.endcapAge = 0;
    }
    for (const child of this.children) {
      child.system?.stop();
    }
  }

  get finished() {
    return this.endcap && this.count === 0 && this.children.every((child) => !child.system || child.system.finished);
  }

  // Whether it emits no more: ended, or every emitter past its time (one that keeps on, as a
  // maintained count, never is; a system without emitters is at once)
  get emittersDone() {
    return this.endcap || this.emitters.every((op) => op.done?.(this) ?? !op.emit);
  }

  // Nothing left and nothing to come: no particles, no more emission, every child started (an
  // end-cap child only comes with the end) and spent too; the game removes such an effect
  get spent() {
    return (
      this.age > 0 &&
      this.count === 0 &&
      this.emittersDone &&
      this.children.every((child) => (child.system ? child.system.spent : child.endcap && !this.endcap))
    );
  }

  update(delta) {
    this.accumulator = Math.min(this.accumulator + delta, STEP * 6);
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      this.tick(STEP);
    }
    for (const child of this.children) {
      child.system?.update(delta);
    }
  }

  tick(dt) {
    this.age += dt;
    if (this.endcap) {
      this.endcapAge += dt;
    }
    // Children start after their delay, or with the end, before this step's operators set
    // their control points
    for (const child of this.children) {
      if (!child.system && (child.endcap ? this.endcap : this.age >= child.delay)) {
        child.system = new ParticleSystem(child.def, this.host, this);
      }
    }
    for (const op of this.preEmission) op.update?.(this, dt);
    if (!this.endcap) {
      for (const op of this.emitters) op.emit?.(this, dt);
    }
    this.accel.fill(0, 0, this.count * 3);
    for (const op of this.forces) op.force?.(this, dt);
    for (const op of this.operators) op.update?.(this, dt);
    for (const op of this.constraints) op.update?.(this, dt);
    if (this.dead.subarray(0, this.count).some((flag) => flag)) {
      this.compact();
    }
  }

  // The renderers' scene objects, and the children's
  objects(list = []) {
    for (const renderer of this.renderers) {
      if (renderer.object) list.push(renderer.object);
    }
    for (const child of this.children) {
      child.system?.objects(list);
    }
    return list;
  }

  render(camera) {
    for (const renderer of this.renderers) {
      renderer.render?.(this, camera);
    }
    for (const child of this.children) {
      child.system?.render(camera);
    }
  }

  dispose() {
    this.disposed = true;
    for (const renderer of this.renderers) {
      renderer.dispose?.();
    }
    for (const child of this.children) {
      child.system?.dispose();
    }
  }
}
