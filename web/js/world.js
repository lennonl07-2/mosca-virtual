/* ECOSISTEMA PROCEDURAL — terreno en chunks (ruido fBm, orgánico, sin cubos) con
   texturas procedurales (pradera moteada, corteza, hojas, agua con olas de verdad),
   árboles de 4 especies (roble, pino, abedul, arbusto) en tamaños reales, frutos que
   maduran/caen/se pudren (sólidos), fauna que deambula y defeca, viento, día/noche
   luminoso. El agua es un peligro que la mosca EVITA (nunca se ahoga: no la pisa). */
import * as THREE from './three.module.min.js';

/* ESCALA: 1 unidad = 1 cm. Mosca REAL ~0.25 cm de cuerpo, hámster ~13 cm, árboles
   1.3-2.3 m, frutos ~4 cm. RES alto: la malla es fina para que una mosca de 2.5 mm
   pise terreno suave y nunca traspase un borde. */
export const CHUNK = 200, RES = 24, RDIST = 5, WATER = 0;

// hash determinista 2D -> [0,1)
function h2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 144665) | 0;
  h = (((h ^ (h >>> 13)) >>> 0) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s) {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < 4; o++) { v += vnoise(x * f, y * f, s + o * 101) * amp; amp *= 0.5; f *= 2.1; }
  return v;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- texturas procedurales en canvas ----------
function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function grassTex() {   // pradera moteada: manchas suaves de verde/tierra, SIN líneas de briznas
  return canvasTex(256, (g, S) => {
    g.fillStyle = '#c3c9b4'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 900; i++) {          // mechones como manchas difusas
      const x = Math.random() * S, y = Math.random() * S, r = 2 + Math.random() * 7;
      const l = 120 + Math.random() * 130;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(${l * 0.72 | 0},${l | 0},${l * 0.62 | 0},${0.18 + Math.random() * 0.25})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
    for (let i = 0; i < 260; i++) {   // manchitas de tierra
      g.fillStyle = `rgba(90,70,45,${0.05 + Math.random() * 0.1})`;
      g.beginPath(); g.arc(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 0, 7); g.fill();
    }
  });
}
function barkTex(base) {   // corteza: vetas verticales onduladas
  return canvasTex(128, (g, S) => {
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * S;
      g.strokeStyle = `rgba(${Math.random() < 0.5 ? '30,20,10' : '255,240,220'},${0.05 + Math.random() * 0.16})`;
      g.lineWidth = 1 + Math.random() * 3;
      g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y <= S; y += 16) g.lineTo(x + Math.sin(y * 0.11 + i) * 4, y);
      g.stroke();
    }
    for (let i = 0; i < 26; i++) {   // nudos/grietas
      g.fillStyle = 'rgba(20,12,6,0.25)';
      g.beginPath(); g.ellipse(Math.random() * S, Math.random() * S, 1 + Math.random() * 2.5, 3 + Math.random() * 7, 0, 0, 7); g.fill();
    }
  });
}
function leafTex(base) {   // masa de hojas: manchas elípticas de verdes variados
  return canvasTex(128, (g, S) => {
    g.fillStyle = base; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 700; i++) {
      const l = 0.55 + Math.random() * 0.75;
      g.fillStyle = `rgba(${100 * l | 0},${190 * l | 0},${70 * l | 0},${0.3 + Math.random() * 0.4})`;
      g.beginPath();
      g.ellipse(Math.random() * S, Math.random() * S, 2 + Math.random() * 5, 1 + Math.random() * 3, Math.random() * 3, 0, 7);
      g.fill();
    }
  });
}
function waterTex() {   // agua: profundidad + destellos de olas superpuestas
  return canvasTex(256, (g, S) => {
    const grd = g.createLinearGradient(0, 0, S, S);
    grd.addColorStop(0, '#1f5f8f'); grd.addColorStop(0.5, '#2e7ba8'); grd.addColorStop(1, '#174e78');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 420; i++) {          // crespones cortos
      const x = Math.random() * S, y = Math.random() * S, w = 8 + Math.random() * 30;
      g.strokeStyle = `rgba(${170 + Math.random() * 80 | 0},${215 + Math.random() * 40 | 0},255,${0.05 + Math.random() * 0.12})`;
      g.lineWidth = 0.8 + Math.random() * 1.8;
      g.beginPath();
      for (let k = 0; k <= 6; k++) g.lineTo(x + (k / 6) * w, y + Math.sin(k * 1.1 + i) * 2.2);
      g.stroke();
    }
    for (let i = 0; i < 60; i++) {           // reflejos brillantes
      const x = Math.random() * S, y = Math.random() * S;
      g.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.08})`;
      g.beginPath(); g.ellipse(x, y, 3 + Math.random() * 10, 1 + Math.random() * 2, Math.random() * 3, 0, 7); g.fill();
    }
  });
}

// especies de árbol (dimensiones en cm, vida real)
const SPECIES = {
  oak:   { hMin: 130, hMax: 215, trMin: 3.5, trMax: 6,   blobs: 3, brMin: 28, brMax: 42, fruit: true,  trunk: '#6b4a2f', leaf: '#4f8f4a' },
  birch: { hMin: 150, hMax: 210, trMin: 1.8, trMax: 3,   blobs: 2, brMin: 16, brMax: 26, fruit: true,  trunk: '#c9c4b4', leaf: '#69a855' },
  pine:  { hMin: 140, hMax: 235, trMin: 2.8, trMax: 4.5, tiers: 4, crMin: 22, crMax: 34, fruit: false, trunk: '#7c4a30', leaf: '#2f6b3e' },
  shrub: { hMin: 22,  hMax: 55,  trMin: 0,   trMax: 0,   blobs: 1, brMin: 12, brMax: 22, fruit: false, trunk: null,      leaf: '#57903f' },
};

export class World {
  constructor(scene) {
    this.scene = scene;
    this.seed = (Math.random() * 1e6) | 0;
    this.chunks = new Map();          // "cx,cz" -> {mesh, trees}
    this.trees = [];
    this.poops = [];
    this.animals = [];
    this.time = 0.3;                  // 0=medianoche, 0.5=mediodía
    this.dayLen = 170;                // segundos por día
    this.timeScale = 1;
    this.day = 1;
    this._dirty = true;
    this._dummy = new THREE.Object3D();
    this._col = new THREE.Color();
    this.bestPos = new THREE.Vector3();
    this.bestD = 1e9;
    // viento: campo suave que varía con el tiempo (cm/s). El aire empuja el vuelo.
    this.windX = 0; this.windZ = 0; this.windSpeed = 0; this._windT = Math.random() * 100;

    // ---- luces (día luminoso para la mosquita; noche azulada pero visible) ----
    this.hemi = new THREE.HemisphereLight(0x9fb6d8, 0x3c4a2e, 1.15); scene.add(this.hemi);
    this.sunLight = new THREE.DirectionalLight(0xfff2cc, 1.9); scene.add(this.sunLight);
    this.moonLight = new THREE.DirectionalLight(0x9fc0ff, 0.0); scene.add(this.moonLight);
    // targets móviles: sin esto la luz apunta al origen del mundo y al alejarse la mosca
    // el sombreado deja de coincidir con el disco solar dibujado
    scene.add(this.sunLight.target, this.moonLight.target);
    // relleno ambiental: el suelo nunca queda a oscuras
    this.amb = new THREE.AmbientLight(0x30402c, 0.55); scene.add(this.amb);

    // ---- cielo ----
    this.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(70, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffe27a, fog: false }));
    this.moonMesh = new THREE.Mesh(new THREE.SphereGeometry(45, 16, 16), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false }));
    scene.add(this.sunMesh, this.moonMesh);
    const sp = new Float32Array(700 * 3);
    for (let i = 0; i < 700; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.95);
      sp[i * 3] = Math.sin(ph) * Math.cos(th) * 3000; sp[i * 3 + 1] = Math.cos(ph) * 3000; sp[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 3000;
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 7, transparent: true, opacity: 0, fog: false }));
    scene.add(this.stars);

    // ---- agua: malla poligonal con olas reales (muchos triángulos, no un cuadrado) ----
    // Plano denso que sigue a la mosca; cada frame se desplazan los vértices con una
    // suma de senoides (crespones) y se recalculan normales para que la luz baile.
    this._wTex = waterTex();
    this._wGeo = new THREE.PlaneGeometry(9000, 9000, 120, 120);
    this._wBase = this._wGeo.attributes.position.array.slice();   // coords originales
    this.water = new THREE.Mesh(this._wGeo,
      new THREE.MeshPhongMaterial({ map: this._wTex, color: 0x9fd4ff, transparent: true, opacity: 0.82,
        shininess: 90, specular: 0xbfe6ff, flatShading: false }));
    this.water.rotation.x = -Math.PI / 2; this.water.position.y = WATER + 0.5; scene.add(this.water);

    // ---- materiales/instancias ----
    this.matTerrain = new THREE.MeshLambertMaterial({ vertexColors: true, map: grassTex() });
    this._barkOak = new THREE.MeshLambertMaterial({ map: barkTex('#6b4a2f') });
    this._barkBirch = new THREE.MeshLambertMaterial({ map: barkTex('#b8b2a2') });
    this._barkPine = new THREE.MeshLambertMaterial({ map: barkTex('#7c4a30') });
    this._leafMat = new THREE.MeshLambertMaterial({ map: leafTex('#4f8f4a'), flatShading: true });
    this._pineMat = new THREE.MeshLambertMaterial({ map: leafTex('#2f6b3e'), flatShading: true });
    // troncos: 3 IM (uno por corteza) — cilindro unitario escalado por instancia
    this.trunkOakIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.45, 1, 7), this._barkOak, 1400);
    this.trunkBirchIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.2, 1, 6), this._barkBirch, 1200);
    this.trunkPineIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.5, 1, 6), this._barkPine, 1400);
    this.leafIM = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this._leafMat, 5200);
    this.coneIM = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 8), this._pineMat, 2600);
    this.fruitIM = new THREE.InstancedMesh(new THREE.SphereGeometry(2, 10, 8),
      new THREE.MeshLambertMaterial({}), 3000);
    this.poopIM = new THREE.InstancedMesh(new THREE.SphereGeometry(1.5, 7, 6),
      new THREE.MeshLambertMaterial({ color: 0x5a4632 }), 80);
    for (const im of [this.trunkOakIM, this.trunkBirchIM, this.trunkPineIM, this.leafIM, this.coneIM,
                      this.fruitIM, this.poopIM]) {
      im.count = 0; im.frustumCulled = false; scene.add(im);
    }
    this.fruitIM.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3000 * 3).fill(1), 3);

    this._spawnAnimals();
  }

  heightAt(x, z) {
    const base = fbm(x * 0.0045, z * 0.0045, this.seed);
    const detail = fbm(x * 0.02, z * 0.02, this.seed + 7);
    return (base - 0.32) * 70 + (detail - 0.5) * 6;
  }
  // Altura de la MALLA RENDERIZADA (interpolación triangular entre vértices, mismo
  // patrón de índices que _buildChunk). El collider debe usar ESTA y no heightAt():
  // entre vértices la malla es plana pero la fbm ondulante se desvía hasta ~3 cm,
  // y esa diferencia era la que permitía "traspasar" el suelo en zonas irregulares.
  meshHeightAt(x, z) {
    const step = CHUNK / RES;                      // separación real de vértices de la malla
    const gx = x / step, gz = z / step;
    const i = Math.floor(gx), j = Math.floor(gz);
    const u = gx - i, v = gz - j;
    const a = this.heightAt(i * step, j * step), b2 = this.heightAt((i + 1) * step, j * step);
    const c2 = this.heightAt(i * step, (j + 1) * step), d2 = this.heightAt((i + 1) * step, (j + 1) * step);
    return (u + v <= 1)
      ? a * (1 - u - v) + b2 * u + c2 * v          // triángulo (a, b2, c2)
      : d2 * (u + v - 1) + b2 * (1 - v) + c2 * (1 - u);  // triángulo (b2, c2, d2)
      // (antes: b2*(1-u)+c2*(1-v) — pesos cruzados que abrían un salto en la diagonal)
  }
  slopeAt(x, z) {
    const d = 3;
    const dx = this.heightAt(x + d, z) - this.heightAt(x - d, z);
    const dz = this.heightAt(x, z + d) - this.heightAt(x, z - d);
    return Math.hypot(dx, dz) / (2 * d);
  }
  // Normal EXACTA de la malla renderizada (mismo triángulo que meshHeightAt). El cuerpo
  // de la mosca se alinea a ella: en pendiente, la mosca se inclina como en la vida real.
  normalAt(x, z, out) {
    const step = CHUNK / RES;
    const gx = x / step, gz = z / step;
    const i = Math.floor(gx), j = Math.floor(gz);
    const u = gx - i, v = gz - j;
    const a = this.heightAt(i * step, j * step), b2 = this.heightAt((i + 1) * step, j * step);
    const c2 = this.heightAt(i * step, (j + 1) * step), d2 = this.heightAt((i + 1) * step, (j + 1) * step);
    // gradiente del plano del triángulo activo (derivadas constantes por triángulo)
    let dhdx, dhdz;
    if (u + v <= 1) { dhdx = (b2 - a) / step; dhdz = (c2 - a) / step; }
    else { dhdx = (d2 - c2) / step; dhdz = (d2 - b2) / step; }
    return out.set(-dhdx, 1, -dhdz).normalize();
  }
  isWater(x, z) { return this.heightAt(x, z) < WATER + 2; }

  // ---------- colisión: el cuerpo de la mosca choca con objetos reales ----------
  // Troncos y conos de pino = cilindros duros (empuje horizontal). Copas y arbustos =
  // esferas duras (empuje 3D). Fauna = esfera. `soft` = posición del fruto que come:
  // las copas cercanas a ese fruto se ignoran para que pueda alcanzarlo sin atravesar el árbol.
  // Muta p (THREE.Vector3) sacándolo del sólido. Devuelve qué tocó ('trunk'|'cone'|'canopy'|'animal') o null.
  // radio REAL del tronco DIBUJADO a la altura y: el cilindro es cónico
  // (base 1.45·tr → punta tr). Usar un radio fijo 1.4·tr dejaba a la mosca
  // flotando separada de la corteza visible.
  trunkRadiusAt(t, y) {
    const top = t.kind === 'pine' ? t.y + t.h * 0.56 : t.y + t.h;
    const f = clamp((y - t.y) / (top - t.y), 0, 1);
    const base = t.kind === 'birch' ? 1.2 : 1.45;   // conicidad del cilindro dibujado
    return t.tr * (base - (base - 1) * f);
  }

  collide(p, r, soft) {
    let hit = null;
    for (const t of this.trees) {
      const dx = p.x - t.x, dz = p.z - t.z;
      if (Math.abs(dx) > 95 || Math.abs(dz) > 95) continue;
      if (t.kind === 'pine') {
        if (p.y > t.y - 1 && p.y < t.y + t.h * 0.56) {
          const rad = this.trunkRadiusAt(t, p.y) + r, hd = Math.hypot(dx, dz);
          if (hd < rad) { const k = rad / Math.max(hd, 1e-6); p.x = t.x + dx * k; p.z = t.z + dz * k; hit = hit || 'trunk'; this.lastTrunk = t; }
        }
        for (let k = 0; k < SPECIES.pine.tiers; k++) {
          const y0 = t.y + t.h * (0.30 + 0.17 * k), ch = t.h * 0.30, cs = t.cr * (1 - 0.2 * k);
          if (p.y > y0 - r && p.y < y0 + ch + r) {
            // radio del cono DIBUJADO a esta altura (base cs → ápice 0): el 0.9 dejaba
            // el collider 10% más delgado que el verde visible → se penetraba el borde
            const fr = clamp(1 - (p.y - y0) / ch, 0, 1), rad = cs * fr + r;
            const ddx = p.x - t.x, ddz = p.z - t.z, hd = Math.hypot(ddx, ddz);
            if (hd < rad) { const kk = rad / Math.max(hd, 1e-6); p.x = t.x + ddx * kk; p.z = t.z + ddz * kk; hit = hit || 'cone'; }
          }
        }
      } else if (t.kind === 'shrub') {
        // el arbusto dibujado es un elipsoide (cr, h*0.75, cr) — colisionar con esferas
        // dejaba atravesable la parte alta/baja; ahora es elipsoide duro con empuje por la normal
        const cy = t.y + t.h * 0.55;
        const ax = t.cr + r, ay = t.h * 0.75 + r, az = t.cr + r;
        const ddx = p.x - t.x, ddy = p.y - cy, ddz = p.z - t.z;
        const qx = ddx / ax, qy = ddy / ay, qz = ddz / az;
        const d = Math.hypot(qx, qy, qz);
        if (d < 1) {
          if (d > 1e-6) {
            const k = 1 / d, sx = qx * k * ax, sy = qy * k * ay, sz = qz * k * az;
            const nx2 = sx / (ax * ax), ny2 = sy / (ay * ay), nz2 = sz / (az * az);
            const nl = Math.hypot(nx2, ny2, nz2) || 1;
            p.x = t.x + sx + nx2 / nl * 0.15; p.y = cy + sy + ny2 / nl * 0.15; p.z = t.z + sz + nz2 / nl * 0.15;
          } else p.y = cy + ay;
          hit = hit || 'canopy';
        }
      } else {   // roble / abedul: tronco cilindro + copas elipsoide
        if (p.y > t.y - 1 && p.y < t.y + t.h) {
          const rad = this.trunkRadiusAt(t, p.y) + r, hd = Math.hypot(dx, dz);
          if (hd < rad) { const k = rad / Math.max(hd, 1e-6); p.x = t.x + dx * k; p.z = t.z + dz * k; hit = hit || 'trunk'; this.lastTrunk = t; }
        }
        const nb = SPECIES[t.kind].blobs;
        for (let b = 0; b < nb; b++) {
          const ang = h2(t.x | 0, b + 3, this.seed + 91) * 6.283;
          const off = t.cr * 0.45 * (b ? 1 : 0);
          const bs = t.cr * (b === 0 ? 1 : 0.72);
          const cx2 = t.x + Math.cos(ang) * off, cy2 = t.y + t.h * (0.82 + 0.12 * b), cz2 = t.z + Math.sin(ang) * off;
          // LA COPA ES SÓLIDA COMO SE DIBUJA: elipsoide (bs, 0.78·bs, bs) + radio del
          // cuerpo (antes esfera 0.9·bs → el borde verde visible era penetrable).
          // El ablandado era un bug: comparaba fruto↔copa (distancia CONSTANTE por árbol),
          // así que con un fruto objetivo cerca la copa entera era fantasma y la mosca
          // atravesaba todo el follaje. Ahora sólo hay un hueco suave JUNTO AL FRUTO
          // (la mosca mete la cabeza para comer, como apartando hojas).
          if (soft && Math.hypot(p.x - soft.x, p.y - soft.y, p.z - soft.z) < 13) continue;
          const ax = bs + r, ay = bs * 0.78 + r, az = bs + r;
          const ddx = (p.x - cx2) / ax, ddy = (p.y - cy2) / ay, ddz = (p.z - cz2) / az;
          const d = Math.hypot(ddx, ddy, ddz);
          if (d < 1) {
            if (d > 1e-6) {
              const k = 1 / d, sx = ddx * k * ax, sy = ddy * k * ay, sz = ddz * k * az;
              const nx2 = sx / (ax * ax), ny2 = sy / (ay * ay), nz2 = sz / (az * az);
              const nl = Math.hypot(nx2, ny2, nz2) || 1;
              p.x = cx2 + sx + nx2 / nl * 0.1; p.y = cy2 + sy + ny2 / nl * 0.1; p.z = cz2 + sz + nz2 / nl * 0.1;
            } else p.y = cy2 + ay;
            hit = hit || 'canopy';
          }
        }
      }
    }
    for (const an of this.animals) {
      const cx2 = an.grp.position.x, cy2 = an.grp.position.y, cz2 = an.grp.position.z;
      const R = 7.5 + r;
      const ddx = p.x - cx2, ddy = p.y - cy2, ddz = p.z - cz2, d3 = Math.hypot(ddx, ddy, ddz);
      if (d3 < R) {
        if (d3 > 1e-6) { const k = R / d3; p.x = cx2 + ddx * k; p.y = cy2 + ddy * k; p.z = cz2 + ddz * k; }
        else p.y = cy2 + R;
        hit = 'animal';
      }
    }
    // frutos: esferas SÓLIDAS (la mosca aterriza encima y camina sobre ellos)
    for (const t of this.trees) {
      if (!t.fruits.length) continue;
      for (const f of t.fruits) {
        if (f.px === undefined) continue;
        const R = f.pr + r;
        const ddx = p.x - f.px, ddy = p.y - f.py, ddz = p.z - f.pz, d3 = Math.hypot(ddx, ddy, ddz);
        if (d3 < R) {
          if (d3 > 1e-6) { const k = R / d3; p.x = f.px + ddx * k; p.y = f.py + ddy * k; p.z = f.pz + ddz * k; }
          else p.y = f.py + R;
          hit = hit || 'fruit';
        }
      }
    }
    return hit;
  }

  // Tronco tocado en la última collide() — main.js lo usa para adherirse y trepar.
  lastTrunk = null;

  // ---------- fauna: hámsteres (~13 cm de largo, vida real) ----------
  _spawnAnimals() {
    const mat = new THREE.MeshLambertMaterial({ color: 0xd9a066 });
    const mat2 = new THREE.MeshLambertMaterial({ color: 0xb8834e });
    const matW = new THREE.MeshLambertMaterial({ color: 0xf5efe6 });
    for (let i = 0; i < 9; i++) {
      // el punto MÁS ALTO de 200 muestras: garantiza tierra firme (el reintentar ciego
      // podía agotar los 40 intentos y sembrar un hámster nadando en el lago)
      let x = 0, z = 0, y = -1e9;
      for (let tries = 0; tries < 200; tries++) {
        const tx = (Math.random() - 0.5) * 900, tz = (Math.random() - 0.5) * 900, ty = this.heightAt(tx, tz);
        if (ty > y) { y = ty; x = tx; z = tz; }
      }
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(5, 12, 10), mat); body.scale.set(1.35, 0.95, 1); g.add(body);
      const belly = new THREE.Mesh(new THREE.SphereGeometry(4.4, 10, 8), matW); belly.scale.set(1.25, 0.85, 0.9); belly.position.set(0, -1.2, 0); g.add(belly);
      const head = new THREE.Mesh(new THREE.SphereGeometry(2.6, 10, 8), mat2); head.position.set(6.4, 0.6, 0); g.add(head);
      for (let s = 0; s < 2; s++) {   // orejas
        const ear = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), mat2);
        ear.position.set(5.6, 2.6, s ? 1.6 : -1.6); ear.scale.set(0.5, 1, 0.8); g.add(ear);
      }
      for (let s = 0; s < 2; s++) {   // ojos
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.42, 6, 6), new THREE.MeshBasicMaterial({ color: 0x120d08 }));
        eye.position.set(8.1, 1.1, s ? 1.15 : -1.15); g.add(eye);
      }
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 6), mat2); nose.position.set(8.9, 0.2, 0); g.add(nose);
      const tail = new THREE.Mesh(new THREE.SphereGeometry(0.9, 6, 6), mat2); tail.position.set(-6.8, 0.4, 0); tail.scale.set(0.7, 0.7, 0.7); g.add(tail);
      // patas (4, trote alternado) — sin ellas el hámster flotaba como un globo
      const legs = [];
      for (const [lx, lz] of [[3.6, 3.0], [3.6, -3.0], [-3.4, 3.0], [-3.4, -3.0]]) {
        const hipL = new THREE.Group(); hipL.position.set(lx, -3.0, lz);
        const fem = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.4, 2.6, 6), mat2);
        fem.position.y = -1.3; hipL.add(fem);
        const foot = new THREE.Mesh(new THREE.SphereGeometry(0.55, 6, 5), mat2);
        foot.position.y = -2.6; hipL.add(foot);
        g.add(hipL); legs.push({ hip: hipL, phase: (lx > 0) === (lz > 0) ? 0 : Math.PI });
      }
      g.position.set(x, y + 5.0, z);
      this.scene.add(g);
      this.animals.push({ grp: g, legs, x, z, heading: Math.random() * 6.28, speed: 6 + Math.random() * 6, poopT: 6 + Math.random() * 16 });
    }
  }

  // ---------- chunks ----------
  _buildChunk(cx, cz) {
    const n = RES + 1;
    const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
    const X = (i) => cx * CHUNK + (i / RES) * CHUNK, Z = (j) => cz * CHUNK + (j / RES) * CHUNK;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3, x = X(i), z = Z(j), y = this.heightAt(x, z);
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      uv[(j * n + i) * 2] = x / 45; uv[(j * n + i) * 2 + 1] = z / 45;   // un tile de textura cada 45 cm
      const sl = this.slopeAt(x, z);
      const v = h2(i + cx * 13, j + cz * 17, this.seed + 3) * 0.14;
      const m = h2((x * 0.1) | 0, (z * 0.1) | 0, this.seed + 21) * 0.1;   // manchas de vegetación
      let r, g, b;
      if (y < WATER + 6) { r = 0.80; g = 0.74; b = 0.52; }                          // arena
      else if (y > 150) { r = 0.95; g = 0.97; b = 1.0; }                            // nieve
      else if (sl > 0.55 || y > 90) { r = 0.48 + v; g = 0.46 + v; b = 0.43 + v; }   // roca
      else { r = 0.30 + v * 0.5 - m * 0.4; g = 0.66 + v + m; b = 0.24 + v * 0.4; }  // pasto
      col[k] = r; col[k + 1] = g; col[k + 2] = b;
    }
    const idx = [];
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      const a = j * n + i, b2 = a + 1, c2 = a + n, d2 = c2 + 1;
      idx.push(a, c2, b2, b2, c2, d2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.matTerrain);
    this.scene.add(mesh);

    // árboles del chunk: 4x4 celdas, ~90% con árbol → bosque denso (1-2 m reales)
    const trees = [];
    const step = CHUNK / 4;
    for (let gx = 0; gx < 4; gx++) for (let gz = 0; gz < 4; gz++) {
      const r1 = h2(cx * 4 + gx, cz * 4 + gz, this.seed + 31);
      if (r1 < 0.10) continue;
      const x = cx * CHUNK + gx * step + h2(gx, cz * 4 + gz, this.seed + 5) * step;
      const z = cz * CHUNK + gz * step + h2(cx * 4 + gx, gz, this.seed + 9) * step;
      const y = this.heightAt(x, z);
      if (y < WATER + 4 || y > 120 || this.slopeAt(x, z) > 0.5) continue;
      const r2 = h2(gx + 7, gz + cz * 3, this.seed + 71);
      const kind = r2 < 0.28 ? 'oak' : r2 < 0.52 ? 'pine' : r2 < 0.70 ? 'birch' : 'shrub';
      const S = SPECIES[kind];
      const tree = {
        x, y, z, kind,
        h: S.hMin + r1 * (S.hMax - S.hMin),
        tr: S.trMin + r2 * (S.trMax - S.trMin),
        cr: (S.brMin || S.crMin) + r1 * ((S.brMax || S.crMax) - (S.brMin || S.crMin)),
        fruits: [],
      };
      if (S.fruit) {
        const nf = 3 + ((r1 * 1000) % 3 | 0);
        for (let k = 0; k < nf; k++) {
          const rr = h2(gx * 7 + k, gz * 13, this.seed + 55);
          tree.fruits.push({ ang: (k / nf) * 6.283 + rr * 2, rad: 12 + rr * 18, phase: 0, t: rr * 30, hp: 1, size: 0.4 });
        }
      }
      trees.push(tree); this.trees.push(tree);
    }
    this.chunks.set(cx + ',' + cz, { mesh, trees });
  }
  _disposeChunk(key) {
    const c = this.chunks.get(key); if (!c) return;
    this.scene.remove(c.mesh); c.mesh.geometry.dispose();
    this.trees = this.trees.filter((t) => !c.trees.includes(t));
    this.chunks.delete(key); this._dirty = true;
  }
  _rebuildStatic() {
    const d = this._dummy;
    let oi = 0, bi = 0, pi = 0, li = 0, ci = 0;
    const put = (im, i) => { d.updateMatrix(); im.setMatrixAt(i, d.matrix); };
    for (const t of this.trees) {
      if (t.kind === 'pine') {
        d.rotation.set(0, 0, 0);
        d.position.set(t.x, t.y + t.h * 0.28, t.z); d.scale.set(t.tr, t.h * 0.56, t.tr);
        if (pi < this.trunkPineIM.instanceMatrix.count) put(this.trunkPineIM, pi++);
        for (let k = 0; k < SPECIES.pine.tiers; k++) {
          const ch = t.h * 0.30, cs = t.cr * (1 - 0.2 * k);
          d.position.set(t.x, t.y + t.h * (0.30 + 0.17 * k) + ch / 2, t.z);
          d.scale.set(cs, ch, cs); d.rotation.set(0, t.x * 0.1 + k, 0);
          if (ci < this.coneIM.instanceMatrix.count) put(this.coneIM, ci++);
        }
      } else if (t.kind === 'shrub') {
        d.position.set(t.x, t.y + t.h * 0.55, t.z); d.scale.set(t.cr, t.h * 0.75, t.cr);
        d.rotation.set(0.2, t.x * 0.13, 0.1);
        if (li < this.leafIM.instanceMatrix.count) put(this.leafIM, li++);
      } else {   // roble y abedul: tronco + copas
        const im = t.kind === 'birch' ? this.trunkBirchIM : this.trunkOakIM;
        const ic = t.kind === 'birch' ? bi : oi;
        d.position.set(t.x, t.y + t.h / 2, t.z); d.scale.set(t.tr, t.h, t.tr); d.rotation.set(0, 0, 0);
        if (ic < im.instanceMatrix.count) { put(im, ic); if (t.kind === 'birch') bi++; else oi++; }
        const nb = SPECIES[t.kind].blobs;
        for (let b = 0; b < nb; b++) {
          const ang = h2(t.x | 0, b + 3, this.seed + 91) * 6.283;
          const off = t.cr * 0.45 * (b ? 1 : 0);
          const bs = t.cr * (b === 0 ? 1 : 0.72);
          d.position.set(t.x + Math.cos(ang) * off, t.y + t.h * (0.82 + 0.12 * b), t.z + Math.sin(ang) * off);
          d.scale.set(bs, bs * 0.78, bs); d.rotation.set(0.3, t.x * 0.1, 0.2);
          if (li < this.leafIM.instanceMatrix.count) put(this.leafIM, li++);
        }
      }
    }
    this.trunkOakIM.count = oi; this.trunkBirchIM.count = bi; this.trunkPineIM.count = pi;
    this.leafIM.count = li; this.coneIM.count = ci;
    for (const im of [this.trunkOakIM, this.trunkBirchIM, this.trunkPineIM, this.leafIM, this.coneIM])
      im.instanceMatrix.needsUpdate = true;
    this._dirty = false;
  }

  // ---------- ciclo de vida de frutos ----------
  _updateFruits(dt, flyPos, flying) {
    const d = this._dummy; let fi = 0;
    for (const t of this.trees) {
      if (!t.fruits.length) continue;
      const canopyY = t.y + t.h * 0.9;
      for (const f of t.fruits) {
        f.t += dt;
        const onTreeX = t.x + Math.cos(f.ang) * f.rad, onTreeZ = t.z + Math.sin(f.ang) * f.rad;
        let px, py, pz, col;
        if (f.phase === 0) {          // creciendo
          f.size = 0.3 + 0.7 * clamp(f.t / 30, 0, 1);
          py = canopyY - 8; px = onTreeX; pz = onTreeZ; col = [0.25, 0.65, 0.25];
          if (f.t > 34) { f.phase = 1; f.t = 0; }
        } else if (f.phase === 1) {   // maduro
          f.size = 1; py = canopyY - 8; px = onTreeX; pz = onTreeZ; col = [0.95, 0.25, 0.18];
          if (f.t > 26) { f.phase = 2; f.t = 0; f.fy = canopyY - 8; }
        } else if (f.phase === 2) {   // cayendo
          f.size = 1; px = onTreeX; pz = onTreeZ;
          const gy = this.heightAt(px, pz) + f.size * 2;
          py = f.fy - (f.fy - gy) * clamp(f.t / 1.3, 0, 1);
          col = [0.95, 0.45, 0.15];
          if (f.t > 1.5) { f.phase = 3; f.t = 0; }
        } else {                      // pudriéndose en el suelo
          px = onTreeX; pz = onTreeZ; py = this.heightAt(px, pz) + f.size * 1.6;
          const rot = clamp(f.t / 60, 0, 1);
          col = [0.95 - rot * 0.55, 0.45 - rot * 0.25, 0.15 + rot * 0.05];
          f.size = 1 - rot * 0.25 - (1 - f.hp) * 0.6;
          if (f.t > 70 || f.hp <= 0) { f.phase = 0; f.t = 0; f.hp = 1; }  // el árbol rebrota
        }
        d.position.set(px, py, pz); d.scale.setScalar(Math.max(0.05, f.size));
        f.px = px; f.py = py; f.pz = pz; f.pr = Math.max(0.05, f.size) * 2;   // esfera sólida real
        d.rotation.set(0, 0, 0); d.updateMatrix();
        if (fi < this.fruitIM.instanceMatrix.count) {
          this.fruitIM.setMatrixAt(fi, d.matrix);
          this.fruitIM.setColorAt(fi, this._col.setRGB(col[0], col[1], col[2]));
          fi++;
        }
      }
    }
    this.fruitIM.count = fi;
    this.fruitIM.instanceMatrix.needsUpdate = true;
    if (this.fruitIM.instanceColor) this.fruitIM.instanceColor.needsUpdate = true;
  }

  // ---------- principales ----------
  update(dt, flyPos, heading, feed) {
    // tiempo
    this.time += (dt / this.dayLen) * this.timeScale;
    if (this.time >= 1) { this.time -= 1; this.day++; }
    const a = (this.time - 0.25) * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0.35 * Math.cos(a * 0.6)).normalize();
    const moonDir = sunDir.clone().negate();
    const dayF = clamp((sunDir.y + 0.06) / 0.28, 0, 1);
    const night = 1 - dayF;

    // cielo / niebla — noche clara: la luna y las estrellas iluminan de verdad
    const sky = this._col.clone().setRGB(0.07, 0.10, 0.18).lerp(new THREE.Color(0.53, 0.71, 0.85), dayF);
    const horizon = 1 - Math.abs(dayF - 0.5) * 2;               // pico en el amanecer/atardecer
    sky.lerp(new THREE.Color(0.85, 0.45, 0.2), Math.max(0, horizon - 0.4) * 0.9);
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    this.scene.fog.near = 250; this.scene.fog.far = 1400;

    // luces y astros (más luz para la mosquita: techo solar 2.6, suelo nocturno visible)
    this.sunLight.position.copy(flyPos).addScaledVector(sunDir, 400);
    this.sunLight.target.position.copy(flyPos);
    this.sunLight.intensity = 2.6 * dayF;
    this.sunLight.color.setRGB(1, 0.75 + 0.2 * dayF, 0.55 + 0.35 * dayF);
    this.moonLight.position.copy(flyPos).addScaledVector(moonDir, 400);
    this.moonLight.target.position.copy(flyPos);
    this.moonLight.intensity = 0.85 * night;
    this.hemi.intensity = 0.55 + 0.85 * dayF;
    this.hemi.color.setRGB(0.62 + 0.3 * dayF, 0.70 + 0.25 * dayF, 0.85);
    this.amb.intensity = 0.35 + 0.35 * dayF;
    this.sunMesh.position.copy(flyPos).addScaledVector(sunDir, 2600);
    this.moonMesh.position.copy(flyPos).addScaledVector(moonDir, 2600);
    this.sunMesh.visible = sunDir.y > -0.15; this.moonMesh.visible = moonDir.y > -0.15;
    this.stars.position.copy(flyPos); this.stars.position.y = 0;
    this.stars.rotation.y += dt * 0.005;
    this.stars.material.opacity = night * 0.9;

    // ---- agua: olas poligonales animadas (desplazamiento de vértices + normales) ----
    this.water.position.x = flyPos.x; this.water.position.z = flyPos.z;
    this._wT = (this._wT || 0) + dt;
    {
      const p = this._wGeo.attributes.position, base = this._wBase, t = this._wT;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        p.array[i * 3 + 2] =
          Math.sin(x * 0.020 + t * 1.4) * 0.55 +
          Math.sin(y * 0.028 - t * 1.1) * 0.42 +
          Math.sin((x + y) * 0.012 + t * 0.7) * 0.65 +
          Math.sin((x - y) * 0.045 + t * 2.2) * 0.18;
      }
      p.needsUpdate = true;
      this._wGeo.computeVertexNormals();
    }
    this._wTex.offset.x = (this._wTex.offset.x + dt * 0.012) % 1;   // destellos deslizantes
    this._wTex.offset.y = (this._wTex.offset.y + dt * 0.006) % 1;

    // ---- viento: deriva lenta de dirección + ráfagas suaves (cm/s) ----
    this._windT += dt;
    const wDir = fbm(this._windT * 0.02, 7.31, this.seed) * Math.PI * 4;
    const wMag = 6 + fbm(this._windT * 0.05, 2.11, this.seed + 3) * 22;
    this.windX = Math.cos(wDir) * wMag;
    this.windZ = Math.sin(wDir) * wMag;
    this.windSpeed = wMag;

    // streaming de chunks (2 nuevos por frame para no trabar)
    const fc = Math.floor(flyPos.x / CHUNK), fz = Math.floor(flyPos.z / CHUNK);
    let made = 0;
    for (let dz = -RDIST; dz <= RDIST && made < 2; dz++) for (let dx = -RDIST; dx <= RDIST && made < 2; dx++) {
      const key = (fc + dx) + ',' + (fz + dz);
      if (!this.chunks.has(key)) { this._buildChunk(fc + dx, fz + dz); made++; this._dirty = true; }
    }
    for (const key of this.chunks.keys()) {
      const [cx, cz] = key.split(',').map(Number);
      if (Math.abs(cx - fc) > RDIST + 2 || Math.abs(cz - fz) > RDIST + 2) this._disposeChunk(key);
    }
    if (this._dirty) this._rebuildStatic();

    // frutos
    this._updateFruits(dt, flyPos);

    // heces (instanciadas)
    const d = this._dummy; let pi = 0;
    for (let i = this.poops.length - 1; i >= 0; i--) {
      const p = this.poops[i]; p.age += dt;
      if (p.age > p.decay) { this.poops.splice(i, 1); continue; }
      const s = p.size * (1 - (p.age / p.decay) * 0.45);
      d.position.set(p.x, p.y + s * 0.3, p.z); d.scale.set(s, s * 0.6, s); d.rotation.set(0, p.rot, 0);
      d.updateMatrix(); if (pi < this.poopIM.instanceMatrix.count) this.poopIM.setMatrixAt(pi++, d.matrix);
    }
    this.poopIM.count = pi; this.poopIM.instanceMatrix.needsUpdate = true;

    // fauna
    let poke = 0;
    for (const an of this.animals) {
      an.heading += (h2((an.x * 10) | 0, (performance.now() / 900) | 0, this.seed) - 0.5) * dt * 2.2;
      // evitar el agua: oler terreno alto alrededor y girar hacia él (antes de meterse)
      const fx = an.x + Math.cos(an.heading) * 14, fz = an.z + Math.sin(an.heading) * 14;
      if (this.heightAt(fx, fz) < WATER + 1.5) {
        let bestA = 0, bestY = -1e9;
        for (const cand of [0.8, -0.8, 1.6, -1.6, 2.5, -2.5]) {
          const hy = this.heightAt(an.x + Math.cos(an.heading + cand) * 22, an.z + Math.sin(an.heading + cand) * 22);
          if (hy > bestY) { bestY = hy; bestA = cand; }
        }
        an.heading += Math.sign(bestA) * dt * 6;
      }
      an.x += Math.cos(an.heading) * an.speed * dt; an.z += Math.sin(an.heading) * an.speed * dt;
      const gy = this.heightAt(an.x, an.z);
      if (gy < WATER + 1.2) {   // si igual entró en agua, salir caminando hacia afuera (no girar en loop)
        let bestA = 0, bestY = -1e9;
        for (const cand of [0.6, -0.6, 1.2, -1.2, 2.0, -2.0, 3.1]) {
          const hy = this.heightAt(an.x + Math.cos(an.heading + cand) * 18, an.z + Math.sin(an.heading + cand) * 18);
          if (hy > bestY) { bestY = hy; bestA = cand; }
        }
        an.heading += bestA;
        an.x += Math.cos(an.heading) * 30 * dt; an.z += Math.sin(an.heading) * 30 * dt;
      }
      an.heading = ((an.heading + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; // nunca acumular vueltas
      an.grp.position.set(an.x, gy + 6.15, an.z);
      an.grp.rotation.y = -an.heading;
      // trote: patas alternadas diagonales
      const gait = performance.now() / 130 + an.speed;
      for (const L of an.legs) L.hip.rotation.x = Math.sin(gait + L.phase) * 0.5;
      an.poopT -= dt * this.timeScale;
      if (an.poopT <= 0 && this.poops.length < 60) {
        an.poopT = 12 + Math.random() * 22;
        this.poops.push({ x: an.x, z: an.z, y: gy, size: 0.9 + Math.random() * 0.7, age: 0, decay: 160, rot: Math.random() * 6.28 });
      }
      const dd = Math.hypot(an.x - flyPos.x, an.z - flyPos.z);
      if (dd < 14) poke = 1;
    }

    // ---- sentidos de la mosca ----
    // Convención anatómica del modelo: +z del cuerpo = lado IZQUIERDO (eyeL está en +z),
    // y +z corresponde a heading CRECIENTE. Un astro/fuente a la izquierda del frente
    // (ángulo +) debe alimentar el canal L. Así el lazo cerrado gira HACIA el estímulo.
    const lightI = 0.42 + 0.48 * dayF;
    const body = dayF > 0.5 ? sunDir : moonDir;
    const ang = Math.atan2(body.z, body.x) - heading;
    const lightL = Math.max(0, Math.cos(ang - 0.85)) * lightI;
    const lightR = Math.max(0, Math.cos(ang + 0.85)) * lightI;

    let odor = 0, taste = 0, best = null, bestD = 1e9;
    for (const t of this.trees) for (const f of t.fruits) {
      let str = 0, px, pz, py;
      if (f.phase === 1) { str = 0.3; px = t.x + Math.cos(f.ang) * f.rad; pz = t.z + Math.sin(f.ang) * f.rad; py = t.y + t.h * 0.9; }
      else if (f.phase >= 2) {
        const rot = f.phase === 3 ? clamp(f.t / 25, 0, 1) : 0.3;
        str = 0.35 + rot * 0.6; px = t.x + Math.cos(f.ang) * f.rad; pz = t.z + Math.sin(f.ang) * f.rad; py = this.heightAt(px, pz);
      }
      if (!str) continue;
      const dd = Math.hypot(px - flyPos.x, pz - flyPos.z);
      const o = str * Math.exp(-dd / 70);
      if (o > odor) { odor = o; best = { kind: 'fruit', f, x: px, y: py, z: pz }; }
    }
    for (const p of this.poops) {
      const str = 1 - p.age / p.decay;
      const dd = Math.hypot(p.x - flyPos.x, p.z - flyPos.z);
      const o = str * Math.exp(-dd / 60);
      if (o > odor) { odor = o; best = { kind: 'poop', p, x: p.x, y: p.y, z: p.z }; }
    }
    // antenas olfativas: la fuente que produce el olor más intenso llega distinto a cada lado
    // (gradiente interantenal → el cerebro compara y gira hacia el olor, como la mosca real).
    // Mismo convenio que la luz: fuente al lado de la antena L dibujada (+z, heading
    // creciente) → odorL. Con olor a la izquierda el cerebro satura descR → turn>0 →
    // heading crece → la mosca gira HACIA la fuente: surqueo real en lazo cerrado.
    let odorL = 0, odorR = 0;
    if (best && odor > 0.015) {
      bestD = Math.hypot(best.x - flyPos.x, best.z - flyPos.z);
      this.bestPos.set(best.x, best.y, best.z);
      this.bestD = bestD;
      const dAng = Math.atan2(best.z - flyPos.z, best.x - flyPos.x) - heading;
      odorL = Math.max(0, Math.cos(dAng - 0.9)) * odor;
      odorR = Math.max(0, Math.cos(dAng + 0.9)) * odor;
      if (bestD < 8) {
        taste = 1;
        // la mosca absorbe SÓLO si su cerebro extendió la probóscide (feed = actividad real
        // del circuito gustativo) y está sobre la fuente: la succión consume el recurso
        if (flyPos.y < best.y + 6 && feed > 0.5) {
          if (best.kind === 'fruit') best.f.hp -= dt * 0.22 * feed;
          else { best.p.size -= dt * 0.10 * feed; if (best.p.size < 0.3) best.p.age = best.p.decay; }
        }
      }
    } else {
      this.bestD = 1e9;
    }

    // HUD (sin emojis)
    const hh = Math.floor(this.time * 24), mm = Math.floor((this.time * 24 % 1) * 60);
    const fase = dayF > 0.85 ? 'día' : dayF > 0.35 ? 'atardecer' : dayF > 0.05 ? 'alba' : 'noche';
    this.hud = `${fase.toUpperCase()} · Día ${this.day} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${this.trees.length} árboles · ${this.poops.length} restos`;

    // humedad y temperatura percibidas (0..1): cerca del agua hay más humedad;
    // el mediodía calienta el terreno. Son estímulos para receptores reales (hygro/therm).
    const nearWater = clamp(1 - (this.heightAt(flyPos.x, flyPos.z) - WATER) / 14, 0, 1);
    const humidity = clamp(0.25 + nearWater * 0.65 + (dayF < 0.1 ? 0.15 : 0), 0, 1);
    const temp = clamp(0.15 + dayF * 0.75, 0, 1);

    return { lightL, lightR, odor, odorL, odorR, taste, poke, night, dayF, humidity, temp };
  }

  regenerate() {
    for (const key of [...this.chunks.keys()]) this._disposeChunk(key);
    this.poops.length = 0;
    this.seed = (Math.random() * 1e6) | 0;
    this.time = 0.3; this.day = 1; this._dirty = true;
  }
}
