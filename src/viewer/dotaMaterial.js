import * as THREE from "three";
import { materialPrograms, runProgram } from "./materialPrograms.js";

// Dota's hero.vfx shader, after its compiled pixel shader. The textures and parameters come from the
// material's vmat data that Source2Viewer keeps in the glTF extras:
//   Masks1: R detail, G diffuse warp, B metalness, A self-illumination
//   Masks2: R specular intensity, G rim intensity, B tint specular by base color, A specular exponent
//   DiffuseWarp: light ramp by half-Lambert, FresnelWarp: R color, G rim, B specular by view angle
// Lighting is a fixed studio rig in view space, the rim light is tinted per item.

const vertexShader = /* glsl */ `
  #include <common>
  #include <morphtarget_pars_vertex>
  #include <skinning_pars_vertex>
  #include <shadowmap_pars_vertex>

  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldNormal;

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
    #include <worldpos_vertex>
    #include <shadowmap_vertex>
    vViewNormal = normalize(transformedNormal);
    vWorldNormal = normalize(inverseTransformDirection(transformedNormal, viewMatrix));
    vViewPosition = -mvPosition.xyz;
  }
`;

const fragmentShader = /* glsl */ `
  #include <common>
  #include <packing>
  #include <lights_pars_begin>
  #include <shadowmap_pars_fragment>
  uniform sampler2D tColor;
  uniform mat3 uBaseUv;
  uniform mat3 uNormalUv;
  uniform mat3 uAlphaUv;
  uniform mat3 uDetailUv;
  uniform mat3 uDetail2Uv;
  uniform float uSeparateAlpha;
  uniform float uOpaque;
  uniform float uFresnelAlpha;
  uniform sampler2D tNormal;
  uniform sampler2D tMasks1;
  uniform sampler2D tMasks2;
  uniform sampler2D tDiffuseWarp;
  uniform sampler2D tFresnelWarp;
  uniform sampler2D tCubeMap;
  uniform sampler2D tDetail;
  uniform sampler2D tDetail2;
  uniform float uDetail2Mode;
  uniform float uDetail2Factor;
  uniform vec3 uDetailTint;
  uniform vec3 uDetail2Tint;

  uniform float uHasNormal;
  uniform float uHasMasks1;
  uniform float uHasMasks2;
  uniform float uHasDiffuseWarp;
  uniform float uHasFresnelWarp;
  uniform float uHasCubeMap;
  uniform float uDetailMode;
  uniform float uDetailFactor;
  uniform float uAlphaTest;
  uniform float uSelfIllum;
  uniform float uSelfIllumToFull;
  uniform float uDetailToFull;
  uniform float uMetalToFull;
  uniform float uSpecularToFull;
  uniform float uWarpToFull;
  uniform float uRimToFull;
  uniform float uExponentToFull;
  uniform float uWarpSelectsRow;
  uniform float uMaskCubeByMetal;
  uniform float uIllumination;
  uniform float uOverbright;

  uniform float uSpecularExponent;
  uniform float uSpecularScale;
  uniform float uRimLightScale;
  uniform float uAmbientScale;
  uniform float uCubeMapScale;
  uniform float uReflectionsUntinted;
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
  varying vec3 vWorldNormal;

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

  // A soft round light of the studio: 1 inside an angle of size radians around dir, fading out
  float softbox(vec3 r, vec3 dir, float size) {
    return smoothstep(cos(size), cos(size * 0.35), dot(r, normalize(dir)));
  }

  void main() {
    // Each layer's texture coordinates, moved, scaled and turned as the material says
    vec2 uv = (uBaseUv * vec3(vUv, 1.0)).xy;
    vec4 color = texture2D(tColor, uv);
    if (uSeparateAlpha > 0.5) color.a = texture2D(tColor, (uAlphaUv * vec3(vUv, 1.0)).xy).a;
    if (uAlphaTest > 0.0 && color.a < uAlphaTest) discard;

    vec4 masks1 = uHasMasks1 > 0.5 ? texture2D(tMasks1, uv) : vec4(0.0);
    vec4 masks2 = uHasMasks2 > 0.5 ? texture2D(tMasks2, uv) : vec4(0.0);

    vec3 n = normalize(vViewNormal);
    if (!gl_FrontFacing) n = -n;
    if (uHasNormal > 0.5) {
      vec2 normalUv = (uNormalUv * vec3(vUv, 1.0)).xy;
      vec3 mapN = texture2D(tNormal, normalUv).xyz * 2.0 - 1.0;
      n = perturbNormal(n, -vViewPosition, normalUv, mapN);
    }
    vec3 worldN = normalize(vWorldNormal);
    vec3 v = normalize(vViewPosition);
    vec3 albedo = color.rgb;

    // Detail textures where Masks1 R says, by the game's modes: 1 add, 2 add and
    // self-illuminate, 3 multiply by twice
    float selfIllum = max(masks1.a * uSelfIllum, uSelfIllumToFull);
    float detailMask = uHasMasks1 > 0.5 ? max(masks1.r, uDetailToFull) : 1.0;
    if (uDetailMode > 0.5) {
      vec3 detail = texture2D(tDetail, (uDetailUv * vec3(vUv, 1.0)).xy).rgb * uDetailTint;
      float amount = detailMask * uDetailFactor;
      if (uDetailMode > 2.5) {
        albedo *= mix(vec3(1.0), detail * 2.0, amount);
      } else {
        albedo += detail * amount;
        if (uDetailMode > 1.5) selfIllum = max(selfIllum, amount);
      }
    }
    if (uDetail2Mode > 0.5) {
      float amount = detailMask * uDetail2Factor;
      albedo += texture2D(tDetail2, (uDetail2Uv * vec3(vUv, 1.0)).xy).rgb * uDetail2Tint * amount;
      if (uDetail2Mode > 1.5) selfIllum = max(selfIllum, amount);
    }

    // What follows is the game's hero.vfx pixel shader, read from its compiled code.
    // Masks with "blend to full" are raised to that value.
    float warpMask = max(masks1.g, uWarpToFull);
    float metal = max(masks1.b, uMetalToFull);
    float specMask = uHasMasks2 > 0.5 ? max(masks2.r, uSpecularToFull) : 0.0;
    float rimMask = max(masks2.g, uRimToFull);
    float tintMask = max(masks2.b, uReflectionsUntinted);
    float exponentMask = max(masks2.a, uExponentToFull);

    // Fresnel warp, looked up by N.V: R the rim, B the specular
    float nv = dot(n, v);
    vec3 fresnel = uHasFresnelWarp > 0.5 ? texture2D(tFresnelWarp, vec2(clamp(nv, 0.0, 1.0), 0.5)).rgb : vec3(1.0 - clamp(nv, 0.0, 1.0));

    // Diffuse: half-Lambert, through the warp ramp whose row Masks1 G picks
    float nl = dot(n, uKeyDir);
    // The stage's shadows (rocks, the model's own arms and weapons), as the game darkens
    // its sun with its shadow map before the warp ramp
    float shadow = 1.0;
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      DirectionalLightShadow sunShadow = directionalLightShadows[ 0 ];
      shadow = getShadow( directionalShadowMap[ 0 ], sunShadow.shadowMapSize, sunShadow.shadowIntensity, sunShadow.shadowBias, sunShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] );
      shadow = mix(1.0, shadow, 0.85);
    #endif
    float halfLambert = (nl * 0.5 + 0.5) * shadow;
    vec3 warped = uHasDiffuseWarp > 0.5 ? texture2D(tDiffuseWarp, vec2(halfLambert, warpMask)).rgb : vec3(halfLambert);
    vec3 diffuseLight = mix(vec3(halfLambert), warped, uWarpSelectsRow > 0.5 ? 1.0 : warpMask) * uKeyColor;
    // A second light that fills from another side, then the sky and the ground
    diffuseLight += clamp(dot(n, uFillDir), 0.0, 1.0) * uFillColor * uAmbientScale;
    diffuseLight += mix(uGroundColor, uSkyColor, worldN.y * 0.5 + 0.5) * uAmbientScale;
    // Lamps on the stage: fires and the like light the side of the model turned to them
    #if NUM_POINT_LIGHTS > 0
      for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
        vec3 toLamp = pointLights[ i ].position + vViewPosition;
        float lampDistance = length(toLamp);
        float lampFalloff = getDistanceAttenuation(lampDistance, pointLights[ i ].distance, pointLights[ i ].decay);
        diffuseLight += pointLights[ i ].color * lampFalloff * clamp(dot(n, toLamp / lampDistance), 0.0, 1.0);
      }
    #endif

    // Specular: Phong, sharpness from Masks2 A, plus the cube map unless metal masks it
    vec3 r = reflect(-v, n);
    float exponent = exponentMask * uSpecularExponent;
    float phong = pow(max(clamp(dot(r, uKeyDir), 0.0, 1.0), 0.001), max(exponent, 1.0)) * clamp(nl, 0.0, 1.0) * shadow;
    vec3 env = vec3(0.0);
    if (uHasCubeMap > 0.5) {
      // The cube map comes as a single face; read it like a matcap by the reflection
      env = texture2D(tCubeMap, r.xy * vec2(0.5, -0.5) + 0.5).rgb;
      // Some cube maps come out black; a soft studio stands in for those
      if (dot(env, vec3(1.0)) < 0.01) {
        env = mix(vec3(0.02, 0.025, 0.03), vec3(0.08, 0.09, 0.1), smoothstep(-0.6, 0.2, r.y));
        env += vec3(1.0, 0.97, 0.92) * softbox(r, vec3(-0.5, 0.55, 0.65), 0.55) * 0.8;
        env += vec3(0.8, 0.88, 1.0) * softbox(r, vec3(0.95, 0.15, 0.25), 0.3) * 0.4;
      }
      env *= uCubeMapScale;
    }
    vec3 specular = (phong * uKeyColor * uSpecularScale + env * (1.0 - uMaskCubeByMetal)) * specMask;
    specular *= mix(albedo, uSpecularColor, tintMask) * max(fresnel.b, metal);

    vec3 lit = diffuseLight * albedo + specular;
    // Metal shows its reflections and highlights only
    vec3 metalColor = env * uMaskCubeByMetal + specular;
    vec3 outColor = mix(lit, metalColor, metal);

    // Rim from above, in the rim color and the fill light's color
    vec3 rim = rimMask * uRimLightColor * uRimLightScale * uFillColor * max(worldN.y, 0.0) * fresnel.r;
    outColor = outColor * uIllumination + rim * mix(vec3(1.0), uStageRim * 2.0, 0.15);

    // Self-illuminated parts show their color as it is, a little brighter for the glow pass
    outColor = mix(outColor, albedo * 1.2, clamp(selfIllum, 0.0, 1.0)) * uOverbright;
    // An opaque material covers the page behind the scene fully; the color's alpha holds masks
    // g_flFresnelModulatesAlpha: a see-through shell shows towards its outline only, where the
    // surface turns away from the eye (a rim light laid over a model, as the prismatic sets')
    float alpha = color.a * mix(1.0, 1.0 - clamp(abs(nv), 0.0, 1.0), uFresnelAlpha);
    gl_FragColor = vec4(outColor, uOpaque > 0.5 ? 1.0 : alpha);
    #include <colorspace_fragment>
  }
`;

// Key, fill and ambient add up to about 1 on a lit side, so the base color shows as painted
const studioKeyDir = new THREE.Vector3(-0.45, 0.75, 0.5).normalize();
const stage = {
  keyDir: studioKeyDir.clone(),
  keyColor: new THREE.Color(1.0, 0.97, 0.92),
  // The fill comes from behind on the right; its color is also the rim's, as in the game
  fillDir: new THREE.Vector3(0.6, 0.2, -0.75).normalize(),
  fillColor: new THREE.Color(0.42, 0.47, 0.58),
  skyColor: new THREE.Color(0.2, 0.22, 0.27),
  groundColor: new THREE.Color(0.07, 0.065, 0.065),
};

const studio = {
  keyColor: stage.keyColor.clone(),
  fillColor: stage.fillColor.clone(),
  skyColor: stage.skyColor.clone(),
  groundColor: stage.groundColor.clone(),
};

// The light of a scene of the game instead of the studio, or null for the studio again.
// keyDir is in view space, so a scene's light is turned with the camera every frame.
export function setDotaLighting(light) {
  stage.keyColor.copy(light?.key ?? studio.keyColor);
  stage.fillColor.copy(light?.fill ?? studio.fillColor);
  stage.skyColor.copy(light?.sky ?? studio.skyColor);
  stage.groundColor.copy(light?.ground ?? studio.groundColor);
  if (!light) {
    stage.keyDir.copy(studioKeyDir);
  }
}

export function setDotaKeyDir(viewDir) {
  stage.keyDir.copy(viewDir);
}


// Shared so a rarity change recolors every material at once
export const stageRim = { value: new THREE.Color("#c9a45c") };

// A vmat's color, or the fallback where it gives none or a broken one (some skins' vmats give
// [null, null]: as a color that is NaN, and the glow pass draws NaN as black over the model)
export function colorParam(values) {
  return Array.isArray(values) && values.length >= 3 && values.slice(0, 3).every(Number.isFinite) ? values : null;
}

function vector(values, fallback) {
  const color = colorParam(values) ?? fallback;
  return new THREE.Color(color[0], color[1], color[2]);
}

// Each texture layer's offset, scale and rotation (degrees) in the vmat. The normal map and the
// color's alpha follow the base layer unless F_SEPARATE_NORMAL_TRANSFORM / _ALPHA_ say otherwise.
const UV_LAYERS = {
  uBaseUv: ["g_vTexCoordOffset", "g_vTexCoordScale", "g_flTexCoordRotation"],
  uNormalUv: ["g_vNormalTexCoordOffset", "g_vNormalTexCoordScale", "g_flNormalTexCoordRotation"],
  uAlphaUv: ["g_vAlphaTexCoordOffset", "g_vAlphaTexCoordScale", "g_flAlphaTexCoordRotation"],
  uDetailUv: ["g_vDetailTexCoordOffset", "g_vDetailTexCoordScale", "g_flDetailTexCoordRotation"],
  uDetail2Uv: ["g_vDetail2TexCoordOffset", "g_vDetail2TexCoordScale", "g_flDetail2TexCoordRotation"],
};
const UV_PARAMS = new Set(Object.values(UV_LAYERS).flat());

// A parameter's numbers, a float as one; null where the vmat gives none
function paramValue(vmat, name) {
  const value = vmat.VectorParams?.[name] ?? vmat.FloatParams?.[name] ?? vmat.FloatParams?.[name.replace(/^g_v/, "g_fl")];
  const values = (Array.isArray(value) ? value : [value]).filter(Number.isFinite);
  return values.length ? values : null;
}

function setUvLayer(matrix, get, [offset, scale, rotation]) {
  const o = get(offset) ?? [0];
  const s = get(scale) ?? [1];
  const angle = ((get(rotation)?.[0] ?? 0) * Math.PI) / 180;
  matrix.setUvTransform(o[0], o[1] ?? o[0], s[0] || 1, (s[1] ?? s[0]) || 1, angle, 0, 0);
}

// textures: { g_tColor: Texture, ... } matched by the vmat texture names
export function createDotaMaterial(original, vmat, textures) {
  const int = vmat.IntParams ?? {};
  const float = vmat.FloatParams ?? {};
  const vec = vmat.VectorParams ?? {};
  // Parameters the game works out every frame (M-04), by the vmat's path
  const programs = materialPrograms(vmat.Name);
  const pick = (name) => textures[name] ?? null;
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;

  const translucent = int.F_TRANSLUCENT === 1 || int.F_ADDITIVE_BLEND === 1;
  const material = new THREE.ShaderMaterial({
    lights: true,
    vertexShader,
    fragmentShader,
    uniforms: {
      // The scene's lights, for the shadow of the stage's sun
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      tColor: { value: pick("g_tColor") ?? original.map ?? white },
      tNormal: { value: pick("g_tNormal") },
      tMasks1: { value: pick("g_tMasks1") },
      tMasks2: { value: pick("g_tMasks2") },
      tDiffuseWarp: { value: pick("g_tDiffuseWarp") },
      tFresnelWarp: { value: pick("g_tFresnelWarp") },
      tCubeMap: { value: pick("g_tCubeMap") },
      uHasNormal: { value: pick("g_tNormal") ? 1 : 0 },
      // A mask the material has is used, whether or not its flag made it into the data
      uHasMasks1: { value: pick("g_tMasks1") ? 1 : 0 },
      uHasMasks2: { value: pick("g_tMasks2") ? 1 : 0 },
      uHasDiffuseWarp: { value: int.F_DIFFUSE_WARP && pick("g_tDiffuseWarp") ? 1 : 0 },
      uHasFresnelWarp: { value: pick("g_tFresnelWarp") ? 1 : 0 },
      uHasCubeMap: { value: int.F_SPECULAR_CUBE_MAP && pick("g_tCubeMap") ? 1 : 0 },
      tDetail: { value: pick("g_tDetail") },
      tDetail2: { value: pick("g_tDetail2") },
      uDetail2Mode: { value: pick("g_tDetail2") && ((float.g_flDetail2BlendFactor ?? 1) > 0 || programs?.g_flDetail2BlendFactor) ? (int.F_DETAIL_2 ?? 0) : 0 },
      uDetail2Factor: { value: float.g_flDetail2BlendFactor ?? 1 },
      uDetailTint: { value: vector(vec.g_vDetail1ColorTint, [1, 1, 1]) },
      uDetail2Tint: { value: vector(vec.g_vDetail2ColorTint, [1, 1, 1]) },
      uDetailMode: { value: pick("g_tDetail") ? (int.F_DETAIL ?? 0) : 0 },
      uDetailFactor: { value: float.g_flDetailBlendFactor ?? 1 },
      ...Object.fromEntries(Object.keys(UV_LAYERS).map((name) => [name, { value: new THREE.Matrix3() }])),
      uSeparateAlpha: { value: int.F_SEPARATE_ALPHA_TRANSFORM ? 1 : 0 },
      uAlphaTest: { value: int.F_ALPHA_TEST ? 0.5 : 0 },
      // The flag is often not set on materials whose mask still glows in the game
      uSelfIllum: { value: pick("g_tMasks1") || float.g_flSelfIllumBlendToFull ? 1 : 0 },
      // "Blend to full" turns a mask all the way on for the whole material
      uSelfIllumToFull: { value: float.g_flSelfIllumBlendToFull ?? 0 },
      uDetailToFull: { value: float.g_flDetailBlendToFull ?? 0 },
      uMetalToFull: { value: float.g_flMetalnessBlendToFull ?? 0 },
      uSpecularToFull: { value: float.g_flSpecularBlendToFull ?? 0 },
      uWarpToFull: { value: float.g_flDiffuseWarpBlendToFull ?? 0 },
      uRimToFull: { value: float.g_flEnvMapBlendToFull ?? 0 },
      uExponentToFull: { value: float.g_flSpecularExponentBlendToFull ?? 0 },
      uWarpSelectsRow: { value: int.g_bDiffuseWarpMaskSelectsWarpTopOrBottom ? 1 : 0 },
      uMaskCubeByMetal: { value: int.F_MASK_CUBE_MAP_BY_METALNESS || int.g_bMaskCubeMapByMetalness ? 1 : 0 },
      uIllumination: { value: (float.g_flIlluminationScale ?? 1) * (float.g_flWorldIlluminationScale ?? 1) },
      uOverbright: { value: float.g_flOverbrightFactor ?? 1 },
      uSpecularExponent: { value: float.g_flSpecularExponent ?? 20 },
      uSpecularScale: { value: float.g_flSpecularScale ?? 1 },
      uRimLightScale: { value: float.g_flRimLightScale ?? 1 },
      uAmbientScale: { value: float.g_flAmbientScale ?? 1 },
      uReflectionsUntinted: { value: float.g_flReflectionsTintByBaseBlendToNone ?? 0 },
      // Materials with a cube map are the glossy ones, the rest reflect a little
      uCubeMapScale: {
        value: float.g_flCubeMapScalar ?? 1,
      },
      uSpecularColor: { value: vector(vec.g_vSpecularColor, [1, 1, 1]) },
      uRimLightColor: { value: vector(vec.g_vRimLightColor, [1, 1, 1]) },
      uKeyDir: { value: stage.keyDir },
      uKeyColor: { value: stage.keyColor },
      uFillDir: { value: stage.fillDir },
      uFillColor: { value: stage.fillColor },
      uSkyColor: { value: stage.skyColor },
      uGroundColor: { value: stage.groundColor },
      uStageRim: stageRim,
      uOpaque: { value: translucent ? 0 : 1 },
      uFresnelAlpha: { value: Math.min(Math.max(float.g_flFresnelModulatesAlpha ?? 0, 0), 1) },
    },
    transparent: translucent,
    depthWrite: !translucent,
    blending: int.F_ADDITIVE_BLEND ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: int.F_RENDER_BACKFACES ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.name = original.name;
  const glow = createGlowMaterial(vmat, textures, material.uniforms, material.side, Boolean(programs?.g_flBloomScale));
  material.userData.glow = glow;
  const u = material.uniforms;

  // The parameters' values: the vmat's own, or what a program gives at this moment
  const values = new Map();
  const get = (name) => values.get(name) ?? paramValue(vmat, name);
  const animatesUv = Object.keys(programs ?? {}).some((name) => UV_PARAMS.has(name));
  const refresh = (initial) => {
    if (initial || animatesUv) {
      for (const [name, layer] of Object.entries(UV_LAYERS)) setUvLayer(u[name].value, get, layer);
      if (!int.F_SEPARATE_NORMAL_TRANSFORM) u.uNormalUv.value.copy(u.uBaseUv.value);
    }
    if (!programs && !initial) return;
    u.uDetailFactor.value = get("g_flDetailBlendFactor")?.[0] ?? 1;
    u.uDetail2Factor.value = get("g_flDetail2BlendFactor")?.[0] ?? 1;
    u.uOverbright.value = get("g_flOverbrightFactor")?.[0] ?? 1;
    const rim = colorParam(get("g_vRimLightColor"));
    if (rim) u.uRimLightColor.value.setRGB(rim[0], rim[1], rim[2]);
    // The game's own reference only where it changes over time; fixed ones keep the half
    if (int.F_ALPHA_TEST && programs?.g_flAlphaTestReference) u.uAlphaTest.value = get("g_flAlphaTestReference")?.[0] ?? 0.5;
    if (glow) {
      const tint = colorParam(get("g_vBloomColor")) ?? [1, 1, 1];
      glow.uniforms.uGlow.value.setRGB(tint[0], tint[1], tint[2]).multiplyScalar(Math.max(get("g_flBloomScale")?.[0] ?? 0, 0));
    }
    // A material fully cloaked is not seen in the game, only what its effects draw (Io's body)
    const cloaked = Boolean(int.F_ENABLE_CLOAK) && (get("g_flMaterialCloakFactor")?.[0] ?? 0) >= 0.99;
    material.visible = !cloaked;
    if (glow) glow.visible = !cloaked;
  };
  refresh(true);
  // Called every frame with the time in seconds
  if (programs) {
    material.userData.animate = (time) => {
      for (const [name, program] of Object.entries(programs)) {
        const value = runProgram(program, time);
        if (value) values.set(name, value);
      }
      refresh(false);
    };
  }
  return material;
}

// The halo the game puts around a material's glowing parts, in the material's own bloom
// color and strength (g_vBloomColor, g_flBloomScale), drawn into a separate glow pass.
// null for materials without one.
// Shares the main material's texture coordinates and alpha test, which may change every frame.
function createGlowMaterial(vmat, textures, main, side, animated) {
  const float = vmat.FloatParams ?? {};
  const scale = float.g_flBloomScale ?? 0;
  const masks1 = textures.g_tMasks1;
  if ((scale <= 0 && !animated) || (!masks1 && !float.g_flSelfIllumBlendToFull)) {
    return null;
  }
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor;
      uniform sampler2D tMasks1;
      uniform mat3 uBaseUv;
      uniform mat3 uAlphaUv;
      uniform float uSeparateAlpha;
      uniform float uHasMasks1;
      uniform float uToFull;
      uniform float uAlphaTest;
      uniform vec3 uGlow;
      varying vec2 vUv;
      void main() {
        vec2 uv = (uBaseUv * vec3(vUv, 1.0)).xy;
        vec4 color = texture2D(tColor, uv);
        if (uSeparateAlpha > 0.5) color.a = texture2D(tColor, (uAlphaUv * vec3(vUv, 1.0)).xy).a;
        if (uAlphaTest > 0.0 && color.a < uAlphaTest) discard;
        float mask = uHasMasks1 > 0.5 ? texture2D(tMasks1, uv).a : 0.0;
        // The surface's own color, tinted by the material's bloom color
        gl_FragColor = vec4(color.rgb * uGlow * mix(mask, 1.0, uToFull), 1.0);
      }
    `,
    uniforms: {
      tColor: main.tColor,
      uBaseUv: main.uBaseUv,
      uAlphaUv: main.uAlphaUv,
      uSeparateAlpha: main.uSeparateAlpha,
      uAlphaTest: main.uAlphaTest,
      tMasks1: { value: masks1 ?? null },
      uHasMasks1: { value: masks1 ? 1 : 0 },
      uToFull: { value: float.g_flSelfIllumBlendToFull ?? 0 },
      // Set by the main material from g_vBloomColor and g_flBloomScale
      uGlow: { value: new THREE.Color() },
    },
    side,
  });
}
