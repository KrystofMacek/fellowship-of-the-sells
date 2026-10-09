import * as THREE from 'three';
import { LAYOUT } from '../engine/lore';
import type { BuildingId } from '../engine/types';
import { banner, box, cone, cyl, gable, mat, mesh, windowMat } from './util';

export interface BuildingView {
  id: BuildingId;
  group: THREE.Group;
  /** height of the label anchor */
  labelHeight: number;
  /** radius used for agent standing spots */
  footprint: number;
  animate(time: number, night: number): void;
}

const STONE = 0xb9b1a3;
const STONE_DARK = 0x8f877a;
const WOOD = 0x6b4a2f;
const ROOF_RED = 0x8c3b2a;
const ROOF_BLUE = 0x34506e;
const GOLD = 0xd4a72c;

function windows(group: THREE.Group, positions: [number, number, number][], w = 0.5, h = 0.8): void {
  for (const [x, y, z] of positions) {
    const win = mesh(new THREE.BoxGeometry(w, h, 0.12), windowMat, x, y, z);
    win.castShadow = false;
    group.add(win);
  }
}

function council(): Partial<BuildingView> & { group: THREE.Group } {
  const g = new THREE.Group();
  g.add(box(16, 0.8, 12, STONE_DARK));
  g.add(box(14, 1, 10.5, STONE, 0, 0.8));
  g.add(box(12, 4.5, 8, 0xd8c9a8, 0, 1.8));
  g.add(gable(13, 4.5, 9, 0xb08a2e, 0, 6.3, 0));
  g.add(box(13.4, 0.4, 9.4, WOOD, 0, 6.1));
  for (const x of [-5, -2.5, 2.5, 5]) g.add(cyl(0.35, 0.4, 4.3, 0xe8dcc0, 8, x, 1.8, 4.6));
  g.add(gable(11, 2, 1.6, 0xb08a2e, 0, 6.1, 4.8));
  g.add(box(2.4, 3, 0.3, 0x3b2a1a, 0, 1.8, 4.05));
  windows(g, [[-3.5, 4.2, 4.05], [3.5, 4.2, 4.05]], 0.9, 1.4);
  for (const x of [-6.5, 6.5]) g.add(banner(0x8e1b1b, 5, x, 1.8, 5.5));
  const crest = mesh(new THREE.OctahedronGeometry(0.8), mat(GOLD, { emissive: GOLD, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.3 }), 0, 11.6, 0);
  crest.name = 'spin';
  g.add(crest);
  // stairs
  for (let i = 0; i < 3; i++) g.add(box(5, 0.3, 1, STONE, 0, i * 0.3, 6.6 - i * 0.6));
  return { group: g, labelHeight: 13.5, footprint: 9 };
}

function watchtower() {
  const g = new THREE.Group();
  g.add(cyl(2.6, 3.0, 1, STONE_DARK, 8));
  g.add(cyl(2.0, 2.5, 12, STONE, 8, 0, 1));
  g.add(cyl(3.0, 3.0, 0.8, STONE_DARK, 8, 0, 13));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.add(box(0.8, 1, 0.8, STONE, Math.cos(a) * 2.6, 13.8, Math.sin(a) * 2.6));
  }
  g.add(cone(2.2, 3.5, 0x2e5a34, 8, 0, 15.2));
  windows(g, [[0, 5, 2.2], [0, 9, 2.0]], 0.4, 1);
  g.add(banner(0x2e7d32, 3, 0, 18.4, 0));
  g.add(box(1.4, 2, 0.3, 0x3b2a1a, 0, 1, 2.4));
  return { group: g, labelHeight: 23, footprint: 5 };
}

function scriptorium() {
  const g = new THREE.Group();
  g.add(box(9, 0.5, 7, STONE_DARK));
  g.add(box(8, 4, 6, 0xe2d6bd, 0, 0.5));
  g.add(gable(9, 3.5, 7, ROOF_RED, 0, 4.5, 0));
  // timber frame
  for (const x of [-3.9, 0, 3.9]) g.add(box(0.3, 4, 0.2, WOOD, x, 0.5, 3.05));
  g.add(box(8, 0.3, 0.2, WOOD, 0, 2.6, 3.05));
  g.add(box(1.4, 2.2, 0.2, 0x3b2a1a, 0, 0.5, 3.1));
  windows(g, [[-2, 3.3, 3.1], [2, 3.3, 3.1], [-2, 1.4, 3.1], [2, 1.4, 3.1]], 0.8, 0.9);
  g.add(box(1, 3, 1, STONE, 2.5, 6, -1.5));
  const smoke = new THREE.Group();
  smoke.name = 'smoke';
  smoke.position.set(2.5, 9.3, -1.5);
  for (let i = 0; i < 4; i++) {
    const puff = mesh(new THREE.IcosahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({ color: 0xcccccc, transparent: true, opacity: 0.5, flatShading: true }));
    puff.castShadow = false;
    puff.userData.phase = i / 4;
    smoke.add(puff);
  }
  g.add(smoke);
  return { group: g, labelHeight: 11, footprint: 6 };
}

function magetower() {
  const g = new THREE.Group();
  g.add(cyl(3, 3.4, 1.2, STONE_DARK, 7));
  g.add(cyl(1.6, 2.4, 10, 0x6d6a8a, 7, 0, 1.2));
  g.add(cyl(2.2, 1.6, 2, 0x5a5780, 7, 0, 11.2));
  g.add(cone(2.5, 6, 0x3a2f7a, 7, 0, 13.2));
  // spiral ledge
  for (let i = 0; i < 14; i++) {
    const a = i * 0.9;
    g.add(box(0.9, 0.2, 0.6, STONE, Math.cos(a) * 2.2, 1.5 + i * 0.7, Math.sin(a) * 2.2));
  }
  windows(g, [[0, 4, 1.95], [0, 8, 1.75], [0, 12, 2.1]], 0.5, 1);
  const crystal = mesh(new THREE.OctahedronGeometry(1.1), new THREE.MeshStandardMaterial({ color: 0x9f8cff, emissive: 0x7b61ff, emissiveIntensity: 1.2, flatShading: true, transparent: true, opacity: 0.9 }), 0, 21.5, 0);
  crystal.name = 'spin';
  crystal.castShadow = false;
  g.add(crystal);
  const light = new THREE.PointLight(0x8f7bff, 30, 30, 1.6);
  light.position.set(0, 21.5, 0);
  light.name = 'glow';
  g.add(light);
  g.add(box(1.2, 2, 0.3, 0x2a2140, 0, 1.2, 2.25));
  return { group: g, labelHeight: 25, footprint: 5 };
}

function gatehouse() {
  const g = new THREE.Group();
  for (const x of [-4, 4]) {
    g.add(cyl(1.8, 2, 8, STONE, 6, x, 0));
    g.add(cone(2.3, 3, ROOF_BLUE, 6, x, 8));
    windows(g, [[x, 5, 1.8]], 0.35, 0.8);
  }
  g.add(box(6.2, 6, 2.6, STONE_DARK, 0, 0));
  g.add(box(2.6, 3.8, 0.3, 0x2b2b2b, 0, 0, 1.3));
  for (let i = -1; i <= 1; i++) g.add(box(0.15, 3.8, 0.4, 0x555555, i * 0.8, 0, 1.4));
  for (let i = -2; i <= 2; i++) g.add(box(0.9, 0.9, 2.8, STONE, i * 1.3, 6));
  g.add(banner(0x37474f, 3, -4, 11, 0));
  g.add(banner(0x37474f, 3, 4, 11, 0));
  return { group: g, labelHeight: 14, footprint: 6 };
}

function market() {
  const g = new THREE.Group();
  const plaza = mesh(new THREE.CylinderGeometry(13.5, 13.5, 0.2, 24), mat(0xb3a58a), 0, 0.1, 0);
  g.add(plaza);
  g.add(cyl(2.2, 2.4, 0.8, STONE, 10));
  g.add(cyl(0.4, 0.5, 2.2, STONE, 8, 0, 0.8));
  g.add(cyl(1.0, 0.4, 0.4, STONE, 8, 0, 3));
  const water = mesh(new THREE.CylinderGeometry(2.0, 2.0, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0x5aa3c8, roughness: 0.1, metalness: 0.3 }), 0, 0.75, 0);
  g.add(water);
  g.add(banner(0xb5562a, 6, 0, 3.2, 0));
  return { group: g, labelHeight: 9, footprint: 14 };
}

function treasury() {
  const g = new THREE.Group();
  g.add(box(8, 0.6, 8, STONE_DARK));
  g.add(box(7, 4, 7, STONE, 0, 0.6));
  const dome = mesh(new THREE.SphereGeometry(3.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(GOLD, { metalness: 0.7, roughness: 0.35 }), 0, 4.6, 0);
  g.add(dome);
  g.add(cyl(0.15, 0.15, 1.5, GOLD, 6, 0, 7.9));
  for (const x of [-2.6, 2.6]) for (const z of [-2.6, 2.6]) g.add(cyl(0.5, 0.5, 5, 0xd6cdbb, 8, x * 1.2, 0, z * 1.2));
  g.add(box(1.6, 2.4, 0.3, 0x4a3415, 0, 0.6, 3.55));
  const pile = new THREE.Group();
  pile.name = 'goldpile';
  pile.position.set(2.6, 0, 4.6);
  g.add(pile);
  return { group: g, labelHeight: 11, footprint: 6 };
}

function oracle() {
  const g = new THREE.Group();
  g.add(cyl(3.2, 3.6, 1, STONE_DARK, 6));
  g.add(cyl(0.9, 1.8, 14, 0xcfc6b8, 6, 0, 1));
  g.add(cyl(2.0, 0.9, 1.5, STONE, 6, 0, 15));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(cone(0.25, 2.5, STONE, 4, Math.cos(a) * 1.8, 16.5, Math.sin(a) * 1.8));
  }
  const orb = mesh(new THREE.SphereGeometry(1.1, 16, 12), new THREE.MeshStandardMaterial({ color: 0x1a1030, emissive: 0xb15cff, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.5 }), 0, 18.3, 0);
  orb.name = 'orb';
  orb.castShadow = false;
  g.add(orb);
  const light = new THREE.PointLight(0xc070ff, 20, 26, 1.6);
  light.position.set(0, 18.3, 0);
  light.name = 'glow';
  g.add(light);
  windows(g, [[0, 6, 1.6], [0, 10, 1.35]], 0.35, 1);
  return { group: g, labelHeight: 22, footprint: 5 };
}

function rookery() {
  const g = new THREE.Group();
  for (const [x, z] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) g.add(cyl(0.25, 0.3, 9, WOOD, 5, x, 0, z));
  g.add(box(4.4, 0.4, 4.4, WOOD, 0, 9));
  g.add(box(3.6, 2.6, 3.6, 0x8a6a46, 0, 9.4));
  g.add(cone(3.4, 2.6, 0x3d3d3d, 4, 0, 12));
  g.children[g.children.length - 1].rotation.y = Math.PI / 4;
  for (const [x, z] of [[0, 1.85], [1.85, 0], [0, -1.85], [-1.85, 0]]) {
    const hole = mesh(new THREE.CircleGeometry(0.35, 8), mat(0x111111), x, 10.6, z);
    hole.lookAt(x * 2, 10.6, z * 2);
    g.add(hole);
  }
  g.add(box(0.8, 9, 0.2, WOOD, 0, 0, 2.3));
  for (let i = 0; i < 8; i++) g.add(box(1.2, 0.15, 0.2, WOOD, 0, i * 1.1 + 0.5, 2.35));
  const birds = new THREE.Group();
  birds.name = 'birds';
  birds.position.y = 15;
  for (let i = 0; i < 3; i++) birds.add(makeBird(0.6));
  g.add(birds);
  return { group: g, labelHeight: 17, footprint: 5 };
}

export function makeBird(scale = 1): THREE.Group {
  const bird = new THREE.Group();
  const body = mesh(new THREE.ConeGeometry(0.18, 0.8, 4), mat(0x151515));
  body.rotation.x = Math.PI / 2;
  bird.add(body);
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.2, 0, 0, 0.25, 0.9, 0, 0], 3));
  wingGeo.computeVertexNormals();
  const wingMat = new THREE.MeshStandardMaterial({ color: 0x151515, side: THREE.DoubleSide, flatShading: true });
  const left = new THREE.Mesh(wingGeo, wingMat);
  const right = new THREE.Mesh(wingGeo, wingMat);
  right.scale.x = -1;
  left.name = 'wingL';
  right.name = 'wingR';
  bird.add(left, right);
  bird.scale.setScalar(scale);
  return bird;
}

const BUILDERS: Record<BuildingId, () => Partial<BuildingView> & { group: THREE.Group }> = {
  council,
  watchtower,
  scriptorium,
  magetower,
  gatehouse,
  market,
  treasury,
  oracle,
  rookery,
};

export function createBuilding(id: BuildingId): BuildingView {
  const built = BUILDERS[id]();
  const group = built.group;
  const pos = LAYOUT[id];
  group.position.set(pos.x, 0, pos.z);
  // face the council (front of each model is +Z)
  if (id !== 'council') group.rotation.y = Math.atan2(-pos.x, -pos.z);
  else group.rotation.y = Math.PI * 0.12;
  group.traverse((o) => (o.userData.buildingId = id));

  const spin = group.getObjectByName('spin');
  const orb = group.getObjectByName('orb');
  const glow = group.getObjectByName('glow') as THREE.PointLight | undefined;
  const smoke = group.getObjectByName('smoke');
  const birds = group.getObjectByName('birds');
  const flutter: THREE.Object3D[] = [];
  group.traverse((o) => o.userData.flutter && flutter.push(o));
  const baseGlow = glow?.intensity ?? 0;
  const spinBaseY = spin?.position.y ?? 0;

  return {
    id,
    group,
    labelHeight: built.labelHeight ?? 10,
    footprint: built.footprint ?? 6,
    animate(time, night) {
      if (spin) {
        spin.rotation.y = time * 0.8;
        spin.position.y = spinBaseY + Math.sin(time * 2) * 0.3;
      }
      if (orb) (orb as THREE.Mesh).scale.setScalar(1 + Math.sin(time * 3) * 0.06);
      if (glow) glow.intensity = baseGlow * (0.6 + night * 0.9) * (0.85 + Math.sin(time * 4) * 0.15);
      if (smoke) {
        smoke.children.forEach((p) => {
          const t = (time * 0.25 + p.userData.phase) % 1;
          p.position.set(Math.sin(t * 6) * 0.4, t * 4, 0);
          p.scale.setScalar(0.6 + t * 1.6);
          ((p as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.5 * (1 - t);
        });
      }
      if (birds) {
        birds.children.forEach((b, i) => {
          const a = time * 0.7 + (i * Math.PI * 2) / 3;
          b.position.set(Math.cos(a) * 5, Math.sin(time * 1.3 + i) * 0.8, Math.sin(a) * 5);
          b.rotation.y = -a;
          const flap = Math.sin(time * 12 + i) * 0.6;
          b.getObjectByName('wingL')!.rotation.z = flap;
          b.getObjectByName('wingR')!.rotation.z = -flap;
        });
      }
      for (const f of flutter) f.rotation.y = Math.sin(time * 2.5 + f.id) * 0.25;
    },
  };
}
