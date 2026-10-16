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
  uniform sampler2D tCubeMap;
  uniform sampler2D tDetail;
  uniform sampler2D tDetail2;
  uniform float uDetail2Mode;
  uniform float uDetail2Factor;
  uniform vec2 uDetail2Scale;
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
  uniform vec2 uDetailScale;
  uniform float uAlphaTest;
  uniform float uSelfIllum;

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

    // Detail texture, masked by Masks1 R, multiplied in at twice its value
    vec3 glow = vec3(0.0);
    // Detail textures where Masks1 R says, by the game's modes: 1 add, 2 add and
    // self-illuminate, 3 multiply by twice
    float selfIllum = masks1.a * uSelfIllum;
    float detailMask = uHasMasks1 > 0.5 ? masks1.r : 1.0;
    if (uDetailMode > 0.5) {
      vec3 detail = texture2D(tDetail, vUv * uDetailScale).rgb * uDetailTint;
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
      albedo += texture2D(tDetail2, vUv * uDetail2Scale).rgb * uDetail2Tint * amount;
      if (uDetail2Mode > 1.5) selfIllum = max(selfIllum, amount);
    }

    // Diffuse with Dota's warp ramp
    float nl = dot(n, uKeyDir);
    float halfLambert = nl * 0.5 + 0.5;
    vec3 keyDiffuse = uHasDiffuseWarp > 0.5
      ? texture2D(tDiffuseWarp, vec2(halfLambert, 0.5)).rgb
      : vec3(halfLambert * halfLambert);
    float fill = max(dot(n, uFillDir), 0.0);
    vec3 ambient = mix(uGroundColor, uSkyColor, n.y * 0.5 + 0.5) * uAmbientScale;
    float metal = masks1.b;
    // Metal gets its color from reflections, not from diffuse light
    vec3 diffuse = albedo * (keyDiffuse * uKeyColor + fill * uFillColor + ambient) * (1.0 - metal * 0.6);

    // Fresnel ramp drives rim and specular falloff
    float facing = clamp(1.0 - dot(n, v), 0.0, 1.0);
    vec3 fresnel = uHasFresnelWarp > 0.5 ? texture2D(tFresnelWarp, vec2(facing, 0.5)).rgb : vec3(facing * facing);

    // Specular, exponent and intensity from Masks2
    float exponent = uHasMasks2 > 0.5 ? max(masks2.a * 100.0, 1.0) : uSpecularExponent;
    // Materials push the scale up to 10; past a point that only turns cloth into silver
    float intensity = (uHasMasks2 > 0.5 ? masks2.r : 0.2) * min(uSpecularScale, 6.0) * 0.12;
    vec3 h = normalize(uKeyDir + v);
    float spec = pow(max(dot(n, h), 0.0), exponent) * max(nl, 0.0);
    vec3 specColor = mix(uSpecularColor * mix(vec3(1.0), albedo * 2.0, 0.5), albedo, masks2.b);
    vec3 specular = specColor * uKeyColor * spec * intensity * (0.4 + fresnel.b);

    // Rim from above, in the item's rarity tint
    float rimMask = uHasMasks2 > 0.5 ? masks2.g : 0.3;
    float rimUp = clamp(n.y * 0.6 + 0.4, 0.0, 1.0);
    // The material's own rim color (Terrorblade's is cyan), with a touch of the stage's
    vec3 rim = min(fresnel.g * rimMask * uRimLightScale * 0.35, 0.9) * rimUp * mix(uRimLightColor, uStageRim, 0.25);

    // Reflections of a studio instead of the material's cube map: a softbox above,
    // strip lights at the sides, a dark floor and a back light in the rarity color.
    // Masked by metalness, tinted by the base color as much as Masks2 B says.
    vec3 r = reflect(-v, n);
    vec3 studio = mix(vec3(0.015, 0.018, 0.025), vec3(0.06, 0.07, 0.09), smoothstep(-0.6, 0.2, r.y));
    studio += vec3(1.0, 0.97, 0.92) * softbox(r, vec3(-0.5, 0.55, 0.65), 0.55) * 1.3;
    studio += vec3(0.8, 0.88, 1.0) * softbox(r, vec3(0.95, 0.15, 0.25), 0.3) * 0.8;
    studio += vec3(0.9, 0.92, 1.0) * smoothstep(0.65, 0.95, r.y) * 0.6;
    studio += uStageRim * softbox(r, vec3(0.0, 0.25, -1.0), 0.8) * 0.7;
    // Dota tints reflections by the base color unless the material blends that away
    vec3 tint = mix(albedo * 2.0, vec3(1.0), uReflectionsUntinted);
    // The cube map comes as a single face; read it like a matcap, by the view-space
    // reflection, which gives the uneven streaks Dota's reflections have
    if (uHasCubeMap > 0.5) {
      vec2 capUv = r.xy * vec2(0.5, -0.5) + 0.5;
      // Some cube maps come out black; the studio stays underneath for those
      studio = studio * 0.6 + texture2D(tCubeMap, capUv).rgb * 1.1;
    }
    vec3 env = studio * tint * metal * uCubeMapScale * mix(0.6, 1.2, fresnel.b);

    // Masks1 alpha is the hero shader's self-illumination mask (eyes, glowing parts)
    // it shows the base color as it is instead of the light on it, not on top of it
    vec3 lit = diffuse + specular + rim + env + glow;
    // Brighter than white, so the glow pass picks glowing parts up
    vec3 outColor = mix(lit, albedo, selfIllum);
    gl_FragColor = vec4(outColor, color.a);
    #include <colorspace_fragment>
  }
`;

// Key, fill and ambient add up to about 1 on a lit side, so the base color shows as painted
const studioKeyDir = new THREE.Vector3(-0.45, 0.75, 0.5).normalize();
const stage = {
  keyDir: studioKeyDir.clone(),
  keyColor: new THREE.Color(0.95, 0.92, 0.86),
  fillDir: new THREE.Vector3(0.7, -0.1, 0.4).normalize(),
  fillColor: new THREE.Color(0.1, 0.12, 0.16),
  skyColor: new THREE.Color(0.2, 0.21, 0.25),
  groundColor: new THREE.Color(0.06, 0.055, 0.06),
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
      tCubeMap: { value: pick("g_tCubeMap") },
      uHasNormal: { value: pick("g_tNormal") ? 1 : 0 },
      uHasMasks1: { value: int.F_MASKS_1 && pick("g_tMasks1") ? 1 : 0 },
      uHasMasks2: { value: int.F_MASKS_2 && pick("g_tMasks2") ? 1 : 0 },
      uHasDiffuseWarp: { value: int.F_DIFFUSE_WARP && pick("g_tDiffuseWarp") ? 1 : 0 },
      uHasFresnelWarp: { value: pick("g_tFresnelWarp") ? 1 : 0 },
      uHasCubeMap: { value: pick("g_tCubeMap") ? 1 : 0 },
      tDetail: { value: pick("g_tDetail") },
      tDetail2: { value: pick("g_tDetail2") },
      uDetail2Mode: { value: pick("g_tDetail2") && (float.g_flDetail2BlendFactor ?? 1) > 0 ? (int.F_DETAIL_2 ?? 0) : 0 },
      uDetail2Factor: { value: float.g_flDetail2BlendFactor ?? 1 },
      uDetail2Scale: { value: new THREE.Vector2(vec.g_vDetail2TexCoordScale?.[0] || 1, vec.g_vDetail2TexCoordScale?.[1] || 1) },
      uDetailTint: { value: vector(vec.g_vDetail1ColorTint, [1, 1, 1]) },
      uDetail2Tint: { value: vector(vec.g_vDetail2ColorTint, [1, 1, 1]) },
      uDetailMode: { value: pick("g_tDetail") ? (int.F_DETAIL ?? 0) : 0 },
      uDetailFactor: { value: float.g_flDetailBlendFactor ?? 1 },
      uDetailScale: {
        value: new THREE.Vector2(
          vec.g_vDetailTexCoordScale?.[0] ?? float.g_flDetailTexCoordScale ?? 1,
          vec.g_vDetailTexCoordScale?.[1] ?? float.g_flDetailTexCoordScale ?? 1
        ),
      },
      uAlphaTest: { value: int.F_ALPHA_TEST ? 0.5 : 0 },
      // The flag is often not set on materials whose mask still glows in the game
      uSelfIllum: { value: int.F_MASKS_1 ? 1 : 0 },
      uSpecularExponent: { value: float.g_flSpecularExponent ?? 20 },
      uSpecularScale: { value: float.g_flSpecularScale ?? 1 },
      uRimLightScale: { value: float.g_flRimLightScale ?? 1 },
      uAmbientScale: { value: float.g_flAmbientScale ?? 1 },
      uReflectionsUntinted: { value: float.g_flReflectionsTintByBaseBlendToNone ?? 0 },
      // Materials with a cube map are the glossy ones, the rest reflect a little
      uCubeMapScale: {
        value: int.F_SPECULAR_CUBE_MAP ? THREE.MathUtils.clamp((float.g_flCubeMapScalar ?? 8) / 8, 0.4, 1.6) : 0.35,
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
    },
    transparent: translucent,
    depthWrite: !translucent,
    blending: int.F_ADDITIVE_BLEND ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: int.F_RENDER_BACKFACES ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.name = original.name;
  return material;
}
