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
import { SPECIAL } from '../data/special';
import { createBumpArt, createFishArt } from './FishArt';
import { buildModelFish } from './ModelFish';

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
  /**
   * きんいろにする／戻す（§6-2）。
   *
   * ==========================================================================
   * **色を「掛ける」だけでは金にならない**（2026-09-16、絵で確認した）。
   *
   * 材質の `color` はテクスチャや頂点カラーに**掛け算**で効くので、
   * 赤い金魚に金を掛けても橙のままだし、青いハギに掛けると暗い緑になる。
   * CLAUDE.md の「白の上に白を重ねても何も変わらない」と同じ話。
   *
   * **体の絵と頂点カラーごと外して、まっさらな金に置き換える。**
   * 輪郭は残るので「金色になった魚」に見える。
   * ==========================================================================
   */
  setGold(on: boolean): void;
  /** たんこぶの育ち 0..1 */
  setBump(t: number): void;
  dispose(): void;
}

/**
 * 魚を1匹作る。
 *
 * **モデル（`.glb`）があればそれを使い、無ければ canvas の絵に落ちる**
 * （不変条件7）。`model` は `AssetLoader.loadModel()` が返したもの。
 */
export function createProceduralFish(
  config: FishConfig,
  model: THREE.Object3D | null = null,
  skin: THREE.Texture | null = null
): ProceduralFish {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  // ======================================================================
  // **モデルがあればそれを使う**（2026-09-14、人間の指示で
  // 「みずのなか」の 3D 魚をそのまま使うことにした）。
  // 無ければ canvas の絵（道A）に落ちる —— **どちらでも遊びは同じ**。
  // ======================================================================
  // **モデルから形が取れなければ null が返る**（Mesh が1つも無い .glb）。
  // そのときは何もしなかったことにして canvas の絵へ落ちる（不変条件7）
  const built = model ? buildModelFish(model, config, skin) : null;
  if (built) {
    group.add(built.group);
    disposables.push(built);
    const clip3d = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    for (const material of built.materials) material.clippingPlanes = [clip3d];

    const bumpArt3d = createBumpArt();
    const bumpGeo3d = new THREE.PlaneGeometry(built.height * 0.42, built.height * 0.42);
    const bumpMat3d = new THREE.MeshBasicMaterial({
      ...(bumpArt3d ? { map: bumpArt3d } : { color: 0xef6a62 }),
      transparent: true,
      alphaTest: 0.3,
      toneMapped: false,
    });
    bumpMat3d.clippingPlanes = [clip3d];
    const bump3d = new THREE.Mesh(bumpGeo3d, bumpMat3d);
    bump3d.name = 'fish.bump';
    bump3d.position.set(built.width * 0.14, built.height * 0.5, built.width * 0.25);
    bump3d.visible = false;
    group.add(bump3d);
    disposables.push(bumpGeo3d, bumpMat3d);
    if (bumpArt3d) disposables.push(bumpArt3d);

    return {
      group,
      height: built.height,
      width: built.width,
      setClipX(worldX: number) {
        clip3d.constant = -worldX;
      },
      setGold(on: boolean) {
        for (const material of built.materials) {
          const m = material as THREE.MeshStandardMaterial;
          if (on) {
            // **体の絵と頂点カラーを外す。** 残すと掛け算になって金にならない
            m.map = null;
            m.vertexColors = false;
            m.color.set(SPECIAL.goldColor);
            // 弱い自発光で、暗い水の中でも金に見せる。
            // **強くしない** —— 強いと輪郭が飛んで「光る塊」になる
            m.emissive.set(0x6a4a05);
          } else {
            m.map = skin;
            m.vertexColors = true;
            m.color.set(0xffffff);
            m.emissive.set(0x000000);
          }
          m.needsUpdate = true;
        }
      },
      setBump(t: number) {
        bump3d.visible = t > 0;
        if (t > 0) bump3d.scale.setScalar(Math.min(1, t * 1.2));
      },
      dispose() {
        for (const item of disposables) item.dispose();
      },
    };
  }

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
  // **戻す先の色**（`setTint(null)` で使う）
  const baseColor = material.color.getHex();
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
    setGold(on: boolean) {
      // ==================================================================
      // **canvas の絵のほうは、掛け算しかできない。**
      // 絵の透明部分で形を切り抜いている（`alphaTest`）ので、
      // `map` を外すと**金色の四角い板**になってしまう。
      //
      // ここは素材が1つも無いときのフォールバック（不変条件7）で、
      // 本番の4種はすべてモデルを持っている。**弱い金で妥協する**
      // ==================================================================
      material.color.set(on ? SPECIAL.goldColor : baseColor);
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
