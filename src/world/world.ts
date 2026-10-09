import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { POOLS } from '../engine/costs';
import { BUILDINGS, LAYOUT } from '../engine/lore';
import type { Realm } from '../engine/realm';
import type { BuildingId } from '../engine/types';
import { AgentLayer } from './agents';
import { createBuilding, type BuildingView } from './buildings';
import { Effects } from './effects';
import { ManaLayer } from './mana';
import { MarketLayer } from './market';
import { buildStars, buildTerrain, heightAt } from './terrain';
import { cyl, lerp, windowMat } from './util';

export type Selection =
  | { type: 'building'; id: BuildingId }
  | { type: 'agent'; id: string }
  | { type: 'product'; id: string };

const SKY_DAY = new THREE.Color(0x9cc9f0);
const SKY_DUSK = new THREE.Color(0xf0a36b);
const SKY_NIGHT = new THREE.Color(0x1b2752);

export class World {
  readonly renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private hemi = new THREE.HemisphereLight(0xcfe6ff, 0x3d5226, 0.9);
  private stars = buildStars();
  private buildings = new Map<BuildingId, BuildingView>();
  private buildingLabels = new Map<BuildingId, HTMLDivElement>();
  private agents: AgentLayer;
  private market: MarketLayer;
  private mana: ManaLayer;
  private effects = new Effects();
  private goldPile = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private downAt = { x: 0, y: 0 };
  private focusTween: { from: THREE.Vector3; to: THREE.Vector3; camFrom: THREE.Vector3; camTo: THREE.Vector3; t: number } | null = null;
  private follow: string | null = null;
  private lastLabelUpdate = 0;
  private hovered: string | null = null;
  private keys = new Set<string>();
  selection: Selection | null = null;
  onSelect: (sel: Selection | null) => void = () => {};

  constructor(private container: HTMLElement, private realm: Realm) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'label-layer';
    container.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 900);
    this.camera.position.set(62, 58, 78);
    this.controls = new OrbitControls(this.camera, this.labels.domElement);
    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 18;
    this.controls.maxDistance = 220;
    this.controls.maxPolarAngle = 1.32;
    this.controls.minPolarAngle = 0.25;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('start', () => {
      this.follow = null;
      this.focusTween = null;
    });

    this.scene.fog = new THREE.Fog(SKY_DAY.clone(), 140, 420);
    this.scene.background = SKY_DAY.clone();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -75;
    sc.right = sc.top = 75;
    sc.near = 10;
    sc.far = 400;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.stars);

    buildTerrain(this.scene);
    for (const id of Object.keys(LAYOUT) as BuildingId[]) this.addBuilding(id);

    this.agents = new AgentLayer(realm, (id) => this.buildings.get(id)?.footprint ?? 6);
    this.market = new MarketLayer(realm);
    this.mana = new ManaLayer(realm);
    this.scene.add(this.mana.root);
    this.goldPile.position.set(LAYOUT.treasury.x, 0, LAYOUT.treasury.z);
    this.scene.add(this.agents.root, this.market.root, this.effects.root, this.goldPile);
    this.syncAll();
    this.bindRealmEvents();
    this.bindPointer();
    this.bindKeys();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private addBuilding(id: BuildingId): void {
    const view = createBuilding(id);
    this.buildings.set(id, view);
    this.scene.add(view.group);
    const el = document.createElement('div');
    el.className = 'building-label';
    el.addEventListener('click', () => this.select({ type: 'building', id }));
    const label = new CSS2DObject(el);
    label.position.set(LAYOUT[id].x, view.labelHeight, LAYOUT[id].z);
    this.scene.add(label);
    this.buildingLabels.set(id, el);
  }

  private bindRealmEvents(): void {
    const ev = this.realm.events;
    ev.on('changed', () => {
      this.agents.sync();
      this.market.sync();
    });
    ev.on('sale', ({ productId, amount }) => {
      this.market.pulse(productId);
      const from = this.market.positionOf(productId);
      this.effects.coins(from, amount, () => {
        this.effects.text(new THREE.Vector3(LAYOUT.treasury.x, 9, LAYOUT.treasury.z), `+$${amount.toFixed(2)}`, 'gold');
        this.syncGoldPile();
      });
    });
    ev.on('ship', () => this.effects.caravan());
    ev.on('raven', () =>
      this.effects.raven(() => this.effects.ring(new THREE.Vector3(LAYOUT.rookery.x, 0.3, LAYOUT.rookery.z), 0x7fb8d8)),
    );
    ev.on('approval', () => {
      this.effects.ring(new THREE.Vector3(0, 0.3, 0), 0xffd36b, 8);
    });
    ev.on('listed', ({ productId }) => {
      this.market.sync();
      const p = this.market.positionOf(productId);
      this.effects.ring(p.clone().setY(0.4), 0x9be38b, 3);
      this.effects.text(p.clone().setY(5), '🎪 New stall', 'good');
    });
    ev.on('retired', ({ productId }) => {
      const p = this.market.positionOf(productId);
      this.effects.ring(p.clone().setY(0.4), 0x999999, 3);
      this.market.sync();
    });
    ev.on('mana', ({ pool, amount }) => {
      const info = POOLS[pool];
      this.effects.text(this.mana.anchor(pool), `−${amount} ${info.icon}`, `mana ${pool}`, 1.6);
    });
    ev.on('manaReset', () => {
      for (const pool of Object.keys(POOLS) as (keyof typeof POOLS)[]) {
        const p = LAYOUT[POOLS[pool].building];
        this.effects.ring(new THREE.Vector3(p.x, 0.4, p.z), POOLS[pool].color, 7);
        this.effects.text(this.mana.anchor(pool).setY(12), `${POOLS[pool].icon} ${POOLS[pool].name} restored`, `mana ${pool}`, 2.5);
      }
    });
    ev.on('dispatched', ({ count, patrol }) => {
      const p = LAYOUT.watchtower;
      this.effects.ring(new THREE.Vector3(p.x, 0.4, p.z), 0x7fd17c, 8);
      this.effects.text(new THREE.Vector3(p.x, 21, p.z), `📯 ${count} scout${count > 1 ? 's' : ''} ${patrol ? 'on patrol' : 'sent'}`, 'good', 2.6);
    });
    ev.on('exhausted', ({ pool }) => {
      const p = LAYOUT[POOLS[pool].building];
      this.effects.ring(new THREE.Vector3(p.x, 0.4, p.z), 0x555566, 5);
    });
  }

  private syncAll(): void {
    this.agents.sync();
    this.market.sync();
    this.syncGoldPile();
  }

  private syncGoldPile(): void {
    const stacks = Math.max(0, Math.min(24, Math.floor(this.realm.net / 25)));
    if (this.goldPile.children.length === stacks) return;
    this.goldPile.clear();
    for (let i = 0; i < stacks; i++) {
      const a = i * 2.4;
      const r = 4.8 + (i % 3) * 0.6;
      const h = 0.3 + ((i * 7) % 5) * 0.15;
      this.goldPile.add(cyl(0.35, 0.35, h, 0xffc83d, 10, Math.cos(a) * r, 0, Math.sin(a) * r));
    }
  }

  // ───────────────────────────── selection & camera ─────────────────────────────

  select(sel: Selection | null, focus = true): void {
    this.selection = sel;
    this.agents.selectedId = sel?.type === 'agent' ? sel.id : null;
    this.market.selectedId = sel?.type === 'product' ? sel.id : null;
    for (const [id, el] of this.buildingLabels) el.classList.toggle('selected', sel?.type === 'building' && sel.id === id);
    this.follow = sel?.type === 'agent' ? sel.id : null;
    if (sel && focus) this.focusOn(this.positionOf(sel), sel.type === 'building' ? 55 : 32);
    this.onSelect(sel);
  }

  private positionOf(sel: Selection): THREE.Vector3 {
    if (sel.type === 'building') return new THREE.Vector3(LAYOUT[sel.id].x, 2, LAYOUT[sel.id].z);
    if (sel.type === 'agent') return this.agents.positionOf(sel.id)?.clone() ?? new THREE.Vector3();
    return this.market.positionOf(sel.id);
  }

  focusOn(target: THREE.Vector3, distance: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(distance);
    this.focusTween = {
      from: this.controls.target.clone(),
      to: target.clone(),
      camFrom: this.camera.position.clone(),
      camTo: target.clone().add(offset),
      t: 0,
    };
  }

  private pick(e: PointerEvent): Selection | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [...this.agents.pickables, ...this.market.pickables, ...[...this.buildings.values()].map((b) => b.group)];
    const hit = this.raycaster.intersectObjects(targets, true)[0];
    if (!hit) return null;
    const d = hit.object.userData;
    if (d.agentId) return { type: 'agent', id: d.agentId };
    if (d.productId) return { type: 'product', id: d.productId };
    if (d.buildingId) return { type: 'building', id: d.buildingId };
    return null;
  }

  private bindPointer(): void {
    const el = this.labels.domElement;
    el.addEventListener('pointerdown', (e) => (this.downAt = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 5) return;
      if ((e.target as HTMLElement).closest('.building-label')) return;
      this.select(this.pick(e));
    });
    let last = 0;
    el.addEventListener('pointermove', (e) => {
      const now = performance.now();
      if (now - last < 60 || e.buttons) return;
      last = now;
      const sel = this.pick(e);
      const key = sel ? `${sel.type}:${sel.id}` : null;
      if (key === this.hovered) return;
      this.hovered = key;
      el.style.cursor = sel ? 'pointer' : 'grab';
      for (const [id, lbl] of this.buildingLabels) lbl.classList.toggle('hover', sel?.type === 'building' && sel.id === id);
    });
  }

  /** WASD / arrows move, Q/E rotate, R/F zoom, Shift = faster. */
  private bindKeys(): void {
    const tracked = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
    addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest('textarea, input') || e.metaKey || e.ctrlKey) return;
      if (!tracked.has(e.code)) return;
      if (e.code.startsWith('Arrow')) e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  private moveCamera(dt: number): void {
    const k = this.keys;
    if (!k.size) return;
    const has = (...codes: string[]) => codes.some((c) => k.has(c));
    const fwd = (has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0);
    const side = (has('KeyD', 'ArrowRight') ? 1 : 0) - (has('KeyA', 'ArrowLeft') ? 1 : 0);
    const turn = (has('KeyE') ? 1 : 0) - (has('KeyQ') ? 1 : 0);
    const zoom = (has('KeyF') ? 1 : 0) - (has('KeyR') ? 1 : 0);
    if (!fwd && !side && !turn && !zoom) return;
    this.follow = null;
    this.focusTween = null;

    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    const dist = offset.length();
    const boost = has('ShiftLeft', 'ShiftRight') ? 2.5 : 1;

    if (fwd || side) {
      const forward = new THREE.Vector3(-offset.x, 0, -offset.z).normalize();
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const step = forward.multiplyScalar(fwd).add(right.multiplyScalar(side)).normalize().multiplyScalar(dist * 0.9 * boost * dt);
      target.add(step);
      this.camera.position.add(step);
    }
    if (turn) {
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), -turn * 1.6 * dt * boost);
      this.camera.position.copy(target).add(offset);
    }
    if (zoom) {
      const next = THREE.MathUtils.clamp(dist * (1 + zoom * 1.4 * dt * boost), this.controls.minDistance, this.controls.maxDistance);
      offset.setLength(next);
      this.camera.position.copy(target).add(offset);
    }
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
  }

  // ───────────────────────────── frame ─────────────────────────────

  update(dt: number, time: number): void {
    const night = this.updateSky();
    windowMat.emissiveIntensity = night * 1.6;
    for (const b of this.buildings.values()) b.animate(time, night);
    this.agents.update(time, dt);
    this.market.update(time, dt);
    this.mana.update(time);
    const crystal = this.buildings.get('magetower')?.group.getObjectByName('spin') as THREE.Mesh | undefined;
    if (crystal) (crystal.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.15 + this.mana.fraction('arcana') * 1.1;
    this.effects.update(dt);
    const water = this.scene.getObjectByName('water');
    if (water) water.position.y = -0.6 + Math.sin(time * 0.8) * 0.05;

    if (this.focusTween) {
      const f = this.focusTween;
      f.t = Math.min(1, f.t + dt / 0.9);
      const e = 1 - Math.pow(1 - f.t, 3);
      this.controls.target.lerpVectors(f.from, f.to, e);
      this.camera.position.lerpVectors(f.camFrom, f.camTo, e);
      if (f.t >= 1) this.focusTween = null;
    } else if (this.follow) {
      const p = this.agents.positionOf(this.follow);
      if (p) {
        const delta = p.clone().sub(this.controls.target);
        delta.y = 0;
        this.controls.target.add(delta.multiplyScalar(Math.min(1, dt * 3)));
        this.camera.position.add(delta);
      }
    }
    this.moveCamera(dt);
    // keep the camera over the realm and above the hills
    const t = this.controls.target;
    const r = Math.hypot(t.x, t.z);
    if (r > 150) {
      const k = 150 / r;
      const dx = t.x * (1 - k);
      const dz = t.z * (1 - k);
      t.x -= dx;
      t.z -= dz;
      this.camera.position.x -= dx;
      this.camera.position.z -= dz;
    }
    const ground = heightAt(t.x, t.z);
    t.y += (Math.max(0, ground) - t.y) * Math.min(1, dt * 4);
    const camGround = heightAt(this.camera.position.x, this.camera.position.z) + 4;
    if (this.camera.position.y < camGround) this.camera.position.y = camGround;
    this.controls.update();

    if (time - this.lastLabelUpdate > 0.3) {
      this.lastLabelUpdate = time;
      this.updateBuildingLabels();
    }
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  /** Day/night cycle. Returns 0 (day) … 1 (night). */
  private updateSky(): number {
    const hour = this.realm.hourOfDay;
    const a = ((hour - 6) / 24) * Math.PI * 2;
    const elev = Math.sin(a);
    const day = THREE.MathUtils.clamp(elev * 3 + 0.35, 0, 1);
    const dusk = THREE.MathUtils.clamp(1 - Math.abs(elev) * 4, 0, 1);
    const sky = SKY_NIGHT.clone().lerp(SKY_DAY, day).lerp(SKY_DUSK, dusk * 0.55);
    (this.scene.background as THREE.Color).copy(sky);
    this.scene.fog!.color.copy(sky);

    const isDay = elev > -0.05;
    const dir = isDay ? new THREE.Vector3(Math.cos(a) * 120, Math.max(elev, 0.08) * 140, 50) : new THREE.Vector3(-Math.cos(a) * 120, Math.max(-elev, 0.15) * 140, -40);
    this.sun.position.copy(dir);
    this.sun.color.setHex(isDay ? 0xffffff : 0x9fb4ff).lerp(new THREE.Color(0xffb27a), isDay ? dusk * 0.6 : 0);
    this.sun.intensity = isDay ? lerp(0.9, 2.4, day) : 1.0;
    this.hemi.intensity = lerp(0.9, 1.0, day);
    this.hemi.color.copy(new THREE.Color(0x8394d6).lerp(new THREE.Color(0xcfe6ff), day));
    (this.stars.material as THREE.PointsMaterial).opacity = 1 - day;
    return 1 - day;
  }

  private updateBuildingLabels(): void {
    const s = this.realm.state;
    const count = (n: number) => (n ? `<b class="badge">${n}</b>` : '');
    const mana = (pool: 'ink' | 'arcana') => {
      const left = this.realm.manaAvailable(pool);
      return `<b class="badge ${pool}">${POOLS[pool].icon} ${Number.isFinite(left) ? Math.floor(left) : '∞'}</b>`;
    };
    const scouting = s.scout.pending + s.agents.filter((a) => a.role === 'scout' && a.phase !== 'idle').length;
    const net = this.realm.net;
    const badges: Record<BuildingId, string> = {
      council: s.approvals.length ? `<b class="badge decree">${s.approvals.length}</b>` : '',
      watchtower: `${scouting ? `<b class="badge scouting">🏹 ${scouting} out</b>` : ''}${s.scout.patrol.enabled ? '<b class="badge">📯</b>' : ''}`,
      scriptorium: `${count(s.briefOrders.length)}${mana('ink')}`,
      magetower: `${count(s.briefs.filter((b) => b.status === 'queued').length)}${mana('arcana')}`,
      gatehouse: count(s.designs.filter((d) => d.status === 'queued-inspection').length),
      market: count(s.products.filter((p) => p.status === 'listed').length),
      treasury: `<b class="badge ${net < 0 ? 'neg' : 'gold'}">${net < 0 ? '−' : ''}$${Math.abs(net).toFixed(2)}</b>`,
      oracle: '',
      rookery: count(s.ravens.filter((r) => r.status === 'arrived').length),
    };
    for (const [id, el] of this.buildingLabels) {
      const html = `<span>${BUILDINGS[id].name}</span>${badges[id]}`;
      if (el.dataset.html !== html) {
        el.dataset.html = html;
        el.innerHTML = html;
      }
    }
  }
}
