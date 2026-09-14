/**
 * 水の中の背景を canvas で描く（設計書 §8-1）
 *
 * ==========================================================================
 * **のはら（草原）の絵をやめた**（2026-09-14、実機で
 * 「背景が野原で魚とマッチしていない」と言われて）。
 *
 * 「ばあ！」から持ってきた絵は7枚とも陸の場面で、**魚に合うのは うみ だけ**。
 * 2ステージ作るのに、合う絵が1枚しか無い。
 *
 * だから**もう1枚をここで描く**。手続き生成なので素材ファイルが増えず、
 * 不変条件7（素材が1つも無くても動く）もそのまま守れる。
 * 水面の光・光の筋・あぶく・砂底 —— 水の中だと分かるものだけを置く。
 *
 * **画面中央の縦帯（幅の 55%）には主役を置かない**（§8-1）。
 * 穴と魚がそこに乗るので、背景に目を引くものがあると二重に見える。
 * ==========================================================================
 */

import * as THREE from 'three';

/** 絵の大きさ。**縦 1:2**（この奥行きで画面に入る比。§8-1） */
const W = 512;
const H = 1024;

export interface WaterSceneColors {
  /** 水面近く（上）と、底のほう（下） */
  readonly top: string;
  readonly bottom: string;
  /** 砂底 */
  readonly floor: string;
}

/**
 * 水の中の絵を1枚描く。`document` が無ければ null（不変条件7）。
 *
 * `seed` を変えると、あぶくと光の筋の並びだけが変わる。
 * **乱数は独立したシードから引く**（§4-2。three の `generateUUID()` が
 * `Math.random()` を消費するので、共有の乱数だと物を1つ足すだけで絵が変わる）。
 */
export function createWaterSceneTexture(
  colors: WaterSceneColors,
  seed = 0x1a2b3c4d
): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const rng = seededRandom(seed);

  // 水。上が明るく、下へ深くなる
  const water = ctx.createLinearGradient(0, 0, 0, H);
  water.addColorStop(0, colors.top);
  water.addColorStop(0.55, mix(colors.top, colors.bottom, 0.6));
  water.addColorStop(1, colors.bottom);
  ctx.fillStyle = water;
  ctx.fillRect(0, 0, W, H);

  // 水面のゆらぎ（いちばん上）。明るい帯を横に何本か
  for (let i = 0; i < 14; i++) {
    const y = rng() * H * 0.16;
    const h = 3 + rng() * 9;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= W; x += 32) {
      ctx.lineTo(x, y + Math.sin((x / W) * Math.PI * (2 + rng() * 3)) * 6);
    }
    ctx.lineTo(W, y + h);
    for (let x = W; x >= 0; x -= 32) {
      ctx.lineTo(x, y + h + Math.sin((x / W) * Math.PI * 3) * 5);
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(255,255,255,${(0.05 + rng() * 0.1).toFixed(3)})`;
    ctx.fill();
  }

  // 光の筋。**上から斜めに落ちる**。等間隔に並べない
  let x = -W * 0.25;
  while (x < W * 1.1) {
    const w = 26 + rng() * 74;
    const lean = 40 + rng() * 90;
    const g = ctx.createLinearGradient(x, 0, x + lean, H * 0.8);
    g.addColorStop(0, `rgba(255,255,255,${(0.1 + rng() * 0.1).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + w, 0);
    ctx.lineTo(x + w + lean, H * 0.82);
    ctx.lineTo(x + lean, H * 0.82);
    ctx.closePath();
    ctx.fill();
    x += w + 40 + rng() * 110;
  }

  // 砂底。**画面のいちばん下だけ**（穴は地平線より下に置くので、
  // ここが地面の手がかりになる）
  const floorY = H * 0.78;
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(0, floorY + 30);
  for (let px = 0; px <= W; px += 64) {
    ctx.quadraticCurveTo(px + 32, floorY + Math.sin(px * 0.02) * 26 - 10, px + 64, floorY + 10);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  const sand = ctx.createLinearGradient(0, floorY - 20, 0, H);
  sand.addColorStop(0, colors.floor);
  sand.addColorStop(1, mix(colors.floor, '#1d2a33', 0.5));
  ctx.fillStyle = sand;
  ctx.fill();

  // あぶく。**画面中央の縦帯を避ける**（魚と穴がそこに乗る）
  for (let i = 0; i < 46; i++) {
    const bx = rng() * W;
    const inMiddle = bx > W * 0.22 && bx < W * 0.78;
    if (inMiddle && rng() < 0.8) continue;
    const by = rng() * H * 0.9;
    const r = 2 + rng() * 7;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,255,255,${(0.18 + rng() * 0.22).toFixed(3)})`;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** mulberry32。小さくて速く、同じ種からは必ず同じ絵が出る */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (sh: number): number =>
    Math.round((((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t));
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}
