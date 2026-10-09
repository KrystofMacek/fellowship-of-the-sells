import * as THREE from 'three';
import { LAYOUT, REALM_EXIT } from '../engine/lore';
import type { BuildingId } from '../engine/types';
import { fbm, mat, smooth } from './util';

const LAKE = { x: -55, z: 42, r: 14 };
const VILLAGE_R = 50;

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Terrain height at a world position. The village core is flat. */
export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const hills = fbm(x * 0.025 + 10, z * 0.025 - 4) * 14;
  const mountains = Math.pow(fbm(x * 0.012 - 3, z * 0.012 + 8), 2) * 90;
  const ramp = smooth(Math.min(1, Math.max(0, (r - VILLAGE_R) / 45)));
  const mountainRamp = smooth(Math.min(1, Math.max(0, (r - 110) / 60)));
  let h = hills * ramp + mountains * mountainRamp + fbm(x * 0.2, z * 0.2) * 0.4;

  const road = distToSegment(x, z, LAYOUT.market.x, LAYOUT.market.z, REALM_EXIT.x + 30, REALM_EXIT.z + 6);
  if (road < 10) h *= smooth(road / 10);

  const lake = Math.hypot(x - LAKE.x, z - LAKE.z);
  if (lake < LAKE.r + 6) {
    const t = smooth(Math.max(0, lake - LAKE.r) / 6);
    h = -1.8 * (1 - t) + h * t;
  }
  return h;
}

export function buildTerrain(scene: THREE.Scene): void {
  const size = 420;
  const seg = 180;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const grass = new THREE.Color(0x5d8a3a);
  const grass2 = new THREE.Color(0x7aa04a);
  const dirt = new THREE.Color(0x8a7a55);
  const rock = new THREE.Color(0x7d7468);
  const snow = new THREE.Color(0xf2f2f5);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const n = fbm(x * 0.08, z * 0.08);
    c.copy(grass).lerp(grass2, n);
    if (h < -0.5) c.copy(dirt);
    else if (h > 42) c.copy(snow);
    else if (h > 22) c.copy(rock).lerp(snow, Math.max(0, (h - 34) / 8));
    else if (h > 14) c.lerp(rock, (h - 14) / 8);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(LAKE.r + 4, 40),
    new THREE.MeshStandardMaterial({ color: 0x3d7ea6, transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0.2 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAKE.x, -0.6, LAKE.z);
  water.name = 'water';
  scene.add(water);

  buildRoads(scene);
  scatterTrees(scene);
  scatterRocks(scene);
}

function road(scene: THREE.Scene, ax: number, az: number, bx: number, bz: number, width = 2.4): void {
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(len / 2);
  const geo = new THREE.PlaneGeometry(width, len, 1, steps);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  const angle = Math.atan2(bx - ax, bz - az);
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  for (let i = 0; i < p.count; i++) {
    const lx = p.getX(i);
    const lz = p.getZ(i);
    const wx = mx + lx * Math.cos(angle) + lz * Math.sin(angle);
    const wz = mz - lx * Math.sin(angle) + lz * Math.cos(angle);
    p.setXYZ(i, wx, heightAt(wx, wz) + 0.05, wz);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(0x9b7e55));
  m.receiveShadow = true;
  scene.add(m);
}

function buildRoads(scene: THREE.Scene): void {
  for (const id of Object.keys(LAYOUT) as BuildingId[]) {
    if (id === 'council') continue;
    road(scene, 0, 0, LAYOUT[id].x, LAYOUT[id].z);
  }
  road(scene, LAYOUT.market.x, LAYOUT.market.z, REALM_EXIT.x + 30, REALM_EXIT.z + 6, 3);
}

function nearBuilding(x: number, z: number, pad: number): boolean {
  for (const p of Object.values(LAYOUT)) if (Math.hypot(x - p.x, z - p.z) < pad) return true;
  return false;
}

function scatterTrees(scene: THREE.Scene): void {
  const count = 900;
  const trunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.6, 5);
  trunkGeo.translate(0, 0.8, 0);
  const crownGeo = new THREE.ConeGeometry(1.4, 3.4, 6);
  crownGeo.translate(0, 3, 0);
  const crown2Geo = new THREE.ConeGeometry(1.0, 2.4, 6);
  crown2Geo.translate(0, 4.4, 0);
  const trunks = new THREE.InstancedMesh(trunkGeo, mat(0x5a3d24), count);
  const crowns = new THREE.InstancedMesh(crownGeo, mat(0x2f5d2e), count);
  const crowns2 = new THREE.InstancedMesh(crown2Geo, mat(0x3b7037), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  let n = 0;
  let guard = 0;
  while (n < count && guard++ < 20000) {
    const a = Math.random() * Math.PI * 2;
    const r = 36 + Math.pow(Math.random(), 0.8) * 150;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h > 26 || h < -0.3) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 3) continue;
    if (nearBuilding(x, z, 12)) continue;
    if (distToSegment(x, z, LAYOUT.market.x, LAYOUT.market.z, REALM_EXIT.x + 30, REALM_EXIT.z + 6) < 5) continue;
    if (fbm(x * 0.05, z * 0.05) < 0.38 && r < 120) continue; // clearings
    const sc = 0.7 + Math.random() * 0.8;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
    s.set(sc, sc * (0.8 + Math.random() * 0.5), sc);
    v.set(x, h - 0.1, z);
    m.compose(v, q, s);
    trunks.setMatrixAt(n, m);
    crowns.setMatrixAt(n, m);
    crowns2.setMatrixAt(n, m);
    n++;
  }
  for (const im of [trunks, crowns, crowns2]) {
    im.count = n;
    im.castShadow = true;
    im.receiveShadow = true;
    scene.add(im);
  }
}

function scatterRocks(scene: THREE.Scene): void {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const rocks = new THREE.InstancedMesh(geo, mat(0x8b8478), 160);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i < 600 && n < 160; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 30 + Math.random() * 120;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (nearBuilding(x, z, 10)) continue;
    const h = heightAt(x, z);
    if (h < -0.3) continue;
    const sc = 0.3 + Math.random() * 1.3;
    m.compose(
      new THREE.Vector3(x, h, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random(), Math.random(), Math.random())),
      new THREE.Vector3(sc, sc * 0.7, sc),
    );
    rocks.setMatrixAt(n++, m);
  }
  rocks.count = n;
  rocks.castShadow = true;
  scene.add(rocks);
}

export function buildStars(): THREE.Points {
  const count = 1500;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.95);
    const r = 380;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
}
