import type { DesignArt } from './types';

/**
 * Renders a design to a canvas. In mock mode this procedurally paints the artwork from its
 * brief (style, palette, text). When a real image model is connected, `art.imageUrl` is used instead.
 */

const THEME_GLYPH: Record<string, string> = {
  mushroom: '🍄', camping: '⛺', books: '📚', moon: '🌙', frog: '🐸', plant: '🪴', mountain: '⛰️',
  leaf: '🌿', ghost: '👻', coffee: '☕', fish: '🐟', axolotl: '🦎', cat: '🐈‍⬛', bee: '🐝', apple: '🍎',
};

const cache = new Map<string, HTMLCanvasElement>();

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function renderDesign(art: DesignArt, theme: string, size = 512): HTMLCanvasElement {
  const key = `${art.seed}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(art.seed);
  const [dark, light, accent, soft] = art.palette;
  // a real scout supplies an emoji directly; mock themes map through the table
  const glyph = THEME_GLYPH[theme] ?? (theme && !/^[\w\s-]+$/.test(theme) ? theme : '✦');
  const c = size / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const drawGlyph = (x: number, y: number, s: number, alpha = 1) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${s}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.fillText(glyph, x, y);
    ctx.restore();
  };

  switch (art.style) {
    case 'badge': {
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.arc(c, c, size * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = light;
      ctx.lineWidth = size * 0.012;
      ctx.beginPath();
      ctx.arc(c, c, size * 0.38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(c, c, size * 0.24, 0, Math.PI * 2);
      ctx.fill();
      drawGlyph(c, c, size * 0.24);
      arcText(ctx, art.text.toUpperCase(), c, c, size * 0.31, light, `bold ${size * 0.06}px Georgia, serif`);
      for (let i = 0; i < 2; i++) {
        ctx.fillStyle = soft;
        star(ctx, c + (i ? 1 : -1) * size * 0.3, c + size * 0.24, size * 0.025);
      }
      break;
    }
    case 'lineart': {
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = dark;
      ctx.lineWidth = size * 0.004;
      ctx.strokeRect(size * 0.08, size * 0.08, size * 0.84, size * 0.84);
      ctx.beginPath();
      let x = size * 0.2;
      let y = size * 0.6;
      ctx.moveTo(x, y);
      for (let i = 0; i < 9; i++) {
        const nx = size * (0.2 + rnd() * 0.6);
        const ny = size * (0.2 + rnd() * 0.45);
        ctx.quadraticCurveTo(x + (nx - x) * rnd() * 2, ny + (rnd() - 0.5) * size * 0.2, nx, ny);
        x = nx;
        y = ny;
      }
      ctx.stroke();
      ctx.filter = 'grayscale(1) contrast(1.3)';
      drawGlyph(c, size * 0.42, size * 0.26, 0.85);
      ctx.filter = 'none';
      ctx.fillStyle = dark;
      ctx.font = `italic ${size * 0.07}px Georgia, serif`;
      ctx.fillText(art.text, c, size * 0.8);
      break;
    }
    case 'retro': {
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, size, size);
      const colors = [accent, soft, dark, accent, soft];
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = colors[i];
        ctx.beginPath();
        ctx.arc(c, size * 0.62, size * (0.38 - i * 0.065), Math.PI, 0);
        ctx.fill();
      }
      ctx.fillStyle = light;
      ctx.fillRect(0, size * 0.62, size, size * 0.38);
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = colors[i];
        ctx.fillRect(size * 0.12, size * (0.64 + i * 0.03), size * 0.76, size * 0.012);
      }
      drawGlyph(c, size * 0.5, size * 0.2);
      ctx.font = `900 ${size * 0.085}px "Trebuchet MS", sans-serif`;
      ctx.fillStyle = dark;
      ctx.fillText(art.text, c + size * 0.006, size * 0.84 + size * 0.006);
      ctx.fillStyle = accent;
      ctx.fillText(art.text, c, size * 0.84);
      break;
    }
    case 'typography': {
      ctx.fillStyle = dark;
      ctx.fillRect(0, 0, size, size);
      const words = art.text.split(' ');
      const lineH = size * 0.7 / Math.max(2, words.length);
      words.forEach((w, i) => {
        ctx.fillStyle = i % 2 ? accent : light;
        ctx.font = `bold ${Math.min(lineH * 0.9, (size * 1.5) / Math.max(3, w.length))}px Georgia, serif`;
        ctx.fillText(w.toUpperCase(), c, size * 0.2 + lineH * (i + 0.5));
      });
      drawGlyph(size * 0.82, size * 0.84, size * 0.11);
      ctx.strokeStyle = soft;
      ctx.lineWidth = size * 0.006;
      ctx.beginPath();
      ctx.moveTo(size * 0.2, size * 0.13);
      ctx.lineTo(size * 0.8, size * 0.13);
      ctx.stroke();
      break;
    }
    case 'celestial': {
      ctx.fillStyle = dark;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 70; i++) {
        ctx.fillStyle = rnd() > 0.7 ? accent : light;
        ctx.globalAlpha = 0.4 + rnd() * 0.6;
        ctx.beginPath();
        ctx.arc(rnd() * size, rnd() * size, rnd() * size * 0.005 + 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 5; i++) {
        const mx = size * (0.22 + i * 0.14);
        ctx.fillStyle = light;
        ctx.beginPath();
        ctx.arc(mx, size * 0.15, size * 0.035, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.arc(mx + size * 0.035 * (1 - i / 2), size * 0.15, size * 0.035, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = accent;
      ctx.lineWidth = size * 0.005;
      ctx.beginPath();
      ctx.arc(c, size * 0.48, size * 0.22, 0, Math.PI * 2);
      ctx.stroke();
      drawGlyph(c, size * 0.48, size * 0.22);
      ctx.fillStyle = light;
      ctx.font = `${size * 0.065}px Georgia, serif`;
      ctx.fillText(art.text.toUpperCase().split('').join(' '), c, size * 0.84);
      break;
    }
    case 'botanical': {
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + rnd() * 0.3;
        const r = size * (0.27 + rnd() * 0.06);
        ctx.save();
        ctx.translate(c + Math.cos(a) * r, size * 0.45 + Math.sin(a) * r);
        ctx.rotate(a + Math.PI / 2);
        ctx.fillStyle = i % 3 === 0 ? accent : i % 3 === 1 ? soft : dark;
        ctx.beginPath();
        ctx.ellipse(0, 0, size * 0.025, size * 0.07, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      drawGlyph(c, size * 0.45, size * 0.24);
      ctx.fillStyle = dark;
      ctx.font = `italic ${size * 0.075}px Georgia, serif`;
      ctx.fillText(art.text, c, size * 0.87);
      break;
    }
  }

  cache.set(key, canvas);
  return canvas;
}

function arcText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, r: number, color: string, font: string) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  const total = Math.min(Math.PI * 1.3, text.length * 0.17);
  const step = text.length > 1 ? total / (text.length - 1) : 0;
  for (let i = 0; i < text.length; i++) {
    const a = -Math.PI / 2 - total / 2 + i * step;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

const urlCache = new Map<string, string>();

export function designDataUrl(art: DesignArt, theme: string, size = 256): string {
  if (art.imageUrl) return art.imageUrl;
  const key = `${art.seed}:${size}`;
  let url = urlCache.get(key);
  if (!url) {
    url = renderDesign(art, theme, size).toDataURL();
    urlCache.set(key, url);
  }
  return url;
}
