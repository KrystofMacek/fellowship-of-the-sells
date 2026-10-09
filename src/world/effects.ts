import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { LAYOUT, REALM_EXIT } from '../engine/lore';
import { makeBird } from './buildings';
import { heightAt } from './terrain';
import { box, cyl, mat, mesh } from './util';

interface Fx {
  obj: THREE.Object3D;
  age: number;
  life: number;
  step(fx: Fx, t: number, dt: number): void;
  done?(): void;
}

const coinGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 10);
const coinMat = new THREE.MeshStandardMaterial({ color: 0xffc83d, emissive: 0xb07800, emissiveIntensity: 0.6, metalness: 0.8, roughness: 0.3 });

export class Effects {
  readonly root = new THREE.Group();
  private fx: Fx[] = [];

  update(dt: number): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i];
      f.age += dt;
      const t = Math.min(1, f.age / f.life);
      f.step(f, t, dt);
      if (t >= 1) {
        this.root.remove(f.obj);
        if (f.obj instanceof CSS2DObject) f.obj.element.remove();
        f.done?.();
        this.fx.splice(i, 1);
      }
    }
  }

  private add(obj: THREE.Object3D, life: number, step: Fx['step'], done?: () => void): void {
    this.root.add(obj);
    this.fx.push({ obj, age: 0, life, step, done });
  }

  /** Gold coins arc from the market stall to the treasury. */
  coins(from: THREE.Vector3, amount: number, onArrive?: () => void): void {
    const to = new THREE.Vector3(LAYOUT.treasury.x, 5, LAYOUT.treasury.z);
    const n = Math.min(6, 2 + Math.floor(amount / 4));
    for (let i = 0; i < n; i++) {
      const coin = new THREE.Mesh(coinGeo, coinMat);
      const offset = new THREE.Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5);
      const start = from.clone().add(offset);
      const delay = i * 0.08;
      this.add(coin, 1.5 + delay, (f) => {
        const t = Math.max(0, (f.age - delay) / 1.5);
        const p = start.clone().lerp(to, t);
        p.y += Math.sin(t * Math.PI) * 9;
        coin.position.copy(p);
        coin.rotation.x = f.age * 8;
        coin.visible = f.age >= delay;
      }, i === 0 ? onArrive : undefined);
    }
  }

  /** A floating label that rises and fades. */
  text(at: THREE.Vector3, html: string, cls: string, life = 2.2): void {
    const el = document.createElement('div');
    el.className = `float-text ${cls}`;
    el.innerHTML = html;
    const obj = new CSS2DObject(el);
    obj.position.copy(at);
    const y0 = at.y;
    this.add(obj, life, (_f, t) => {
      obj.position.y = y0 + t * 4;
      el.style.opacity = String(1 - t * t);
    });
  }

  /** The print partner's caravan carries an order out of the realm. */
  caravan(): void {
    const g = new THREE.Group();
    g.add(box(1.6, 0.9, 1.0, 0x7a5532, 0, 0.45));
    const cover = mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.6, 8, 1, false, 0, Math.PI), mat(0xeee2c8), 0, 1.35, 0);
    cover.rotation.z = Math.PI / 2;
    g.add(cover);
    for (const x of [-0.55, 0.55]) for (const z of [-0.55, 0.55]) {
      const w = cyl(0.3, 0.3, 0.12, 0x3b2a1a, 8, x, 0.3, z);
      w.rotation.x = Math.PI / 2;
      w.position.y = 0.3;
      g.add(w);
    }
    g.add(box(0.9, 0.9, 0.45, 0x5b4636, 1.6, 0.5, 0));
    g.add(box(0.35, 0.45, 0.3, 0x5b4636, 2.1, 1.1, 0));
    const start = new THREE.Vector3(LAYOUT.market.x + 6, 0, LAYOUT.market.z + 2);
    const end = new THREE.Vector3(REALM_EXIT.x + 10, 0, REALM_EXIT.z + 3);
    const dir = end.clone().sub(start);
    g.rotation.y = Math.atan2(-dir.z, dir.x); // model faces +X
    this.add(g, 9, (_f, t) => {
      const p = start.clone().lerp(end, t);
      p.y = heightAt(p.x, p.z) + Math.abs(Math.sin(t * 80)) * 0.05;
      g.position.copy(p);
      g.scale.setScalar(t > 0.85 ? (1 - t) / 0.15 : Math.min(1, t * 10));
    });
  }

  /** A raven flies in from beyond the mountains to the rookery. */
  raven(onArrive?: () => void): void {
    const bird = makeBird(1.4);
    const a = Math.random() * Math.PI * 2;
    const start = new THREE.Vector3(Math.cos(a) * 160, 45, Math.sin(a) * 160);
    const end = new THREE.Vector3(LAYOUT.rookery.x, 12, LAYOUT.rookery.z);
    bird.lookAt(end);
    this.add(bird, 6, (f, t) => {
      const p = start.clone().lerp(end, t);
      p.y += Math.sin(t * Math.PI) * 10;
      bird.position.copy(p);
      bird.lookAt(end.x, p.y, end.z);
      const flap = Math.sin(f.age * 14) * 0.7;
      bird.getObjectByName('wingL')!.rotation.z = flap;
      bird.getObjectByName('wingR')!.rotation.z = -flap;
    }, onArrive);
  }

  /** An expanding ring of light. */
  ring(at: THREE.Vector3, color: number, size = 6): void {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.copy(at);
    this.add(m, 1.4, (_f, t) => {
      m.scale.setScalar(1 + t * size);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
    });
  }

  /** A pillar of light rising, e.g. for level-ups. */
  beam(at: THREE.Vector3, color: number): void {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.9, 12, 12, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }),
    );
    m.position.copy(at).add(new THREE.Vector3(0, 6, 0));
    this.add(m, 1.8, (_f, t) => {
      m.scale.set(1 - t * 0.6, 0.3 + t, 1 - t * 0.6);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - t);
    });
  }
}
