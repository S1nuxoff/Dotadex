import * as THREE from "three";

// A take on Dota's hero.vfx shader. The textures and parameters come from the
// material's vmat data that Source2Viewer keeps in the glTF extras:
//   Masks1: R detail, G diffuse warp, B metalness, A self-illumination
//   Masks2: R specular intensity, G rim intensity, B tint specular by base color, A specular exponent
//   DiffuseWarp: light ramp by half-Lambert, FresnelWarp: R color, G rim, B specular by view angle
// Lighting is a fixed studio rig in view space, the rim light is tinted per item.

const vertexShader = /* glsl */ `
  #include <common>
  #include <morphtarget_pars_vertex>
  #include <skinning_pars_vertex>

  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  void main() {
    vUv = uv;
    #include <beginnormal_vertex>
    #include <morphnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <morphtarget_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    vViewNormal = normalize(transformedNormal);
    vViewPosition = -mvPosition.xyz;
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tColor;
  uniform sampler2D tNormal;
  uniform sampler2D tMasks1;
  uniform sampler2D tMasks2;
  uniform sampler2D tDiffuseWarp;
  uniform sampler2D tFresnelWarp;

  uniform float uHasNormal;
  uniform float uHasMasks1;
  uniform float uHasMasks2;
  uniform float uHasDiffuseWarp;
  uniform float uHasFresnelWarp;
  uniform float uAlphaTest;
  uniform float uSelfIllum;

  uniform float uSpecularExponent;
  uniform float uSpecularScale;
  uniform float uRimLightScale;
  uniform float uAmbientScale;
  uniform vec3 uSpecularColor;
  uniform vec3 uRimLightColor;

  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;
  uniform vec3 uFillDir;
  uniform vec3 uFillColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform vec3 uStageRim;

  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  // Normal mapping without tangents, from screen-space derivatives
  vec3 perturbNormal(vec3 n, vec3 pos, vec2 uv, vec3 mapN) {
    vec3 q0 = dFdx(pos);
    vec3 q1 = dFdy(pos);
    vec2 st0 = dFdx(uv);
    vec2 st1 = dFdy(uv);
    vec3 q1perp = cross(q1, n);
    vec3 q0perp = cross(n, q0);
    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;
    float det = max(dot(T, T), dot(B, B));
    float scale = det == 0.0 ? 0.0 : inversesqrt(det);
    return normalize(T * (mapN.x * scale) + B * (mapN.y * scale) + n * mapN.z);
  }

  void main() {
    vec4 color = texture2D(tColor, vUv);
    if (uAlphaTest > 0.0 && color.a < uAlphaTest) discard;

    vec4 masks1 = uHasMasks1 > 0.5 ? texture2D(tMasks1, vUv) : vec4(0.0);
    vec4 masks2 = uHasMasks2 > 0.5 ? texture2D(tMasks2, vUv) : vec4(0.0, 0.0, 0.0, 0.0);

    vec3 n = normalize(vViewNormal);
    if (!gl_FrontFacing) n = -n;
    if (uHasNormal > 0.5) {
      vec3 mapN = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
      n = perturbNormal(n, -vViewPosition, vUv, mapN);
    }
    vec3 v = normalize(vViewPosition);
    vec3 albedo = color.rgb;

    // Diffuse with Dota's warp ramp
    float nl = dot(n, uKeyDir);
    float halfLambert = nl * 0.5 + 0.5;
    vec3 keyDiffuse = uHasDiffuseWarp > 0.5
      ? texture2D(tDiffuseWarp, vec2(halfLambert, 0.5)).rgb
      : vec3(halfLambert * halfLambert);
    float fill = max(dot(n, uFillDir), 0.0);
    vec3 ambient = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5) * uAmbientScale;
    float metal = masks1.b;
    vec3 diffuse = albedo * (keyDiffuse * uKeyColor + fill * uFillColor + ambient) * (1.0 - metal * 0.6);

    // Fresnel ramp drives rim and specular falloff
    float facing = clamp(1.0 - dot(n, v), 0.0, 1.0);
    vec3 fresnel = uHasFresnelWarp > 0.5 ? texture2D(tFresnelWarp, vec2(facing, 0.5)).rgb : vec3(facing * facing);

    // Specular, exponent and intensity from Masks2
    float exponent = uHasMasks2 > 0.5 ? max(masks2.a * 100.0, 1.0) : uSpecularExponent;
    float intensity = (uHasMasks2 > 0.5 ? masks2.r : 0.2) * uSpecularScale * 0.15;
    vec3 h = normalize(uKeyDir + v);
    float spec = pow(max(dot(n, h), 0.0), exponent) * max(nl, 0.0);
    vec3 specColor = mix(uSpecularColor, albedo, masks2.b);
    vec3 specular = specColor * uKeyColor * spec * intensity * (0.4 + fresnel.b);

    // Rim from above, in the item's rarity tint
    float rimMask = uHasMasks2 > 0.5 ? masks2.g : 0.3;
    float rimUp = clamp(n.y * 0.6 + 0.4, 0.0, 1.0);
    vec3 rim = fresnel.g * rimMask * uRimLightScale * 0.12 * rimUp * mix(uRimLightColor, uStageRim, 0.65);

    // Metal reflects a soft studio environment tinted by the base color
    vec3 r = reflect(-v, n);
    vec3 env = mix(uGroundColor, uSkyColor * 2.0, r.y * 0.5 + 0.5) * albedo * metal;

    vec3 selfIllum = albedo * masks1.a * uSelfIllum;
    vec3 outColor = diffuse + specular + rim + env + selfIllum;
    gl_FragColor = vec4(outColor, color.a);
    #include <colorspace_fragment>
  }
`;

const stage = {
  keyDir: new THREE.Vector3(-0.45, 0.75, 0.5).normalize(),
  keyColor: new THREE.Color(1.15, 1.1, 1.0),
  fillDir: new THREE.Vector3(0.7, -0.1, 0.4).normalize(),
  fillColor: new THREE.Color(0.18, 0.22, 0.3),
  skyColor: new THREE.Color(0.32, 0.36, 0.44),
  groundColor: new THREE.Color(0.1, 0.09, 0.1),
};

// Shared so a rarity change recolors every material at once
export const stageRim = { value: new THREE.Color("#c9a45c") };

function vector(values, fallback) {
  return values ? new THREE.Color(values[0], values[1], values[2]) : new THREE.Color(...fallback);
}

// textures: { g_tColor: Texture, ... } matched by the vmat texture names
export function createDotaMaterial(original, vmat, textures) {
  const int = vmat.IntParams ?? {};
  const float = vmat.FloatParams ?? {};
  const vec = vmat.VectorParams ?? {};
  const pick = (name) => textures[name] ?? null;
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;

  const translucent = int.F_TRANSLUCENT === 1 || int.F_ADDITIVE_BLEND === 1;
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      tColor: { value: pick("g_tColor") ?? original.map ?? white },
      tNormal: { value: pick("g_tNormal") },
      tMasks1: { value: pick("g_tMasks1") },
      tMasks2: { value: pick("g_tMasks2") },
      tDiffuseWarp: { value: pick("g_tDiffuseWarp") },
      tFresnelWarp: { value: pick("g_tFresnelWarp") },
      uHasNormal: { value: pick("g_tNormal") ? 1 : 0 },
      uHasMasks1: { value: int.F_MASKS_1 && pick("g_tMasks1") ? 1 : 0 },
      uHasMasks2: { value: int.F_MASKS_2 && pick("g_tMasks2") ? 1 : 0 },
      uHasDiffuseWarp: { value: int.F_DIFFUSE_WARP && pick("g_tDiffuseWarp") ? 1 : 0 },
      uHasFresnelWarp: { value: pick("g_tFresnelWarp") ? 1 : 0 },
      uAlphaTest: { value: int.F_ALPHA_TEST ? 0.5 : 0 },
      uSelfIllum: { value: int.F_SELF_ILLUM ? 1 : 0 },
      uSpecularExponent: { value: float.g_flSpecularExponent ?? 20 },
      uSpecularScale: { value: float.g_flSpecularScale ?? 1 },
      uRimLightScale: { value: float.g_flRimLightScale ?? 1 },
      uAmbientScale: { value: float.g_flAmbientScale ?? 1 },
      uSpecularColor: { value: vector(vec.g_vSpecularColor, [1, 1, 1]) },
      uRimLightColor: { value: vector(vec.g_vRimLightColor, [1, 1, 1]) },
      uKeyDir: { value: stage.keyDir },
      uKeyColor: { value: stage.keyColor },
      uFillDir: { value: stage.fillDir },
      uFillColor: { value: stage.fillColor },
      uSkyColor: { value: stage.skyColor },
      uGroundColor: { value: stage.groundColor },
      uStageRim: stageRim,
    },
    transparent: translucent,
    depthWrite: !translucent,
    blending: int.F_ADDITIVE_BLEND ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: int.F_RENDER_BACKFACES ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.name = original.name;
  return material;
}
