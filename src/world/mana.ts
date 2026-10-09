import * as THREE from 'three';
import { POOLS, type ManaPool } from '../engine/costs';
import { LAYOUT } from '../engine/lore';
import type { Realm } from '../engine/realm';

const SHARDS = 10;

interface Ring {
  pool: ManaPool;
  group: THREE.Group;
  shards: THREE.Mesh[];
  lit: THREE.MeshStandardMaterial;
  dim: THREE.MeshStandardMaterial;
}

/** Floating crystal rings showing how much of each daily AI budget remains. */
export class ManaLayer {
  readonly root = new THREE.Group();
  private rings: Ring[] = [];

  constructor(private realm: Realm) {
    const geo = new THREE.OctahedronGeometry(0.45);
    geo.scale(0.7, 1.4, 0.7);
    for (const pool of Object.keys(POOLS) as ManaPool[]) {
      const info = POOLS[pool];
      const lit = new THREE.MeshStandardMaterial({ color: info.color, emissive: info.color, emissiveIntensity: 1.4, flatShading: true });
      const dim = new THREE.MeshStandardMaterial({ color: 0x3a3a44, emissive: 0x000000, flatShading: true, transparent: true, opacity: 0.55 });
      const group = new THREE.Group();
      const p = LAYOUT[info.building];
      group.position.set(p.x, 0, p.z);
      const shards: THREE.Mesh[] = [];
      for (let i = 0; i < SHARDS; i++) {
        const m = new THREE.Mesh(geo, lit);
        m.userData.buildingId = info.building;
        shards.push(m);
        group.add(m);
      }
      this.root.add(group);
      this.rings.push({ pool, group, shards, lit, dim });
    }
  }

  /** world position above a pool's building, for floating text */
  anchor(pool: ManaPool): THREE.Vector3 {
    const p = LAYOUT[POOLS[pool].building];
    return new THREE.Vector3(p.x, 9, p.z);
  }

  /** 0..1 fraction of the pool left today */
  fraction(pool: ManaPool): number {
    const cap = this.realm.manaCap(pool);
    if (!Number.isFinite(cap)) return 1; // unlimited
    return cap ? this.realm.manaAvailable(pool) / cap : 0;
  }

  update(time: number): void {
    for (const r of this.rings) {
      const frac = this.fraction(r.pool);
      const litCount = Math.ceil(frac * SHARDS - 1e-6);
      r.lit.emissiveIntensity = 1.1 + Math.sin(time * 3) * 0.3;
      r.shards.forEach((m, i) => {
        const a = (i / SHARDS) * Math.PI * 2 + time * 0.35;
        const on = i < litCount;
        m.material = on ? r.lit : r.dim;
        m.position.set(Math.cos(a) * 7.5, (on ? 5.5 : 3.2) + Math.sin(time * 2 + i) * 0.25, Math.sin(a) * 7.5);
        m.rotation.y = time * 1.5 + i;
      });
    }
  }
}
