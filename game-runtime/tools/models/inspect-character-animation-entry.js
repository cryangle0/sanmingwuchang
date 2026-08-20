import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const PLACEHOLDER_TEXTURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
  'AAAADUlEQVR42mNk+M/wHwAF/gL+XwWZVwAAAABJRU5ErkJggg==';

function base64ToArrayBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function trackTarget(trackName) {
  const propertyIndex = trackName.lastIndexOf('.');
  return propertyIndex >= 0 ? trackName.slice(0, propertyIndex) : trackName;
}

function rounded(values) {
  return values.map((value) => Number(value.toFixed(5)));
}

function boundsRecord(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  return {
    min: rounded(bounds.min.toArray()),
    max: rounded(bounds.max.toArray()),
    size: rounded(size.toArray()),
  };
}

function sceneMetrics(root) {
  let objects = 0;
  let meshes = 0;
  let skinnedMeshes = 0;
  let vertices = 0;
  let triangles = 0;
  const bones = new Set();
  const skeletonBones = new Set();
  const materials = new Set();
  const textures = new Set();
  const objectNames = [];
  const meshRecords = [];
  root.traverse((object) => {
    objects += 1;
    if (object.name) {
      objectNames.push(object.name);
    }
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
        skeletonBones.add(bone.name);
      }
    }
    const position = object.geometry.getAttribute('position');
    const meshVertices = position?.count ?? 0;
    const meshTriangles = Math.floor((object.geometry.index?.count ?? meshVertices) / 3);
    vertices += meshVertices;
    triangles += meshTriangles;
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of meshMaterials) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) {
          textures.add(value);
        }
      }
    }
    meshRecords.push({
      name: object.name || 'unnamed-mesh',
      vertices: meshVertices,
      triangles: meshTriangles,
      skinned: object instanceof THREE.SkinnedMesh,
    });
  });
  return {
    objects,
    meshes,
    skinnedMeshes,
    vertices,
    triangles,
    materials: materials.size,
    textures: textures.size,
    bones: [...bones].sort(),
    skeletonBones: [...skeletonBones].sort(),
    objectNames: [...new Set(objectNames)].sort(),
    meshRecords: meshRecords.sort((left, right) => right.triangles - left.triangles),
  };
}

function animationMetrics(root) {
  return root.animations.map((clip) => {
    const targetNames = [...new Set(clip.tracks.map((track) => trackTarget(track.name)))].sort();
    return {
      name: clip.name,
      duration: Number(clip.duration.toFixed(5)),
      tracks: clip.tracks.length,
      targetNames,
      trackNames: clip.tracks.map((track) => track.name).sort(),
      keyframes: clip.tracks.reduce((sum, track) => sum + track.times.length, 0),
    };
  });
}

function applyAuditMaterials(root) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const material = new THREE.MeshStandardMaterial({
      color: object instanceof THREE.SkinnedMesh ? 0xc89451 : 0x849178,
      roughness: 0.78,
      metalness: 0.03,
      side: THREE.DoubleSide,
    });
    object.material = material;
    object.castShadow = true;
    object.receiveShadow = true;
  });
}

function renderPreview(root, clip, sampleRatio) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(800, 800, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.setClearColor(0x18201d, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x18201d);
  applyAuditMaterials(root);
  const mixer = clip ? new THREE.AnimationMixer(root) : null;
  if (mixer && clip) {
    const action = mixer.clipAction(clip);
    action.play();
    mixer.setTime(Math.max(0, clip.duration * sampleRatio));
  }
  let bounds = new THREE.Box3().setFromObject(root);
  let size = bounds.getSize(new THREE.Vector3());
  const scale = 2.2 / Math.max(size.y, 0.001);
  root.scale.multiplyScalar(scale);
  root.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(root);
  size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  root.position.add(new THREE.Vector3(-centre.x, -bounds.min.y, -centre.z));
  root.updateMatrixWorld(true);
  scene.add(root);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
  camera.position.set(3.4, 2.45, 4.2);
  camera.lookAt(0, 1.05, 0);
  scene.add(camera);

  const key = new THREE.DirectionalLight(0xffe0ae, 3.4);
  key.position.set(3.5, 5.5, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xb7d7d1, 0x2d251e, 1.55));

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 64),
    new THREE.MeshStandardMaterial({ color: 0x303a32, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  renderer.render(scene, camera);
  document.body.innerHTML = '';
  document.body.style.margin = '0';
  document.body.appendChild(renderer.domElement);
  return boundsRecord(root);
}

window.inspectCharacterAnimation = async (input) => {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(() => PLACEHOLDER_TEXTURE);
  const loader = new FBXLoader(manager);
  const root = loader.parse(base64ToArrayBuffer(input.base64), '');
  root.name ||= input.name;
  const metrics = sceneMetrics(root);
  const animations = animationMetrics(root);
  const clip = root.animations.reduce(
    (longest, candidate) =>
      !longest || candidate.duration > longest.duration ? candidate : longest,
    null,
  );
  const restBounds = boundsRecord(root);
  const sampledBounds = renderPreview(root, clip, input.sampleRatio ?? 0.35);
  return {
    name: input.name,
    restBounds,
    sampledBounds,
    metrics,
    animations,
    rootChildren: root.children.map((child) => ({
      name: child.name,
      type: child.type,
    })),
  };
};
