import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

function base64ToArrayBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

window.renderMapAsset = async (base64) => {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise((resolve, reject) => {
    loader.parse(base64ToArrayBuffer(base64), '', resolve, reject);
  });
  const scene = gltf.scene;
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  const bounds = new THREE.Box3().setFromObject(scene);
  const centre = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 1);
  scene.position.sub(centre);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 500);
  camera.position.set(radius * 1.65, radius * 1.1, radius * 1.65);
  camera.lookAt(0, radius * 0.14, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(760, 760, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x1b211e, 1);

  const key = new THREE.DirectionalLight(0xffe1b2, 3.2);
  key.position.set(radius * 1.8, radius * 2.8, radius * 1.1);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xb7d7d1, 0x30251e, 1.55));

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 1.25, 64),
    new THREE.MeshStandardMaterial({ color: 0x30382f, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -radius * 0.5;
  ground.receiveShadow = true;
  scene.add(ground);

  const root = new THREE.Scene();
  root.background = new THREE.Color(0x1b211e);
  root.add(scene);
  renderer.render(root, camera);
  document.body.innerHTML = '';
  document.body.style.margin = '0';
  document.body.style.background = '#1b211e';
  document.body.appendChild(renderer.domElement);
  return {
    width: size.x,
    height: size.y,
    depth: size.z,
  };
};
