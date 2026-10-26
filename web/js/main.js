/* MOSCA VIRTUAL — hilo principal: render 3D + UI + bucle cerrado mundo↔cerebro */
import * as THREE from './three.module.min.js';
import { World, WATER } from './world.js?v=eco16a';

const $ = (id) => document.getElementById(id);
const loader = $('loader');

// ---------- estado ----------
let tables, neuronsMeta;   // metadatos en main thread (para colores/inspección)
let snap = null;           // Uint8Array actividad (N)
let N = 0;
let colorMode = 'act';     // act | nt | reg
let autoWorld = true;
const env = { lightL: 0, lightR: 0, odor: 0, odorL: 0, odorR: 0, taste: 0, poke: 0, humidity: 0.5, temp: 0.5 };
const motor = { walk: 0, turn: 0, fly: 0, feed: 0, arousal: 0, mechAct: 0 };
let inspectNeuron = -1;

// ---------- worker ----------
const worker = new Worker('js/brain-worker.js?v=eco16a');
worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'progress') { $('bari').style.width = m.pct + '%'; $('lmsg').textContent = m.label; }
  if (m.type === 'ready') { N = m.N; $('lmsg').textContent = 'Conectoma listo'; loader.style.display = 'none'; }
  if (m.type === 'error') { loader.style.display = 'flex'; $('lmsg').textContent = m.message || 'No se pudo iniciar la simulación.'; $('lmsg').classList.add('error'); }
  if (m.type === 'snap') {
    snap = m.snap;
    Object.assign(motor, m.motor);
    $('sHz').textContent = m.spikes.toLocaleString();
    $('sSim').textContent = Math.round(m.simHz);
    let a = 0; for (let i = 0; i < snap.length; i += 13) a += snap[i];
    const avg = a / (snap.length / 13) / 255;
    $('sAct').textContent = Math.round(avg * 100) + '%';
    $('mAct').style.width = Math.min(100, avg * 250) + '%';
    $('mWalk').style.width = Math.min(100, motor.walk * 400) + '%';
    $('mTurn').style.width = Math.min(100, Math.abs(motor.turn) * 500) + '%';
    $('mFly').style.width = Math.min(100, motor.fly * 500) + '%';
    $('mFeed').style.width = Math.min(100, motor.feed * 400) + '%';
    updateColors();
  }
  if (m.type === 'inspect') showInspect(m);
};

// ---------- carga (top-level await: el scene 3D se construye CON los datos ya listos) ----------
tables = await (await fetch('data/tables.json')).json();
{
  const nb = await (await fetch('data/neurons.bin')).arrayBuffer();
  const dv = new DataView(nb);
  const REC = 20;
  N = nb.byteLength / REC;
  neuronsMeta = {
    x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N),
    sc: new Uint8Array(N), nt: new Uint8Array(N), cl: new Uint8Array(N), sd: new Uint8Array(N),
  };
  for (let i = 0; i < N; i++) {
    const o = i * REC;
    neuronsMeta.x[i] = dv.getFloat32(o, true);
    neuronsMeta.y[i] = dv.getFloat32(o + 4, true);
    neuronsMeta.z[i] = dv.getFloat32(o + 8, true);
    neuronsMeta.sc[i] = dv.getUint8(o + 12);
    neuronsMeta.nt[i] = dv.getUint8(o + 14);
    neuronsMeta.sd[i] = dv.getUint8(o + 15);
    neuronsMeta.cl[i] = dv.getUint8(o + 18);
  }
}
worker.postMessage({
  type: 'init',
  neuronsURL: new URL('data/neurons.bin', document.baseURI).href,
  synapsesURL: new URL('data/synapses.bin', document.baseURI).href,
  tables,
});

// ---------- escena del cerebro ----------
const brainView = $('vBrain');
const bRenderer = new THREE.WebGLRenderer({ antialias: false });
brainView.appendChild(bRenderer.domElement);
const bScene = new THREE.Scene();
bScene.background = new THREE.Color(0x07090d);
const bCam = new THREE.PerspectiveCamera(50, 1, 1, 5000);

// centrar y escalar coords nm -> unidades
const CX = 500000, CY = 240000, CZ = 140000, SC = 0.00042;
const pos = new Float32Array(N * 3);
for (let i = 0; i < N; i++) {
  pos[i * 3] = (neuronsMeta.x[i] - CX) * SC;
  pos[i * 3 + 1] = (neuronsMeta.z[i] - CZ) * SC;   // z (dorso-ventral) -> arriba
  pos[i * 3 + 2] = (neuronsMeta.y[i] - CY) * SC;
}
const bGeo = new THREE.BufferGeometry();
bGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
const colAttr = new THREE.BufferAttribute(new Uint8Array(N * 3).fill(80), 3, true);
bGeo.setAttribute('color', colAttr);
const bPoints = new THREE.Points(bGeo, new THREE.PointsMaterial({
  size: 1.15, vertexColors: true, transparent: true, opacity: 0.9, sizeAttenuation: true,
}));
bScene.add(bPoints);

// paletas
const NTCOL = { 1: [80, 220, 120], 2: [90, 140, 255], 3: [255, 160, 60], 4: [200, 110, 255], 5: [255, 110, 180], 6: [80, 220, 220], 0: [110, 115, 125] };
const REGCOL = { 1: [255, 200, 90], 2: [120, 130, 160], 3: [255, 90, 90], 4: [220, 120, 255], 5: [255, 60, 60], 6: [80, 180, 255], 7: [110, 255, 150], 8: [255, 140, 200], 9: [140, 255, 230] };
function heat(v) { // 0..255 -> azul->cian->amarillo->rojo
  const t = v / 255;
  if (t < 0.33) return [20 + t * 90, 40 + t * 500, 90 + t * 400];
  if (t < 0.66) return [50 + (t - .33) * 620, 190, 190 - (t - .33) * 500];
  return [255, 220 - (t - .66) * 600, 20];
}
function updateColors() {
  if (!snap) return;
  const c = colAttr.array;
  for (let i = 0; i < N; i++) {
    let r, g, b;
    if (colorMode === 'act') {
      const v = snap[i];
      if (v < 3) { r = 14; g = 18; b = 28; }
      else { const h = heat(v); r = h[0]; g = h[1]; b = h[2]; }
    } else if (colorMode === 'nt') {
      const p = NTCOL[neuronsMeta.nt[i]] || NTCOL[0];
      const boost = snap[i] / 255;
      r = p[0] * (0.35 + boost); g = p[1] * (0.35 + boost); b = p[2] * (0.35 + boost);
    } else {
      const p = REGCOL[neuronsMeta.sc[i]] || [90, 90, 90];
      const boost = snap[i] / 255;
      r = p[0] * (0.3 + boost); g = p[1] * (0.3 + boost); b = p[2] * (0.3 + boost);
    }
    c[i * 3] = Math.min(255, r); c[i * 3 + 1] = Math.min(255, g); c[i * 3 + 2] = Math.min(255, b);
  }
  colAttr.needsUpdate = true;
}

// controles orbitales manuales (cerebro)
let bYaw = 0.6, bPitch = 0.25, bDist = 260, dragging = false, lx = 0, ly = 0;
bRenderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
addEventListener('pointerup', () => dragging = false);
addEventListener('pointermove', (e) => {
  if (!dragging) return;
  bYaw += (e.clientX - lx) * 0.005; bPitch += (e.clientY - ly) * 0.005;
  bPitch = Math.max(-1.4, Math.min(1.4, bPitch));
  lx = e.clientX; ly = e.clientY;
});
bRenderer.domElement.addEventListener('wheel', (e) => { e.preventDefault(); bDist *= 1 + e.deltaY * 0.001; bDist = Math.max(40, Math.min(900, bDist)); }, { passive: false });

// clic -> inspección
const ray = new THREE.Raycaster();
ray.params.Points.threshold = 1.6;
bRenderer.domElement.addEventListener('click', (e) => {
  const r = bRenderer.domElement.getBoundingClientRect();
  const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(p, bCam);
  const hit = ray.intersectObject(bPoints)[0];
  if (hit) { inspectNeuron = hit.index; worker.postMessage({ type: 'inspect', neuron: inspectNeuron }); }
});

// líneas de conexiones del neurón inspeccionado
let connLines = null;
function showInspect(m) {
  $('inspect').style.display = 'block';
  $('iTitle').textContent = 'Neurona #' + m.neuron.toLocaleString();
  $('iClass').textContent = tables.class[m.cl - 1] || '—';
  $('iSuper').textContent = tables.super_class[m.sc - 1] || '—';
  $('iNT').textContent = m.nt ? tables.nt[m.nt - 1] : '—';
  $('iDeg').textContent = m.degree.toLocaleString();
  $('iSide').textContent = m.sd ? 'derecha' : 'izquierda';
  if (connLines) { bScene.remove(connLines); connLines.geometry.dispose(); }
  const pts = new Float32Array(m.targets.length * 6);
  for (let k = 0; k < m.targets.length; k++) {
    const t = m.targets[k];
    pts[k * 6] = (m.x - CX) * SC; pts[k * 6 + 1] = (m.z - CZ) * SC; pts[k * 6 + 2] = (m.y - CY) * SC;
    pts[k * 6 + 3] = (neuronsMeta.x[t] - CX) * SC; pts[k * 6 + 4] = (neuronsMeta.z[t] - CZ) * SC; pts[k * 6 + 5] = (neuronsMeta.y[t] - CY) * SC;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  connLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.5 }));
  bScene.add(connLines);
}
$('iClose').onclick = () => { $('inspect').style.display = 'none'; if (connLines) { bScene.remove(connLines); connLines = null; } };
$('iStim').onclick = () => { if (inspectNeuron >= 0) worker.postMessage({ type: 'stim', neuron: inspectNeuron, ticks: 60 }); };

// ---------- escena de la mosca ----------
const flyView = $('vFly');
const fRenderer = new THREE.WebGLRenderer({ antialias: true });
flyView.appendChild(fRenderer.domElement);
const fScene = new THREE.Scene();
fScene.background = new THREE.Color(0x0a0e14);
fScene.fog = new THREE.Fog(0x0a0e14, 140, 680);
const fCam = new THREE.PerspectiveCamera(50, 1, 0.1, 15000);

// ---- CÁMARA FIJA EN LA MOSCA: el usuario SÓLO acerca/aleja con la rueda ----
// (antes: arrastrar orbitaba libremente y la rueda dejaba ir hasta 40 m → la mosca
//  de 2.5 mm desaparecía entre la niebla y el usuario la perdía)
let camYaw = 2.4, camPitch = 0.30, camDist = 30;   // vista 3/4 fija sobre la mosca
const CAM_MIN = 2, CAM_MAX = 250;                  // 2 cm ↔ 2.5 m: más lejos = invisible
const camTgt = new THREE.Vector3(), _v3tmp = new THREE.Vector3();
fRenderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  camDist = Math.max(CAM_MIN, Math.min(CAM_MAX, camDist * (1 + e.deltaY * 0.0012)));
}, { passive: false });

// ecosistema procedural (terreno en chunks, árboles, frutos, fauna, día/noche)
const world = new World(fScene);

// ---- la mosca: ANATOMÍA COMPLETA de Drosophila melanogaster ----
// Cabeza: ojos compuestos, triángulo de 3 ocelos, antenas (escapo+pedicelo+flagelo+arista
// plumosa), probóscide con labelos, palpos maxilares. Tórax: pronoto, escutum, scutelo,
// sedas. 6 patas: coxa, fémur, tibia con espinas, tarso articulado, uñas+pulvillos.
// 2 alas con venación + álula, 2 HALTERIOS (órganos de equilibrio de los dípteros).
// Abdomen: tergitos con bandas, espiráculos, terminalia.
const fly = new THREE.Group();
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.55 });   // quitina gris
const darkMat = new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.6 });     // bandas/oscuras
const bristleMat = new THREE.MeshStandardMaterial({ color: 0x14100a, roughness: 0.4 });  // sedas negras
// --- tórax: bloques + placas dorsales (pronoto, escutum, scutelo, postnotum) + pleuron ---
const tho = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 16), bodyMat); tho.scale.set(1.15, 0.95, 1.05); tho.position.x = 3; fly.add(tho);
const pronotum = new THREE.Mesh(new THREE.SphereGeometry(3.2, 12, 10), darkMat);
pronotum.scale.set(0.5, 0.55, 1.15); pronotum.position.set(-1.4, 2.8, 0); fly.add(pronotum);
const scutum = new THREE.Mesh(new THREE.SphereGeometry(5.2, 14, 12), darkMat);
scutum.scale.set(1.0, 0.45, 1.0); scutum.position.set(2.6, 3.6, 0); fly.add(scutum);
const scutellum = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 10), darkMat);
scutellum.scale.set(0.9, 0.5, 1.0); scutellum.position.set(7.3, 3.3, 0); fly.add(scutellum);
const postnotum = new THREE.Mesh(new THREE.SphereGeometry(1.7, 10, 8), darkMat);   // placa tras al escutelo
postnotum.scale.set(0.7, 0.35, 1.0); postnotum.position.set(8.9, 2.9, 0); fly.add(postnotum);
for (const sgn of [1, -1]) {                                                        // pleuron (placas laterales)
  const pl = new THREE.Mesh(new THREE.SphereGeometry(3.4, 10, 8), darkMat);
  pl.scale.set(1.15, 0.9, 0.35); pl.position.set(2.8, -0.6, sgn * 4.6); fly.add(pl);
  const hum = new THREE.Mesh(new THREE.SphereGeometry(1.15, 8, 6), bodyMat);        // callo humeral
  hum.position.set(-0.6, 1.4, sgn * 4.9); fly.add(hum);
}
// sedas torácicas (acrosticales, humerales, prescutelares) — conos negros
const brGeo = new THREE.ConeGeometry(0.09, 1.6, 4);
for (const [bx, bz, tilt] of [[0.5, 1.6, 0.3], [2.5, 1.8, 0.25], [4.5, 1.6, 0.2], [6.3, 1.1, 0.5],
                               [1.5, -1.6, -0.3], [3.5, -1.8, -0.25], [5.5, -1.5, -0.2], [6.8, -0.9, -0.5]]) {
  const br = new THREE.Mesh(brGeo, bristleMat); br.position.set(bx, 5.5, bz); br.rotation.z = tilt; fly.add(br);
}
// cuello (membrana cervical)
const neck = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.7, 2.2, 10), bodyMat);
neck.rotation.z = Math.PI / 2; neck.position.set(7.8, 0.3, 0); fly.add(neck);
// --- abdomen: 6 tergitos alternos + terminalia + espiráculos ---
for (let k = 0; k < 6; k++) {
  const t = k / 5;
  const seg = new THREE.Mesh(new THREE.SphereGeometry(6.6 - t * 3.8, 12, 10), k % 2 ? darkMat : bodyMat);
  seg.scale.set(1.02, 0.82, 1 - t * 0.22); seg.position.set(-2.5 - k * 2.9, -t * 0.7, 0); fly.add(seg);
}
const term = new THREE.Mesh(new THREE.ConeGeometry(1.15, 3.4, 8), darkMat);   // ovipositor/terminalia
term.rotation.z = Math.PI / 2 + 0.3; term.position.set(-20.6, -1.9, 0); fly.add(term);
for (const sgn of [1, -1]) {                                                    // cerci (apéndices sensoriales traseros)
  const cer = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 2.2, 6), bodyMat);
  cer.position.set(-19.4, -0.4, sgn * 1.3); cer.rotation.set(sgn * 0.5, 0, 1.35); fly.add(cer);
  for (let k = 0; k < 3; k++) {                                                 // sedas del cerco
    const cs = new THREE.Mesh(brGeo, bristleMat);
    cs.position.set(-20.2 - k * 0.5, 0.4 + k * 0.25, sgn * (1.4 + k * 0.25)); cs.rotation.z = 1.9; fly.add(cs);
  }
}
for (let k = 0; k < 4; k++) for (const sgn of [1, -1]) {                      // espiráculos laterales
  const sp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 6), bristleMat);
  sp.position.set(-4 - k * 3.4, -0.6, sgn * (5.4 - k * 0.9)); fly.add(sp);
}
// --- cabeza: cápsula, cara, ojos compuestos, ocelos, antenas, probóscide, palpos ---
const head = new THREE.Mesh(new THREE.SphereGeometry(4.2, 16, 16), bodyMat);
head.scale.set(1.0, 0.95, 1.15); head.position.set(10.2, 0.4, 0); fly.add(head);
const face = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 12), bodyMat);
face.scale.set(0.6, 0.85, 1.1); face.position.set(13.1, -0.5, 0); fly.add(face);
// cara: clípeo + labro (la "pizarra" sobre la boca) y arista frontal con sedas
const clypeus = new THREE.Mesh(new THREE.SphereGeometry(1.5, 10, 8), bodyMat);
clypeus.scale.set(0.35, 0.9, 1.05); clypeus.position.set(13.9, -1.6, 0); fly.add(clypeus);
const labrum = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 2.0), darkMat);
labrum.position.set(14.1, -2.6, 0); fly.add(labrum);
for (const [fy, fz, ft] of [[2.2, 0.9, 0.5], [2.2, -0.9, -0.5], [1.2, 1.4, 0.9], [1.2, -1.4, -0.9]]) {  // sedas frontales/postoculares
  const br = new THREE.Mesh(brGeo, bristleMat); br.position.set(11.6, fy, fz); br.rotation.z = ft; fly.add(br);
}
for (const sgn of [1, -1]) {   // cerda occipital y vibrissas maxilares
  const oc = new THREE.Mesh(brGeo, bristleMat); oc.position.set(9.4, 2.2, sgn * 2.6); oc.rotation.set(sgn * 0.5, 0, 0.4); fly.add(oc);
  const vb = new THREE.Mesh(brGeo, bristleMat); vb.position.set(13.4, -2.2, sgn * 1.1); vb.rotation.z = 1.1; fly.add(vb);
}
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xb3241f, roughness: 0.25, emissive: 0x3a0806 });
const eyeL = new THREE.Mesh(new THREE.SphereGeometry(2.7, 14, 12), eyeMat);
eyeL.scale.set(0.8, 1.2, 0.6); eyeL.position.set(11.2, 1.1, 2.8); fly.add(eyeL);
const eyeR = eyeL.clone(); eyeR.position.z = -2.8; fly.add(eyeR);
for (const [ox, oz] of [[12.1, 0], [11.0, 1.15], [11.0, -1.15]]) {   // triángulo de 3 ocelos
  const oc = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1a0f0a, roughness: 0.15 }));
  oc.position.set(ox, 4.0, oz); fly.add(oc);
}
for (const sgn of [1, -1]) {   // antena: escapo + pedicelo + flagelo + arista plumosa
  const ant = new THREE.Group(); ant.position.set(12.5, 1.7, sgn * 1.5); ant.rotation.set(0.45, 0, sgn * 0.55);
  const scape = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.62, 1.5, 6), bodyMat); scape.position.y = 0.75; ant.add(scape);
  const ped = new THREE.Mesh(new THREE.SphereGeometry(0.58, 8, 6), bodyMat); ped.position.y = 1.7; ant.add(ped);
  const flag = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.3, 2.7, 6), darkMat); flag.position.y = 3.2; ant.add(flag);
  for (let k = 0; k < 5; k++) {
    const ar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.07, 1.7, 4), bristleMat);
    ar.position.set(0, 2.3 + k * 0.55, 0); ar.rotation.z = sgn * (0.95 + k * 0.08); ant.add(ar);
  }
  fly.add(ant);
}
// probóscide (la boca-succionadora de la mosca) en un grupo con pivote en la cabeza:
// en reposo va plegada bajo la cabeza; al comer se extiende hacia el alimento y los
// labelos laten succionando.
const probG = new THREE.Group(); probG.position.set(11.6, -1.0, 0); fly.add(probG);
const prob = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.15, 3.6, 8), bodyMat);   // probóscide
prob.position.set(0.7, -1.9, 0); prob.rotation.z = 0.55; probG.add(prob);
const labella = [];
for (const sgn of [1, -1]) {
  const lab = new THREE.Mesh(new THREE.SphereGeometry(0.85, 8, 6), darkMat);            // labelos
  lab.scale.set(0.5, 0.4, 0.9); lab.position.set(2.4, -3.4, sgn * 0.55); probG.add(lab); labella.push(lab);
  const palp = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.8, 5), bodyMat); // palpo maxilar
  palp.position.set(1.4, -2.1, sgn * 1.5); palp.rotation.set(sgn * 0.4, 0, 0.7); probG.add(palp);
}
probG.rotation.z = 0.55;   // plegada por defecto
// --- halterios: segundo par de alas reducido (órgano de equilibrio) ---
for (const sgn of [1, -1]) {
  const hal = new THREE.Group(); hal.position.set(6.6, 2.0, sgn * 3.6); hal.rotation.set(0, 0, sgn * 0.5 - 1.1);
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 2.6, 6), bodyMat); stalk.position.y = 1.3; hal.add(stalk);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), darkMat); knob.position.y = 2.8; hal.add(knob);
  fly.add(hal);
}

// patas: 3 pares (protorácica/mesotorácica/metatorácica) × 5 segmentos anatómicos:
// coxa → fémur → tibia (con espinas) → tarso (5 artejos) → uñas (claws) + pulvillos
const legs = [];
const tarsGeo = new THREE.CylinderGeometry(0.16, 0.2, 1.1, 5);
for (let s = 0; s < 2; s++) for (let f = 0; f < 3; f++) {
  const zc = s ? 1 : -1;
  const hip = new THREE.Group();
  hip.position.set(1 + f * 3.2, -2, zc * 4.5);
  const coxa = new THREE.Mesh(new THREE.SphereGeometry(0.55, 6, 6), darkMat);
  coxa.position.set(0, -0.6, zc * 0.9); hip.add(coxa);
  const seg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.32, 7, 5), bodyMat);   // fémur
  seg1.position.set(0, -1.5, zc * 3); seg1.rotation.x = zc * 0.9; hip.add(seg1);
  const knee = new THREE.Group(); knee.position.set(0, -1.5, zc * 6);
  const seg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 8, 5), bodyMat);    // tibia
  seg2.position.set(0, -3.5, 0); knee.add(seg2);
  for (let k = 0; k < 3; k++) {                                                          // espinas tibiales
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.9, 4), bristleMat);
    sp.position.set(0.25, -1.6 - k * 2, 0); sp.rotation.z = -1.2; knee.add(sp);
  }
  const ankle = new THREE.Group(); ankle.position.set(0, -7.6, 0); knee.add(ankle);      // tarso articulado
  let prev = ankle;
  for (let k = 0; k < 4; k++) {
    const art = new THREE.Mesh(tarsGeo, k === 0 ? darkMat : bodyMat);
    art.position.y = -0.55; prev.add(art);
    const nxt = new THREE.Group(); nxt.position.y = -1.05; nxt.rotation.x = 0.18; prev.add(nxt); prev = nxt;
  }
  for (const cz of [0.28, -0.28]) {                                                      // par de uñas
    const claw = new THREE.Mesh(new THREE.ConeGeometry(0.09, 1.0, 4), bristleMat);
    claw.position.set(0.15, -0.4, cz); claw.rotation.z = 2.4; prev.add(claw);
  }
  const pulv = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5), new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.8 }));
  pulv.scale.set(0.5, 0.35, 1); pulv.position.set(0.05, -0.5, 0); prev.add(pulv);        // pulvillo (adhesivo)
  hip.add(knee);
  fly.add(hip);
  legs.push({ hip, knee, phase: (f * 2.1 + s * 0.7) % 6.28, side: s, seg: f });
}
// alas: forma de lágrima con nervios, pivote en la base (aletean desde el tórax)
const wingMat = new THREE.MeshBasicMaterial({ color: 0xdfeeff, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false });
const wingGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(2.5, 2.4, 8.5, 3.6, 13.5, 2.3);
  s.bezierCurveTo(15.6, 1.7, 15.7, 0.2, 13.8, -0.5);
  s.bezierCurveTo(9, -1.9, 3.5, -1.5, 0, 0);
  return new THREE.ShapeGeometry(s, 16);
})();
const wingVeins = (() => {
  const pts = [];
  for (const c of [[0, 0, 14, 1.6], [0, 0, 13, 0.2], [1, 0.4, 12.5, 2.6], [4, 0.1, 10, 3.0]]) {
    pts.push(new THREE.Vector3(c[0], c[1], 0), new THREE.Vector3(c[2], c[3], 0));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
})();
const veinsMat = new THREE.LineBasicMaterial({ color: 0x9db8d8, transparent: true, opacity: 0.5 });
const wings = [];
for (let s = 0; s < 2; s++) {
  const piv = new THREE.Group();
  piv.position.set(3, 3.4, (s ? 1 : -1) * 2.8);
  piv.rotation.y = Math.PI + (s ? 0.65 : -0.65);          // hacia atrás y afuera
  const w = new THREE.Mesh(wingGeo, wingMat);
  w.rotation.x = (s ? 1 : -1) * Math.PI / 2;              // horizontal
  piv.add(w);
  const vn = new THREE.LineSegments(wingVeins, veinsMat);
  vn.rotation.x = w.rotation.x; vn.position.y = 0.05;
  piv.add(vn);
  const alula = new THREE.Mesh(new THREE.CircleGeometry(1.1, 7, 0, 1.9), wingMat);   // álula (lobulo basilar)
  alula.rotation.x = w.rotation.x; alula.rotation.y = (s ? -0.5 : 0.5); alula.position.set(-0.7, 0.1, (s ? 0.9 : -0.9));
  piv.add(alula);
  fly.add(piv); wings.push(piv);
}
fly.scale.setScalar(0.0074);   // ESCALA REAL: cuerpo ~0.25 cm (Drosophila melanogaster hembra)
fly.position.y = 6;
fScene.add(fly);
// halo guía: anillo que marca dónde está la mosca cuando la cámara se aleja tanto
// que el cuerpo de 2.5 mm deja de verse. Siempre de cara a la cámara y por encima
// de todo (depthTest=false): NUNCA se pierde de vista.
const halo = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.0, 40),
  new THREE.MeshBasicMaterial({ color: 0x7dffa8, transparent: true, opacity: 0.9,
    side: THREE.DoubleSide, fog: false, depthTest: false, depthWrite: false }));
halo.visible = false; halo.renderOrder = 999;
fScene.add(halo);
// alcance exacto de las patas: distancia del centro del cuerpo a la punta de las uñas
// (medida sobre la bounding box del modelo ya escalado). El suelo duro mantiene el centro
// a esta altura sobre la malla: las uñas TOCAN el terreno, el cuerpo nunca lo traspasa.
fly.updateMatrixWorld(true);
const _bb = new THREE.Box3().setFromObject(fly);
const LEG_REACH = Math.max(0.02, fly.position.y - _bb.min.y);
const BODY_R = 0.12;           // radio del cuerpo a escala real (~1.2 mm)

// ---------- bucle del mundo ----------
let heading = 0, speed = 0, height = 6, phase = 0;
let vy = 0;                    // velocidad vertical (gravedad real: 981 cm/s² = 9.81 m/s²)
let lastT = performance.now();
let probExt = 0;   // extensión de la probóscide 0=plegada 1=aspirando
let baseGain = 1.0;            // excitabilidad puesta por el usuario (slider)
let gainT = 0;
// estados internos (neuromodulación): hambre, sed, energía, fatiga, amenaza.
// NO deciden: modulan la ganancia del cerebro y la saliencia sensorial, como las
// aminas moduladoras reales (NPY/dopamina/serotonina) que cambian el umbral de decisión.
const states = { hunger: 0.35, thirst: 0.3, energy: 0.85, fatigue: 0, threat: 0 };
// adherencia (pulvillos): la mosca se pega al tronco que toca y trepa con walk
let attach = null;             // {t, ang, y} o null
let waterBumpT = 0;            // cooldown del reflejo mecánico al chocar con la orilla
const _nrm = new THREE.Vector3(), _fwd = new THREE.Vector3(), _rft = new THREE.Vector3(),
      _up = new THREE.Vector3(), _up2 = new THREE.Vector3(), _mB = new THREE.Matrix4(), _qT = new THREE.Quaternion();
let restT = 0, groomT = 0;
const h2b = (x) => { let h = (Math.sin(x * 127.1) * 43758.5453) % 1; return h < 0 ? h + 1 : h; };

// aparecer sobre tierra firme del ecosistema (caminando)
function respawnOnLand() {
  let y = -9, tries = 0;
  while (y < 8 && tries++ < 80) { fly.position.x = (Math.random() - 0.5) * 500; fly.position.z = (Math.random() - 0.5) * 500; y = world.heightAt(fly.position.x, fly.position.z); }
  height = world.meshHeightAt(fly.position.x, fly.position.z) + LEG_REACH; fly.position.y = height;
}
respawnOnLand();

const clamp01 = (v) => Math.max(0, Math.min(1, v));

function stepWorld(dt) {
  // sentidos desde el ecosistema real (bucle cerrado: mundo → RECEPTORES del cerebro)
  const groundY = world.heightAt(fly.position.x, fly.position.z);
  const senses = world.update(dt, fly.position, heading, motor.feed);
  if (autoWorld) {
    // el HAMBRE modula la saliencia del olor (como la dopamina sobre las ORN reales):
    // con el estómago vacío, el mismo fruto "huele" más fuerte para el cerebro
    const odBoost = 1 + states.hunger * 0.9;
    env.lightL = senses.lightL; env.lightR = senses.lightR;
    env.odor = senses.odor; env.taste = senses.taste;
    env.odorL = Math.min(1, senses.odorL * odBoost); env.odorR = Math.min(1, senses.odorR * odBoost);
    env.humidity = senses.humidity; env.temp = senses.temp;
    if (senses.poke) env.poke = 1;
    $('pLL').value = env.lightL.toFixed(2); $('vLL').textContent = env.lightL.toFixed(2);
    $('pLR').value = env.lightR.toFixed(2); $('vLR').textContent = env.lightR.toFixed(2);
    $('pOd').value = env.odor.toFixed(2); $('vOd').textContent = env.odor.toFixed(2);
    $('pTa').value = env.taste.toFixed(2); $('vTa').textContent = env.taste.toFixed(2);
  }

  // ══ ESTADOS INTERNOS (neuromodulación, no decisiones) ══════════════════════
  // (se actualizan al final del paso, cuando ya se conocen el sabor, el poke y el
  //  vuelo de este frame — ver justo antes de enviar env al worker)

  // ══ EL CUERPO ES UN DESCODIFICADOR NEUROMUSCULAR ═════════════════════════════
  // Aquí NO hay decisiones: cada actuador es una función de transferencia
  // instantánea de la actividad de neuronas motoras REALES del FlyWire
  // (walk/turn/fly = descendentes y motoras; feed = 2ª etapa del circuito gustativo).
  // La física (gravedad 9.81 m/s², viento, adherencia de pulvillos, superficie
  // repelente del agua) es el CUERPO y el MEDIO — como las fuerzas sobre un insecto
  // real. Si se estrella o no come, es SU decisión.
  const w = Math.min(1, motor.walk * 3.2);
  const t = Math.max(-1, Math.min(1, motor.turn * 9));
  const f = Math.min(1, motor.fly * 3.5);
  const feed = Math.min(1, motor.feed * 3.0);
  const airborne = f > 0.5;

  // ---- adherencia (pulvillos + uñas): toca un tronco caminando → se pega y trepa ----
  const trunk = world.lastTrunk;
  world.lastTrunk = null;
  if (attach && (airborne || attach.y > attach.t.y + attach.t.h - 3 || feed > 0.6)) attach = null;
  if (!attach && trunk && !airborne && w > 0.05) attach = { t: trunk, y: Math.max(trunk.y + 1, fly.position.y) };

  const meshGy = world.meshHeightAt(fly.position.x, fly.position.z);
  if (attach) {
    // ciclo real: contacto → adhesión → soporte contra la gravedad → avance vertical.
    // Caminar (walk) la sube por la corteza; girar la desplaza alrededor del tronco.
    attach.y += w * dt * 2.4;
    const t2 = attach.t;
    const hd = Math.hypot(fly.position.x - t2.x, fly.position.z - t2.z) || 1e-6;
    const rad = world.trunkRadiusAt(t2, attach.y) + BODY_R + LEG_REACH;
    // sólo se ACERCA si quedó dentro de la corteza; si un cono/copa la empujó hacia
    // afuera (colisión más abajo), se queda donde la colisión la puso — trepar nunca
    // atraviesa follaje
    if (hd < rad) {
      fly.position.x = t2.x + (fly.position.x - t2.x) / hd * rad;
      fly.position.z = t2.z + (fly.position.z - t2.z) / hd * rad;
    }
    fly.position.y = attach.y; height = attach.y; vy = 0;
    heading += t * dt * 2.2;
    speed = w * 2.4;
  } else {
    // velocidad: reclutamiento todo-o-nada de unidades motoras (como una placa motora).
    // Escala real: caminar ~4 cm/s, volar ~45-90 cm/s (Drosophila vuela a ~1 m/s)
    speed += ((airborne ? 45 + w * 45 : w * 4) - speed) * dt * 2.2;
    heading += t * dt * 3.0;
    heading = ((heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

    // ---- EL AGUA SE EVITA, NUNCA SE PISA (como mosca real) ----
    // Las patas están cubiertas de cera hidrófoba: la superficie no se rompe. Si el
    // paso siguiente cae en agua, la orilla la detiene, resbala a lo largo de la
    // playa y el impacto estimula SUS mecanosensores → SU cerebro gira para alejarse.
    let nx2 = fly.position.x + Math.cos(heading) * speed * dt + (airborne ? world.windX * dt * 0.6 : 0);
    let nz2 = fly.position.z + Math.sin(heading) * speed * dt + (airborne ? world.windZ * dt * 0.6 : 0);
    if (!airborne && world.meshHeightAt(nx2, nz2) < WATER + 0.2) {
      waterBumpT -= dt;
      if (waterBumpT <= 0) { env.poke = 1; waterBumpT = 0.4; }
      heading += (Math.sign(t) || (h2b(fly.position.x) < 0.5 ? 1 : -1)) * dt * 6;
      nx2 = fly.position.x; nz2 = fly.position.z;
    }
    fly.position.x = nx2; fly.position.z = nz2;

    // ---- gravedad 981 cm/s² (9.81 m/s²) + sustentación de las motoras de vuelo ----
    // térmicas diurnas (corrientes ascendentes) y turbulencia: el aire es un objeto físico
    const turb = Math.sin(fly.position.x * 0.7 + performance.now() * 0.002) *
                 Math.cos(fly.position.z * 0.6 - performance.now() * 0.0017);
    const targetH = meshGy + LEG_REACH + f * (40 + senses.dayF * 25) + Math.sin(performance.now() / 900) * f * 6 + f * turb * 3;
    if (airborne) {
      // en vuelo: el empuje alar vence la gravedad; cerca de la lámina de agua,
      // las patas hidrófugas REBOTAN (nunca se ahoga, nunca revive: no entra)
      if (meshGy < WATER + 0.2 && height < WATER + 1.2) { height = WATER + 1.2; vy = 25; env.poke = 1; }
      else { vy = 0; height += (targetH - height) * dt * (targetH > height ? 6 : 2.5); }
    } else {
      // ¿aterrizó sobre agua? (vino volando): la superficie tensioactiva no la sostiene —
      // resbala cuesta arriba hacia la orilla más cercana sin romper nunca el film.
      if (meshGy < WATER + 0.2) {
        const e = 2, gX = world.meshHeightAt(fly.position.x + e, fly.position.z) - world.meshHeightAt(fly.position.x - e, fly.position.z),
              gZ = world.meshHeightAt(fly.position.x, fly.position.z + e) - world.meshHeightAt(fly.position.x, fly.position.z - e);
        const gl = Math.hypot(gX, gZ) || 1e-6;
        fly.position.x += gX / gl * 14 * dt; fly.position.z += gZ / gl * 14 * dt;
        env.poke = 1;
      }
      const floor = Math.max(meshGy, WATER + 0.2) + LEG_REACH;
      if (height > floor + 0.02) {
        vy -= 981 * dt;                       // caída libre real
        height += vy * dt;
        // REFLEJO VESTIBULAR: los HALTERIOS (órganos de equilibrio de los dípteros)
        // detectan la caída libre y estimulan SUS mecanosensores CONTINUAMENTE
        // (señal sostenida, como el startle calibrado: g(poke)=0.98 sólo con entrada
        //  sostenida). El cuerpo no salva a la mosca: le AVISA al cerebro, y ella
        //  (fibra gigante → motoras de vuelo) decide despegar antes de estrellarse.
        if (vy < -80) env.poke = 1;
        if (height <= floor) { height = floor; vy = 0; }   // aterriza: las patas absorben
      } else {
        height += (floor - height) * dt * 8;  // pisa la malla (pendientes suaves)
        vy = 0;
      }
    }
    fly.position.y = height;
  }

  // ---- colisión con objetos REALES: troncos, copas, conos, frutos, fauna y el suelo ----
  // TAMBIÉN mientras trepa: antes se saltaba la colisión con attach y la mosca
  // atravesaba conos y copas al subir por el tronco. El tronco al que está pegada no
  // la empuja (ya está fuera de su radio), así que la adherencia sigue funcionando.
  {
    // las copas se ablandan sólo JUNTO al fruto que va a comer (la mosca mete la cabeza);
    // todo lo demás es 100% sólido: nada se traspasa, ni un borde
    world.collide(fly.position, BODY_R, world.bestD < 45 ? world.bestPos : null);
    const gy2 = world.meshHeightAt(fly.position.x, fly.position.z);
    const floor2 = Math.max(gy2, WATER + 0.2) + LEG_REACH;
    if (fly.position.y < floor2) { fly.position.y = floor2; height = fly.position.y; vy = 0; }
    if (fly.position.y > 400) { fly.position.y = 400; height = 400; }
    if (attach) { attach.y = fly.position.y; height = fly.position.y; }  // sincroniza tras el empuje
  }

  // ---- ORIENTACIÓN: el cuerpo se alinea a la NORMAL de la superficie ----
  // En pendiente la mosca se inclina con el terreno; pegada al tronco, su "arriba"
  // es la radial de la corteza (queda de lado, trepando, como en la vida real);
  // en vuelo se nivela. El alabeo (bank) entra girando el eje arriba alrededor del frente.
  let up;
  if (attach) {
    up = _up.set(fly.position.x - attach.t.x, 0, fly.position.z - attach.t.z).normalize();  // dorsal hacia afuera
    _fwd.set(Math.cos(heading), 1.8, Math.sin(heading));                                     // cabeza arriba, trepando
  } else {
    up = airborne ? _nrm.set(0, 1, 0) : world.normalAt(fly.position.x, fly.position.z, _nrm);
    _fwd.set(Math.cos(heading), 0, Math.sin(heading));
  }
  _fwd.addScaledVector(up, -_fwd.dot(up)).normalize();
  const bank = -t * (airborne ? 0.5 : 0.12);
  _up2.copy(up).applyAxisAngle(_fwd, bank);
  _rft.crossVectors(_fwd, _up2).normalize();
  _mB.makeBasis(_fwd, _up2, _rft);
  _qT.setFromRotationMatrix(_mB);
  fly.quaternion.slerp(_qT, Math.min(1, dt * 8));

  // ---- aseo (grooming): en reposo prolongado la mosca se limpia patas y alas ----
  if (!airborne && !attach && w < 0.05 && feed < 0.2) {
    restT += dt;
    if (groomT > 0) groomT -= dt;
    else if (restT > 6 && Math.random() < dt * 0.25) { groomT = 2 + Math.random() * 2.5; restT = 0; }
  } else { restT = 0; if (!airborne) groomT = Math.max(0, groomT - dt); }
  const grooming = groomT > 0;

  // patas: ANDA EN TRÍPODE (grupo frontal+trasera de un lado con media del otro,
  // alternando — la marcha real de los insectos). Frecuencia = walk. Al comer se
  // agacha (stance += feed); al asearse sube las patas delanteras a la cabeza.
  phase += dt * (2 + w * 16);
  const stance = 0.15 + feed * 0.4;
  for (const L of legs) {
    const trip = ((L.side === 0) === (L.seg !== 1)) ? 0 : Math.PI;
    let osc = Math.sin(phase + trip);
    let swing = 0.15 + w;
    if (grooming && L.seg === 0) { osc = Math.sin(performance.now() / 90 + L.side * 2); swing = 1.4; }
    L.hip.rotation.y = osc * 0.5 * swing;
    L.knee.rotation.x = (L.side ? -1 : 1) * (0.4 + Math.max(0, osc) * 0.5 * (0.2 + w)) - (grooming && L.seg === 0 ? 1.1 : 0);
    L.knee.position.y = -1.5 - Math.max(0, osc) * 1.2 * w - stance;
  }
  const fa = Math.sin(performance.now() / (airborne ? 26 : 120)) * (0.55 + f * 0.6);
  wings[0].rotation.z = fa * f;
  wings[1].rotation.z = -fa * f;

  // ---- probóscide: la extiende la actividad del circuito gustativo REAL (feed) ----
  probExt += (feed - probExt) * dt * 5;
  probG.rotation.z = 1.2 - probExt * 1.55;                        // plegada bajo la cabeza (1.2) → extendida hacia el alimento (-0.35)
  const suck = feed > 0.5 ? Math.sin(performance.now() / 110) * 0.5 + 0.5 : 0;
  for (const lab of labella) lab.scale.set(0.5 + suck * 0.28 * probExt, 0.4 + suck * 0.22 * probExt, 0.9 + suck * 0.35 * probExt);  // labelos laten aspirando
  prob.scale.set(1 + probExt * 0.25, 1 + probExt * 0.55, 1 + probExt * 0.25);  // se alarga al extenderse

  // ══ ESTADOS INTERNOS (neuromodulación, no decisiones) ══════════════════════
  // Hambre/sed crecen con el tiempo; comer/beber los baja. La energía cae volando
  // y sube en reposo; la amenaza se dispara con el susto y decae. Estos estados
  // mueven la GANANCIA global del cerebro (como las aminas moduladoras reales):
  // cansada o asustada, la misma red decide distinto. La decisión sigue siendo de ella.
  const eating = senses.taste > 0.5 && feed > 0.5;
  const atShore = groundY > WATER + 0.2 && groundY < WATER + 2.5;
  const drinking = atShore && !airborne && w < 0.03 && states.thirst > 0.4;
  states.hunger = clamp01(states.hunger + dt * 0.004 - (eating ? dt * 0.06 : 0));
  states.thirst = clamp01(states.thirst + dt * 0.003 - (drinking ? dt * 0.08 : 0));
  states.energy = clamp01(states.energy + dt * (airborne ? -0.02 : w > 0.1 ? -0.004 : 0.012));
  states.fatigue = clamp01(states.fatigue + dt * (airborne ? 0.02 : w > 0.1 ? 0.005 : -0.015));
  states.threat = clamp01(states.threat - dt * 0.25 + (env.poke ? 0.9 : 0));
  gainT += dt;
  if (gainT > 0.25) {
    gainT = 0;
    // la temperatura también modula: en frío el insecto se entumece (poiquilotermo)
    const gMod = (0.55 + 0.45 * states.energy) * (1 + states.threat * 0.6) *
                 (1 - states.fatigue * 0.35) * (0.6 + 0.4 * senses.temp);
    worker.postMessage({ type: 'param', key: 'gain', value: baseGain * gMod });
  }
  for (const [id, key] of [['sHambre', 'hunger'], ['sSed', 'thirst'], ['sEnergia', 'energy'], ['sFatiga', 'fatigue'], ['sAmenaza', 'threat']]) {
    $(id).style.width = (states[key] * 100).toFixed(0) + '%';
  }

  // HUD: estado de comportamiento observable (sin emojis)
  const bstate = attach ? 'TREPAR' : airborne ? (states.threat > 0.4 ? 'ESCAPE EN VUELO' : 'VUELO')
    : feed > 0.5 ? 'ALIMENTARSE' : drinking ? 'BEBER' : grooming ? 'ASEARSE'
    : w > 0.08 ? 'CAMINAR' : 'REPOSO';
  $('hud').textContent = bstate + ' · viento ' + world.windSpeed.toFixed(0) + ' cm/s · ' + (world.hud || 'ECOSISTEMA');

  // el cerebro recibe el estado del mundo YA con los reflejos de este frame (poke de agua)
  worker.postMessage({ type: 'env', env });
  env.poke = 0;

  // ══ CÁMARA: SIEMPRE encima de la mosca. El usuario sólo acerca/aleja. ══════
  // Objetivo = la mosca SIN retardo (antes el lerp lento la dejaba atrás y "se
  // perdía"). La posición de la cámara se desliza suave para que el zoom no sea
  // brusco, y nunca queda por debajo del terreno.
  if (window.__camOverride) { fCam.position.copy(window.__camOverride); fCam.lookAt(fly.position); }
  else {
    camTgt.set(fly.position.x, fly.position.y + 0.15, fly.position.z);
    const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
    const cx2 = camTgt.x + Math.cos(camYaw) * cp * camDist,
          cz2 = camTgt.z + Math.sin(camYaw) * cp * camDist;
    // la cámara tampoco atraviesa el suelo: se sienta sobre la malla si hace falta
    const camFloor = world.meshHeightAt(cx2, cz2) + 1.5;
    const cy2 = Math.max(camTgt.y + sp * camDist + 0.4, camFloor);
    fCam.position.lerp(_v3tmp.set(cx2, cy2, cz2), Math.min(1, dt * 10));
    fCam.lookAt(camTgt);
    // halo guía: un anillo SIEMPRE visible alrededor de la mosca cuando está lejos,
    // escalado con la distancia para ocupar el mismo tamaño en pantalla
    const far = camDist > 60;
    halo.visible = far;
    if (far) {
      halo.position.copy(fly.position);
      halo.scale.setScalar(camDist * 0.09);
      halo.lookAt(fCam.position);   // de cara a la cámara: siempre se ve como anillo
    }
  }
}

// ---------- UI ----------
function bindSlider(id, valId, key) {
  $(id).addEventListener('input', (e) => {
    env[key] = parseFloat(e.target.value);
    $(valId).textContent = env[key].toFixed(2);
    if (key !== 'poke') { autoWorld = false; $('bAuto').classList.remove('on'); }
  });
}
bindSlider('pLL', 'vLL', 'lightL'); bindSlider('pLR', 'vLR', 'lightR');
bindSlider('pOd', 'vOd', 'odor'); bindSlider('pTa', 'vTa', 'taste');
$('bPoke').onclick = () => { worker.postMessage({ type: 'env', env: { poke: 1 } }); };
$('bAuto').onclick = () => { autoWorld = !autoWorld; $('bAuto').classList.toggle('on', autoWorld); };
$('pTime').addEventListener('input', (e) => {
  world.timeScale = parseFloat(e.target.value);
  $('vTime').textContent = world.timeScale + 'x';
});
$('bDay').onclick = () => { world.time = 0.5; };
$('bNight').onclick = () => { world.time = 0.0; };
$('bRegen').onclick = () => {
  world.regenerate();
  respawnOnLand();
};
$('pGain').addEventListener('input', (e) => { baseGain = parseFloat(e.target.value); $('vGain').textContent = baseGain.toFixed(2); worker.postMessage({ type: 'param', key: 'gain', value: baseGain }); });
let paused = false;
$('bPause').onclick = () => { paused = !paused; $('bPause').textContent = paused ? 'Seguir' : 'Pausar'; worker.postMessage({ type: 'param', key: 'pause', value: paused }); };
$('bReset').onclick = () => worker.postMessage({ type: 'param', key: 'reset' });
const cbs = { cAct: 'act', cNT: 'nt', cReg: 'reg' };
for (const [id, mode] of Object.entries(cbs)) $(id).onclick = () => {
  colorMode = mode;
  for (const j of Object.keys(cbs)) $(j).classList.toggle('on', j === id);
  drawLegend(); updateColors();
};
function drawLegend() {
  const el = $('legend');
  if (colorMode === 'act') el.innerHTML = '<span>azul=callada → rojo=disparando</span>';
  else if (colorMode === 'nt') el.innerHTML = tables.nt.map((n, i) => `<span><i style="background:rgb(${NTCOL[i + 1].join(',')})"></i>${n}</span>`).join('');
  else el.innerHTML = tables.super_class.map((n, i) => `<span><i style="background:rgb(${(REGCOL[i + 1] || [90,90,90]).join(',')})"></i>${n}</span>`).join('');
}
drawLegend();
const exps = {
  sleep: { gain: 0.1, auto: false, env: { lightL: 0, lightR: 0, odor: 0, odorL: 0, odorR: 0, taste: 0 } },
  awake: { gain: 1.2, auto: false, env: { lightL: 0.9, lightR: 0.2, odor: 0, odorL: 0, odorR: 0, taste: 0 } },
  feast: { gain: 1.0, auto: false, env: { lightL: 0.1, lightR: 0.1, odor: 1, odorL: 1, odorR: 0.15, taste: 0.8 } },
  storm: { gain: 2.2, auto: false, env: { lightL: 0.5, lightR: 0.5, odor: 0.5, odorL: 0.5, odorR: 0.5, taste: 0.5 } },
};
document.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => {
  const e = exps[b.dataset.exp];
  autoWorld = e.auto; $('bAuto').classList.toggle('on', autoWorld);
  Object.assign(env, e.env);
  baseGain = e.gain;
  $('pGain').value = e.gain; $('vGain').textContent = e.gain.toFixed(2);
  worker.postMessage({ type: 'param', key: 'gain', value: e.gain });
});

$('bBrain').onclick = (e) => { e.stopPropagation(); brainView.classList.toggle('big'); requestAnimationFrame(resize); };

// ---------- resize + loop ----------
function resize() {
  const bw = brainView.clientWidth, bh = brainView.clientHeight;
  const fw = flyView.clientWidth, fh = flyView.clientHeight;
  bRenderer.setSize(bw, bh); bCam.aspect = bw / bh; bCam.updateProjectionMatrix();
  fRenderer.setSize(fw, fh); fCam.aspect = fw / fh; fCam.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  bYaw += dt * 0.06;
  bCam.position.set(
    Math.cos(bYaw) * Math.cos(bPitch) * bDist,
    Math.sin(bPitch) * bDist,
    Math.sin(bYaw) * Math.cos(bPitch) * bDist
  );
  bCam.lookAt(0, 0, 0);
  bRenderer.render(bScene, bCam);
  stepWorld(dt);
  fRenderer.render(fScene, fCam);
}
loop();

// hook de depuración/pruebas: expone estado de la escena del cerebro
window.__mosca = {
  get bCam() { return bCam; }, get bPoints() { return bPoints; },
  get bRenderer() { return bRenderer; }, get neuronsMeta() { return neuronsMeta; },
  get tables() { return tables; }, get worker() { return worker; },
  get fly() { return fly; }, get world() { return world; }, get autoWorld() { return autoWorld; },
  get env() { return env; }, get motor() { return motor; }, get heading() { return heading; },
  get height() { return height; }, set height(v) { height = v; },
  get fCam() { return fCam; }, get fScene() { return fScene; },
  get probG() { return probG; }, get probExt() { return probExt; },
  get eating() { return motor.feed > 0.5; }, get LEG_REACH() { return LEG_REACH; },
  CX, CY, CZ, SC,
};

// ocultar loader cuando el worker esté listo
const hideCheck = setInterval(() => { if (snap) { loader.style.display = 'none'; clearInterval(hideCheck); } }, 300);
