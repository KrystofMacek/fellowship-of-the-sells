import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { renderDesign } from '../engine/art';
import { LAYOUT, ROLES } from '../engine/lore';
import type { Realm } from '../engine/realm';
import type { Agent, BuildingId, Role } from '../engine/types';
import { heightAt } from './terrain';
import { cone, cyl, mat, mesh } from './util';

const ROLE_ICON: Record<Role, string> = {
  scout: '🏹', scribe: '🪶', mage: '✨', warden: '🛡️', merchant: '⚖️', oracle: '🔮', herald: '🐦‍⬛',
};

interface AgentView {
  agent: Agent;
  group: THREE.Group;
  body: THREE.Group;
  carry: THREE.Group;
  carryKey: string;
  label: CSS2DObject;
  labelEl: HTMLDivElement;
  pos: THREE.Vector3;
  heading: number;
}

function buildFigure(role: Role): THREE.Group {
  const g = new THREE.Group();
  const robe = ROLES[role].color;
  const skin = 0xe0b48c;
  g.add(cone(0.5, 1.3, robe, 7));
  g.add(cyl(0.22, 0.3, 0.35, robe, 7, 0, 1.05));
  g.add(mesh(new THREE.IcosahedronGeometry(0.27, 1), mat(skin), 0, 1.62, 0));
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.08, 0.08), mat(0x3b2a1a), 0, 0.85, 0.28));
  switch (role) {
    case 'mage': {
      g.add(cone(0.42, 0.9, 0x2c2f8f, 8, 0, 1.75));
      g.add(cyl(0.55, 0.55, 0.05, 0x2c2f8f, 12, 0, 1.75));
      g.add(cyl(0.04, 0.04, 2.1, 0x5a3d24, 5, 0.5, 0));
      g.add(mesh(new THREE.OctahedronGeometry(0.14), mat(0xa58bff, { emissive: 0x8a6bff, emissiveIntensity: 1.5 }), 0.5, 2.15, 0));
      break;
    }
    case 'scout': {
      g.add(cone(0.34, 0.55, 0x2d4f2a, 7, 0, 1.6));
      const bow = mesh(new THREE.TorusGeometry(0.5, 0.03, 4, 12, Math.PI), mat(0x5a3d24), -0.1, 1.1, -0.32);
      bow.rotation.z = Math.PI / 2;
      g.add(bow);
      break;
    }
    case 'scribe':
      g.add(cyl(0.3, 0.3, 0.14, 0x4a3520, 8, 0, 1.82));
      g.add(cone(0.03, 0.5, 0xf5f0e6, 4, 0.3, 1.0, 0.2));
      break;
    case 'warden':
      g.add(mesh(new THREE.SphereGeometry(0.31, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x9a9aa2, { metalness: 0.6, roughness: 0.4 }), 0, 1.66, 0));
      g.add(cyl(0.035, 0.035, 2.3, 0x5a3d24, 5, 0.48, 0));
      g.add(cone(0.08, 0.3, 0xc0c0c8, 4, 0.48, 2.3));
      g.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.06, 8), mat(0x6b2222), -0.45, 0.9, 0.1).rotateZ(Math.PI / 2));
      break;
    case 'merchant':
      g.add(cyl(0.5, 0.5, 0.05, 0x9a4a22, 10, 0, 1.78));
      g.add(cyl(0.25, 0.28, 0.25, 0x9a4a22, 8, 0, 1.8));
      g.add(mesh(new THREE.IcosahedronGeometry(0.2, 0), mat(0x8a6d3b), 0.4, 0.75, 0.15));
      break;
    case 'oracle':
      g.add(cone(0.36, 0.7, 0x4b1f66, 7, 0, 1.55));
      g.add(cyl(0.04, 0.04, 2.0, 0xd9d0c0, 5, 0.5, 0));
      g.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), mat(0xd8a8ff, { emissive: 0xb15cff, emissiveIntensity: 1.8 }), 0.5, 2.1, 0));
      break;
    case 'herald':
      g.add(cyl(0.28, 0.3, 0.16, 0x1f4d63, 8, 0, 1.8));
      g.add(cone(0.04, 0.6, 0xc23b22, 4, -0.2, 1.9, 0).rotateZ(0.6));
      break;
  }
  g.scale.setScalar(1.25);
  return g;
}

function scrollMesh(color: number): THREE.Group {
  const g = new THREE.Group();
  const roll = mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.75, 8), mat(0xf1e4c4));
  roll.rotation.z = Math.PI / 2;
  g.add(roll);
  const seal = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 8), mat(color, { emissive: color, emissiveIntensity: 0.6 }), 0, 0, 0.14);
  seal.rotation.x = Math.PI / 2;
  g.add(seal);
  return g;
}

export class AgentLayer {
  private views = new Map<string, AgentView>();
  readonly root = new THREE.Group();
  private selectRing: THREE.Mesh;
  selectedId: string | null = null;

  constructor(private realm: Realm, private footprint: (id: BuildingId) => number) {
    this.selectRing = mesh(new THREE.RingGeometry(0.8, 1.05, 24), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    this.selectRing.rotation.x = -Math.PI / 2;
    this.selectRing.visible = false;
    this.root.add(this.selectRing);
  }

  get pickables(): THREE.Object3D[] {
    return [...this.views.values()].map((v) => v.group);
  }

  positionOf(agentId: string): THREE.Vector3 | null {
    return this.views.get(agentId)?.pos ?? null;
  }

  sync(): void {
    const agents = this.realm.state.agents;
    const ids = new Set(agents.map((a) => a.id));
    for (const [id, v] of this.views) {
      if (!ids.has(id)) {
        this.root.remove(v.group);
        v.label.element.remove();
        this.views.delete(id);
      }
    }
    for (const agent of agents) {
      let v = this.views.get(agent.id);
      if (!v) {
        v = this.create(agent);
        this.views.set(agent.id, v);
      }
      v.agent = agent;
    }
  }

  private create(agent: Agent): AgentView {
    const group = new THREE.Group();
    const body = buildFigure(agent.role);
    group.add(body);
    const carry = new THREE.Group();
    carry.position.y = 3.0;
    group.add(carry);
    group.traverse((o) => (o.userData.agentId = agent.id));

    const labelEl = document.createElement('div');
    labelEl.className = 'agent-tag';
    const label = new CSS2DObject(labelEl);
    label.position.y = 3.4;
    group.add(label);

    const pos = this.target(agent);
    group.position.copy(pos);
    this.root.add(group);
    return { agent, group, body, carry, carryKey: '', label, labelEl, pos: pos.clone(), heading: 0 };
  }

  /** Spot in front of a building, facing another building. */
  private door(building: BuildingId, toward: BuildingId, lateral: number): THREE.Vector3 {
    const p = LAYOUT[building];
    const t = LAYOUT[toward === building ? 'council' : toward];
    let dx = t.x - p.x;
    let dz = t.z - p.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const r = this.footprint(building) * (building === 'market' ? 1.05 : 1.15) + 1.5;
    const x = p.x + dx * r - dz * lateral;
    const z = p.z + dz * r + dx * lateral;
    return new THREE.Vector3(x, heightAt(x, z), z);
  }

  private lateralSlot(agent: Agent): number {
    const peers = this.realm.state.agents.filter((a) => a.home === agent.home);
    const i = peers.findIndex((a) => a.id === agent.id);
    return (i - (peers.length - 1) / 2) * 1.6;
  }

  private target(agent: Agent): THREE.Vector3 {
    const lat = this.lateralSlot(agent);
    if (agent.phase === 'idle' || agent.phase === 'working') return this.door(agent.home, 'council', lat);
    const a = this.door(agent.from, agent.to, 0);
    const b = this.door(agent.to, agent.from, lat * 0.5);
    const path = [a];
    if (agent.from !== 'council' && agent.to !== 'council') {
      // route around the council hall along the roads
      const mid = new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
      if (mid.lengthSq() < 1) mid.set(0, 0, 1);
      path.push(mid.normalize().multiplyScalar(12));
    }
    path.push(b);
    return pointAlong(path, agent.progress);
  }

  update(time: number, dt: number): void {
    const k = 1 - Math.exp(-dt * 10);
    for (const v of this.views.values()) {
      const a = v.agent;
      const target = this.target(a);
      const moving = a.phase === 'delivering' || a.phase === 'returning';
      const delta = target.clone().sub(v.pos);
      if (delta.lengthSq() > 0.0004 && moving) v.heading = Math.atan2(delta.x, delta.z);
      if (!moving) {
        const c = LAYOUT[a.home];
        const face = Math.atan2(v.pos.x - c.x, v.pos.z - c.z);
        v.heading = lerpAngle(v.heading, face, k * 0.3);
      }
      v.pos.lerp(target, k);
      v.group.position.copy(v.pos);
      v.group.rotation.y = lerpAngle(v.group.rotation.y, v.heading, k);

      const phaseT = time * 9 + v.group.id;
      if (moving) {
        v.body.position.y = Math.abs(Math.sin(phaseT)) * 0.18;
        v.body.rotation.z = Math.sin(phaseT) * 0.06;
        v.body.rotation.x = 0.08;
      } else if (a.phase === 'working') {
        v.body.position.y = Math.abs(Math.sin(time * 4 + v.group.id)) * 0.08;
        v.body.rotation.x = 0.15 + Math.sin(time * 6 + v.group.id) * 0.12;
        v.body.rotation.z = 0;
      } else if (a.resting) {
        v.body.position.y = 0;
        v.body.rotation.x = 0.35 + Math.sin(time * 1.5 + v.group.id) * 0.04;
        v.body.rotation.z = 0;
      } else {
        v.body.position.y = 0;
        v.body.rotation.x = 0;
        v.body.rotation.z = Math.sin(time * 1.2 + v.group.id) * 0.03;
      }

      this.updateCarry(v);
      v.carry.rotation.y = time * 1.5;
      v.carry.position.y = 3.0 + Math.sin(time * 3 + v.group.id) * 0.12;
      this.updateLabel(v);
    }

    const sel = this.selectedId ? this.views.get(this.selectedId) : undefined;
    this.selectRing.visible = !!sel;
    if (sel) {
      this.selectRing.position.set(sel.pos.x, sel.pos.y + 0.08, sel.pos.z);
      this.selectRing.scale.setScalar(1 + Math.sin(time * 4) * 0.08);
    }
  }

  private updateCarry(v: AgentView): void {
    const a = v.agent;
    const key = a.phase === 'delivering' ? `${a.role}:${a.taskRef}` : '';
    if (key === v.carryKey) return;
    v.carryKey = key;
    v.carry.clear();
    if (!key) return;
    const design = (a.role === 'mage' || a.role === 'warden') && this.realm.state.designs.find((d) => d.id === a.taskRef);
    if (design) {
      const quest = this.realm.state.quests.find((q) => q.id === design.questId);
      const tex = new THREE.CanvasTexture(renderDesign(design.art, quest?.emoji ?? quest?.theme ?? '', 256));
      tex.colorSpace = THREE.SRGBColorSpace;
      const frame = mesh(new THREE.BoxGeometry(1.0, 1.0, 0.08), mat(0x5a3d24));
      const pic = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.86), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
      pic.position.z = 0.05;
      frame.add(pic);
      v.carry.add(frame);
    } else {
      v.carry.add(scrollMesh(ROLES[a.role].color));
    }
  }

  private updateLabel(v: AgentView): void {
    const a = v.agent;
    const working = a.phase === 'working';
    const icon = a.resting ? '💤' : ROLE_ICON[a.role];
    const html = `<span class="icon">${icon}</span>${working ? `<span class="bar"><i style="width:${Math.round(a.progress * 100)}%"></i></span>` : ''}`;
    if (v.labelEl.dataset.html !== html) {
      v.labelEl.dataset.html = html;
      v.labelEl.innerHTML = html;
    }
    v.labelEl.classList.toggle('busy', a.phase !== 'idle' || !!a.resting);
    v.labelEl.classList.toggle('selected', a.id === this.selectedId);
    v.labelEl.title = `${a.name}: ${a.activity}`;
  }
}

function pointAlong(path: THREE.Vector3[], t: number): THREE.Vector3 {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const l = path[i].distanceTo(path[i - 1]);
    lens.push(l);
    total += l;
  }
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const p = path[i].clone().lerp(path[i + 1], lens[i] ? Math.min(1, d / lens[i]) : 1);
      p.y = heightAt(p.x, p.z);
      return p;
    }
    d -= lens[i];
  }
  return path[path.length - 1].clone();
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
