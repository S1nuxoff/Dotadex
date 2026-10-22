import * as THREE from "three";
import { materialPrograms, runProgram } from "./materialPrograms.js";

// Dota's hero.vfx shader, after its compiled pixel shader. The textures and parameters come from the
// material's vmat data that Source2Viewer keeps in the glTF extras:
//   Masks1: R detail, G diffuse warp, B metalness, A self-illumination
//   Masks2: R specular intensity, G rim intensity, B tint specular by base color, A specular exponent
//   DiffuseWarp: light ramp by half-Lambert, FresnelWarp: R color, G rim, B specular by view angle
// Lighting is a fixed studio rig in view space, the rim light is tinted per item.

// The sun's shadow as hero.vfx and global_lit_simple.vfx read it. The point is pushed out along
// its normal before it is projected (the light's normalBias); outside the shadow map it is lit
// (its sampler's border is 1). hero.vfx has a 9-tap path (a texel apart, 0.206 / 0.124 / 0.075)
// and a soft 25-tap one taken only when the view's highqualityshadows is set (client.dll
// 0x182224b7c), which no layout sets; its extra 0.0007 nearer would also erase every shadow within
// about 15 units on the hero page's perspective map (near 4), the hat's on the face among them,
// which the game shows. So the 9-tap one is drawn; ?shadow25 draws the other
const sunShadowChunk = /* glsl */ `
  // ?shadowview tells apart a point outside the shadow map (-1) and no shadow map at all (-2)
  #ifdef SHADOW_VIEW
    #define SUN_OUTSIDE -1.0
    #define SUN_OFF -2.0
    #define SUN_NO_LIGHT -3.0
    #define SUN_NOT_PCF -4.0
  #else
    #define SUN_NO_LIGHT 1.0
    #define SUN_NOT_PCF 1.0
    #define SUN_OUTSIDE 1.0
    #define SUN_OFF 1.0
  #endif
  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0 && defined( SHADOWMAP_TYPE_PCF )
    // hero.vfx's soft path (cb2[18].w > 0, the scene's highqualityshadows): 25 bilinear compares on
    // a Poisson disk of 5 texels radius, 0.0007 nearer the light, a tap off the map counting as shadow
    const vec2 SUN_DISK[25] = vec2[25](
      vec2(-0.978698, -0.088412), vec2(-0.841121, 0.521165), vec2(-0.717460, -0.503220), vec2(-0.702933, 0.903134), vec2(-0.663198, 0.154820),
      vec2(-0.495102, -0.232887), vec2(-0.364238, -0.961791), vec2(-0.345866, -0.564379), vec2(-0.325663, 0.640370), vec2(-0.182714, 0.321329),
      vec2(-0.142613, -0.022736), vec2(-0.056429, -0.367290), vec2(-0.018586, 0.918882), vec2(0.038179, -0.728996), vec2(0.165990, 0.093112),
      vec2(0.253639, 0.719535), vec2(0.369549, -0.655019), vec2(0.423627, 0.429975), vec2(0.530747, -0.364971), vec2(0.566027, -0.940489),
      vec2(0.639332, 0.028413), vec2(0.652089, 0.669668), vec2(0.773797, 0.345012), vec2(0.968871, 0.840449), vec2(0.991882, -0.657338)
    );
    float sunShadow() {
      DirectionalLightShadow light = directionalLightShadows[ 0 ];
      vec4 coord = vDirectionalShadowCoord[ 0 ];
      coord.xyz /= coord.w;
      coord.z += light.shadowBias - 0.0007;
      if (coord.x < 0.0 || coord.x > 1.0 || coord.y < 0.0 || coord.y > 1.0 || coord.z > 1.0) return SUN_OUTSIDE;
      #ifndef SHADOW_25TAP
        // The usual path: 9 compares a texel apart, no extra offset
        coord.z += 0.0007;
        float s = 1.0 / light.shadowMapSize.x;
        #define SUN_TAP(x, y) texture( directionalShadowMap[ 0 ], vec3( coord.xy + vec2(x, y) * s, coord.z ) )
        float corners = SUN_TAP(1.0, 1.0) + SUN_TAP(-1.0, 1.0) + SUN_TAP(1.0, -1.0) + SUN_TAP(-1.0, -1.0);
        float sides = SUN_TAP(1.0, 0.0) + SUN_TAP(-1.0, 0.0) + SUN_TAP(0.0, 1.0) + SUN_TAP(0.0, -1.0);
        float lit = (corners * 0.074906 + sides * 0.123596 + SUN_TAP(0.0, 0.0) * 0.205993) * 25.0;
        #undef SUN_TAP
      #else
        float radius = 5.0 / light.shadowMapSize.x;
        float lit = 0.0;
        for (int i = 0; i < 25; i++) {
          vec2 uv = coord.xy + SUN_DISK[i] * radius;
          if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0) lit += texture( directionalShadowMap[ 0 ], vec3( uv, coord.z ) );
        }
      #endif
      return mix(1.0, lit * 0.04, light.shadowIntensity);
    }
  #elif !defined( USE_SHADOWMAP )
    float sunShadow() { return SUN_OFF; }
  #elif NUM_DIR_LIGHT_SHADOWS == 0
    float sunShadow() { return SUN_NO_LIGHT; }
  #else
    float sunShadow() { return SUN_NOT_PCF; }
  #endif
`;

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
  ${sunShadowChunk}
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
  uniform samplerCube tCubeMap;
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
  uniform sampler2D tCubeMask;
  uniform float uHasCubeMask;
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
  uniform float uProbe;
  uniform vec3 uSpecularColor;
  uniform vec3 uRimLightColor;

  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;
  uniform vec3 uFillDir;
  uniform vec3 uFillColor;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform float uFillScale;
  uniform vec3 uShadowFill;
  uniform float uShadowFillOn;

  // Lights particles cast (C_OP_RenderDeferredLight), as deferred_local_light_cs adds them:
  // color × N·L × smoothstep(saturate((1 - d / radius) / width)), diffuse only
  #define MAX_PARTICLE_LIGHTS 32
  uniform int uParticleLightCount;
  uniform vec3 uParticleLightPos[MAX_PARTICLE_LIGHTS];
  uniform vec3 uParticleLightColor[MAX_PARTICLE_LIGHTS];
  uniform vec2 uParticleLightRange[MAX_PARTICLE_LIGHTS];
  vec3 particleLights(vec3 n, vec3 pos) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < MAX_PARTICLE_LIGHTS; i++) {
      if (i >= uParticleLightCount) break;
      vec3 toLight = uParticleLightPos[i] - pos;
      float d = length(toLight);
      float t = clamp((1.0 - d / uParticleLightRange[i].x) * uParticleLightRange[i].y, 0.0, 1.0);
      sum += uParticleLightColor[i] * (t * t * (3.0 - 2.0 * t)) * clamp(dot(n, toLight / max(d, 1e-5)), 0.0, 1.0);
    }
    return sum;
  }

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
    float shadow = sunShadow();
    #ifdef NO_SUN_SHADOW
      shadow = 1.0;
    #endif
    float halfLambert = (nl * 0.5 + 0.5) * shadow;
    vec3 warped = uHasDiffuseWarp > 0.5 ? texture2D(tDiffuseWarp, vec2(halfLambert, warpMask)).rgb : vec3(halfLambert);
    vec3 diffuseLight = mix(vec3(halfLambert), warped, uWarpSelectsRow > 0.5 ? 1.0 : warpMask) * uKeyColor;
    // A second light that fills from another side, then the sky and the ground
    diffuseLight += clamp(dot(n, uFillDir), 0.0, 1.0) * uFillColor * uFillScale * uAmbientScale;
    // hero.vfx's sky/ground term: lerp(cb2[17], cb2[6], N.z * 0.5 + 0.5) × cb2[6].w ×
    // max(1 - clouds, 1 - shadow) × g_flAmbientScale (gloss/f_d0.asm). On the hero page that is
    // the shadow's fill, PortraitShadowColor × PortraitShadowScale, only where the key light's
    // shadow falls (no clouds there); elsewhere the studio's sky and ground as before
    if (uShadowFillOn > 0.5) {
      // Dev switch ?fillall: the fill everywhere, as with clouds of 0 (max(1 - 0, 1 - shadow) = 1)
      #ifdef FILL_ALL
        diffuseLight += uShadowFill * uAmbientScale;
      #else
        diffuseLight += uShadowFill * (1.0 - shadow) * uAmbientScale;
      #endif
    } else {
      diffuseLight += mix(uGroundColor, uSkyColor, worldN.y * 0.5 + 0.5) * uAmbientScale;
    }
    // Lamps on the stage: fires and the like light the side of the model turned to them
    #if NUM_POINT_LIGHTS > 0
      for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
        vec3 toLamp = pointLights[ i ].position + vViewPosition;
        float lampDistance = length(toLamp);
        float lampFalloff = getDistanceAttenuation(lampDistance, pointLights[ i ].distance, pointLights[ i ].decay);
        diffuseLight += pointLights[ i ].color * lampFalloff * clamp(dot(n, toLamp / lampDistance), 0.0, 1.0);
      }
    #endif
    diffuseLight += particleLights(n, -vViewPosition);

    // Specular: Phong, sharpness from Masks2 A, plus the cube map unless metal masks it. The
    // shadow darkens the diffuse only: hero.vfx multiplies the highlight by saturate(N·L) and the
    // key color alone (gloss/f_d0.asm and f_d4.asm)
    vec3 r = reflect(-v, n);
    float exponent = exponentMask * uSpecularExponent;
    float phong = pow(max(clamp(dot(r, uKeyDir), 0.0, 1.0), 0.001), exponent) * clamp(nl, 0.0, 1.0);
    // Dev switch ?specshadow: the highlight darkened by the shadow, as before cc2a2c9, to compare
    #ifdef SPEC_SHADOWED
      phong *= shadow;
    #endif
    vec3 env = vec3(0.0);
    if (uHasCubeMap > 0.5) {
      // Read by the reflection in the world, in the game's axes (the scene's x, y, z are the
      // game's y, z, x), as hero.vfx samples its texturecube
      vec3 rw = inverseTransformDirection(r, viewMatrix);
      env = textureCube(tCubeMap, vec3(rw.z, rw.x, rw.y)).rgb * uCubeMapScale;
      // F_MASK_CUBE_MAP_BY_SEPARATE_MASK: times the green of g_tCubeMapSeparateMask at the base
      // coordinates (hero.vfx static combo 590626: sample t8.yxzw, mul by its first channel)
      if (uHasCubeMask > 0.5) env *= texture2D(tCubeMask, uv).g;
    }
    vec3 specular = (phong * uKeyColor * uSpecularScale + env * (1.0 - uMaskCubeByMetal)) * specMask;
    specular *= mix(albedo, uSpecularColor, tintMask) * max(fresnel.b, metal);

    vec3 lit = diffuseLight * albedo + specular;
    // Metal shows its reflections and highlights only
    vec3 metalColor = env * uMaskCubeByMetal + specular;
    vec3 outColor = mix(lit, metalColor, metal);

    // Rim from above, in the rim color and the second light's color (without its strength, as
    // the game's vertex shader gives it)
    vec3 rim = rimMask * uRimLightColor * uRimLightScale * uFillColor * max(worldN.y, 0.0) * fresnel.r;
    outColor = outColor * uIllumination + rim;

    // Self-illuminated parts show their color as it is (their halo is the glow pass's)
    outColor = mix(outColor, albedo, clamp(selfIllum, 0.0, 1.0)) * uOverbright;
    // An opaque material covers the page behind the scene fully; the color's alpha holds masks
    // g_flFresnelModulatesAlpha: a see-through shell shows towards its outline only, where the
    // surface turns away from the eye (a rim light laid over a model, as the prismatic sets')
    float alpha = color.a * mix(1.0, 1.0 - clamp(abs(nv), 0.0, 1.0), uFresnelAlpha);
    gl_FragColor = vec4(outColor, uOpaque > 0.5 ? 1.0 : alpha);
    #ifdef SHOW_TRANSLUCENT
      // ?showtranslucent: a blended material drawn solid red with its alpha as brightness
      if (uOpaque < 0.5) gl_FragColor = vec4(alpha, 0.0, 0.0, 1.0);
    #endif
    #ifdef SHADOW_VIEW
      // White lit, black shadowed; blue outside the shadow map, red with no shadow map
      gl_FragColor = shadow == -2.0 ? vec4(1.0, 0.0, 0.0, 1.0) : shadow == -3.0 ? vec4(1.0, 0.0, 1.0, 1.0) : shadow == -4.0 ? vec4(1.0, 1.0, 0.0, 1.0) : shadow == -1.0 ? vec4(0.0, 0.3, 1.0, 1.0) : vec4(vec3(shadow), 1.0);
    #endif
    // Dev probe (?probe, shift+click): the shading's intermediate values, one group per pass,
    // read back from a float target to compare with the game's (a RenderDoc pixel trace)
    if (uProbe > 0.5) {
      vec3 probeN = inverseTransformDirection(n, viewMatrix);
      float probeRL = clamp(dot(r, uKeyDir), 0.0, 1.0);
      if (uProbe < 1.5) gl_FragColor = vec4(probeN, nl);
      else if (uProbe < 2.5) gl_FragColor = vec4(nv, probeRL, exponent, shadow);
      else if (uProbe < 3.5) gl_FragColor = vec4(phong, specMask, tintMask, fresnel.b);
      else if (uProbe < 4.5) gl_FragColor = vec4(diffuseLight, metal);
      else if (uProbe < 5.5) gl_FragColor = vec4(albedo, warpMask);
      else if (uProbe < 6.5) gl_FragColor = vec4(specular, halfLambert);
      else gl_FragColor = vec4(outColor, exponentMask);
      return;
    }
    #include <colorspace_fragment>
  }
`;

// The probe's group, 0 off (dev only)
export const probeMode = { value: 0 };

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
  // The hero page's shadow fill (PortraitShadowColor × PortraitShadowScale), black without one
  shadowFill: new THREE.Color(0, 0, 0),
};
// 1 where the light has a shadow fill: hero.vfx's sky/ground term then shows only in the shadow
const shadowFillOn = { value: 0 };

const studio = {
  keyColor: stage.keyColor.clone(),
  fillColor: stage.fillColor.clone(),
  skyColor: stage.skyColor.clone(),
  groundColor: stage.groundColor.clone(),
};

// The second light's strength for the diffuse; the rim takes its color alone
const fillScale = { value: 1 };

// The particles' lights, shared by every material (view space, filled by setParticleLights)
const MAX_PARTICLE_LIGHTS = 32;
const particleLightUniforms = {
  uParticleLightCount: { value: 0 },
  uParticleLightPos: { value: Array.from({ length: MAX_PARTICLE_LIGHTS }, () => new THREE.Vector3()) },
  uParticleLightColor: { value: Array.from({ length: MAX_PARTICLE_LIGHTS }, () => new THREE.Vector3()) },
  uParticleLightRange: { value: Array.from({ length: MAX_PARTICLE_LIGHTS }, () => new THREE.Vector2(1, 1)) },
};

// This frame's particle lights (frameLights of the particle renderers) for the camera: the
// strongest MAX_PARTICLE_LIGHTS of them, by color times radius
export function setParticleLights(lights, camera) {
  const chosen = lights.length > MAX_PARTICLE_LIGHTS
    ? [...lights].sort((a, b) => (b.r + b.g + b.b) * b.radius - (a.r + a.g + a.b) * a.radius).slice(0, MAX_PARTICLE_LIGHTS)
    : lights;
  const view = camera.matrixWorldInverse;
  chosen.forEach((light, i) => {
    particleLightUniforms.uParticleLightPos.value[i].set(light.x, light.y, light.z).applyMatrix4(view);
    particleLightUniforms.uParticleLightColor.value[i].set(light.r, light.g, light.b);
    particleLightUniforms.uParticleLightRange.value[i].set(light.radius, light.width > 1e-4 ? 1 / light.width : 1e4);
  });
  particleLightUniforms.uParticleLightCount.value = chosen.length;
}
const studioFillDir = stage.fillDir.clone();

// The light of a scene of the game instead of the studio, or null for the studio again.
// keyDir and fillDir are in view space, so a scene's lights are turned with the camera every frame.

export function setDotaLighting(light) {
  stage.keyColor.copy(light?.key ?? studio.keyColor);
  fillScale.value = light?.fillScale ?? 1;
  stage.fillColor.copy(light?.fill ?? studio.fillColor);
  stage.skyColor.copy(light?.sky ?? studio.skyColor);
  stage.groundColor.copy(light?.ground ?? studio.groundColor);
  stage.shadowFill.copy(light?.shadowFill ?? new THREE.Color(0, 0, 0));
  shadowFillOn.value = light?.shadowFill ? 1 : 0;
  if (!light) {
    stage.keyDir.copy(studioKeyDir);
  }
  if (!light?.fillFollows) {
    stage.fillDir.copy(studioFillDir);
  }
}

export function setDotaKeyDir(viewDir) {
  stage.keyDir.copy(viewDir);
}

export function setDotaFillDir(viewDir) {
  stage.fillDir.copy(viewDir);
}


// The cube maps materials reflect, all six faces: cubemaps/index.json maps a texture's file name
// to a strip of its faces in the texture's order (rt lf bk ft up dn: +X -X +Y -Y +Z -Z in the
// game's axes). The glTF holds only one face. Loaded once; each cube made once from its strip.
let cubeIndex = {};
let cubeLoading = null;
const cubeTextures = new Map();
export function loadCubeMaps(root) {
  cubeLoading ??= fetch(`${root}cubemaps/index.json`)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}))
    .then((json) => {
      cubeIndex = json;
      cubeRoot = root;
    });
  return cubeLoading;
}
let cubeRoot = "";
function cubeTexture(name) {
  // By the texture's file name (a skin's materials give a path: its last part, as a .vtex)
  const key = name?.split("/").pop().toLowerCase().replace(/\.(png|jpg|webp)$/, ".vtex");
  const path = key && cubeIndex[key];
  if (!path) {
    return null;
  }
  if (!cubeTextures.has(path)) {
    cubeTextures.set(
      path,
      new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => {
          const size = image.height;
          const faces = Array.from({ length: 6 }, (_, i) => {
            const canvas = document.createElement("canvas");
            canvas.width = size;
            canvas.height = size;
            canvas.getContext("2d").drawImage(image, i * size, 0, size, size, 0, 0, size, size);
            return canvas;
          });
          const texture = new THREE.CubeTexture(faces);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.needsUpdate = true;
          resolve(texture);
        };
        image.onerror = () => resolve(null);
        image.src = cubeRoot + path;
      })
    );
  }
  return cubeTextures.get(path);
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
      // The whole cube, once its faces are in (cubemaps/), else no reflection
      tCubeMap: { value: null },
      uHasNormal: { value: pick("g_tNormal") ? 1 : 0 },
      // A mask the material has is used, whether or not its flag made it into the data
      uHasMasks1: { value: pick("g_tMasks1") ? 1 : 0 },
      uHasMasks2: { value: pick("g_tMasks2") ? 1 : 0 },
      uHasDiffuseWarp: { value: int.F_DIFFUSE_WARP && pick("g_tDiffuseWarp") ? 1 : 0 },
      uHasFresnelWarp: { value: pick("g_tFresnelWarp") ? 1 : 0 },
      uHasCubeMap: { value: 0 },
      tCubeMask: { value: int.F_MASK_CUBE_MAP_BY_SEPARATE_MASK ? pick("g_tCubeMapSeparateMask") : null },
      uHasCubeMask: { value: int.F_MASK_CUBE_MAP_BY_SEPARATE_MASK && pick("g_tCubeMapSeparateMask") ? 1 : 0 },
      tDetail: { value: pick("g_tDetail") },
      tDetail2: { value: pick("g_tDetail2") },
      uDetail2Mode: { value: pick("g_tDetail2") && ((float.g_flDetail2BlendFactor ?? 1) > 0 || programs?.g_flDetail2BlendFactor) ? (int.F_DETAIL_2 ?? 0) : 0 },
      uDetail2Factor: { value: float.g_flDetail2BlendFactor ?? 1 },
      // The detail tints and the bloom color go from gamma to linear in hero.vfx (SrgbGammaToLinear
      // in their expressions); its specular color is taken as it is
      uDetailTint: { value: linearColor(vec.g_vDetail1ColorTint, [1, 1, 1]) },
      uDetail2Tint: { value: linearColor(vec.g_vDetail2ColorTint, [1, 1, 1]) },
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
      uShadowFill: { value: stage.shadowFill },
      uShadowFillOn: shadowFillOn,
      uFillScale: fillScale,
      uProbe: probeMode,
      ...particleLightUniforms,
      uOpaque: { value: translucent ? 0 : 1 },
      uFresnelAlpha: { value: Math.min(Math.max(float.g_flFresnelModulatesAlpha ?? 0, 0), 1) },
    },
    transparent: translucent,
    depthWrite: !translucent,
    blending: int.F_ADDITIVE_BLEND ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: int.F_RENDER_BACKFACES ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.name = original.name;
  if (int.F_SPECULAR_CUBE_MAP) {
    cubeTexture(vmat.TextureParams?.g_tCubeMap)?.then((cube) => {
      if (cube) {
        material.uniforms.tCubeMap.value = cube;
        material.uniforms.uHasCubeMap.value = 1;
      }
    });
  }
  // While developing, ?nospec drops the key light's highlight, ?noenv the cube map's reflection,
  // ?norim the rim light, and ?shadowview draws the sun's shadow alone (white lit, black shadowed)
  if (import.meta.env.DEV) {
    const search = window.location.search;
    if (search.includes("shadowview")) material.defines = { ...material.defines, SHADOW_VIEW: "" };
    if (search.includes("shadow25")) material.defines = { ...material.defines, SHADOW_25TAP: "" };
    // ?noshadow: the hero lit as if nothing shadowed it, to tell a shadow from the rest
    if (search.includes("noshadow")) material.defines = { ...material.defines, NO_SUN_SHADOW: "" };
    if (search.includes("specshadow")) material.defines = { ...material.defines, SPEC_SHADOWED: "" };
    if (search.includes("fillall")) material.defines = { ...material.defines, FILL_ALL: "" };
    if (search.includes("showtranslucent")) material.defines = { ...material.defines, SHOW_TRANSLUCENT: "" };
    if (search.includes("nospec")) material.uniforms.uSpecularScale.value = 0;
    if (search.includes("noenv")) material.uniforms.uCubeMapScale.value = 0;
    if (search.includes("norim")) material.uniforms.uRimLightScale.value = 0;
  }
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
      glow.uniforms.uBloomColor.value.setRGB(tint[0], tint[1], tint[2], THREE.SRGBColorSpace);
      glow.uniforms.uBloomScale.value = Math.max(get("g_flBloomScale")?.[0] ?? 0, 0);
      glow.uniforms.uBloomShift.value = get("g_flBloomShift")?.[0] ?? 0;
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

// Dota's global_lit_simple.vfx (static props, the hero page's pedestal), after its compiled forward
// pixel shader (S_MODE_FORWARD with S_SPECULAR and S_NORMAL_MAP; the game draws it in its deferred
// mode, whose G-buffer holds the same albedo, specular mask and normal):
//   albedo = color × g_vColorTint (the vmat's tint taken from gamma to linear by the shader's expression)
//   key = the sun's shadow × saturate(N·L)
//   light = key × key color + saturate(N·fill direction) × fill color × fill scale
//         + (1 − key) × mix(ground, sky, N up ½ + ½)
//   out = light × albedo
// Its specular (PortraitSpecularDirection, 0 0 −1 on the hero page) is lit only by reflections
// pointing down, which a camera above the pedestal never sees, so it is left out. Parts of the
// global light the page does not give (its clouds texture, the fill's own shadowing) are 1.
const litSimpleFragment = /* glsl */ `
  #include <common>
  #include <packing>
  #include <lights_pars_begin>
  #include <shadowmap_pars_fragment>
  ${sunShadowChunk}
  uniform sampler2D tColor;
  uniform sampler2D tNormal;
  uniform mat3 uBaseUv;
  uniform float uHasNormal;
  uniform float uBumpStrength;
  uniform float uAlphaTest;
  uniform vec3 uTint;
  uniform vec3 uKeyDir;
  uniform vec3 uKeyColor;
  uniform vec3 uFillDir;
  uniform vec3 uFillColor;
  uniform float uFillScale;
  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;

  // Lights particles cast (C_OP_RenderDeferredLight), as deferred_local_light_cs adds them:
  // color × N·L × smoothstep(saturate((1 - d / radius) / width)), diffuse only
  #define MAX_PARTICLE_LIGHTS 32
  uniform int uParticleLightCount;
  uniform vec3 uParticleLightPos[MAX_PARTICLE_LIGHTS];
  uniform vec3 uParticleLightColor[MAX_PARTICLE_LIGHTS];
  uniform vec2 uParticleLightRange[MAX_PARTICLE_LIGHTS];
  vec3 particleLights(vec3 n, vec3 pos) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < MAX_PARTICLE_LIGHTS; i++) {
      if (i >= uParticleLightCount) break;
      vec3 toLight = uParticleLightPos[i] - pos;
      float d = length(toLight);
      float t = clamp((1.0 - d / uParticleLightRange[i].x) * uParticleLightRange[i].y, 0.0, 1.0);
      sum += uParticleLightColor[i] * (t * t * (3.0 - 2.0 * t)) * clamp(dot(n, toLight / max(d, 1e-5)), 0.0, 1.0);
    }
    return sum;
  }

  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldNormal;

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
    vec2 uv = (uBaseUv * vec3(vUv, 1.0)).xy;
    vec4 color = texture2D(tColor, uv);
    if (uAlphaTest > 0.0 && color.a < uAlphaTest) discard;
    vec3 albedo = color.rgb * uTint;

    vec3 n = normalize(vViewNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 worldN = normalize(vWorldNormal);
    if (!gl_FrontFacing) worldN = -worldN;
    if (uHasNormal > 0.5) {
      // g_flBumpStrength scales the map's slope, as the shader does before normalizing
      vec3 mapN = texture2D(tNormal, uv).xyz * 2.0 - 1.0;
      mapN.xy *= uBumpStrength;
      n = perturbNormal(n, -vViewPosition, uv, normalize(mapN));
    }

    float shadow = sunShadow();
    float key = shadow * clamp(dot(n, uKeyDir), 0.0, 1.0);
    vec3 light = key * uKeyColor;
    light += clamp(dot(n, uFillDir), 0.0, 1.0) * uFillColor * uFillScale;
    light += (1.0 - key) * mix(uGroundColor, uSkyColor, worldN.y * 0.5 + 0.5);
    light += particleLights(n, -vViewPosition);
    gl_FragColor = vec4(light * albedo, 1.0);
    #ifdef SHADOW_VIEW
      // White lit, black shadowed; blue outside the shadow map, red with no shadow map
      gl_FragColor = shadow == -2.0 ? vec4(1.0, 0.0, 0.0, 1.0) : shadow == -3.0 ? vec4(1.0, 0.0, 1.0, 1.0) : shadow == -4.0 ? vec4(1.0, 1.0, 0.0, 1.0) : shadow == -1.0 ? vec4(0.0, 0.3, 1.0, 1.0) : vec4(vec3(shadow), 1.0);
    #endif
    #include <colorspace_fragment>
  }
`;

// A vmat color the shader takes from gamma to linear (its expression SrgbGammaToLinear)
function linearColor(values, fallback) {
  return vector(values, fallback).convertSRGBToLinear();
}

// Features of global_lit_simple.vfx drawn here; a material with any other is left to the plain one
const LIT_SIMPLE_FLAGS = new Set(["F_NORMAL_MAP", "F_SPECULAR", "F_ALPHA_TEST", "F_RENDER_BACKFACES", "F_DO_NOT_CAST_SHADOWS", "F_DO_NOT_REFLECT"]);

// textures: { g_tColor: Texture, ... } matched by the vmat texture names; null if the material uses
// features not drawn here
export function createLitSimpleMaterial(original, vmat, textures) {
  const int = vmat.IntParams ?? {};
  const float = vmat.FloatParams ?? {};
  if (Object.entries(int).some(([name, value]) => name.startsWith("F_") && value && !LIT_SIMPLE_FLAGS.has(name))) {
    return null;
  }
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  white.needsUpdate = true;
  const normal = int.F_NORMAL_MAP ? textures.g_tNormal ?? null : null;
  const material = new THREE.ShaderMaterial({
    lights: true,
    vertexShader,
    fragmentShader: litSimpleFragment,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
      tColor: { value: textures.g_tColor ?? original.map ?? white },
      tNormal: { value: normal },
      uHasNormal: { value: normal ? 1 : 0 },
      uBumpStrength: { value: float.g_flBumpStrength ?? 1 },
      uAlphaTest: { value: int.F_ALPHA_TEST ? (float.g_flAlphaTestReference ?? 0.5) : 0 },
      uBaseUv: { value: new THREE.Matrix3() },
      uTint: { value: linearColor(vmat.VectorParams?.g_vColorTint, [1, 1, 1]) },
      uKeyDir: { value: stage.keyDir },
      uKeyColor: { value: stage.keyColor },
      uFillDir: { value: stage.fillDir },
      uFillColor: { value: stage.fillColor },
      uSkyColor: { value: stage.skyColor },
      uGroundColor: { value: stage.groundColor },
      uShadowFill: { value: stage.shadowFill },
      uShadowFillOn: shadowFillOn,
      uFillScale: fillScale,
      ...particleLightUniforms,
    },
    side: int.F_RENDER_BACKFACES ? THREE.DoubleSide : THREE.FrontSide,
  });
  material.name = original.name;
  setUvLayer(material.uniforms.uBaseUv.value, (name) => paramValue(vmat, name), UV_LAYERS.uBaseUv);
  if (import.meta.env.DEV && window.location.search.includes("shadowview")) material.defines = { ...material.defines, SHADOW_VIEW: "" };
  if (import.meta.env.DEV && window.location.search.includes("shadow25")) material.defines = { ...material.defines, SHADOW_25TAP: "" };
  return material;
}

// The halo the game puts around a material's glowing parts, drawn into a separate glow pass as
// the game writes its bloom buffer (hero.vfx's deferred mode, read from its compiled code): how
// much glows is Masks1 A (and the alpha of an additive self-illuminating detail) times
// g_flBloomScale; the halo's color is the surface's own, moved towards g_vBloomColor by that
// amount times g_flBloomShift (M-05; 0 on most materials, so the color alone).
// null for materials without one.
// Shares the main material's texture coordinates, detail and alpha test, which may change every frame.
function createGlowMaterial(vmat, textures, main, side, animated) {
  const float = vmat.FloatParams ?? {};
  const scale = float.g_flBloomScale ?? 0;
  const masks1 = textures.g_tMasks1;
  const detailGlows = main.uDetailMode.value === 2;
  if ((scale <= 0 && !animated) || (!masks1 && !float.g_flSelfIllumBlendToFull && !detailGlows)) {
    return null;
  }
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: /* glsl */ `
      uniform sampler2D tColor;
      uniform sampler2D tMasks1;
      uniform sampler2D tDetail;
      uniform mat3 uBaseUv;
      uniform mat3 uAlphaUv;
      uniform mat3 uDetailUv;
      uniform float uSeparateAlpha;
      uniform float uHasMasks1;
      uniform float uToFull;
      uniform float uDetailToFull;
      uniform float uDetailMode;
      uniform float uDetailFactor;
      uniform vec3 uDetailTint;
      uniform float uAlphaTest;
      uniform float uIllumination;
      uniform vec3 uBloomColor;
      uniform float uBloomScale;
      uniform float uBloomShift;
      varying vec2 vUv;
      void main() {
        vec2 uv = (uBaseUv * vec3(vUv, 1.0)).xy;
        vec4 color = texture2D(tColor, uv);
        if (uSeparateAlpha > 0.5) color.a = texture2D(tColor, (uAlphaUv * vec3(vUv, 1.0)).xy).a;
        if (uAlphaTest > 0.0 && color.a < uAlphaTest) discard;
        vec4 masks1 = uHasMasks1 > 0.5 ? texture2D(tMasks1, uv) : vec4(0.0);
        float glow = max(masks1.a, uToFull);
        vec3 albedo = color.rgb;
        if (uDetailMode > 1.5 && uDetailMode < 2.5) {
          vec4 detail = texture2D(tDetail, (uDetailUv * vec3(vUv, 1.0)).xy);
          float amount = (uHasMasks1 > 0.5 ? max(masks1.r, uDetailToFull) : 1.0) * uDetailFactor;
          albedo += detail.rgb * uDetailTint * amount;
          glow += detail.a * amount;
        }
        glow *= uBloomScale;
        vec3 halo = mix(albedo, uBloomColor, glow * uBloomShift) * uIllumination;
        gl_FragColor = vec4(max(halo * glow, 0.0), 1.0);
      }
    `,
    uniforms: {
      tColor: main.tColor,
      uBaseUv: main.uBaseUv,
      uAlphaUv: main.uAlphaUv,
      uDetailUv: main.uDetailUv,
      uSeparateAlpha: main.uSeparateAlpha,
      uAlphaTest: main.uAlphaTest,
      tDetail: main.tDetail,
      uDetailMode: main.uDetailMode,
      uDetailFactor: main.uDetailFactor,
      uDetailTint: main.uDetailTint,
      uDetailToFull: main.uDetailToFull,
      uIllumination: main.uIllumination,
      tMasks1: { value: masks1 ?? null },
      uHasMasks1: { value: masks1 ? 1 : 0 },
      uToFull: { value: float.g_flSelfIllumBlendToFull ?? 0 },
      // Set by the main material, the values may change every frame
      uBloomColor: { value: new THREE.Color(1, 1, 1) },
      uBloomScale: { value: 0 },
      uBloomShift: { value: 0 },
    },
    side,
  });
}
