import * as THREE from 'three';
import { renderDesign } from '../engine/art';
import { LAYOUT } from '../engine/lore';
import type { Realm } from '../engine/realm';
import type { Product, ProductType } from '../engine/types';
import { box, cyl, mat, mesh } from './util';

const CANOPY: Record<ProductType, number> = {
  'T-Shirt': 0xb23a3a,
  Hoodie: 0x3a5bb2,
  Mug: 0xd9a441,
  Poster: 0x3f8f5a,
  'Tote Bag': 0x8a5cc2,
  Sticker: 0xd96c9a,
};

interface Stall {
  productId: string;
  slot: number;
  group: THREE.Group;
  pillar: THREE.Mesh;
  pillarMat: THREE.MeshStandardMaterial;
  pulse: number;
}

/** Ring slots around the fountain. */
const SLOTS: { x: number; z: number; angle: number }[] = (() => {
  const out: { x: number; z: number; angle: number }[] = [];
  const rings = [
    { r: 6.2, n: 8, off: 0 },
    { r: 10.2, n: 14, off: 0.2 },
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.n; i++) {
      const angle = (i / ring.n) * Math.PI * 2 + ring.off;
      out.push({ x: LAYOUT.market.x + Math.cos(angle) * ring.r, z: LAYOUT.market.z + Math.sin(angle) * ring.r, angle });
    }
  }
  return out;
})();

export class MarketLayer {
  readonly root = new THREE.Group();
  private stalls = new Map<string, Stall>();
  selectedId: string | null = null;

  constructor(private realm: Realm) {}

  get pickables(): THREE.Object3D[] {
    return [...this.stalls.values()].map((s) => s.group);
  }

  positionOf(productId: string): THREE.Vector3 {
    const s = this.stalls.get(productId);
    if (s) return s.group.position.clone().add(new THREE.Vector3(0, 2, 0));
    return new THREE.Vector3(LAYOUT.market.x, 3, LAYOUT.market.z);
  }

  sync(): void {
    const live = this.realm.state.products.filter((p) => p.status === 'listed');
    const liveIds = new Set(live.map((p) => p.id));
    for (const [id, s] of this.stalls) {
      if (!liveIds.has(id)) this.remove(id, s);
    }
    const used = new Set([...this.stalls.values()].map((s) => s.slot));
    const waiting = live.filter((p) => !this.stalls.has(p.id)).sort((a, b) => b.sales - a.sales || b.listedAt - a.listedAt);
    for (const p of waiting) {
      let slot = SLOTS.findIndex((_, i) => !used.has(i));
      if (slot < 0) {
        // market is full: replace the weakest stall if this product clearly outsells it
        const weakest = [...this.stalls.values()]
          .map((s) => ({ s, p: live.find((x) => x.id === s.productId)! }))
          .sort((a, b) => a.p.sales - b.p.sales)[0];
        if (!weakest || p.sales <= weakest.p.sales * 2 + 1) continue;
        slot = weakest.s.slot;
        this.remove(weakest.s.productId, weakest.s);
      }
      used.add(slot);
      this.stalls.set(p.id, this.create(p, slot));
    }
    for (const s of this.stalls.values()) {
      const p = live.find((x) => x.id === s.productId);
      if (p) this.updateFame(s, p);
    }
  }

  private remove(id: string, s: Stall): void {
    this.root.remove(s.group);
    this.stalls.delete(id);
  }

  private create(p: Product, slot: number): Stall {
    const spot = SLOTS[slot];
    const g = new THREE.Group();
    g.position.set(spot.x, 0.2, spot.z);
    g.rotation.y = -spot.angle + Math.PI / 2;

    g.add(box(1.8, 0.9, 0.9, 0x7a5532, 0, 0, 0.3));
    for (const x of [-0.85, 0.85]) g.add(cyl(0.06, 0.06, 2.6, 0x5a3d24, 5, x, 0, -0.2));
    const canopy = box(2.1, 0.12, 1.5, mat(CANOPY[p.productType]), 0, 2.5, 0.25);
    canopy.rotation.x = -0.25;
    g.add(canopy);

    const design = this.realm.state.designs.find((d) => d.id === p.designId);
    const quest = this.realm.state.quests.find((q) => q.id === p.questId);
    if (design) {
      const tex = new THREE.CanvasTexture(renderDesign(design.art, quest?.emoji ?? quest?.theme ?? '', 256));
      tex.colorSpace = THREE.SRGBColorSpace;
      const art = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide }));
      art.position.set(0, 1.7, -0.15);
      g.add(art);
      const item = mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), new THREE.MeshStandardMaterial({ map: tex }), 0.35, 1.08, 0.35);
      g.add(item);
    }

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xffd36b, emissive: 0xffb300, emissiveIntensity: 0.9, transparent: true, opacity: 0.35, depthWrite: false });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1, 8, 1, true), pillarMat);
    pillar.position.set(0, 3, 0.2);
    g.add(pillar);

    g.traverse((o) => (o.userData.productId = p.id));
    g.scale.setScalar(0.01);
    this.root.add(g);
    return { productId: p.id, slot, group: g, pillar, pillarMat, pulse: 0 };
  }

  private updateFame(s: Stall, p: Product): void {
    const week = p.dailySales.slice(-7).reduce((a, b) => a + b, 0);
    const h = week ? 0.6 + Math.log2(1 + week) * 1.6 : 0;
    s.pillar.visible = h > 0;
    s.pillar.scale.set(1, Math.max(0.01, h), 1);
    s.pillar.position.y = 2.8 + h / 2;
  }

  pulse(productId: string): void {
    const s = this.stalls.get(productId);
    if (s) s.pulse = 1;
  }

  update(time: number, dt: number): void {
    for (const s of this.stalls.values()) {
      const target = s.productId === this.selectedId ? 1.15 : 1;
      const cur = s.group.scale.x;
      s.group.scale.setScalar(cur + (target + s.pulse * 0.25 - cur) * Math.min(1, dt * 6));
      s.pulse = Math.max(0, s.pulse - dt * 1.5);
      s.pillarMat.opacity = 0.25 + Math.sin(time * 3 + s.slot) * 0.08 + s.pulse * 0.5;
    }
  }
}
