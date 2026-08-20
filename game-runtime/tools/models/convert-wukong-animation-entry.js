import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const PLACEHOLDER_TEXTURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
  'AAAADUlEQVR42mNk+M/wHwAF/gL+XwWZVwAAAABJRU5ErkJggg==';
const ROOT_MOTION_TARGETS = new Set(['Armature', 'Root', 'Hip', 'Pelvis']);
const BODY_MESH_NAME = 'H009-Body';
const WEAPON_MESH_NAME = 'H009-RuyiJinguBang';
const state = {
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

function prepareCharacterMeshes(root) {
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
  if (skinnedMeshes.length !== 1) {
    throw new Error(`expected one Wukong body mesh, found ${skinnedMeshes.length}`);
  }
  if (staticMeshes.length !== 1) {
    throw new Error(`expected one Ruyi Jingu Bang mesh, found ${staticMeshes.length}`);
  }
  skinnedMeshes[0].name = BODY_MESH_NAME;
  skinnedMeshes[0].geometry.name = BODY_MESH_NAME;
  staticMeshes[0].name = WEAPON_MESH_NAME;
  staticMeshes[0].geometry.name = WEAPON_MESH_NAME;
}

function standardizeMaterials(root) {
  const converted = new Map();
  const originalMaterials = new Set();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const materials = sourceMaterials.map((source) => {
      originalMaterials.add(source);
      const materialKey = `${source.uuid}:${object.name === WEAPON_MESH_NAME ? 'weapon' : 'body'}`;
      const existing = converted.get(materialKey);
      if (existing) {
        return existing;
      }
      const isWeapon = object.name === WEAPON_MESH_NAME;
      const material = new THREE.MeshStandardMaterial({
        name: source.name,
        color: isWeapon
          ? 0xb98732
          : 'color' in source && source.color instanceof THREE.Color
            ? source.color
            : 0xffffff,
        map:
          !isWeapon && 'map' in source && source.map instanceof THREE.Texture ? source.map : null,
        normalMap:
          'normalMap' in source && source.normalMap instanceof THREE.Texture
            ? source.normalMap
            : null,
        normalScale:
          'normalScale' in source && source.normalScale instanceof THREE.Vector2
            ? source.normalScale
            : new THREE.Vector2(1, 1),
        roughness: isWeapon ? 0.48 : 0.78,
        metalness: isWeapon ? 0.22 : 0.02,
        opacity: source.opacity,
        transparent: source.opacity < 0.999,
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

function sanitizedClip(source, name, sourceRestPositions, idleRestPositions) {
  const tracks = [];
  let retargetedPositionTracks = 0;
  let maximumRestPositionCorrection = 0;
  for (const sourceTrack of source.tracks) {
    if (constantScaleTrack(sourceTrack)) {
      continue;
    }
    const track = sourceTrack.clone();
    const target = trackTarget(track.name);
    if (track instanceof THREE.VectorKeyframeTrack && track.name.endsWith('.position')) {
      const sourceRest = sourceRestPositions.get(target);
      const idleRest = idleRestPositions.get(target);
      if (!sourceRest || !idleRest) {
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

window.resetWukongAnimationConversion = () => {
  if (state.root) {
    disposeSource(state.root);
  }
  state.root = null;
  state.clips.clear();
  state.sourceMetrics = [];
  state.idleRestPositions = null;
};

window.addWukongAnimationSource = async (input) => {
  const root = await parseFbx(input.base64);
  const source = root.animations.reduce(
    (longest, candidate) =>
      !longest || candidate.duration > longest.duration ? candidate : longest,
    null,
  );
  if (!source) {
    disposeSource(root);
    throw new Error(`${input.name} has no animation`);
  }
  const metrics = objectMetrics(root);
  if (metrics.skinnedMeshes !== 1 || metrics.bones.length === 0) {
    disposeSource(root);
    throw new Error(`${input.name} does not contain one usable skinned character mesh`);
  }
  const sourceRestPositions = localRestPositions(root);
  if (input.name === 'Idle') {
    state.idleRestPositions = sourceRestPositions;
  }
  if (!state.idleRestPositions) {
    disposeSource(root);
    throw new Error('Idle must be loaded before the other Wukong animation sources');
  }
  const sanitized = sanitizedClip(source, input.name, sourceRestPositions, state.idleRestPositions);
  const clip = sanitized.clip;
  state.sourceMetrics.push({
    name: input.name,
    ...metrics,
    duration: clip.duration,
    tracks: clip.tracks.length,
    retargetedPositionTracks: sanitized.retargetedPositionTracks,
    maximumRestPositionCorrection: sanitized.maximumRestPositionCorrection,
  });
  state.clips.set(input.name, clip);
  if (input.name === 'Idle') {
    prepareCharacterMeshes(root);
    standardizeMaterials(root);
    root.name = 'H009-Wukong-Animated';
    state.root = root;
  } else {
    disposeSource(root);
  }
  return state.sourceMetrics.at(-1);
};

window.exportWukongAnimationAsset = async () => {
  const clipNames = ['Idle', 'Move', 'Attack', 'Spell'];
  if (!state.root || clipNames.some((name) => !state.clips.has(name))) {
    throw new Error('all four Wukong animation sources are required');
  }
  const sourceBones = state.sourceMetrics[0]?.bones ?? [];
  for (const metrics of state.sourceMetrics) {
    if (JSON.stringify(metrics.bones) !== JSON.stringify(sourceBones)) {
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
