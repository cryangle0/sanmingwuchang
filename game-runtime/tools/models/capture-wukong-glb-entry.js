import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const TARGET_HEIGHT = 2.2;
const RENDER_SIZE = 760;
const BACKGROUND = 0x18201d;

function base64ToArrayBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function renderableBounds(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().makeEmpty();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) {
      return;
    }
    let localBounds;
    if (object instanceof THREE.SkinnedMesh) {
      object.skeleton.update();
      object.computeBoundingBox();
      localBounds = object.boundingBox;
    } else {
      if (!object.geometry.boundingBox) {
        object.geometry.computeBoundingBox();
      }
      localBounds = object.geometry.boundingBox;
    }
    if (localBounds) {
      bounds.union(localBounds.clone().applyMatrix4(object.matrixWorld));
    }
  });
  return bounds;
}

function normalizedPresentationRoot(sourceRoot) {
  const presentation = new THREE.Group();
  presentation.add(sourceRoot);
  const bounds = renderableBounds(presentation);
  const height = bounds.getSize(new THREE.Vector3()).y;
  presentation.scale.setScalar(TARGET_HEIGHT / Math.max(height, 0.001));
  const scaledBounds = renderableBounds(presentation);
  const center = scaledBounds.getCenter(new THREE.Vector3());
  presentation.position.set(-center.x, -scaledBounds.min.y, -center.z);
  presentation.updateMatrixWorld(true);
  return presentation;
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

function meshMetrics(root) {
  const meshRecords = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    const positions = object.geometry.getAttribute('position');
    meshRecords.push({
      name: object.name || 'unnamed-mesh',
      triangles: Math.floor((object.geometry.index?.count ?? positions?.count ?? 0) / 3),
      skinned: object instanceof THREE.SkinnedMesh,
    });
  });
  return meshRecords.sort((left, right) => right.triangles - left.triangles);
}

function textureReady(texture) {
  const image = texture.image;
  const width = image?.naturalWidth ?? image?.videoWidth ?? image?.width ?? 0;
  const height = image?.naturalHeight ?? image?.videoHeight ?? image?.height ?? 0;
  return width > 0 && height > 0;
}

async function waitForTextures(root) {
  const textures = objectTextures(root);
  const deadline = performance.now() + 15_000;
  while (performance.now() < deadline) {
    if (textures.every(textureReady)) {
      return textures.length;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`only ${textures.filter(textureReady).length}/${textures.length} textures ready`);
}

function pixelMetrics(renderer, target, scene, camera, presentation) {
  const baseline = new Uint8Array(RENDER_SIZE * RENDER_SIZE * 4);
  const pixels = new Uint8Array(RENDER_SIZE * RENDER_SIZE * 4);
  renderer.setRenderTarget(target);
  presentation.visible = false;
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(target, 0, 0, RENDER_SIZE, RENDER_SIZE, baseline);
  presentation.visible = true;
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(target, 0, 0, RENDER_SIZE, RENDER_SIZE, pixels);
  renderer.setRenderTarget(null);

  let changedPixels = 0;
  const colors = new Set();
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const difference = Math.max(
      Math.abs((pixels[offset] ?? 0) - (baseline[offset] ?? 0)),
      Math.abs((pixels[offset + 1] ?? 0) - (baseline[offset + 1] ?? 0)),
      Math.abs((pixels[offset + 2] ?? 0) - (baseline[offset + 2] ?? 0)),
    );
    if (difference <= 6) {
      continue;
    }
    changedPixels += 1;
    colors.add(
      (((pixels[offset] ?? 0) >> 4) << 8) |
        (((pixels[offset + 1] ?? 0) >> 4) << 4) |
        ((pixels[offset + 2] ?? 0) >> 4),
    );
  }
  return {
    changedPixels,
    pixelCoverage: changedPixels / (RENDER_SIZE * RENDER_SIZE),
    colorBucketCount: colors.size,
  };
}

window.renderWukongGlbClip = async (input) => {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise((resolve, reject) => {
    loader.parse(base64ToArrayBuffer(input.base64), '', resolve, reject);
  });
  const presentation = normalizedPresentationRoot(gltf.scene);
  const textureCount = await waitForTextures(presentation);
  const meshes = meshMetrics(presentation);
  presentation.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  const clip = gltf.animations.find((candidate) => candidate.name === input.clipName);
  if (!clip) {
    throw new Error(`${input.clipName} clip not found`);
  }
  const mixer = new THREE.AnimationMixer(presentation);
  mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play();
  mixer.setTime(clip.duration * input.sampleFraction);
  presentation.updateMatrixWorld(true);
  const bounds = renderableBounds(presentation);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.add(presentation);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
  camera.position.set(3.7, 2.55, 4.6);
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

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(RENDER_SIZE, RENDER_SIZE, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.setClearColor(BACKGROUND, 1);
  const target = new THREE.WebGLRenderTarget(RENDER_SIZE, RENDER_SIZE, {
    depthBuffer: true,
    stencilBuffer: false,
    colorSpace: THREE.SRGBColorSpace,
  });
  const pixels = pixelMetrics(renderer, target, scene, camera, presentation);
  renderer.render(scene, camera);
  document.body.innerHTML = '';
  document.body.style.margin = '0';
  document.body.appendChild(renderer.domElement);

  return {
    clipName: clip.name,
    duration: clip.duration,
    sampleTime: clip.duration * input.sampleFraction,
    textureCount,
    meshes,
    bounds: {
      minimum: bounds.min.toArray(),
      maximum: bounds.max.toArray(),
      size: size.toArray(),
      horizontalCenterOffset: Math.hypot(center.x, center.z),
    },
    ...pixels,
  };
};
