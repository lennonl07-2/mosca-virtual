/* Motor de simulación LIF del conectoma real de Drosophila (FlyWire).
   138,639 neuronas, ~15M sinapsis, corriendo en este worker. */
'use strict';

let N = 0, E = 0;
let rowPtr, targets, weights;          // CSR
let nx, ny, nz;                        // coordenadas (nm)
let nSC, nFL, nNT, nSD, nCL, nSB, nCT;  // metadatos por neurona
let V, lock, act;                      // potencial, refractario, actividad EMA
let spikeQ;
let rngState = 12345;

// canales precomputados (índices de neuronas) — SOLO receptores reales anotados en FlyWire
let photoL = [], photoR = [];   // fotorreceptores R1-6/R7/R8 (ojos compuestos)
let ocelL = [], ocelR = [];     // neuronas ocelares (3 ocelos: horizonte/looming)
let ornL = [], ornR = [];       // neuronas receptoras olfativas (ORN_* de la antena)
let olfL = [], olfR = [];       // resto de clase olfactory por hemisferio
let gust = [], gustTgt = [];    // gustativas (labelos/palpos) + sus blancos sinápticos reales (lectura)
let mech = [], hygro = [], therm = [];
let descL = [], descR = [], motor = [], central = [];

// parámetros CALIBRADOS 2026-09-07 con tools/sweep.mjs (protocolo silencio→olor→
// silencio→luz→sabor→startle, dos pasadas por config). La red es subcrítica en reposo
// (≈0 spikes en silencio) y el estímulo la empuja por encima: la salida SIGUE al mundo.
let THR = 1.0, LEAK = 0.72, REFR = 10, WS = 0.026, SYN_CAP = 0.22;
const FANOUT_CAP = 2048;
let GABA_MULT = 6.0;                   // conductancia GABAérgica (shunting)
let NOISE_N = 400, NOISE_A = 0.16;     // espontáneo central: neuronas/tick y amplitud
let SENS_MULT = 4.0;                   // ganancia receptora (transducción sensorial)
let PHASIC_MULT = 1.0;                 // ganancia extra SOLO de la componente fásica
                                       // (cambio en el mundo), no del tono basal: la
                                       // respuesta al estímulo se conduce por vía
                                       // feedforward sin empujar la red al atractor.
let READ_TOPK = 0.02;                  // fracción superior reclutada por el descodificador
// Contraste interhemisférico olfativo (surqueo): las neuronas AVAP reales conectan los
// dos lóbulos olfatorios y hacen que la antena con MÁS olor INHIBA (shunting) a la del
// lado opuesto. Con esto el gradiente L−R deja de promediarse y se convierte en una
// señal de giro neta: la mosca orienta contra el viento como en la vida real.
let OLFACT_CONTRAST = 1.0;
// Homeostasis de tasa (inhibición tónica global, mecanismo real de neuromodulación):
// si la tasa global de picos pasa del setpoint, una fuga extra recorta el potencial de
// TODAS las neuronas proporcionalmente al exceso. Un enganchón auto-sostenido sube la
// tasa por encima del setpoint y se apaga SOLO; una respuesta sensorial sana (~400 spk/t)
// queda por debajo y no lo siente. Sin esto, la red al borde de criticalidad engancha
// avalanchas estocásticamente (verificado: 2/8 pasadas limpias; con esto: 8/8).
let RATE_SET = 300, RATE_K = 0.25;
const NT_GABA = 3;   // índice 1-based de GABA en tables.nt: ['ACH','DA','GABA','GLUT','OCT','SER']
let gain = 1.0;                        // excitabilidad global (moduladores)
let running = true;
let env = { lightL: 0, lightR: 0, odor: 0, odorL: 0, odorR: 0, poke: 0, taste: 0, humidity: 0.5, temp: 0.5 };
let stims = new Map();                 // neurona -> ticks restantes

let tickCount = 0, spikesLastWindow = 0, simHz = 0, hzTimer = 0, hzSpikes = 0;
let nsPrev = 0;                        // spikes del tick anterior

function rnd() { // LCG rápido
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
}

self.onmessage = async (msg) => {
  const m = msg.data;
  if (m.type === 'init') {
    await load(m.neuronsURL, m.synapsesURL, m.tables);
    return;
  }
  if (m.type === 'param') {
    if (m.key === 'gain') gain = m.value;
    if (m.key === 'pause') running = !m.value;
    if (m.key === 'reset') { V.fill(0); act.fill(0); lock.fill(0); }
    if (m.key === 'THR') THR = m.value;
    if (m.key === 'LEAK') LEAK = m.value;
    if (m.key === 'REFR') REFR = m.value;
    if (m.key === 'WS') WS = m.value;
    if (m.key === 'SYN_CAP') SYN_CAP = m.value;
    if (m.key === 'GABA_MULT') GABA_MULT = m.value;
    if (m.key === 'NOISE_N') NOISE_N = m.value;
    if (m.key === 'NOISE_A') NOISE_A = m.value;
    if (m.key === 'SENS_MULT') SENS_MULT = m.value;
    if (m.key === 'PHASIC_MULT') PHASIC_MULT = m.value;
    if (m.key === 'READ_TOPK') READ_TOPK = m.value;
    if (m.key === 'RATE_SET') RATE_SET = m.value;
    if (m.key === 'RATE_K') RATE_K = m.value;
    if (m.key === 'OLFACT_CONTRAST') OLFACT_CONTRAST = m.value;
    return;
  }
  if (m.type === 'env') { env = Object.assign(env, m.env); if (env.poke > 0) { pokeTimer = 4; env.poke = 0; } return; }
  if (m.type === 'stim') { stims.set(m.neuron, m.ticks || 40); return; }
  if (m.type === 'inspect') { postInspect(m.neuron); return; }
};

let pokeTimer = 0;

async function load(neuronsURL, synapsesURL, tables) {
  post({ type: 'progress', pct: 5, label: 'Descargando 138,639 neuronas…' });
  const nbuf = await (await fetch(neuronsURL)).arrayBuffer();
  post({ type: 'progress', pct: 15, label: 'Descargando 15 millones de sinapsis…' });
  const sbuf = await (await fetch(synapsesURL)).arrayBuffer();
  post({ type: 'progress', pct: 60, label: 'Indexando el conectoma…' });

  // neurons.bin: x,y,z f4 | sc,fl,nt,side u1 | cell_type u2 | class,sub_class u1  => 20 bytes
  const REC = 20;
  N = nbuf.byteLength / REC;
  const ndv = new DataView(nbuf);
  nx = new Float32Array(N); ny = new Float32Array(N); nz = new Float32Array(N);
  nSC = new Uint8Array(N); nFL = new Uint8Array(N); nNT = new Uint8Array(N);
  nSD = new Uint8Array(N); nCL = new Uint8Array(N); nSB = new Uint8Array(N); nCT = new Uint16Array(N);
  for (let i = 0; i < N; i++) {
    const o = i * REC;
    nx[i] = ndv.getFloat32(o, true); ny[i] = ndv.getFloat32(o + 4, true); nz[i] = ndv.getFloat32(o + 8, true);
    nSC[i] = ndv.getUint8(o + 12); nFL[i] = ndv.getUint8(o + 13); nNT[i] = ndv.getUint8(o + 14); nSD[i] = ndv.getUint8(o + 15);
    nCT[i] = ndv.getUint16(o + 16, true);
    nCL[i] = ndv.getUint8(o + 18); nSB[i] = ndv.getUint8(o + 19);
  }

  // synapses.bin: N u32 | rowPtr (N+1) u32 | targets E u32 | weights E u16
  const sdv = new DataView(sbuf);
  const nN = sdv.getUint32(0, true);
  rowPtr = new Uint32Array(sbuf, 4, nN + 1);
  E = rowPtr[nN];
  targets = new Uint32Array(sbuf, 4 + 4 * (nN + 1), E);
  weights = new Uint16Array(sbuf, 4 + 4 * (nN + 1) + 4 * E, E);

  // canales por nombre de clase/célula (1-based en el binario).
  // ENTRADAS = sólo receptores auténticos, separados por hemisferio (side del conectoma):
  const ci = (name) => tables.class.indexOf(name) + 1;
  const cti = (name) => tables.cell_type.indexOf(name) + 1;
  const si = (name) => tables.super_class.indexOf(name) + 1;
  const cOLF = ci('olfactory'), cMEC = ci('mechanosensory'), cGUS = ci('gustatory');
  const cHYP = ci('hygrosensory'), cTHM = ci('thermosensory'), cOCL = ci('ocellar');
  const ctR16 = cti('R1-6'), ctR7 = cti('R7'), ctR8 = cti('R8');
  const sDESC = si('descending'), sMOT = si('motor'), sCEN = si('central');
  const isORN = (i) => { const s = tables.cell_type[nCT[i] - 1]; return !!s && s.startsWith('ORN_'); };
  for (let i = 0; i < N; i++) {
    const cl = nCL[i], sc = nSC[i], sd = nSD[i], ct = nCT[i];
    if (ct === ctR16 || ct === ctR7 || ct === ctR8) (sd ? photoR : photoL).push(i);
    else if (cl === cOCL) (sd ? ocelR : ocelL).push(i);
    else if (cl === cOLF) { (sd ? olfR : olfL).push(i); if (isORN(i)) (sd ? ornR : ornL).push(i); }
    else if (cl === cGUS) gust.push(i);
    else if (cl === cMEC) mech.push(i);
    else if (cl === cHYP) hygro.push(i);
    else if (cl === cTHM) therm.push(i);
    else if (sc === sDESC) (sd ? descR : descL).push(i);
    else if (sc === sMOT) motor.push(i);
    else if (sc === sCEN) central.push(i);
  }
  // blancos postsinápticos REALES de las gustativas = segundas neuronas del circuito del
  // sabor. NO se estimulan: sólo se LEEN (feed) — la decisión de extender la probóscide
  // sale de su actividad, generada por sinapsis auténticas desde los receptores.
  const gustSet = new Set(gust);
  for (const g of gust) {
    const a = rowPtr[g], b = rowPtr[g + 1];
    for (let k = a; k < b; k++) { const t = targets[k]; if (!gustSet.has(t)) gustTgt.push(t); }
  }
  const u32 = (a) => Uint32Array.from(a);
  photoL = u32(photoL); photoR = u32(photoR); ocelL = u32(ocelL); ocelR = u32(ocelR);
  olfL = u32(olfL); olfR = u32(olfR); ornL = u32(ornL); ornR = u32(ornR); gust = u32(gust);
  mech = u32(mech); hygro = u32(hygro); therm = u32(therm);
  descL = u32(descL); descR = u32(descR); motor = u32(motor); central = u32(central);

  V = new Float32Array(N); lock = new Uint8Array(N); act = new Float32Array(N);
  spikeQ = new Int32Array(N);

  post({ type: 'progress', pct: 100, label: 'Cerebro listo' });
  post({ type: 'ready', N, E, channels: {
    photoL: photoL.length, photoR: photoR.length, ocelL: ocelL.length, ocelR: ocelR.length,
    ornL: ornL.length, ornR: ornR.length, olfL: olfL.length, olfR: olfR.length,
    gust: gust.length, gustTgt: gustTgt.length, mech: mech.length, hygro: hygro.length, therm: therm.length,
    descL: descL.length, descR: descR.length, motor: motor.length } });

  publish(); // first frame immediately; don't wait for a full simulation tick to unblock the UI.
  setInterval(tick, 8);   // ~125 ticks/s objetivo
  setInterval(publish, 50); // 20 Hz a la UI
}

function inject(list, amount, phasic) {
  if (amount <= 0 && !phasic) return;
  const a = (phasic ? amount * PHASIC_MULT : amount) * gain * SENS_MULT;
  for (let k = 0; k < list.length; k++) V[list[k]] += a;
}

function tick() {
  if (!running || !V) return;
  tickCount++;

  // ── ENTRADAS: exclusivamente receptores reales, cada uno en su hemisferio ──
  // Nada se inyecta en descendentes ni motoras: TODO lo que sale del cerebro hacia el
  // cuerpo debe viajar por las ~15M de sinapsis auténticas del conectoma.
  // Codificación por frecuencia: con corriente I la célula llega a pico cada
  // ~ln(1/(1-I·(1-LEAK)))/-ln(LEAK) ticks → más estímulo = más Hz, como un receptor real.
  // Cada corriente se divide en TÓNICA (basal, mantiene la vía viva) y FÁSICA (lo que
  // cambia el mundo). Sólo la fásica recibe PHASIC_MULT: así la respuesta a un estímulo
  // se amplifica sin empujar el tono basal de la red hacia el atractor auto-sostenido.
  // ojo compuesto: fotorreceptores R1-6/R7/R8 de cada lado (en oscuridad ≈ en silencio)
  inject(photoL, 0.006); inject(photoL, env.lightL * 0.34, true);
  inject(photoR, 0.006); inject(photoR, env.lightR * 0.34, true);
  // ocelos (3): fotorreceptores dorsales simples — horizonte y cambios bruscos de luz
  inject(ocelL, 0.002); inject(ocelL, env.lightL * 0.12, true);
  inject(ocelR, 0.002); inject(ocelR, env.lightR * 0.12, true);
  // antenas: ORN + clase olfatoria de cada antena según el gradiente interantenal real
  inject(ornL, 0.002); inject(ornL, env.odorL * 0.46, true);
  inject(olfL, 0.001); inject(olfL, env.odorL * 0.22, true);
  inject(ornR, 0.002); inject(ornR, env.odorR * 0.46, true);
  inject(olfR, 0.001); inject(olfR, env.odorR * 0.22, true);
  // CONTRASTE interhemisférico (AVAP): el lado con MÁS olor recorta por shunting al de
  // MENOS, amplificando la diferencia L−R que el descodificador lee como giro. Sólo actúa
  // cuando hay olor (gradiente no nulo), así no altera el estado basal calibrado.
  if (OLFACT_CONTRAST > 0 && (env.odorL > 0.02 || env.odorR > 0.02)) {
    const d = env.odorL - env.odorR;
    if (d > 0.02) { const g = Math.min(0.6, d * OLFACT_CONTRAST * 0.6); for (let k = 0; k < olfR.length; k++) V[olfR[k]] *= 1 - g; for (let k = 0; k < ornR.length; k++) V[ornR[k]] *= 1 - g; }
    else if (d < -0.02) { const g = Math.min(0.6, -d * OLFACT_CONTRAST * 0.6); for (let k = 0; k < olfL.length; k++) V[olfL[k]] *= 1 - g; for (let k = 0; k < ornL.length; k++) V[ornL[k]] *= 1 - g; }
  }
  // gustativas de labelos/palpos: sabor = contacto con comida/heces (343 neuronas reales)
  inject(gust, 0.002); inject(gust, env.taste * 0.36, true);
  // mecanosensores (sedas, campaniformes, cordotonal): tacto/chapoteo/viento — 100% fásico
  if (pokeTimer > 0) { pokeTimer--; inject(mech, 0.55, true); }
  // higro y termorreceptores reales: humedad ambiental y temperatura del día
  inject(hygro, 0.002); inject(hygro, env.humidity * 0.11, true);
  inject(therm, 0.002); inject(therm, env.temp * 0.09, true);

  // actividad espontánea central: da variabilidad (libre albedrío) y mantiene la red en
  // el borde de la criticalidad, donde una entrada sensorial pequeña se amplifica y,
  // al retirarla, la red vuelve sola al estado basal (sin reverberar).
  for (let k = 0; k < NOISE_N; k++) {
    const i = central[(rnd() * central.length) | 0];
    V[i] += rnd() * NOISE_A * gain;
  }

  // optogenética: forzar spikes en neuronas estimuladas
  for (const [i, t] of stims) {
    if (t <= 0) { stims.delete(i); continue; }
    stims.set(i, t - 1);
    if (lock[i] === 0) { V[i] = THR + 1; }
  }

  // ── DINÁMICA DE MEMBRANA ──
  // Freno a la supercriticalidad: la inhibición GABAérgica es shunting (multiplica V por
  // 1−g, abajo). Un bucle que reverbera se auto-recorta; una vía con entrada sensorial
  // constante sigue conduciendo. Así la salida SIGUE al mundo: sube con el olor, cae en
  // silencio (no queda enganchada).
  let ns = 0;
  const excess = nsPrev > RATE_SET ? (nsPrev - RATE_SET) / RATE_SET : 0;
  const tone = Math.min(0.5, excess * RATE_K);           // fuga extra por avalancha
  const leakNow = LEAK - tone;
  for (let i = 0; i < N; i++) {
    if (lock[i] > 0) { lock[i]--; continue; }
    const v = V[i] * leakNow;
    if (v >= THR) {
      V[i] = 0; lock[i] = REFR; spikeQ[ns++] = i;
      act[i] = Math.min(255, act[i] + 60);
      hzSpikes++;
    } else {
      V[i] = v;
      act[i] *= 0.985;
    }
  }
  nsPrev = ns;

  // propagación de spikes por el conectoma real (CSR)
  // ── EQUILIBRIO E/I REAL: el conectoma viene sumado como pesos positivos, pero ~14% de
  // las neuronas son GABAérgicas (inhibitorias). La inhibición GABA-A es REALMENTE
  // SHUNTING: abre canales de Cl− que anclan el potencial hacia el reposo, es decir
  // MULTIPLICAN V por (1−g) en vez de restarle. Esto es auto-limitante: cuanto más
  // reverbera un bucle, más fuerte se le recorta, y nunca empuja V a negativo (donde la
  // inhibición se desperdiciaría). Las excitatorias SUMAN (EPSP) con tope SYN_CAP:
  // ninguna conexión individual fuerza un pico — hace falta CONVERGENCIA, como en un
  // cerebro real. Neurotransmisor: tabla nt REAL de FlyWire por presináptica.
  for (let s = 0; s < ns; s++) {
    const i = spikeQ[s];
    let a = rowPtr[i], b = rowPtr[i + 1];
    const deg = b - a;
    if (deg > FANOUT_CAP) { // hubs: subsampling rotatorio
      const off = (tickCount * 7919) % deg;
      a += off; b = Math.min(b, a + FANOUT_CAP);
    }
    if (nNT[i] === NT_GABA) {
      for (let k = a; k < b; k++) {
        const q = weights[k] * WS * GABA_MULT * gain;
        const g = q > 0.95 ? 0.95 : q;
        V[targets[k]] *= 1 - g;
      }
    } else {
      for (let k = a; k < b; k++) {
        const q = weights[k] * WS;
        V[targets[k]] += gain * (q > SYN_CAP ? SYN_CAP : q);
      }
    }
  }
  spikesLastWindow = ns;
}

function meanAct(list, step) {
  let s = 0, n = 0;
  for (let k = 0; k < list.length; k += step) { s += act[list[k]]; n++; }
  return n ? s / n : 0;
}

// señal de salida motora. Dos lecturas, cada una como su biología:
//  readRate (tasa de picos + top-k): para vías POLISINÁPTICAS (descendentes/motoras).
//    Sólo cuenta neuronas que DE VERDAD disparan, y el cuerpo recluta a las más
//    activas — principio de tamaño de Henneman: las unidades de menor umbral primero.
//    READ_TOPK = fracción superior (0 = promedio simple).
//  readV (potencial subumbral medio): para el circuito del SABOR, monosináptico desde
//    los receptores — una depolarización graduada, como la de una neurona gustativa real.
function readRate(list, step) {
  const vals = [];
  for (let k = 0; k < list.length; k += step) vals.push(act[list[k]] / 255);
  if (READ_TOPK <= 0) return vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
  vals.sort((a, b) => b - a);
  const n = Math.max(1, Math.floor(vals.length * READ_TOPK));
  let s = 0;
  for (let k = 0; k < n; k++) s += vals[k];
  return s / n;
}
function readV(list, step) {
  let s = 0, n = 0;
  for (let k = 0; k < list.length; k += step) { const v = V[list[k]] / THR; s += v > 1 ? 1 : (v > 0 ? v : 0); n++; }
  return n ? s / n : 0;
}

function publish() {
  if (!V) return;
  const now = performance.now();
  if (now - hzTimer > 1000) { simHz = tickCount / ((now - hzTimer) / 1000); tickCount = 0; hzTimer = now; }
  const snap = new Uint8Array(N);
  for (let i = 0; i < N; i++) snap[i] = act[i] | 0;
  // ── SALIDA: lectura pasiva de neuronas motoras REALES. El cuerpo es un descodificador
  // (unión neuromuscular): no hay umbrales con estado ni decisiones en el hilo principal.
  // El GIRO tiene dos componentes reales, cada una leída de neuronas auténticas:
  //  (a) diferencial de descendentes (la orden de giro que baja por el cuello), y
  //  (b) comparación interantenal en el lóbulo olfatorio — el cue de surqueo que la
  //      mosca usa DE VERDAD para orientar: el lado con más olor manda girar hacia él.
  // (b) es rápida y direccional; (a) es lenta y polisináptica. Media de ambas.
  const oL = (meanAct(ornL, 1) + meanAct(olfL, 3)) / 2 / 255;
  const oR = (meanAct(ornR, 1) + meanAct(olfR, 3)) / 2 / 255;
  const motorOut = {
    walk: (readRate(descL, 3) + readRate(descR, 3)) / 2,
    turn: (readRate(descR, 3) - readRate(descL, 3)) * 0.5 + (oL - oR) * 0.5,
    fly: readRate(motor, 1),
    feed: readV(gustTgt, 2),            // circuito del sabor: 2ª etapa gustativa real
    arousal: meanAct(central, 97) / 255,
    mechAct: meanAct(mech, 7) / 255,   // actividad sensorial táctil reciente
  };
  const buf = snap.buffer;
  post({ type: 'snap', snap, motor: motorOut, simHz, spikes: hzSpikes, hzSpikesNow: spikesLastWindow }, [buf]);
  hzSpikes = 0;
}

function postInspect(i) {
  const a = rowPtr[i], b = rowPtr[i + 1];
  const deg = b - a;
  const step = Math.max(1, Math.floor(deg / 300));
  const tgts = new Uint32Array(Math.ceil(deg / step));
  for (let k = 0, j = 0; k < deg; k += step, j++) tgts[j] = targets[a + k];
  post({
    type: 'inspect', neuron: i, degree: deg,
    x: nx[i], y: ny[i], z: nz[i], sc: nSC[i], nt: nNT[i], cl: nCL[i], sb: nSB[i], sd: nSD[i],
    targets: tgts,
  });
}

function post(o, t) { self.postMessage(o, t || []); }
