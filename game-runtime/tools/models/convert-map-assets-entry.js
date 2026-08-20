import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

const PLACEHOLDER_TEXTURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function b64ToArrayBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function dataUrl(file) {
  return `data:${file.mime};base64,${file.b64}`;
}

function fileNameFromUrl(value) {
  const normalized = decodeURIComponent(value.replace(/\\/g, '/'));
  return normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
}

function textureUrlMap(files) {
  return new Map(
    (files ?? []).map((file) => [String(file.name ?? '').toLowerCase(), dataUrl(file)]),
  );
}

function normalizedTextureKey(value) {
  return fileNameFromUrl(String(value ?? ''))
    .replace(/\.[^.]+$/i, '')
    .replace(/[^a-z0-9]+/g, '');
}

function semanticTextureMatch(materialName, loadedTextures) {
  const key = normalizedTextureKey(materialName);
  const rules = [
    {
      material: /roof|tile/i,
      texture: /roof|tile/i,
    },
    {
      material: /maple.*leaf|leaf.*maple/i,
      texture: /maple.*leaf|leaf.*maple/i,
    },
    {
      material: /oak.*leaf|leaf.*oak/i,
      texture: /oak/i,
    },
  ];
  for (const rule of rules) {
    if (rule.material.test(key)) {
      const match = loadedTextures.find(({ key: textureKey }) => rule.texture.test(textureKey));
      if (match) {
        return match;
      }
    }
  }
  return null;
}

async function loadInputTextures(files) {
  const loader = new THREE.TextureLoader();
  const loaded = [];
  for (const file of files ?? []) {
    try {
      const texture = await loader.loadAsync(dataUrl(file));
      texture.name = file.name;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.needsUpdate = true;
      loaded.push({
        fileName: file.name,
        key: normalizedTextureKey(file.name),
        texture,
      });
    } catch {
      // The material falls back to its authored colour or the semantic palette.
    }
  }
  return loaded;
}

function assignInputTextures(root, loadedTextures) {
  const assigned = [];
  const unmatched = new Set();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material) {
        continue;
      }
      const sourceMap = material.map ?? null;
      const candidateKeys = [
        normalizedTextureKey(material.name),
        normalizedTextureKey(sourceMap?.name),
        normalizedTextureKey(sourceMap?.sourceFile),
      ].filter(Boolean);
      const matched =
        loadedTextures.find(({ key }) =>
          candidateKeys.some(
            (candidate) => candidate === key || candidate.includes(key) || key.includes(candidate),
          ),
        ) ?? semanticTextureMatch(material.name, loadedTextures);
      if (!matched) {
        unmatched.add(material.name || sourceMap?.name || 'unnamed-material');
        continue;
      }
      const texture = matched.texture.clone();
      texture.image = matched.texture.image;
      if (sourceMap) {
        texture.offset.copy(sourceMap.offset);
        texture.repeat.copy(sourceMap.repeat);
        texture.center.copy(sourceMap.center);
        texture.rotation = sourceMap.rotation;
        texture.wrapS = sourceMap.wrapS;
        texture.wrapT = sourceMap.wrapT;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.name = matched.fileName;
      texture.needsUpdate = true;
      material.map = texture;
      material.needsUpdate = true;
      assigned.push({
        material: material.name || 'unnamed-material',
        texture: matched.fileName,
      });
    }
  });
  return {
    assigned,
    unmatched: [...unmatched].sort(),
  };
}

function colorHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function paletteColor(materialName, sourceColor, profile) {
  const key = String(materialName ?? '').toLowerCase();
  const source = sourceColor?.clone?.() ?? new THREE.Color(0xffffff);
  const sourceMaximum = Math.max(source.r, source.g, source.b);
  const sourceMinimum = Math.min(source.r, source.g, source.b);
  const sourceIsNearBlack = sourceMaximum < 0.045;
  const sourceIsUseful =
    !sourceIsNearBlack &&
    (source.r < 0.98 || source.g < 0.98 || source.b < 0.98) &&
    sourceMaximum - sourceMinimum > 0.01;
  if (sourceIsUseful) {
    return source;
  }

  if (/roof|tile/i.test(key)) {
    return new THREE.Color(0xa84d35);
  }

  const palettes =
    profile === 'rock'
      ? [0x6d6256, 0x877566, 0x8d8171, 0x5a554e, 0x9b8b79]
      : profile === 'foliage'
        ? [0x3f5c3b, 0x6d4c3d, 0x78924d, 0x9d6b47, 0x8f4d4d, 0x596b51]
        : [0x6d4c3d, 0x8b6045, 0x9f7a4f, 0x5d6f61, 0x708b78, 0x8a4f4e, 0xb28a55, 0x5d6673];
  let index = colorHash(key) % palettes.length;
  if (/water|shui|yu|ocean|river/i.test(key)) {
    index = 3;
  } else if (/maple|autumn|red/i.test(key)) {
    index = profile === 'foliage' ? 4 : 5;
  } else if (/leaf|leaves|foliage|plant|zhiwu|tree|grass|bush|reed|fern|flower/i.test(key)) {
    index = profile === 'foliage' ? 0 : 4;
  } else if (/roof|tile|qizi|red|lacquer/i.test(key)) {
    index = profile === 'foliage' ? 3 : 5;
  } else if (/wood|building|item|timber/i.test(key)) {
    index = 1;
  } else if (/terrain|ground|dimian|stone|rock|cliff/i.test(key)) {
    index = 2;
  }
  return new THREE.Color(palettes[index]);
}

function materialKey(material, profile) {
  const color = material.color ?? new THREE.Color(0xffffff);
  return [
    profile,
    material.name ?? '',
    color.getHex(),
    material.transparent ? 'alpha' : 'opaque',
  ].join('|');
}

function cleanScene(root, profile, assetName = '') {
  const materials = new Map();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
    const cleanedMaterials = sourceMaterials.map((source) => {
      const sourceMap = source.map ?? null;
      const key = `${materialKey(source, profile)}|${sourceMap?.uuid ?? ''}`;
      const cached = materials.get(key);
      if (cached) {
        return cached;
      }
      const isLightMap = /light|emis|glow/i.test(`${source.name ?? ''} ${sourceMap?.name ?? ''}`);
      const materialDescriptor = `${assetName} ${source.name ?? ''} ${sourceMap?.name ?? ''}`;
      const isFoliage =
        profile === 'foliage' &&
        /leaf|leaves|foliage|plant|tree|bush|reed|fern|flower/i.test(materialDescriptor);
      const isRoof = /roof|tile/i.test(materialDescriptor);
      const cutout = isFoliage || (Boolean(source.transparent) && !isRoof);
      const material = new THREE.MeshStandardMaterial({
        name: source.name || `${profile}-material`,
        color: sourceMap
          ? isRoof
            ? 0xa84d35
            : 0xffffff
          : paletteColor(source.name, source.color, profile),
        roughness: profile === 'rock' ? 0.94 : profile === 'foliage' ? 0.9 : 0.82,
        metalness: profile === 'rock' ? 0.02 : 0.04,
        transparent: Boolean(source.transparent) && !isFoliage && !isRoof,
        opacity: source.opacity ?? 1,
        alphaTest: isRoof ? 0 : cutout ? Math.max(source.alphaTest ?? 0, 0.24) : 0,
        depthWrite: true,
        side: cutout ? THREE.DoubleSide : THREE.FrontSide,
      });
      if (sourceMap) {
        material.map = sourceMap;
        sourceMap.colorSpace = THREE.SRGBColorSpace;
        if (isLightMap) {
          material.emissiveMap = sourceMap;
          material.emissive.set(0xffc36b);
          material.emissiveIntensity = 0.45;
        }
        material.color.set(isRoof ? 0xa84d35 : 0xffffff);
        material.normalMap = null;
        material.roughnessMap = null;
        material.metalnessMap = null;
        material.aoMap = null;
        material.needsUpdate = true;
      }
      if (isFoliage) {
        material.emissive.setRGB(0.04, 0.07, 0.025);
        material.emissiveIntensity = sourceMap ? 0.35 : 0.15;
      }
      if (isRoof) {
        material.transparent = false;
        material.opacity = 1;
        material.alphaTest = 0;
        material.depthWrite = true;
        material.side = THREE.FrontSide;
      }
      if (source.vertexColors) {
        material.vertexColors = true;
      }
      materials.set(key, material);
      return material;
    });
    object.material = Array.isArray(object.material)
      ? cleanedMaterials
      : (cleanedMaterials[0] ?? cleanedMaterials);
    object.castShadow = false;
    object.receiveShadow = true;
  });
  root.updateMatrixWorld(true);
  return { materialCount: materials.size };
}

function filterScene(root, filter) {
  const include = filter?.include ? new RegExp(filter.include, 'i') : null;
  const exclude = filter?.exclude ? new RegExp(filter.exclude, 'i') : null;
  const spatialBounds = filter?.bounds ?? null;
  if (!include && !exclude && !spatialBounds) {
    return;
  }
  root.updateMatrixWorld(true);

  function intersectsSpatialBounds(object) {
    if (!spatialBounds || !(object instanceof THREE.Mesh)) {
      return true;
    }
    const bounds = new THREE.Box3().setFromObject(object);
    return (
      (spatialBounds.minX === undefined || bounds.max.x >= spatialBounds.minX) &&
      (spatialBounds.maxX === undefined || bounds.min.x <= spatialBounds.maxX) &&
      (spatialBounds.minY === undefined || bounds.max.y >= spatialBounds.minY) &&
      (spatialBounds.maxY === undefined || bounds.min.y <= spatialBounds.maxY) &&
      (spatialBounds.minZ === undefined || bounds.max.z >= spatialBounds.minZ) &&
      (spatialBounds.maxZ === undefined || bounds.min.z <= spatialBounds.maxZ)
    );
  }

  function pruneNode(object, inheritedKeep) {
    const name = String(object.name ?? '');
    if (object !== root && exclude?.test(name)) {
      return false;
    }
    const keepSelf = inheritedKeep || !include || include.test(name);
    let keptRenderable =
      object instanceof THREE.Mesh && keepSelf && intersectsSpatialBounds(object);
    for (const child of [...object.children]) {
      if (pruneNode(child, keepSelf)) {
        keptRenderable = true;
      } else {
        object.remove(child);
      }
    }
    return keptRenderable;
  }

  pruneNode(root, false);
  root.updateMatrixWorld(true);
}

function normalizeFloor(root, targetHeight) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const height = Math.max(0.001, bounds.max.y - bounds.min.y);
  const scale = targetHeight > 0 ? targetHeight / height : 1;
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  const scaledBounds = new THREE.Box3().setFromObject(root);
  const centreX = (scaledBounds.min.x + scaledBounds.max.x) / 2;
  const centreZ = (scaledBounds.min.z + scaledBounds.max.z) / 2;
  root.position.x -= centreX;
  root.position.y -= scaledBounds.min.y;
  root.position.z -= centreZ;
  root.updateMatrixWorld(true);
  const finalBounds = new THREE.Box3().setFromObject(root);
  return {
    nativeHeight: height,
    targetHeight: targetHeight > 0 ? targetHeight : height,
    scale,
    bounds: [...finalBounds.min.toArray(), ...finalBounds.max.toArray()].map((value) =>
      Number(value.toFixed(3)),
    ),
  };
}

function removeEmptyNodes(root) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.computeBoundingBox();
      object.geometry.computeBoundingSphere();
    }
  });
}

async function exportGlb(root) {
  removeEmptyNodes(root);
  const result = await new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      root,
      (value) => resolve(value),
      (error) => reject(error),
      {
        binary: true,
        onlyVisible: false,
        truncateDrawRange: true,
      },
    );
  });
  return new Uint8Array(result);
}

function arrayBufferToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function parseFbx(input) {
  const manager = new THREE.LoadingManager();
  const textures = textureUrlMap(input.textures);
  manager.setURLModifier((url) => textures.get(fileNameFromUrl(url)) ?? PLACEHOLDER_TEXTURE);
  const loader = new FBXLoader(manager);
  let resolveLoaded;
  const loaded = new Promise((resolve) => {
    resolveLoaded = resolve;
  });
  manager.onLoad = () => resolveLoaded();
  const root = loader.parse(b64ToArrayBuffer(input.b64), '');
  await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  const inputTextures = await loadInputTextures(input.textures);
  root.userData.inputTextureDiagnostics = assignInputTextures(root, inputTextures);
  return root;
}

async function waitForTextureImages(root) {
  const textures = new Set();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material?.map) {
        textures.add(material.map);
      }
    }
  });

  await Promise.all(
    [...textures].map(
      (texture) =>
        new Promise((resolve) => {
          const image = texture.image;
          if (!image) {
            resolve();
            return;
          }
          const width = image.naturalWidth ?? image.width ?? 0;
          const height = image.naturalHeight ?? image.height ?? 0;
          if (image.complete && width > 0 && height > 0) {
            resolve();
            return;
          }
          const finish = () => {
            image.removeEventListener?.('load', finish);
            image.removeEventListener?.('error', finish);
            resolve();
          };
          image.addEventListener?.('load', finish, { once: true });
          image.addEventListener?.('error', finish, { once: true });
          setTimeout(finish, 2_000);
        }),
    ),
  );

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const texture = material?.map;
      const image = texture?.image;
      const width = image?.naturalWidth ?? image?.width ?? 0;
      const height = image?.naturalHeight ?? image?.height ?? 0;
      if (texture && (!image || width <= 0 || height <= 0)) {
        material.map = null;
        material.needsUpdate = true;
      }
    }
  });
  return {
    total: textures.size,
    valid: [...textures].filter((texture) => {
      const image = texture.image;
      const width = image?.naturalWidth ?? image?.width ?? 0;
      const height = image?.naturalHeight ?? image?.height ?? 0;
      return width > 0 && height > 0;
    }).length,
  };
}

async function parseObj(input) {
  const textureMap = new Map(
    (input.textures ?? []).map((file) => [file.name.toLowerCase(), dataUrl(file)]),
  );
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => textureMap.get(fileNameFromUrl(url)) ?? PLACEHOLDER_TEXTURE);
  const materials = new MTLLoader(manager).parse(input.mtl, '');
  materials.preload();
  const loader = new OBJLoader(manager);
  loader.setMaterials(materials);
  let resolveLoaded;
  const loaded = new Promise((resolve) => {
    resolveLoaded = resolve;
  });
  manager.onLoad = () => resolveLoaded();
  const root = loader.parse(input.obj);
  await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  return root;
}

function sceneMetrics(root, includeDetails = false) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  let meshes = 0;
  let triangles = 0;
  const details = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    meshes += 1;
    const position = object.geometry.getAttribute('position');
    triangles += (object.geometry.index?.count ?? position?.count ?? 0) / 3;
    if (includeDetails) {
      const meshBounds = new THREE.Box3().setFromObject(object);
      details.push({
        name: object.name || 'unnamed-mesh',
        triangles: Math.round((object.geometry.index?.count ?? position?.count ?? 0) / 3),
        bounds: [...meshBounds.min.toArray(), ...meshBounds.max.toArray()].map((value) =>
          Number(value.toFixed(2)),
        ),
      });
    }
  });
  const metrics = {
    meshes,
    triangles: Math.round(triangles),
    nativeBounds: [...bounds.min.toArray(), ...bounds.max.toArray()].map((value) =>
      Number(value.toFixed(3)),
    ),
  };
  if (includeDetails) {
    metrics.meshDetails = details.sort((left, right) => right.triangles - left.triangles);
  }
  return metrics;
}

window.convertMapAsset = async (input) => {
  const root = input.type === 'obj' ? await parseObj(input) : await parseFbx(input);
  const textureImages = await waitForTextureImages(root);
  const includeDetails = Boolean(input.debugNodes);
  const before = sceneMetrics(root, includeDetails);
  filterScene(root, input.nodeFilter);
  const filtered = sceneMetrics(root, includeDetails);
  const parts =
    input.type === 'obj' ? root.children.filter((child) => child instanceof THREE.Mesh) : [root];
  const exportedParts = [];
  for (const [index, sourcePart] of parts.entries()) {
    const part = input.type === 'obj' ? new THREE.Group().add(sourcePart.clone(true)) : sourcePart;
    const cleaned = cleanScene(part, input.profile ?? 'landmark', input.name ?? '');
    const targetHeight = input.partTargetHeights?.[index] ?? input.targetHeight ?? 10;
    const normalized = normalizeFloor(part, targetHeight);
    const after = sceneMetrics(part);
    const glb = await exportGlb(part);
    exportedParts.push({
      name: sourcePart.name || `part-${index + 1}`,
      b64: arrayBufferToBase64(glb),
      metrics: {
        before: index === 0 ? before : null,
        filtered: index === 0 ? filtered : null,
        after,
        materials: cleaned.materialCount,
        normalized,
      },
    });
  }
  return {
    parts: exportedParts,
    metrics: {
      before,
      filtered,
      parts: exportedParts.length,
      textureAssignments: root.userData.inputTextureDiagnostics ?? null,
      textureImages,
    },
  };
};

window.__ready = true;
