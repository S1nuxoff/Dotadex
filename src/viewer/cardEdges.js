// The particle edges round a card of the cosmetic picker (ui_econ_item_animated
// #ArcanaBackgroundEffect): a particle-only scene, maps/scenes/armory/ui_armory_edges, seen
// through its shot_camera, in which the card starts one effect by name once that scene is
// loaded (client.dll 0x182e4bea0): armory_edge_set on set tiles, armory_edge_icon on animated
// item tiles. The effect draws the frame itself: its control points 1-4 are the card's corners.
//
// One renderer draws every card's scene in turn and each card copies the frame into its own
// canvas, so a page of cards holds a single WebGL context.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { ParticleManager } from "./particles/manager.js";
import { frameLights, SCENE_DEPTH } from "./particles/render.js";
import { toScene, UNIT } from "./particles/math.js";
import { fetchData } from "../fetchData.js";
import { PARTICLES_BASE } from "../datasets.js";

export const EDGES_MAP = "maps/scenes/armory/ui_armory_edges.vmap";
const EDGES_CAMERA = "shot_camera";

// The UI scenes' effects and cameras (particles/map-effects.json, map-cameras.json), loaded once
let sceneData = null;
function loadScene(base) {
  const json = (file) =>
    fetchData(`${PARTICLES_BASE}particles/${file}`)
      .then((res) => (res.ok ? res.json() : {}))
      .catch(() => ({}));
  sceneData ??= Promise.all([json("map-effects.json"), json("map-cameras.json")]).then(([effects, cameras]) => ({
    effects: effects[EDGES_MAP] ?? [],
    camera: cameras[EDGES_MAP]?.[EDGES_CAMERA] ?? null,
  }));
  return sceneData;
}

// The game's angles (pitch, yaw, roll in degrees) as the direction they face, in the scene's axes
function forwardOf([pitch, yaw]) {
  const p = THREE.MathUtils.degToRad(pitch);
  const y = THREE.MathUtils.degToRad(yaw);
  return toScene({ x: Math.cos(p) * Math.cos(y), y: Math.cos(p) * Math.sin(y), z: -Math.sin(p) }).normalize();
}

let shared = null;
function sharedRenderer() {
  if (shared) return shared;
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(1);
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
  const scenePass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  composer.addPass(scenePass);
  composer.addPass(new OutputPass());
  // As the stage does: the canvas's pixels are taken as premultiplied, and additive particles
  // leave colors brighter than their alpha, so the alpha is raised to the brightest channel
  composer.addPass(
    new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main() { vec4 c = clamp(texture2D(tDiffuse, vUv), 0.0, 1.0); gl_FragColor = vec4(c.rgb, max(c.a, max(c.r, max(c.g, c.b)))); }`,
    })
  );
  shared = { renderer, composer, scenePass, cards: new Set(), last: 0, frame: 0 };
  return shared;
}

function tick(now) {
  const { renderer, composer, scenePass, cards } = shared;
  const delta = shared.last ? Math.min((now - shared.last) / 1000, 0.1) : 0;
  shared.last = now;
  // The stage's depth is not this scene's: no depth feathering here
  const hadDepth = SCENE_DEPTH.uHasSceneDepth.value;
  SCENE_DEPTH.uHasSceneDepth.value = 0;
  for (const card of cards) {
    if (!card.visible || !card.camera) continue;
    const width = Math.max(1, Math.round(card.canvas.clientWidth * card.ratio));
    const height = Math.max(1, Math.round(card.canvas.clientHeight * card.ratio));
    if (card.canvas.width !== width || card.canvas.height !== height) {
      card.canvas.width = width;
      card.canvas.height = height;
    }
    card.camera.aspect = width / height;
    card.camera.updateProjectionMatrix();
    card.camera.updateMatrixWorld();
    card.scene.updateMatrixWorld();
    // Lights the edges might cast are not the stage's
    const lights = frameLights.length;
    card.manager.update(delta, card.camera);
    frameLights.length = lights;
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== width || size.y !== height) {
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
    }
    scenePass.scene = card.scene;
    scenePass.camera = card.camera;
    composer.render(delta);
    const context = card.canvas.getContext("2d");
    context.clearRect(0, 0, width, height);
    context.drawImage(renderer.domElement, 0, 0, width, height, 0, 0, width, height);
  }
  SCENE_DEPTH.uHasSceneDepth.value = hadDepth;
  shared.frame = cards.size ? requestAnimationFrame(tick) : 0;
}

// Starts the edges on a card's canvas: name the effect the card starts (armory_edge_set,
// armory_edge_icon). Returns the function that stops them.
export function startCardEdges(base, canvas, name) {
  const renderer = sharedRenderer();
  const scene = new THREE.Scene();
  const manager = new ParticleManager(scene, base);
  const card = { canvas, scene, manager, camera: null, visible: true, ratio: Math.min(window.devicePixelRatio, 2) };
  let live = true;
  loadScene(base).then(({ effects, camera }) => {
    const effect = effects.find((entry) => entry.name === name);
    if (!live || !effect || !camera) return;
    // shot_camera: fov 8.8 is the height's, the corners (0, ±50, ±76) 1000 away fill the card
    // (152 of the 153.9 it sees; taken as the width's, the frame would cover two thirds of it)
    card.camera = new THREE.PerspectiveCamera(camera.fov, 1, camera.near * UNIT, camera.far * UNIT);
    card.camera.position.copy(toScene({ x: camera.origin[0], y: camera.origin[1], z: camera.origin[2] }));
    card.camera.lookAt(card.camera.position.clone().add(forwardOf(camera.angles)));
    const anchor = new THREE.Group();
    anchor.position.copy(toScene({ x: effect.origin[0], y: effect.origin[1], z: effect.origin[2] }));
    anchor.rotation.y = THREE.MathUtils.degToRad(effect.angles?.[1] ?? 0);
    scene.add(anchor);
    anchor.updateMatrixWorld(true);
    manager.setModel(anchor, []);
    manager.setEffects([{ system: effect.system }]);
  });
  // Drawn only while the card is on screen
  const observer = new IntersectionObserver(([entry]) => (card.visible = entry.isIntersecting));
  observer.observe(canvas);
  renderer.cards.add(card);
  if (!renderer.frame) {
    renderer.last = 0;
    renderer.frame = requestAnimationFrame(tick);
  }
  return () => {
    live = false;
    observer.disconnect();
    renderer.cards.delete(card);
    manager.dispose();
  };
}
