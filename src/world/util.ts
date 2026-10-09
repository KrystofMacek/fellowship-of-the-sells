import * as THREE from 'three';

const matCache = new Map<string, THREE.MeshStandardMaterial>();

/** Shared flat-shaded low-poly material. */
export function mat(color: number, opts: { emissive?: number; emissiveIntensity?: number; roughness?: number; metalness?: number } = {}) {
  const key = `${color}:${opts.emissive ?? 0}:${opts.emissiveIntensity ?? 0}:${opts.roughness ?? 0.9}:${opts.metalness ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: opts.roughness ?? 0.9,
      metalness: opts.metalness ?? 0,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
    });
    matCache.set(key, m);
  }
  return m;
}

/** Window glass that lights up at night — the world updates its intensity. */
export const windowMat = new THREE.MeshStandardMaterial({ color: 0x2a2015, emissive: 0xffb347, emissiveIntensity: 0, flatShading: true });

export function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export const box = (w: number, h: number, d: number, color: number | THREE.Material, x = 0, y = 0, z = 0) =>
  mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'number' ? mat(color) : color, x, y + h / 2, z);

export const cyl = (rt: number, rb: number, h: number, color: number | THREE.Material, seg = 8, x = 0, y = 0, z = 0) =>
  mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof color === 'number' ? mat(color) : color, x, y + h / 2, z);

export const cone = (r: number, h: number, color: number | THREE.Material, seg = 8, x = 0, y = 0, z = 0) =>
  mesh(new THREE.ConeGeometry(r, h, seg), typeof color === 'number' ? mat(color) : color, x, y + h / 2, z);

/** A gabled roof (triangular prism) spanning width `w` along X and depth `d` along Z. */
export function gable(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  geo.translate(0, 0, -d / 2);
  return mesh(geo, mat(color), x, y, z);
}

export function banner(color: number, h = 3, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.add(cyl(0.06, 0.06, h, 0x3b2a1a, 5, 0, 0, 0));
  const cloth = mesh(new THREE.PlaneGeometry(0.9, 1.4), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, flatShading: true }), 0.45, h - 0.8, 0);
  cloth.userData.flutter = true;
  g.add(cloth);
  g.position.set(x, y, z);
  return g;
}

/** Deterministic value noise for terrain. */
export function noise2(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const h = (a: number, b: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  return (
    h(xi, zi) * (1 - u) * (1 - v) + h(xi + 1, zi) * u * (1 - v) + h(xi, zi + 1) * (1 - u) * v + h(xi + 1, zi + 1) * u * v
  );
}

export function fbm(x: number, z: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    sum += noise2(x * freq, z * freq) * amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / 1.875;
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => t * t * (3 - 2 * t);
