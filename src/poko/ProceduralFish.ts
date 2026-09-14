/**
 * さかなの板（設計書 §5-1 / §9）
 *
 * ==========================================================================
 * **絵を1枚の板に貼る**（道A。2026-09-14、実機で「魚のクオリティーが
 * 低すぎます」と言われて球と円錐をやめた）。
 *
 * 「ばあ！」（peek-aboo）とまったく同じ理由:
 * **この app のカメラは `(0, 0.3, 7.2)` に固定で、魚は常に横を向いている。**
 * 立体であることを使っていないので、板1枚で足りる。
 * 副作用として三角形が激減する（球と円錐の版から 1/20 以下）。
 *
 * 絵は `FishArt` が canvas に描く。**素材ファイルは要らない**（不変条件7）。
 * `document` が無い環境（単体テスト）では単色の板に落ちる。
 *
 * **大きさは面積でそろえる**（下の `TARGET_AREA` を読むこと）。
 * ==========================================================================
 */

import * as THREE from 'three';

import type { FishConfig } from '../types';
import { createBumpArt, createFishArt } from './FishArt';

/**
 * 見かけの大きさ（幅 × 高さ の平方根。ワールド）。
 *
 * ==========================================================================
 * **高さでそろえたら、細長い魚だけ大きく見えた**（2026-09-14 の実測）。
 * こい（体高 0.50）は幅 0.63、ふぐ（0.95）は 0.42 で **1.5倍**の差になり、
 * 実機で「大きい魚の出現頻度が高い」と言われた。
 * 大きく見えていたのは特別な魚ではなく、**こいそのもの**だった。
 *
 * 面積でそろえると、細長い魚は短く、丸い魚は高くなって**見かけの大きさが
 * そろう**。輪郭の差（細長い／丸い）はそのまま残る。
 * ==========================================================================
 */
const TARGET_AREA = 0.82;

/** 高さの上限（ワールド）。穴（縦半径 0.5）から大きくはみ出さない */
const MAX_H = 0.62;

export interface ProceduralFish {
  readonly group: THREE.Group;
  readonly height: number;
  readonly width: number;
  /** **この x より左を描かない**（ワールド座標）。穴の口に合わせる */
  setClipX(worldX: number): void;
  /** たんこぶの育ち 0..1 */
  setBump(t: number): void;
  dispose(): void;
}

export function createProceduralFish(config: FishConfig): ProceduralFish {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  const art = createFishArt(config);
  // 絵の縦横比から板の形を決める。**絵が無いときは体型から決める**
  const aspect = art ? art.aspect : 1 / Math.max(0.3, config.bodyHeight);
  // 面積をそろえる: w * h = TARGET_AREA^2、w / h = aspect
  let height = Math.sqrt((TARGET_AREA * TARGET_AREA) / aspect);
  let width = height * aspect;
  if (height > MAX_H) {
    width *= MAX_H / height;
    height = MAX_H;
  }

  const geometry = new THREE.PlaneGeometry(width, height);
  // **描かれている範囲だけを板に貼る。** canvas の余白まで貼ると
  // そのぶん魚が小さくなる（2026-09-14 に踏んだ）
  if (art) {
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(
        i,
        art.ink.u0 + uv.getX(i) * (art.ink.u1 - art.ink.u0),
        art.ink.v0 + uv.getY(i) * (art.ink.v1 - art.ink.v0)
      );
    }
    uv.needsUpdate = true;
  }
  const material = art
    ? new THREE.MeshBasicMaterial({
        map: art.texture,
        transparent: true,
        // **`alphaTest` を入れる。** 透明な角が他の板と重なると
        // 描く順番で消えたり出たりする（「ばあ！」で踏んだ）
        alphaTest: 0.35,
        // **光を当てない。** 描いたとおりの色を出すため（道A と同じ理由）。
        // 加算の光を乗せると体色が消える（CLAUDE.md）
        toneMapped: false,
      })
    : new THREE.MeshBasicMaterial({ color: config.color, toneMapped: false });
  const plate = new THREE.Mesh(geometry, material);
  plate.name = 'fish.plate';
  group.add(plate);
  disposables.push(geometry, material);
  if (art) disposables.push(art.texture);

  // たんこぶ。**叩かれるまで見えない**
  const bumpArt = createBumpArt();
  const bumpGeometry = new THREE.PlaneGeometry(height * 0.42, height * 0.42);
  const bumpMaterial = bumpArt
    ? new THREE.MeshBasicMaterial({
        map: bumpArt,
        transparent: true,
        alphaTest: 0.3,
        toneMapped: false,
      })
    : new THREE.MeshBasicMaterial({ color: 0xef6a62, toneMapped: false });
  const bump = new THREE.Mesh(bumpGeometry, bumpMaterial);
  bump.name = 'fish.bump';
  // 頭の上。板より少し手前に置いて、輪郭に隠れないようにする
  bump.position.set(width * 0.18, height * 0.46, 0.01);
  bump.visible = false;
  group.add(bump);
  disposables.push(bumpGeometry, bumpMaterial);
  if (bumpArt) disposables.push(bumpArt);

  // 切り取り面。**材質ごとに持たせる**（three は material 単位で見る）
  const clip = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  material.clippingPlanes = [clip];
  bumpMaterial.clippingPlanes = [clip];

  return {
    group,
    height,
    width,
    setClipX(worldX: number) {
      // 面の向きは +x なので、constant は -x
      clip.constant = -worldX;
    },
    setBump(t: number) {
      bump.visible = t > 0;
      if (t <= 0) return;
      const s = Math.min(1, t * 1.2);
      bump.scale.setScalar(s);
    },
    dispose() {
      // **1つでも漏らすとリークする**（不変条件8）
      for (const item of disposables) item.dispose();
    },
  };
}
