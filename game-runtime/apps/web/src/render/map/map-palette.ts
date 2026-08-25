/**
 * Material library for the 百眼迷城 environment.
 *
 * One material per semantic surface keeps the whole map at a few dozen draw
 * calls, and every material is owned and disposed here. Textures come from the
 * procedural surface set, so nothing is downloaded and the look is identical
 * on every machine.
 *
 * Colour discipline follows JourneyWestGreatBrawl_AI游戏场景提示词 section 6:
 * a multi-hue world on a 青玉绿 / 暖灰石 base under a bright warm key, with
 * 朱砂红, 金色 and 五行 accents spent on the courts, shops, chests and
 * gameplay-critical markers. District hues live in `map-regions.ts` and reach
 * these materials as vertex colours or per-instance tints.
 *
 * The one thing the prompt's palette does not relax: surfaces still sit a step
 * below the 30 saturated hero silhouettes in saturation, so characters read
 * against the world. Section 6 asks for 饱和度适中, not for maximum colour.
 */

import * as THREE from 'three';
import { webAssetUrl } from '../../runtime/asset-url';
import { createMapSurfaces, type MapSurfaceSet } from '../shading/map-surfaces';
import type { PaintedSurface } from '../shading/texture-lab';
import { applyWindSway } from '../shading/wind';

export interface MapMaterialLibrary {
  /** Playfield floor. Reads per-vertex district tint from vertex colours. */
  readonly ground: THREE.MeshStandardMaterial;
  readonly boundaryCliff: THREE.MeshStandardMaterial;
  readonly boundaryCliffFace: THREE.MeshStandardMaterial;
  readonly vaultWall: THREE.MeshStandardMaterial;
  readonly wallTrim: THREE.MeshStandardMaterial;
  readonly highland: THREE.MeshStandardMaterial;
  readonly highlandTop: THREE.MeshStandardMaterial;
  readonly ramp: THREE.MeshStandardMaterial;
  readonly courtFloor: THREE.MeshStandardMaterial;
  readonly courtRing: THREE.LineBasicMaterial;
  /** Gold inlay rings on court floors. */
  readonly courtInlay: THREE.MeshStandardMaterial;
  readonly spawnPad: THREE.MeshStandardMaterial;
  readonly chest: THREE.MeshStandardMaterial;
  readonly rock: THREE.MeshStandardMaterial;
  readonly shopAnchor: THREE.MeshStandardMaterial;
  readonly pigDen: THREE.MeshStandardMaterial;
  readonly dragonPalace: THREE.MeshStandardMaterial;
  readonly dragonWater: THREE.MeshPhysicalMaterial;
  /** Valley ponds on the heightfield; darker and less emissive than palace pools. */
  readonly valleyWater: THREE.MeshPhysicalMaterial;
  readonly eliteArena: THREE.MeshStandardMaterial;
  readonly grass: THREE.MeshStandardMaterial;
  readonly grassDark: THREE.MeshStandardMaterial;
  readonly pebble: THREE.MeshStandardMaterial;
  /** Low-profile procedural ground cover; all are tinted per instance. */
  readonly groundMoss: THREE.MeshStandardMaterial;
  readonly groundSoil: THREE.MeshStandardMaterial;
  readonly groundLeaves: THREE.MeshStandardMaterial;
  /** Flora set: white-base materials tinted per instance by district. */
  readonly floraTrunk: THREE.MeshStandardMaterial;
  readonly floraCanopy: THREE.MeshStandardMaterial;
  readonly floraBamboo: THREE.MeshStandardMaterial;
  readonly floraBoulder: THREE.MeshStandardMaterial;
  readonly floraShadow: THREE.MeshBasicMaterial;
  /** Arterial roads (MAIN/COURT/ARENA): dressed flagstone. */
  readonly roadMajor: THREE.MeshStandardMaterial;
  /** Connectors and shop lanes (SIDE/SHOP/SPAWNL/RAMP): packed earth. */
  readonly roadMinor: THREE.MeshStandardMaterial;
  /** Risk shortcuts and dens (RISK/DEN/SIDEDOOR/BREACH): unlit dirt track. */
  readonly roadRisk: THREE.MeshStandardMaterial;
  /** Soft packed-earth verge beneath every road ribbon. */
  readonly roadShoulder: THREE.MeshStandardMaterial;
  /** Timber and lacquer for procedural buildings. */
  readonly timber: THREE.MeshStandardMaterial;
  readonly lacquer: THREE.MeshStandardMaterial;
  readonly roofTile: THREE.MeshStandardMaterial;
  /** Beyond the boundary: dark apron ground and mountain silhouettes. */
  readonly beyondApron: THREE.MeshStandardMaterial;
  readonly beyondRidgeNear: THREE.MeshStandardMaterial;
  readonly beyondRidgeFar: THREE.MeshStandardMaterial;
  /** District dressing set: shared across all seven region prop families. */
  readonly bone: THREE.MeshStandardMaterial;
  readonly charred: THREE.MeshStandardMaterial;
  readonly straw: THREE.MeshStandardMaterial;
  readonly cloth: THREE.MeshStandardMaterial;
  readonly web: THREE.MeshBasicMaterial;
  readonly soil: THREE.MeshStandardMaterial;
  readonly clay: THREE.MeshStandardMaterial;
  readonly iron: THREE.MeshStandardMaterial;
  /** Storm wall: additive, double sided, no depth write. */
  readonly stormWall: THREE.MeshBasicMaterial;
  readonly stormFloor: THREE.MeshBasicMaterial;
  setGraphicsTier(tier: MapGraphicsTier): void;
  dispose(): void;
}

type MapGraphicsTier = 'balanced' | 'reduced';

/** Repeat counts are expressed in metres of world space per texture tile. */
function makeTiler(): {
  tiled(surface: PaintedSurface, metresPerTile: number): PaintedSurface;
  disposeClones(): void;
} {
  // Prism geometry emits UVs in world metres, and one painted surface backs
  // several materials at different densities, so each call clones the texture
  // objects (the bitmap is shared) and owns the clones' repeat settings.
  const clones: THREE.Texture[] = [];
  return {
    tiled(surface: PaintedSurface, metresPerTile: number): PaintedSurface {
      const repeat = 1 / metresPerTile;
      const clone = (texture: THREE.CanvasTexture): THREE.CanvasTexture => {
        const copy = texture.clone();
        copy.repeat.set(repeat, repeat);
        copy.needsUpdate = true;
        clones.push(copy);
        return copy;
      };
      return {
        albedo: clone(surface.albedo),
        normal: clone(surface.normal),
        roughness: clone(surface.roughness),
        dispose(): void {
          // Owned and disposed by disposeClones.
        },
      };
    },
    disposeClones(): void {
      for (const texture of clones) {
        texture.dispose();
      }
    },
  };
}

function standard(
  surface: PaintedSurface | null,
  options: THREE.MeshStandardMaterialParameters,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    ...(surface
      ? {
          map: surface.albedo,
          normalMap: surface.normal,
          roughnessMap: surface.roughness,
        }
      : {}),
    ...options,
  });
}

/**
 * The large arena cannot rely on a single repeated grass tile: it reads as a
 * flat carpet at the gameplay camera. Blend the verified grass and soil maps
 * in world space so the same deterministic dry fields that tint the vertices
 * also reveal packed earth at a visibly larger scale.
 */
/**
 * Ground shading, with the fragment-only relief technique from
 * world-of-claudecraft (MIT, Copyright (c) 2026 Levy Street), adapted to this
 * map's height field. Its packed ground AO texture ships under CC0 from
 * ambientCG via that project.
 *
 * The reason to borrow it rather than displace geometry is the same constraint
 * both projects have: the sim reads an analytic height field, so foot
 * placement, selection rings and shorelines all break the moment the drawn
 * mesh leaves it. Here the mesh IS the authority — terrainHeightMm is defined
 * as this grid's own triangle interpolation — which makes displacement even
 * less available than it was there. So all of the relief lives in the
 * fragment: parallax slides the ground UVs along the view ray, a cavity term
 * darkens the hollows, and one step toward the sun casts clod-scale shadows.
 *
 * Two details from the original carry the whole effect and are kept exactly:
 *
 * The height signal is zero-mean by construction. Each AO channel has its
 * measured mean subtracted, so mip averaging returns the signal to zero with
 * distance and both parallax and cavity fade out for free instead of smearing
 * the far field.
 *
 * The parallax height is sampled at a forced-coarse mip. At full resolution
 * every pixel walks its UVs by a different amount, and that incoherent warp is
 * what reads as melted, liquid ground; neighbouring offsets have to agree
 * before the eye accepts a clod as standing up.
 */
function applyGroundLayerBlend(
  material: THREE.MeshStandardMaterial,
  soilTexture: THREE.Texture,
  groundAoTexture: THREE.Texture,
  initialGraphicsTier: MapGraphicsTier,
): (tier: MapGraphicsTier) => void {
  const reliefEnabled = { value: initialGraphicsTier === 'balanced' ? 1 : 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uJwgbGroundSoil = { value: soilTexture };
    shader.uniforms.uJwgbGroundAO = { value: groundAoTexture };
    shader.uniforms.uJwgbGroundReliefEnabled = reliefEnabled;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 climate;
attribute vec4 splat;
varying vec2 vJwgbGroundWorldXZ;
varying vec3 vJwgbClimate;
varying vec4 vJwgbSplat;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vJwgbGroundWorldXZ = transformed.xz;
vJwgbClimate = climate;
vJwgbSplat = splat;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uJwgbGroundSoil;
uniform sampler2D uJwgbGroundAO;
uniform float uJwgbGroundReliefEnabled;
varying vec2 vJwgbGroundWorldXZ;
varying vec3 vJwgbClimate;
varying vec4 vJwgbSplat;

// Packed ground AO: R grass, G dirt, B rock, A sand. Channel means measured by
// the source project's packer; subtracting them keeps the height signal
// zero-mean so distance mips fade the relief instead of biasing it.
const vec4 JWGB_AO_MEAN = vec4(0.812, 0.897, 0.623, 0.883);
// Per-layer parallax amplitude = target depth / channel standard deviation, so
// one sd of a layer's height walks the projection by that layer's own depth.
// A single global amplitude leaves the low-contrast layers reading flat.
const vec4 JWGB_PARALLAX_AMP = vec4(0.129, 0.188, 0.229, 0.107);
const float JWGB_PARALLAX_CLAMP = 0.04;
// The original forces a coarse mip (LOD 2.5 of a 512px field) so neighbouring
// fragments agree on their offset; at full resolution every pixel walks its
// UVs differently and that incoherent warp is what reads as melted ground.
// Reaching for a mip level needs textureLod, whose availability depends on the
// GLSL version three compiles this material as, and a shader that fails to
// compile takes the whole ground with it. Sampling a coarser tiling instead
// produces the same smooth, agreeing offsets using only texture2D.
const float JWGB_PARALLAX_COARSE = 0.28;
// Sun azimuth in ground-UV space, matching the scene's directional light
// offset of (-22, 34, +18): one clod-scale step toward it.
const vec2 JWGB_SUN_UV_STEP = vec2(-0.01238, 0.01013);

float jwgbGroundRelief(vec2 uv, vec4 weights) {
  vec4 base = texture2D(uJwgbGroundAO, uv);
  float dirt = texture2D(uJwgbGroundAO, uv * 0.55).g;
  float rock = texture2D(uJwgbGroundAO, uv * 0.6).b;
  return (base.r - JWGB_AO_MEAN.x) * weights.x
       + (dirt - JWGB_AO_MEAN.y) * weights.y
       + (rock - JWGB_AO_MEAN.z) * weights.z
       + (base.a - JWGB_AO_MEAN.w) * weights.w;
}

float jwgbGroundReliefSmooth(vec2 uv, vec4 weights) {
  vec2 coarse = uv * JWGB_PARALLAX_COARSE;
  vec4 base = texture2D(uJwgbGroundAO, coarse);
  float dirt = texture2D(uJwgbGroundAO, coarse * 0.55).g;
  float rock = texture2D(uJwgbGroundAO, coarse * 0.6).b;
  return (base.r - JWGB_AO_MEAN.x) * weights.x
       + (dirt - JWGB_AO_MEAN.y) * weights.y
       + (rock - JWGB_AO_MEAN.z) * weights.z
       + (base.a - JWGB_AO_MEAN.w) * weights.w;
}

float jwgbGroundHash(vec2 point) {
  vec3 value = fract(vec3(point.xyx) * vec3(0.1031, 0.1030, 0.0973));
  value += dot(value, value.yzx + 33.33);
  return fract((value.x + value.y) * value.z);
}

float jwgbGroundNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 fraction = fract(point);
  fraction = fraction * fraction * (3.0 - 2.0 * fraction);
  return mix(
    mix(jwgbGroundHash(cell), jwgbGroundHash(cell + vec2(1.0, 0.0)), fraction.x),
    mix(
      jwgbGroundHash(cell + vec2(0.0, 1.0)),
      jwgbGroundHash(cell + vec2(1.0, 1.0)),
      fraction.x
    ),
    fraction.y
  );
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 splatWeights = vJwgbSplat;
  vec2 reliefUv = vJwgbGroundWorldXZ * 0.22;

  vec2 parallaxOffset = vec2(0.0);
  float groundShade = 1.0;

  // Reduced graphics skips every AO lookup in the relief path. The uniform
  // branch changes immediately when adaptive quality drops without forcing a
  // shader recompile during combat.
  if (uJwgbGroundReliefEnabled > 0.5) {
    // Offset parallax: slide the ground UVs along the view ray by the smoothed
    // height, so clods occlude what is behind them as the camera moves.
    vec2 viewXZ = vJwgbGroundWorldXZ - cameraPosition.xz;
    float viewLen = max(length(viewXZ), 0.001);
    float parallaxAmp = dot(splatWeights, JWGB_PARALLAX_AMP);
    float parallaxHeight = jwgbGroundReliefSmooth(reliefUv, splatWeights);
    parallaxOffset = clamp(
      (viewXZ / viewLen) * parallaxHeight * parallaxAmp,
      vec2(-JWGB_PARALLAX_CLAMP),
      vec2(JWGB_PARALLAX_CLAMP)
    );
    vec2 tuv = reliefUv + parallaxOffset;

    // Cavity: the fine field at native tiling, plus a coarse clump octave that
    // survives mip averaging and keeps shading the mid-field where the player
    // actually looks.
    float cavityFine = jwgbGroundRelief(tuv, splatWeights);
    float cavityCoarse = (texture2D(uJwgbGroundAO, tuv * 0.16).g - JWGB_AO_MEAN.y);
    float cavity = cavityFine * 1.65 + cavityCoarse * 0.9;

    // Micro sun-shadow: one clod-scale step toward the sun. Where the ground
    // ahead stands higher than here, this fragment sits in its shadow.
    float sunHeight = jwgbGroundRelief(tuv + JWGB_SUN_UV_STEP, splatWeights);
    float microShadow = clamp((sunHeight - cavityFine) * 2.4, 0.0, 0.6);
    groundShade = clamp(1.0 + cavity * 0.85 - microShadow * 0.55, 0.55, 1.35);
  }

  vec4 grassTexel = texture2D(map, vMapUv + parallaxOffset * 0.5);
  vec3 soilTexel = texture2D(uJwgbGroundSoil, vJwgbGroundWorldXZ / 10.5 + parallaxOffset).rgb;
  float broadDry = jwgbGroundNoise(vJwgbGroundWorldXZ / 82.0 + 17.0);
  float fieldDry = jwgbGroundNoise(vJwgbGroundWorldXZ / 27.0 + 53.0);
  float fineDry = jwgbGroundNoise(vJwgbGroundWorldXZ / 9.0 + 131.0);
  float dryField = broadDry * 0.58 + fieldDry * 0.3 + fineDry * 0.12;
  float soilMask = smoothstep(0.54, 0.78, dryField) * 0.62;
  soilMask += smoothstep(0.72, 0.9, fieldDry) * 0.14;
  soilMask = min(0.86, soilMask + vJwgbClimate.x * 0.52);
  vec3 terrainTexel = mix(grassTexel.rgb, soilTexel, soilMask);
  terrainTexel *= mix(vec3(1.0), vec3(0.58, 0.68, 0.64), vJwgbClimate.y);
  terrainTexel = mix(terrainTexel, vec3(0.84, 0.88, 0.9), vJwgbClimate.z * 0.58);
  terrainTexel *= groundShade;
  diffuseColor *= vec4(terrainTexel, grassTexel.a);
#endif`,
      );
  };
  material.customProgramCacheKey = () => 'jwgb-ground-relief-v2';
  return (tier): void => {
    reliefEnabled.value = tier === 'balanced' ? 1 : 0;
  };
}

function createMapAssetTextures(): {
  texture(file: string, repeatX: number, repeatY?: number): THREE.Texture;
  dispose(): void;
} {
  const loader = new THREE.TextureLoader();
  const textures: THREE.Texture[] = [];
  return {
    texture(file: string, repeatX: number, repeatY = repeatX): THREE.Texture {
      const texture = loader.load(webAssetUrl(`assets/terrain/${file}`));
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeatX, repeatY);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      textures.push(texture);
      return texture;
    },
    dispose(): void {
      for (const texture of textures) {
        texture.dispose();
      }
    },
  };
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('map palette: contact shadow canvas unavailable');
  }
  const gradient = context.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.08,
    size / 2,
    size / 2,
    size * 0.5,
  );
  gradient.addColorStop(0, 'rgba(255,255,255,0.82)');
  gradient.addColorStop(0.42, 'rgba(255,255,255,0.48)');
  gradient.addColorStop(0.76, 'rgba(255,255,255,0.16)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createMapMaterials(
  seed: number,
  graphicsTier: MapGraphicsTier = 'balanced',
): MapMaterialLibrary {
  const surfaces: MapSurfaceSet = createMapSurfaces(seed);
  const { tiled, disposeClones } = makeTiler();
  const assetTextures = createMapAssetTextures();
  const contactShadowTexture = createContactShadowTexture();
  const groundGrassTexture = assetTextures.texture('Grass001_Stylized.jpg', 1);
  const groundSoilTexture = assetTextures.texture('Ground023_Stylized.jpg', 1);
  // Height/AO data, not colour: it must stay linear or the relief signal is
  // gamma-bent and the measured channel means no longer centre it.
  const groundAoTexture = assetTextures.texture('GroundAO_Packed.png', 1);
  groundAoTexture.colorSpace = THREE.NoColorSpace;

  // The ground UV is authored in world metres by the ground builder, so the
  // texture repeat stays at 1 and tiling density is chosen there.
  const ground = standard(surfaces.ground, {
    map: groundGrassTexture,
    color: 0xffffff,
    vertexColors: true,
    roughness: 1,
    metalness: 0.02,
    normalScale: new THREE.Vector2(0.28, 0.28),
  });
  const setGroundGraphicsTier = applyGroundLayerBlend(
    ground,
    groundSoilTexture,
    groundAoTexture,
    graphicsTier,
  );

  const boundaryCliff = standard(tiled(surfaces.cliff, 13), {
    map: assetTextures.texture('Rock026_Color.jpg', 1 / 13),
    color: 0x666b65,
    roughness: 1,
    metalness: 0.04,
    normalScale: new THREE.Vector2(0.48, 0.48),
  });

  // Escarpment face. Vertex colour carries the crest-to-abyss gradient, so the
  // albedo stays neutral and the same material covers 60 m of drop.
  const boundaryCliffFace = standard(tiled(surfaces.cliff, 13), {
    map: assetTextures.texture('Rock026_Color.jpg', 1 / 13),
    color: 0xffffff,
    vertexColors: true,
    roughness: 1,
    metalness: 0.03,
    normalScale: new THREE.Vector2(0.85, 0.85),
    side: THREE.DoubleSide,
  });

  const vaultWall = standard(tiled(surfaces.masonry, 6), {
    color: 0x918f86,
    roughness: 1,
    metalness: 0.05,
    normalScale: new THREE.Vector2(0.52, 0.52),
  });

  const wallTrim = standard(surfaces.masonry, {
    color: 0x9e998c,
    roughness: 0.9,
    metalness: 0.04,
    normalScale: new THREE.Vector2(0.55, 0.55),
  });

  const highland = standard(tiled(surfaces.cliff, 11), {
    color: 0x9aa98e,
    roughness: 1,
    metalness: 0.02,
    normalScale: new THREE.Vector2(0.9, 0.9),
  });

  /** Walkable plateau tops: mossy stone, distinct from the cliff sides. */
  const highlandTop = standard(tiled(surfaces.ground, 10), {
    color: 0xa2af8d,
    roughness: 1,
    metalness: 0.02,
    normalScale: new THREE.Vector2(0.7, 0.7),
  });

  const ramp = standard(surfaces.masonry, {
    color: 0xb2a58e,
    roughness: 0.95,
    metalness: 0.03,
  });

  // Court floors tile like dressed stone; the ceremonial inlay is separate
  // ring geometry so it stays crisp at any court size.
  const courtFloor = standard(tiled(surfaces.court, 11), {
    // Keep the courts warm enough to read as ceremonial stone without
    // turning the whole arena into a bright yellow tile field.
    color: 0xa9a397,
    roughness: 1,
    metalness: 0.06,
    normalScale: new THREE.Vector2(0.7, 0.7),
  });

  const courtRing = new THREE.LineBasicMaterial({
    color: 0x9e8240,
    transparent: true,
    opacity: 0.68,
  });

  const courtInlay = new THREE.MeshStandardMaterial({
    // Bronze-gold keeps the array legible while yielding to the player,
    // court floor and boss silhouette at the gameplay camera distance.
    color: 0x765b2b,
    roughness: 0.68,
    metalness: 0.24,
    emissive: 0x120d03,
  });

  // Main routes use the worn road surface, not the ceremonial court courses.
  // Reusing court stone here made the whole route network read as one repeated
  // checkerboard and flattened the distinction between traversal and arenas.
  const roadMajor = standard(tiled(surfaces.road, 8), {
    map: assetTextures.texture('Ground023_Stylized.jpg', 1 / 5.5),
    color: 0x9d8e75,
    roughness: 0.96,
    metalness: 0.02,
    normalScale: new THREE.Vector2(0.52, 0.52),
  });
  const roadMinor = standard(tiled(surfaces.road, 6.5), {
    map: assetTextures.texture('Ground023_Stylized.jpg', 1 / 5.5),
    color: 0xb3a992,
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(0.62, 0.62),
  });
  const roadRisk = standard(tiled(surfaces.road, 6.5), {
    map: assetTextures.texture('Ground023_Stylized.jpg', 1 / 4.8),
    color: 0x8f8067,
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(0.72, 0.72),
  });
  const roadShoulder = standard(tiled(surfaces.ground, 8), {
    map: assetTextures.texture('Ground023_Stylized.jpg', 1 / 7.5),
    // Keep the shoulder in the ground's value range so its wider footprint
    // feathers the authored gameplay road into the surrounding districts.
    color: 0x817b63,
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(0.35, 0.35),
  });

  const spawnPad = new THREE.MeshStandardMaterial({
    color: 0x7c8f86,
    roughness: 0.8,
    metalness: 0.06,
    emissive: 0x14231d,
  });
  const chest = new THREE.MeshStandardMaterial({
    color: 0xc79a3e,
    roughness: 0.42,
    metalness: 0.55,
    emissive: 0x40300a,
  });
  const rock = standard(surfaces.cliff, {
    map: assetTextures.texture('Rock026_Color.jpg', 1),
    color: 0x858b89,
    roughness: 1,
    metalness: 0.02,
  });
  const shopAnchor = new THREE.MeshStandardMaterial({
    color: 0xb88b4e,
    roughness: 0.82,
    metalness: 0.04,
    emissive: 0x211406,
  });
  const pigDen = standard(surfaces.ground, {
    color: 0xa18468,
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(0.78, 0.78),
  });
  const dragonPalace = new THREE.MeshStandardMaterial({
    color: 0x397f80,
    roughness: 0.62,
    metalness: 0.18,
    emissive: 0x061819,
  });
  const dragonWater = new THREE.MeshPhysicalMaterial({
    color: 0x4ba4a7,
    roughness: 0.2,
    metalness: 0.04,
    emissive: 0x082a2b,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.82,
    clearcoat: 0.72,
    clearcoatRoughness: 0.24,
  });
  // Depth and foam arrive as vertex colour from buildWaterGeometry, so the
  // albedo stays white and the surface only supplies its sheen. A flat colour
  // here is what made ponds read as shadowed ground.
  const valleyWater = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.28,
    metalness: 0.0,
    emissive: 0x062b35,
    emissiveIntensity: 0.18,
    transparent: true,
    opacity: 0.84,
    depthWrite: false,
    side: THREE.DoubleSide,
    clearcoat: 0.42,
    clearcoatRoughness: 0.24,
    reflectivity: 0.42,
  });
  const eliteArena = new THREE.MeshStandardMaterial({
    color: 0x8f4938,
    roughness: 0.86,
    metalness: 0.04,
    emissive: 0x130302,
  });

  const timber = standard(surfaces.timber, {
    color: 0xe0bd99,
    roughness: 0.9,
    metalness: 0.03,
    normalScale: new THREE.Vector2(0.68, 0.68),
  });
  const lacquer = new THREE.MeshStandardMaterial({
    color: 0xa74436,
    roughness: 0.52,
    metalness: 0.14,
    emissive: 0x190302,
  });
  const roofTile = standard(surfaces.roof, {
    color: 0xe4ece8,
    roughness: 0.78,
    metalness: 0.08,
    normalScale: new THREE.Vector2(0.75, 0.75),
    emissive: 0x10191a,
    emissiveIntensity: 0.28,
    side: THREE.DoubleSide,
  });

  // The world outside the boundary cliffs: an ink-dark apron so the void
  // never reads as a hole, and two ridge tones for layered mountain
  // silhouettes that dissolve into the fog.
  const beyondApron = new THREE.MeshStandardMaterial({
    color: 0x1d2622,
    roughness: 1,
    metalness: 0,
  });
  const beyondRidgeNear = new THREE.MeshStandardMaterial({
    color: 0x33413a,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  const beyondRidgeFar = new THREE.MeshStandardMaterial({
    color: 0x2c3a34,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });

  const grass = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0,
    emissive: 0x18240e,
    emissiveIntensity: 0.12,
    side: THREE.DoubleSide,
  });
  applyWindSway(grass, 0.085);
  const grassDark = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0,
    emissive: 0x101b0a,
    emissiveIntensity: 0.1,
    side: THREE.DoubleSide,
  });
  applyWindSway(grassDark, 0.085);
  const pebble = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0.02,
  });
  const groundMoss = new THREE.MeshStandardMaterial({
    map: assetTextures.texture('Grass001_Stylized.jpg', 1.25),
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const groundSoil = new THREE.MeshStandardMaterial({
    map: assetTextures.texture('Ground023_Stylized.jpg', 1.1),
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const groundLeaves = new THREE.MeshStandardMaterial({
    map: assetTextures.texture('Ground023_Stylized.jpg', 1.45),
    color: 0xffffff,
    roughness: 0.96,
    metalness: 0,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const floraTrunk = new THREE.MeshStandardMaterial({
    color: 0x584433,
    roughness: 0.95,
    metalness: 0.02,
  });
  const floraCanopy = new THREE.MeshStandardMaterial({
    color: 0xffffff, // per-instance district tint
    roughness: 0.92,
    metalness: 0,
    emissive: 0x091309,
    emissiveIntensity: 0.035,
    flatShading: true,
  });
  applyWindSway(floraCanopy, 0.05);
  const floraBamboo = new THREE.MeshStandardMaterial({
    color: 0xffffff, // per-instance district tint
    roughness: 0.85,
    metalness: 0.02,
    emissive: 0x081408,
    emissiveIntensity: 0.025,
    flatShading: true,
  });
  applyWindSway(floraBamboo, 0.06);
  const floraBoulder = new THREE.MeshStandardMaterial({
    color: 0xffffff, // per-instance stone tint
    roughness: 1,
    metalness: 0.02,
    flatShading: true,
  });
  const floraShadow = new THREE.MeshBasicMaterial({
    map: contactShadowTexture,
    color: 0x1d2618,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });

  const stormWall = new THREE.MeshBasicMaterial({
    color: 0x7a5cd8,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stormFloor = new THREE.MeshBasicMaterial({
    color: 0x2a1c4a,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // District dressing materials. Kept deliberately low-saturation so the
  // per-district accents stay the loudest colour on the field.
  const bone = new THREE.MeshStandardMaterial({
    color: 0xd6cfbf,
    roughness: 0.88,
    metalness: 0.02,
    flatShading: true,
  });
  const charred = new THREE.MeshStandardMaterial({
    color: 0x2b2420,
    roughness: 1,
    metalness: 0.02,
    emissive: 0x431305,
    emissiveIntensity: 0.55,
  });
  const straw = new THREE.MeshStandardMaterial({
    color: 0xb69a58,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  const cloth = new THREE.MeshStandardMaterial({
    color: 0x8d4034,
    roughness: 0.85,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const web = new THREE.MeshBasicMaterial({
    color: 0xe6ede7,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const soil = new THREE.MeshStandardMaterial({
    color: 0x6d5c46,
    roughness: 1,
    metalness: 0,
  });
  const clay = new THREE.MeshStandardMaterial({
    color: 0x9a7355,
    roughness: 0.95,
    metalness: 0.02,
    flatShading: true,
  });
  const iron = new THREE.MeshStandardMaterial({
    color: 0x666c72,
    roughness: 0.55,
    metalness: 0.55,
  });

  const owned: THREE.Material[] = [
    ground,
    boundaryCliff,
    boundaryCliffFace,
    vaultWall,
    wallTrim,
    highland,
    highlandTop,
    ramp,
    courtFloor,
    courtRing,
    courtInlay,
    roadMajor,
    roadMinor,
    roadRisk,
    roadShoulder,
    spawnPad,
    chest,
    rock,
    shopAnchor,
    pigDen,
    dragonPalace,
    dragonWater,
    valleyWater,
    eliteArena,
    timber,
    lacquer,
    roofTile,
    beyondApron,
    beyondRidgeNear,
    beyondRidgeFar,
    grass,
    grassDark,
    pebble,
    groundMoss,
    groundSoil,
    groundLeaves,
    floraTrunk,
    floraCanopy,
    floraBamboo,
    floraBoulder,
    floraShadow,
    bone,
    charred,
    straw,
    cloth,
    web,
    soil,
    clay,
    iron,
    stormWall,
    stormFloor,
  ];

  return {
    ground,
    boundaryCliff,
    boundaryCliffFace,
    vaultWall,
    wallTrim,
    highland,
    highlandTop,
    ramp,
    courtFloor,
    courtRing,
    courtInlay,
    spawnPad,
    chest,
    rock,
    shopAnchor,
    pigDen,
    dragonPalace,
    dragonWater,
    valleyWater,
    eliteArena,
    grass,
    grassDark,
    pebble,
    groundMoss,
    groundSoil,
    groundLeaves,
    floraTrunk,
    floraCanopy,
    floraBamboo,
    floraBoulder,
    floraShadow,
    roadMajor,
    roadMinor,
    roadRisk,
    roadShoulder,
    timber,
    lacquer,
    roofTile,
    beyondApron,
    beyondRidgeNear,
    beyondRidgeFar,
    bone,
    charred,
    straw,
    cloth,
    web,
    soil,
    clay,
    iron,
    stormWall,
    stormFloor,
    setGraphicsTier(tier): void {
      setGroundGraphicsTier(tier);
    },
    dispose(): void {
      surfaces.dispose();
      disposeClones();
      assetTextures.dispose();
      contactShadowTexture.dispose();
      for (const material of owned) {
        material.dispose();
      }
    },
  };
}
