/**
 * さかなの絵を canvas に描く（設計書 §5-1 / §9）
 *
 * ==========================================================================
 * **球と円錐を並べるのをやめた**（2026-09-14、実機で「魚のクオリティーが
 * 低すぎます」と言われて）。
 *
 * 「ばあ！」（peek-aboo）で通った道と同じ結論になった:
 * **この app のカメラは固定で、魚は常に横を向いている。**
 * 立体である必要がどこにも無いので、**1枚の板に絵を貼る**（道A）。
 * 手続き生成の立体は、球の継ぎ目・円錐の角・のっぺりした陰影が必ず残る。
 * canvas なら**曲線とグラデーションで描ける**ので、絵本の魚に近づく。
 *
 * **`document` が無い環境（単体テスト）では null を返す。**
 * 呼び出し側は単色の板に落ちる（不変条件7。例外を投げない）。
 * ==========================================================================
 */

import * as THREE from 'three';

import type { FishConfig } from '../types';

/** 絵の大きさ。**横長**（魚は横を向いている） */
const W = 384;
const H = 240;

/** 体の前後（鼻先と尾のつけ根）。余白を残して切れないようにする */
const NOSE_X = W * 0.9;
const JOINT_X = W * 0.3;
const MID_Y = H * 0.5;

export interface FishArt {
  texture: THREE.CanvasTexture;
  /**
   * **実際に描かれている範囲**（0..1 の uv）。
   *
   * ==========================================================================
   * **板の大きさを canvas の大きさから決めてはいけない**（2026-09-14 に踏んだ）。
   * 絵のまわりには透明な余白があるので、板いっぱいに貼ると
   * **魚だけが小さく**なる。実機で「小さすぎる」と見て気づいた。
   *
   * 「ばあ！」の「体の底は、作り手ではなく生成側で y=0 に揃える」と同じで、
   * **描き終わったあとに測って機械的に合わせる。**
   * ==========================================================================
   */
  ink: { u0: number; v0: number; u1: number; v1: number };
  /** 描かれている範囲の縦横比（板の形に使う） */
  aspect: number;
}

/**
 * 1匹ぶんの絵を描く。**`FishConfig` だけを読む。**
 *
 * `switch (cfg.id)` を書かないこと ——「ばあ！」で動物が17体になった時点で
 * 分岐が3箇所に散り、新しい動物を足すと1箇所だけ入れ忘れる形になった。
 */
export function createFishArt(config: FishConfig): FishArt | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const body = '#' + config.color.toString(16).padStart(6, '0');
  const accent = '#' + config.accent.toString(16).padStart(6, '0');
  // 輪郭は体色を暗くした色。**黒で縁取らない**（絵本の魚は黒縁を持たない）
  const line = shade(body, -0.45);
  const belly = shade(body, 0.42);

  // 体の厚み（上下の張り出し）。`bodyHeight` がそのまま輪郭になる
  const half = H * 0.46 * clamp(config.bodyHeight, 0.3, 1);

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  drawTail(ctx, config, half, body, line);
  drawFins(ctx, config, half, accent, line);
  drawBody(ctx, half, body, belly, line);
  drawPattern(ctx, config, half, accent);
  drawFace(ctx, half, line);

  const ink = measureInk(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const inkW = (ink.u1 - ink.u0) * W;
  const inkH = (ink.v1 - ink.v0) * H;
  return { texture, ink, aspect: inkW / Math.max(1, inkH) };
}

/** 胴。**輪郭は1本の閉じた曲線**（球を並べると継ぎ目が出る） */
function drawBody(
  ctx: CanvasRenderingContext2D,
  half: number,
  body: string,
  belly: string,
  line: string
): void {
  ctx.beginPath();
  ctx.moveTo(NOSE_X, MID_Y);
  // 背中。鼻先から背の高いところを通って尾のつけ根へ
  ctx.bezierCurveTo(NOSE_X - 40, MID_Y - half, JOINT_X + 90, MID_Y - half, JOINT_X, MID_Y - half * 0.42);
  // 腹。尾のつけ根から鼻先へ戻る
  ctx.bezierCurveTo(JOINT_X + 90, MID_Y + half, NOSE_X - 40, MID_Y + half, NOSE_X, MID_Y);
  ctx.closePath();

  // 背は濃く、腹は淡く。**上下の勾配を付ける** ——
  // 「ばあ！」で「平らな面は光を足しても明るさが一様のまま」と実測した
  const g = ctx.createLinearGradient(0, MID_Y - half, 0, MID_Y + half);
  g.addColorStop(0, shade(body, -0.18));
  g.addColorStop(0.55, body);
  g.addColorStop(1, belly);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = 7;
  ctx.stroke();
}

/** 尾。**形ごとに変える**（`TAILS` ではなく描き分け） */
function drawTail(
  ctx: CanvasRenderingContext2D,
  config: FishConfig,
  half: number,
  body: string,
  line: string
): void {
  // **canvas の外へ出さない。** はみ出すと尾が切れる（実機の絵で確認した）
  const reach = config.tail === 'fan' ? 92 : config.tail === 'long' ? 104 : 76;
  const tip = Math.max(28, JOINT_X - reach);
  const spread = half * (config.tail === 'fan' ? 1.3 : config.tail === 'round' ? 0.8 : 1.05);
  ctx.beginPath();
  ctx.moveTo(JOINT_X + 10, MID_Y);
  if (config.tail === 'fork') {
    // 二股。真ん中がくびれる
    ctx.lineTo(tip, MID_Y - spread);
    ctx.quadraticCurveTo(JOINT_X + 40, MID_Y, tip, MID_Y + spread);
  } else if (config.tail === 'round') {
    // 丸い尾
    ctx.quadraticCurveTo(tip, MID_Y - spread, tip - 10, MID_Y);
    ctx.quadraticCurveTo(tip, MID_Y + spread, JOINT_X + 10, MID_Y);
  } else {
    // ひらひら（金魚）／細長い
    ctx.quadraticCurveTo(tip + 30, MID_Y - spread * 1.15, tip, MID_Y - spread * 0.35);
    ctx.quadraticCurveTo(tip - 26, MID_Y, tip, MID_Y + spread * 0.35);
    ctx.quadraticCurveTo(tip + 30, MID_Y + spread * 1.15, JOINT_X + 10, MID_Y);
  }
  ctx.closePath();
  ctx.fillStyle = shade(body, -0.1);
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = 6;
  ctx.stroke();
}

/** 背びれと胸びれ */
function drawFins(
  ctx: CanvasRenderingContext2D,
  config: FishConfig,
  half: number,
  accent: string,
  line: string
): void {
  const size = config.fins === 'flowing' ? 1 : config.fins === 'wide' ? 0.72 : 0.44;

  // 背びれ。**背中の中ほどに置く**（2026-09-14 に踏んだ）。
  // 頭寄りに置いていたら、淡い色の魚では**帽子をかぶっているように見えた**
  ctx.beginPath();
  ctx.moveTo(JOINT_X + 30, MID_Y - half * 0.72);
  ctx.quadraticCurveTo(
    JOINT_X + 80,
    MID_Y - half * (0.9 + size * 0.85),
    JOINT_X + 140,
    MID_Y - half * 0.82
  );
  ctx.closePath();
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = 5;
  ctx.stroke();

  // 胸びれ（体の手前側）
  ctx.beginPath();
  ctx.moveTo(NOSE_X - 110, MID_Y + half * 0.1);
  ctx.quadraticCurveTo(NOSE_X - 150, MID_Y + half * (0.55 + size * 0.6), NOSE_X - 60, MID_Y + half * 0.5);
  ctx.closePath();
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.stroke();
}

/** 模様。**体の中だけに描く**（はみ出すと輪郭が壊れる） */
function drawPattern(
  ctx: CanvasRenderingContext2D,
  config: FishConfig,
  half: number,
  accent: string
): void {
  if (config.pattern === 'plain') return;
  ctx.save();
  // 体の形で切り抜く
  ctx.beginPath();
  ctx.moveTo(NOSE_X, MID_Y);
  ctx.bezierCurveTo(NOSE_X - 40, MID_Y - half, JOINT_X + 90, MID_Y - half, JOINT_X, MID_Y - half * 0.42);
  ctx.bezierCurveTo(JOINT_X + 90, MID_Y + half, NOSE_X - 40, MID_Y + half, NOSE_X, MID_Y);
  ctx.closePath();
  ctx.clip();

  ctx.fillStyle = accent;
  if (config.pattern === 'band' || config.pattern === 'stripe') {
    const wide = config.pattern === 'band';
    const count = wide ? 3 : 5;
    for (let i = 0; i < count; i++) {
      const x = JOINT_X + 40 + ((NOSE_X - JOINT_X - 60) * (i + 0.5)) / count;
      // **帯の幅は左右の辺の差で決まる**（2026-09-14 に踏んだ）。
      // 曲げるための制御点を幅に足していたので、帯 1本が 3.5倍の太さになり、
      // **3本で体が塗り潰されていた**（くまのみが白い魚に見えた）。
      const w = wide ? 24 : 9;
      const bulge = w * 0.9;
      ctx.beginPath();
      ctx.moveTo(x - w, MID_Y - half);
      ctx.quadraticCurveTo(x - w + bulge, MID_Y, x - w, MID_Y + half);
      ctx.lineTo(x + w, MID_Y + half);
      ctx.quadraticCurveTo(x + w + bulge, MID_Y, x + w, MID_Y - half);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    // 斑点。**等間隔に置かない**（等間隔だと機械で打ったように見える）
    const spots: [number, number, number][] = [
      [0.32, -0.42, 20],
      [0.5, 0.18, 15],
      [0.66, -0.2, 18],
      [0.44, -0.05, 11],
      [0.74, 0.34, 13],
      [0.58, 0.5, 10],
    ];
    for (const [t, v, r] of spots) {
      ctx.beginPath();
      ctx.ellipse(JOINT_X + (NOSE_X - JOINT_X) * t, MID_Y + half * v, r, r * 0.86, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** 目と口。**目で表情が決まる**ので大きく取る */
function drawFace(ctx: CanvasRenderingContext2D, half: number, line: string): void {
  const ex = NOSE_X - 62;
  const ey = MID_Y - half * 0.28;
  const r = Math.max(16, half * 0.3);

  ctx.beginPath();
  ctx.arc(ex, ey, r, 0, Math.PI * 2);
  ctx.fillStyle = '#fffdf6';
  ctx.fill();
  ctx.strokeStyle = line;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(ex + r * 0.2, ey + r * 0.08, r * 0.52, 0, Math.PI * 2);
  ctx.fillStyle = '#241f1c';
  ctx.fill();

  // 光。これがあると生きている目になる
  ctx.beginPath();
  ctx.arc(ex + r * 0.02, ey - r * 0.3, r * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // 口。**にっこりさせる**（叩く相手が怖い顔だと、叩くのが嫌なことになる）
  ctx.beginPath();
  ctx.moveTo(NOSE_X - 12, MID_Y + half * 0.16);
  ctx.quadraticCurveTo(NOSE_X - 30, MID_Y + half * 0.36, NOSE_X - 46, MID_Y + half * 0.14);
  ctx.strokeStyle = line;
  ctx.lineWidth = 5;
  ctx.stroke();
}

/** たんこぶの絵。叩かれた印（§4-4） */
export function createBumpArt(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const cx = size / 2;
  ctx.beginPath();
  ctx.ellipse(cx, size * 0.62, size * 0.3, size * 0.34, 0, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(cx - 8, size * 0.48, 4, cx, size * 0.62, size * 0.36);
  g.addColorStop(0, '#ffc9c4');
  g.addColorStop(1, '#ef6a62');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = '#b03a34';
  ctx.lineWidth = 7;
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 色を明るく（+）／暗く（−）する。`amount` は -1..1 */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number): number =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}


/**
 * 描かれている範囲（不透明な画素の外接箱）を 0..1 の uv で返す。
 *
 * **1画素でも不透明なら数える。** 見えているものを見逃す側には倒さない
 * （「ばあ！」の `CUTOUT_MASKS` と同じ考え）。
 */
function measureInk(ctx: CanvasRenderingContext2D): {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
} {
  const data = ctx.getImageData(0, 0, W, H).data;
  let x0 = W;
  let y0 = H;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] < 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  // 何も描けていなければ全面（例外を投げない。不変条件7）
  if (x1 <= x0 || y1 <= y0) return { u0: 0, v0: 0, u1: 1, v1: 1 };
  // 1画素ぶん外に余裕を取る（縁の線が切れないように）
  const pad = 2;
  return {
    u0: Math.max(0, x0 - pad) / W,
    // canvas の y は上が 0、uv の v は下が 0
    v0: 1 - Math.min(H, y1 + pad) / H,
    u1: Math.min(W, x1 + pad) / W,
    v1: 1 - Math.max(0, y0 - pad) / H,
  };
}
