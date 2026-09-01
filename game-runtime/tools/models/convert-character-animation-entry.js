import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const PLACEHOLDER_TEXTURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
  'AAAADUlEQVR42mNk+M/wHwAF/gL+XwWZVwAAAABJRU5ErkJggg==';
const ROOT_MOTION_TARGETS = new Set([
  'Armature',
  'Root',
  'Hip',
  'Hips',
  'Pelvis',
  'Waist',
  'mixamorigHips',
]);
const state = {
  config: null,
  root: null,
  clips: new Map(),
  sourceMetrics: [],
  idleRestPositions: null,
};

function base64ToArrayBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(value) {
  const bytes = new Uint8Array(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function textureReady(texture) {
  const image = texture.image;
  const width = image?.naturalWidth ?? image?.videoWidth ?? image?.width ?? 0;
  const height = image?.naturalHeight ?? image?.videoHeight ?? image?.height ?? 0;
  return width > 0 && height > 0;
}

function objectTextures(root) {
  const textures = new Set();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) {
          textures.add(value);
        }
      }
    }
  });
  return [...textures];
}

async function waitForTextures(root) {
  const textures = objectTextures(root);
  const deadline = performance.now() + 20_000;
  while (performance.now() < deadline) {
    if (textures.every(textureReady)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const ready = textures.filter(textureReady).length;
  throw new Error(`only ${ready}/${textures.length} embedded textures became ready`);
}

async function parseFbx(base64) {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    return /^(?:blob:|data:)/i.test(url) ? url : PLACEHOLDER_TEXTURE;
  });
  const loader = new FBXLoader(manager);
  const loaded = new Promise((resolve) => {
    manager.onLoad = resolve;
  });
  const root = loader.parse(base64ToArrayBuffer(base64), '');
  await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 20_000))]);
  await waitForTextures(root);
  return root;
}

function objectMetrics(root) {
  let meshes = 0;
  let skinnedMeshes = 0;
  let staticMeshes = 0;
  let vertices = 0;
  let triangles = 0;
  const bones = new Set();
  const meshRecords = [];
  root.traverse((object) => {
    if (object instanceof THREE.Bone) {
      bones.add(object.name);
    }
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    meshes += 1;
    if (object instanceof THREE.SkinnedMesh) {
      skinnedMeshes += 1;
      for (const bone of object.skeleton.bones) {
        bones.add(bone.name);
      }
    } else {
      staticMeshes += 1;
    }
    const position = object.geometry.getAttribute('position');
    const meshVertices = position?.count ?? 0;
    const meshTriangles = Math.floor((object.geometry.index?.count ?? position?.count ?? 0) / 3);
    vertices += meshVertices;
    triangles += meshTriangles;
    meshRecords.push({
      name: object.name || 'unnamed-mesh',
      parentName: object.parent?.name || null,
      skinned: object instanceof THREE.SkinnedMesh,
      vertices: meshVertices,
      triangles: meshTriangles,
    });
  });
  return {
    meshes,
    skinnedMeshes,
    staticMeshes,
    vertices,
    triangles,
    bones: [...bones].sort(),
    meshRecords: meshRecords.sort((left, right) => right.triangles - left.triangles),
  };
}

function animationKeyframes(clip) {
  return clip.tracks.reduce((sum, track) => sum + track.times.length, 0);
}

function selectAnimation(root, pattern, stateName) {
  const normalizedPattern = pattern?.toLowerCase() ?? null;
  const matching = normalizedPattern
    ? root.animations.filter((clip) => clip.name.toLowerCase().includes(normalizedPattern))
    : root.animations;
  if (matching.length === 0) {
    throw new Error(
      `${stateName} has no clip matching ${JSON.stringify(pattern)}; ` +
        `available: ${root.animations.map((clip) => clip.name).join(', ')}`,
    );
  }
  return [...matching].sort((left, right) => {
    return (
      animationKeyframes(right) - animationKeyframes(left) ||
      right.tracks.length - left.tracks.length ||
      right.duration - left.duration ||
      left.name.localeCompare(right.name)
    );
  })[0];
}

function prepareCharacterMeshes(root, modelId, requiresSeparateWeapon) {
  const skinnedMeshes = [];
  const staticMeshes = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    if (object instanceof THREE.SkinnedMesh) {
      skinnedMeshes.push(object);
    } else {
      staticMeshes.push(object);
    }
  });
  if (skinnedMeshes.length === 0) {
    throw new Error(`${modelId} does not contain a usable skinned character mesh`);
  }
  if (requiresSeparateWeapon && staticMeshes.length === 0) {
    throw new Error(`${modelId} does not contain a retained weapon mesh`);
  }
  for (const [index, mesh] of skinnedMeshes.entries()) {
    const name = `${modelId}-Body-${String(index + 1).padStart(2, '0')}`;
    mesh.name = name;
    mesh.geometry.name = name;
  }
  for (const [index, mesh] of staticMeshes.entries()) {
    const name = `${modelId}-Weapon-${String(index + 1).padStart(2, '0')}`;
    mesh.name = name;
    mesh.geometry.name = name;
  }
}

function materialTexture(source, property) {
  const value = source[property];
  return value instanceof THREE.Texture ? value : null;
}

function standardizeMaterials(root, staticMeshesAreWeapons = true) {
  const converted = new Map();
  const originalMaterials = new Set();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const isWeapon = staticMeshesAreWeapons && !(object instanceof THREE.SkinnedMesh);
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const materials = sourceMaterials.map((source) => {
      originalMaterials.add(source);
      const materialKey = `${source.uuid}:${isWeapon ? 'weapon' : 'body'}`;
      const existing = converted.get(materialKey);
      if (existing) {
        return existing;
      }
      const color =
        'color' in source && source.color instanceof THREE.Color
          ? source.color
          : new THREE.Color(1, 1, 1);
      const emissive =
        'emissive' in source && source.emissive instanceof THREE.Color
          ? source.emissive
          : new THREE.Color(0, 0, 0);
      const material = new THREE.MeshStandardMaterial({
        name: source.name,
        color,
        emissive,
        emissiveIntensity:
          'emissiveIntensity' in source && typeof source.emissiveIntensity === 'number'
            ? source.emissiveIntensity
            : 1,
        map: materialTexture(source, 'map'),
        normalMap: materialTexture(source, 'normalMap'),
        roughnessMap: materialTexture(source, 'roughnessMap'),
        metalnessMap: materialTexture(source, 'metalnessMap'),
        aoMap: materialTexture(source, 'aoMap'),
        alphaMap: materialTexture(source, 'alphaMap'),
        emissiveMap: materialTexture(source, 'emissiveMap'),
        normalScale:
          'normalScale' in source && source.normalScale instanceof THREE.Vector2
            ? source.normalScale
            : new THREE.Vector2(1, 1),
        roughness: isWeapon ? 0.5 : 0.76,
        metalness: isWeapon ? 0.18 : 0.02,
        opacity: source.opacity,
        transparent: source.transparent || source.opacity < 0.999,
        alphaTest: source.alphaTest,
        side: source.side,
        depthTest: source.depthTest,
        depthWrite: source.opacity >= 0.999 && source.depthWrite,
      });
      converted.set(materialKey, material);
      return material;
    });
    object.material = Array.isArray(object.material)
      ? materials
      : (materials[0] ?? new THREE.MeshStandardMaterial());
  });
  for (const source of originalMaterials) {
    source.dispose();
  }
}

function trackTarget(trackName) {
  const propertyIndex = trackName.lastIndexOf('.');
  return propertyIndex >= 0 ? trackName.slice(0, propertyIndex) : trackName;
}

function localRestPositions(root) {
  const positions = new Map();
  root.traverse((object) => {
    if (object.name && !positions.has(object.name)) {
      positions.set(object.name, object.position.clone());
    }
  });
  return positions;
}

function constantScaleTrack(track) {
  if (!track.name.endsWith('.scale') || track.values.length < 3) {
    return false;
  }
  for (let index = 3; index < track.values.length; index += 1) {
    if (Math.abs(track.values[index] - track.values[index % 3]) > 0.000_01) {
      return false;
    }
  }
  return true;
}

function sanitizedClip(
  source,
  name,
  sourceRestPositions,
  idleRestPositions,
  allowAnimationBoneSetDifferences,
) {
  const tracks = [];
  const droppedTrackNames = [];
  let retargetedPositionTracks = 0;
  let maximumRestPositionCorrection = 0;
  for (const sourceTrack of source.tracks) {
    if (constantScaleTrack(sourceTrack)) {
      continue;
    }
    const track = sourceTrack.clone();
    const target = trackTarget(track.name);
    const idleRest = idleRestPositions.get(target);
    if (!idleRest) {
      if (allowAnimationBoneSetDifferences) {
        droppedTrackNames.push(track.name);
        continue;
      }
      throw new Error(`${name} track ${track.name} has no matching Idle target`);
    }
    if (track instanceof THREE.VectorKeyframeTrack && track.name.endsWith('.position')) {
      const sourceRest = sourceRestPositions.get(target);
      if (!sourceRest || !idleRest) {
        if (allowAnimationBoneSetDifferences) {
          droppedTrackNames.push(track.name);
          continue;
        }
        throw new Error(`${name} position track ${track.name} has no matching Idle rest transform`);
      }
      const correction = idleRest.clone().sub(sourceRest);
      maximumRestPositionCorrection = Math.max(maximumRestPositionCorrection, correction.length());
      for (let index = 0; index < track.values.length; index += 3) {
        track.values[index] += correction.x;
        track.values[index + 1] += correction.y;
        track.values[index + 2] += correction.z;
        if (ROOT_MOTION_TARGETS.has(target)) {
          track.values[index] = idleRest.x;
          track.values[index + 1] = idleRest.y;
          track.values[index + 2] = idleRest.z;
        }
      }
      retargetedPositionTracks += 1;
    }
    tracks.push(track);
  }
  const clip = new THREE.AnimationClip(name, source.duration, tracks);
  clip.optimize();
  return {
    clip,
    retargetedPositionTracks,
    maximumRestPositionCorrection,
    droppedTracks: droppedTrackNames.length,
    droppedTrackNames,
  };
}

function disposeSource(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) {
          textures.add(value);
        }
      }
    }
  });
  for (const geometry of geometries) {
    geometry.dispose();
  }
  for (const material of materials) {
    material.dispose();
  }
  for (const texture of textures) {
    texture.dispose();
  }
}

async function exportGlb(root, clips) {
  root.animations = clips;
  root.updateMatrixWorld(true);
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(root, resolve, reject, {
      animations: clips,
      binary: true,
      onlyVisible: false,
      truncateDrawRange: true,
      trs: true,
    });
  });
}

window.resetCharacterAnimationConversion = (config) => {
  if (state.root) {
    disposeSource(state.root);
  }
  state.config = config;
  state.root = null;
  state.clips.clear();
  state.sourceMetrics = [];
  state.idleRestPositions = null;
};

window.addCharacterAnimationSource = async (input) => {
  if (!state.config) {
    throw new Error('character conversion config is missing');
  }
  const root = await parseFbx(input.base64);
  const source = selectAnimation(root, input.clipPattern, input.name);
  const metrics = objectMetrics(root);
  if (metrics.skinnedMeshes === 0 || metrics.bones.length === 0) {
    disposeSource(root);
    throw new Error(`${input.name} does not contain a usable skinned character mesh`);
  }
  const sourceRestPositions = localRestPositions(root);
  if (input.name === 'Idle') {
    state.idleRestPositions = sourceRestPositions;
  }
  if (!state.idleRestPositions) {
    disposeSource(root);
    throw new Error('Idle must be loaded before the other character animation sources');
  }
  const sanitized = sanitizedClip(
    source,
    input.name,
    sourceRestPositions,
    state.idleRestPositions,
    state.config.allowAnimationBoneSetDifferences === true,
  );
  const clip = sanitized.clip;
  state.sourceMetrics.push({
    name: input.name,
    selectedClip: source.name,
    availableClips: root.animations.map((candidate) => candidate.name),
    ...metrics,
    duration: clip.duration,
    tracks: clip.tracks.length,
    keyframes: clip.tracks.reduce((sum, track) => sum + track.times.length, 0),
    retargetedPositionTracks: sanitized.retargetedPositionTracks,
    maximumRestPositionCorrection: sanitized.maximumRestPositionCorrection,
    droppedTracks: sanitized.droppedTracks,
    droppedTrackNames: sanitized.droppedTrackNames,
  });
  state.clips.set(input.name, clip);
  if (input.name === 'Idle') {
    prepareCharacterMeshes(root, state.config.modelId, state.config.requiresSeparateWeapon);
    standardizeMaterials(root, state.config.staticMeshesAreWeapons !== false);
    root.name = `${state.config.modelId}-${state.config.displayName}-Animated`;
    state.root = root;
  } else {
    disposeSource(root);
  }
  return state.sourceMetrics.at(-1);
};

window.exportCharacterAnimationAsset = async () => {
  const clipNames = state.config.animationStates ?? ['Idle', 'Move', 'Attack', 'Spell'];
  if (!state.root || clipNames.some((name) => !state.clips.has(name))) {
    throw new Error('all four character animation sources are required');
  }
  const sourceBones = state.sourceMetrics[0]?.bones ?? [];
  for (const metrics of state.sourceMetrics) {
    if (
      state.config.allowAnimationBoneSetDifferences !== true &&
      JSON.stringify(metrics.bones) !== JSON.stringify(sourceBones)
    ) {
      throw new Error(`skeleton mismatch in ${metrics.name}`);
    }
  }
  const clips = clipNames.map((name) => state.clips.get(name));
  const outputMetrics = objectMetrics(state.root);
  const glb = await exportGlb(state.root, clips);
  return {
    base64: arrayBufferToBase64(glb),
    sourceMetrics: state.sourceMetrics,
    outputMetrics,
    clips: clips.map((clip) => ({
      name: clip.name,
      duration: clip.duration,
      tracks: clip.tracks.length,
      keyframes: clip.tracks.reduce((sum, track) => sum + track.times.length, 0),
    })),
  };
};
