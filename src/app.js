import * as THREE from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const CONFIG = {
  realCupHeightMeters: 4.85,
  defaultSceneScale: 2.2,
  minSceneScale: 1.2,
  maxSceneScale: 4.4, 
  scaleStep: 0.12,
  distanceStep: 0.08,
  minDistanceFactor: 0.72,
  maxDistanceFactor: 1.6,
  fallbackDistanceMeters: 11.5,
  fallbackEyeHeightMeters: 1.55,
  iosVerticalOffsetMeters: 5.0,
  yawOffsetRadians: Math.PI,
  finalUrl: "https://hisenseshow.it/landing/"
};

const PLATFORM_DEFAULTS = {
  android: { sceneScale: 1.56, distanceFactor: 1.4 },
  ios: { sceneScale: 10.12, distanceFactor: 0.8 },
  //ios: { sceneScale: 7.2, distanceFactor: 0.5 },
  other: { sceneScale: CONFIG.defaultSceneScale, distanceFactor: 1 }
};

const app = document.getElementById("app");
const canvas = document.getElementById("xrCanvas");
const cameraFeed = document.getElementById("cameraFeed");
const startButton = document.getElementById("startExperience");
const exitButton = document.getElementById("exitButton");
const placeButton = document.getElementById("placeButton");
const restartButton = document.getElementById("restartButton");
const recalibrateButton = document.getElementById("recalibrateButton");
const smallerButton = document.getElementById("smallerButton");
const largerButton = document.getElementById("largerButton");
const nearerButton = document.getElementById("nearerButton");
const fartherButton = document.getElementById("fartherButton");
const statusText = document.getElementById("statusText");
const supportLine = document.getElementById("supportLine");
const cupGuide = document.getElementById("cupGuide");
const audio = document.getElementById("showAudio");
const finalLink = document.querySelector(".final-link");

const userAgent = navigator.userAgent || "";
const isAndroid = /Android/i.test(userAgent);
const isIOS = /iPad|iPhone|iPod/i.test(userAgent)
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isChrome = /Chrome|CriOS/i.test(userAgent);
const platformKey = isIOS ? "ios" : isAndroid ? "android" : "other";
const platformDefaults = PLATFORM_DEFAULTS[platformKey];
const storageVersion = platformKey === "ios" ? "v7" : "v4";

const STORAGE_KEYS = {
  sceneScale: `hisense.sceneScale.${platformKey}.${storageVersion}`,
  distanceFactor: `hisense.distanceFactor.${platformKey}.${storageVersion}`
};

if (platformKey === "ios") {
  localStorage.removeItem(STORAGE_KEYS.sceneScale);
  localStorage.removeItem(STORAGE_KEYS.distanceFactor);
}

let renderer;
let scene;
let camera;
let stageRoot;
let model;
let mixer;
let clipDuration = 30;
let loaded = false;
let loadingPromise;
let xrSession;
let xrReferenceSpaceType = "local";
let fallbackStream;
let currentMode = "boot";
let showRunning = false;
let sceneScale = readStoredNumber(STORAGE_KEYS.sceneScale, platformDefaults.sceneScale);
let distanceFactor = readStoredNumber(STORAGE_KEYS.distanceFactor, platformDefaults.distanceFactor);


sceneScale = clamp(sceneScale, CONFIG.minSceneScale, CONFIG.maxSceneScale);
distanceFactor = clamp(distanceFactor, CONFIG.minDistanceFactor, CONFIG.maxDistanceFactor);

if (supportLine) {
  supportLine.textContent = isAndroid
    ? isChrome
      ? "WebXR quando disponibile, modalità compatibile sugli altri Android."
      : "Apri con Chrome Android per la migliore stabilità AR."
    : "Demo compatibile camera/WebGL su questo browser.";
}
finalLink.href = CONFIG.finalUrl;

startButton.addEventListener("click", startExperience);
placeButton.addEventListener("click", placeAndStartShow);
exitButton.addEventListener("click", closeExperience);
restartButton.addEventListener("click", restartShow);
recalibrateButton.addEventListener("click", recalibrate);
smallerButton.addEventListener("click", () => adjustScale(-CONFIG.scaleStep));
largerButton.addEventListener("click", () => adjustScale(CONFIG.scaleStep));
nearerButton.addEventListener("click", () => adjustDistance(-CONFIG.distanceStep));
fartherButton.addEventListener("click", () => adjustDistance(CONFIG.distanceStep));
audio.addEventListener("ended", finishShow);
window.addEventListener("resize", resizeRenderer);
document.addEventListener("visibilitychange", handleVisibilityChange);

async function startExperience() {
  startButton.disabled = true;
  setStatus("Caricamento scena");

  try {
    await unlockAudio();
    await loadExperience();

    const webXRAvailable = await isWebXRAvailable();
    if (webXRAvailable) {
      await startWebXR();
      setMode("calibrating");
      setStatus("Allinea la sagoma");
      return;
    }

    await startFallbackCamera();
    setMode("fallback-calibrating");
    setStatus("Modalità compatibile");
  } catch (error) {
    console.warn(error);
    try {
      await startFallbackCamera();
      setMode("fallback-calibrating");
      setStatus("Modalità compatibile");
    } catch (fallbackError) {
      console.error(fallbackError);
      setMode("boot");
      setStatus("Fotocamera non disponibile");
      if (supportLine) {
        supportLine.textContent = "Serve accesso alla fotocamera o Chrome Android con WebXR.";
      }
    }
  } finally {
    startButton.disabled = false;
  }
}

async function loadExperience() {
  if (loaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    setupThree();
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath("./vendor/three/addons/libs/draco/");
    dracoLoader.setDecoderConfig({ type: "wasm" });
    loader.setDRACOLoader(dracoLoader);
    loader.load(
      "./assets/Scena_Corretta_512.glb",
      (gltf) => {
        model = gltf.scene;
        model.traverse((object) => {
          object.frustumCulled = false;
          if (!object.isMesh) return;
          object.castShadow = false;
          object.receiveShadow = false;
          if (object.material) {
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            const needsDoubleSide = object.name.toLowerCase().includes("frigorifero")
              || materials.some((material) => /frigorifero|frigo|interno|porte/i.test(material.name || ""));

            materials.forEach((material) => {
              material.side = needsDoubleSide ? THREE.DoubleSide : THREE.FrontSide;
              material.needsUpdate = true;
            });
          }
        });

        stageRoot.add(model);
        mixer = new THREE.AnimationMixer(model);
        if (gltf.animations.length) {
          const clip = gltf.animations[0];
          clipDuration = clip.duration || clipDuration;
          const action = mixer.clipAction(clip);
          action.loop = THREE.LoopOnce;
          action.clampWhenFinished = true;
          action.play();
          mixer.setTime(0);
        }

        loaded = true;
        dracoLoader.dispose();
        resolve();
      },
      (progress) => {
        if (!progress.total) return;
        const percent = Math.round((progress.loaded / progress.total) * 100);
        setStatus(`Caricamento ${percent}%`);
      },
      reject
    );
  });

  return loadingPromise;
}

function setupThree() {
  if (renderer) return;

  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: new URLSearchParams(window.location.search).has("verify")
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.xr.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.05, 120);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x5d7773, 1.7);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(-3, 7, 4);
  scene.add(key);

  stageRoot = new THREE.Group();
  stageRoot.visible = false;
  scene.add(stageRoot);

  resizeRenderer();
}

async function isWebXRAvailable() {
  if (!navigator.xr || !window.isSecureContext) return false;
  try {
    return await navigator.xr.isSessionSupported("immersive-ar");
  } catch {
    return false;
  }
}

async function startWebXR() {
  stopFallbackCamera();
  setupThree();

  const requestCompatible = {
    optionalFeatures: ["dom-overlay", "light-estimation"],
    domOverlay: { root: document.getElementById("xrOverlay") }
  };

  xrSession = await navigator.xr.requestSession("immersive-ar", requestCompatible);
  xrReferenceSpaceType = "local";

  xrSession.addEventListener("end", handleXREnd);
  renderer.xr.setReferenceSpaceType(xrReferenceSpaceType);
  await renderer.xr.setSession(xrSession);
  renderer.setAnimationLoop(render);
}

async function startFallbackCamera() {
  setupThree();
  stopXRSession();

  fallbackStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  });

  cameraFeed.srcObject = fallbackStream;
  await cameraFeed.play();
  renderer.setAnimationLoop(null);
  requestAnimationFrame(renderFallbackLoop);
}

function placeAndStartShow() {
  if (!loaded) return;

  if (currentMode === "calibrating") {
    placeStageFromXR();
    setMode("show");
  } else {
    placeStageForFallback();
    setMode("fallback-show");
  }

  startShow();
}

function placeStageFromXR() {
  const xrCamera = renderer.xr.getCamera(camera);
  const worldCamera = xrCamera.cameras?.[0] || xrCamera;
  worldCamera.updateMatrixWorld(true);

  const cameraPosition = new THREE.Vector3();
  const cameraQuaternion = new THREE.Quaternion();
  const cameraScale = new THREE.Vector3();
  worldCamera.matrixWorld.decompose(cameraPosition, cameraQuaternion, cameraScale);

  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion).normalize();
  const horizontalForward = new THREE.Vector3(forward.x, 0, forward.z);
  if (horizontalForward.lengthSq() < 0.0001) horizontalForward.set(0, 0, -1);
  horizontalForward.normalize();

  const distance = estimateCupDistance(worldCamera) * distanceFactor;
  const rootPosition = cameraPosition.clone().add(horizontalForward.multiplyScalar(distance));
  rootPosition.y = cameraPosition.y - CONFIG.fallbackEyeHeightMeters;

  orientAndScaleStage(rootPosition, cameraPosition);
}

function placeStageForFallback() {
  const portrait = window.innerHeight >= window.innerWidth;
  camera.fov = portrait ? 96 : 68;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.near = 0.05;
  camera.far = 120;
  camera.position.set(0, CONFIG.fallbackEyeHeightMeters, 0);
  camera.lookAt(0, portrait ? 4.4 : 3.2, -14);
  camera.updateProjectionMatrix();

  const rootPosition = new THREE.Vector3(0, 0, -CONFIG.fallbackDistanceMeters * distanceFactor);
  orientAndScaleStage(rootPosition, camera.position);
}

function orientAndScaleStage(rootPosition, cameraPosition) {
  stageRoot.position.copy(rootPosition);
  const directionToCamera = cameraPosition.clone().sub(rootPosition);
  directionToCamera.y = 0;
  if (directionToCamera.lengthSq() < 0.0001) directionToCamera.set(0, 0, -1);
  directionToCamera.normalize();

  stageRoot.rotation.set(0, Math.atan2(-directionToCamera.x, -directionToCamera.z) + CONFIG.yawOffsetRadians, 0);
  stageRoot.scale.setScalar(sceneScale);
  stageRoot.visible = true;
}

function estimateCupDistance(worldCamera) {
  const projectionCamera = worldCamera.projectionMatrix ? worldCamera : camera;
  const fovY = 2 * Math.atan(1 / projectionCamera.projectionMatrix.elements[5]);
  const guideHeight = getGuideHeightFraction();
  const distance = CONFIG.realCupHeightMeters / (2 * Math.tan(fovY / 2) * guideHeight);
  return clamp(distance, 4.2, 11.5);
}

function getGuideHeightFraction() {
  const rect = cupGuide.getBoundingClientRect();
  const height = rect.height || window.innerHeight * 0.64;
  return clamp(height / Math.max(window.innerHeight, 1), 0.46, 0.78);
}

function startShow() {
  showRunning = true;
  setStatus("Show in corso");
  audio.currentTime = 0;
  mixer?.setTime(0);
  audio.play().catch((error) => {
    console.warn("Audio playback blocked", error);
    setStatus("Tocca Riavvia per audio");
  });
}

function restartShow() {
  if (!stageRoot.visible) {
    placeAndStartShow();
    return;
  }
  startShow();
}

function recalibrate() {
  showRunning = false;
  audio.pause();
  audio.currentTime = 0;
  mixer?.setTime(0);
  stageRoot.visible = false;
  setStatus("Allinea la sagoma");
  setMode(currentMode.startsWith("fallback") ? "fallback-calibrating" : "calibrating");
}

function finishShow() {
  showRunning = false;
  mixer?.setTime(Math.min(clipDuration, audio.duration || clipDuration));
  window.location.assign(CONFIG.finalUrl);
}

function renderFallbackLoop() {
  if (!currentMode.startsWith("fallback")) return;
  render();
  requestAnimationFrame(renderFallbackLoop);
}

function render() {
  if (showRunning && mixer) {
    mixer.setTime(Math.min(audio.currentTime || 0, clipDuration));
  }

  renderer.render(scene, camera);
}

function adjustScale(delta) {
  sceneScale = clamp(sceneScale + delta, CONFIG.minSceneScale, CONFIG.maxSceneScale);
  localStorage.setItem(STORAGE_KEYS.sceneScale, String(sceneScale));
  stageRoot?.scale.setScalar(sceneScale);
  setStatus(`Scala ${Math.round(sceneScale * 100)}%`);
}

function adjustDistance(delta) {
  distanceFactor = clamp(distanceFactor + delta, CONFIG.minDistanceFactor, CONFIG.maxDistanceFactor);
  localStorage.setItem(STORAGE_KEYS.distanceFactor, String(distanceFactor));
  setStatus(`Distanza ${Math.round(distanceFactor * 100)}%`);
}

function resizeRenderer() {
  if (!renderer || !camera) return;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

async function unlockAudio() {
  try {
    const previousVolume = audio.volume;
    audio.volume = 0;
    await audio.play();
    audio.pause();
    audio.currentTime = 0;
    audio.volume = previousVolume || 1;
  } catch {
    audio.volume = 1;
  }
}

function handleVisibilityChange() {
  if (document.hidden && showRunning) {
    audio.pause();
  }
}

function handleXREnd() {
  xrSession = null;
  showRunning = false;
  audio.pause();
  if (!currentMode.startsWith("fallback")) {
    setMode("boot");
    setStatus("Sessione chiusa");
  }
}

function closeExperience() {
  showRunning = false;
  audio.pause();
  audio.currentTime = 0;
  mixer?.setTime(0);
  stageRoot.visible = false;
  stopFallbackCamera();
  stopXRSession();
  setMode("boot");
}

function stopXRSession() {
  if (!xrSession) return;
  const session = xrSession;
  xrSession = null;
  session.end().catch(() => {});
  renderer?.setAnimationLoop(null);
}

function stopFallbackCamera() {
  if (fallbackStream) {
    fallbackStream.getTracks().forEach((track) => track.stop());
    fallbackStream = null;
  }
  cameraFeed.srcObject = null;
}

function setMode(mode) {
  currentMode = mode;
  app.dataset.mode = mode;
}

function setStatus(message) {
  statusText.value = message;
  statusText.textContent = message;
}

function readStoredNumber(key, fallback) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
