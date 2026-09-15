/**
 * GLTF のモデルから魚を作る（設計書 §5-1）
 *
 * ==========================================================================
 * **モデルは「みずのなか」（suizokukan）のものをそのまま使う**
 * （2026-09-14、人間の指示）。`public/models/*.glb`。
 *
 * 正規化そのものは**みずのなかの `normalizeModelGeometry` に任せる**
 * （`ModelGeometry.ts` に移植した）。自前で書き直して2回失敗している:
 *
 * - **模様が出なかった。** 配布モデルは UV を持たないので、
 *   `material.map` に体表の絵を貼っても全頂点が uv(0,0) を読む。
 *   実機では「濃い茶色の魚」になった
 * - **エイが黒い影にしか見えなかった。** モデルのマテリアル色が暗い青灰で、
 *   `color` を明るくしても何も変わらない。みずのなかが同じ失敗を記録している
 *
 * **向きは自動判定しない。** みずのなかで
 * 「頭が -z のモデルは `modelFlip: true` が要る（**自動判定は誤るのでやめた**）。
 * 背が上を向くかは `modelRollDeg` で明示する（琉金は 90 が要り、
 * 入れないと横倒しで泳いだ）」と実測している。**データで明示する**。
 *
 * 正規化のあとは「体長 1.0・体軸 z・頭が +z」なので、
 * このアプリの約束（**右 = +x を向いて泳ぐ**）へ倒すのはここでやる。
 *
 * **モデルが読めなければ null を返す。** 呼び出し側が canvas の絵に落ちる
 * （不変条件7）。
 * ==========================================================================
 */

import * as THREE from 'three';

import type { FishConfig } from '../types';
import { normalizeModelGeometry, tintModelGeometry } from './ModelGeometry';

/** 体長（ワールド）。**種類によらずそろえる**（当たりやすさを揃えるため） */
const TARGET_LENGTH = 0.95;

export interface ModelFishParts {
  group: THREE.Group;
  width: number;
  height: number;
  /** 切り取りを掛ける材質（穴の口より左を描かない） */
  materials: THREE.Material[];
  dispose(): void;
}

/**
 * 読み込んだ GLTF のシーンから、魚1匹ぶんの group を組む。
 *
 * @param root `AssetLoader.loadModel()` が返したもの
 * @param skin 体に貼る画像。無ければ `color` / `accent` で塗り替える
 */
export function buildModelFish(
  root: THREE.Object3D,
  config: FishConfig,
  skin: THREE.Texture | null
): ModelFishParts | null {
  const roll = ((config.modelRollDeg ?? 0) * Math.PI) / 180;
  const geometry = normalizeModelGeometry(root, roll);
  if (!geometry) return null;

  // ======================================================================
  // **色は「陰影はモデル・色は設定」で作る**（みずのなかの `tintModelGeometry`）。
  //
  // 体表の絵（`skinUrl`）があるときは**頂点色を白に戻す**。
  // 残すと、絵と焼き込んだ色が二重に掛かって濁る。
  // ======================================================================
  if (skin) {
    // **展開図を貼るモデルは頂点色を白に戻す**（みずのなかの実測）。
    // `normalizeModelGeometry` がマテリアル色を頂点色に焼き込んでいるので、
    // そのままだと**展開図の色と二重に掛かって暗く濁る**。
    // 2026-09-14、はぎ（クマノミのモデル＋ナンヨウハギの絵）が
    // **ほぼ黒い茶色**に見えていた直接の原因がこれ
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3)
    );
  } else {
    // 展開図が無いモデルは、マテリアル色のままだと `color` が効かない。
    // **陰影はモデルから、色は設定から**取って塗り直す
    tintModelGeometry(geometry, config.color, config.accent);
  }

  // ======================================================================
  // **+z（みずのなかの向き）→ +x（この app の向き）へ倒す。**
  //
  // `rotateY(+90°)` は (0,0,1) を (1,0,0) へ送る。
  // `modelFlip` は「頭が -z を向いているモデル」の印なので、
  // 倒したあとの世界では +x のまわりではなく **y のまわりに 180度**。
  // ======================================================================
  geometry.rotateY(Math.PI / 2);
  if (config.modelFlip) geometry.rotateY(Math.PI);

  // 大きさをそろえる。**正規化で体長 1.0 になっている**ので倍率だけ掛ける
  const scale = TARGET_LENGTH * (config.modelScale ?? 1);
  geometry.scale(scale, scale, scale);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  if (box) {
    box.getSize(size);
    box.getCenter(center);
    // 回した結果、中心がずれていることがある。**穴の口に合わせるので中心を戻す**
    geometry.translate(-center.x, -center.y, -center.z);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  // ======================================================================
  // 材質。**頂点色を読ませる**（`normalizeModelGeometry` が焼き込んでいる）。
  //
  // `MeshStandardMaterial` にしているのは、光の向きで体の丸みが出るため。
  // `flatShading` は使わない（低ポリのモデルが折り紙に見える）
  // ======================================================================
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    ...(skin ? { map: skin } : {}),
    roughness: 0.62,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.add(mesh);

  return {
    group,
    width: size.x,
    height: size.y,
    materials: [material],
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
