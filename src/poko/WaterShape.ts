/**
 * 水たまりの手続き生成（設計書 §5-2）
 *
 * ==========================================================================
 * **1種類だけ作る。** 「ばあ！」の隠れ場所は9種を作り分けていて
 * `SpotShapes.ts` が 1,000行あったが、ここは水たまり1種でよい。
 *
 * 形の決まりごと:
 *  - **楕円の水面**（横長）。見下ろし 11.8° のカメラから見て自然な比にする
 *  - ふちに**低い岸**。魚が出ると岸の裏に腹が隠れる
 *  - 水の中は暗いが、**真っ黒にしない**（背景より少し暗い程度）
 *  - **魚は水面の奥（z < 0）から出て、手前（z > 0）には出ない。**
 *    「ばあ！」で踏んだ「板1枚の動物が前板より手前に出て隠れない」を
 *    そもそも作らない（`FISH_Z` が負であることがその保証）
 *
 * **四角い板を1枚も混ぜないこと。** 「ばあ！」で岩の庇を四角い板にしていたら、
 * 判定に5場面すべてで「両端を直角に切り落とした長方形」と言われ、
 * 芯を残して瘤を重ねた版でも同じ減点がそのまま残った。**直線を残さない。**
 * ==========================================================================
 */

import * as THREE from 'three';

/**
 * 水面の横半径（ワールド）。
 *
 * **0.95 だと画面からはみ出す**（2026-09-13 の実測）。
 * 画面に入る x は Pixel 7（縦持ち）で ±2.30 しかない。
 *
 * **6箇所にしたとき、さらに 0.78 → 0.624 に縮めた**（同日）。
 * 縦に3行置くと行間が詰まるので、水たまりを小さくして
 * 置ける帯を上下に広げた。**当たりやすさのほうが、水たまりの大きさより優先。**
 */
const RX = 0.624;
/** 水面の縦半径。見下ろし 11.8° で潰れて見えるぶんを見込んで浅くする */
const RY = 0.336;

/** 岸の輪の外側の倍率。**画面の端との距離はこれで測ること** */
const BANK_SCALE = 1.18;

/**
 * 見た目の外周（ワールド）。**当たり判定ではなく「絵としての大きさ」。**
 *
 * ==========================================================================
 * **水面の半径だけで端との距離を測らないこと**（2026-09-13 に踏んだ）。
 * 手前の列を x = ±1.5 に置いたら、Pixel 7（縦持ち・画面に入るのは ±2.30）で
 * **岸の輪の外側が切れていた**。1.5 + 0.78 = 2.28 で収まったつもりが、
 * 岸まで入れると 1.5 + 0.92 = **2.42** ではみ出す。
 *
 * CLAUDE.md の「置いたのに見えないときは、まず画面に入っているかを疑う」
 * がそのまま当てはまる。**部品の外周で測る。**
 * ==========================================================================
 */
export const OUTER_RX = RX * BANK_SCALE;
/** 岸の高さ。魚が出たとき腹を隠す */
const BANK_H = 0.12;

/**
 * 魚を置く奥行き。**必ず負**（水面より奥）。
 *
 * ここが 0 以上になると、魚が水面の手前に出て**隠れなくなる**。
 * 「ばあ！」では切り抜きの板を前板との隙間を埋めるために
 * `FORWARD`（0.26）だけ手前に出していて、
 * 水面や葉のように薄い覆いがそれを隠せず、
 * **うみ の すいめん でクマノミが丸ごと画面に出ていた**（実機で発覚）。
 */
export const FISH_Z = -0.16;

/** 水面がひと揺れする周期（秒）。**3回/秒を超えない**（不変条件6） */
const RIPPLE_PERIOD = 2.6;

export interface WaterShape {
  readonly group: THREE.Group;
  /** 魚が出きったときに頭が来る高さ（ローカル y） */
  readonly rimY: number;
  /** 水面をゆっくり波打たせる。`elapsed` は更新時計の秒 */
  update(elapsed: number): void;
  dispose(): void;
}

export function createWaterShape(
  waterColors: readonly [string, string],
  bankColors: readonly [string, string]
): WaterShape {
  const [shallow, deep] = waterColors;
  const group = new THREE.Group();

  // 水。**楕円のまま。四角い板にしない**（上の注意を読むこと）。
  // 内側ほど暗くして深さを出す。`CircleGeometry` を縦に潰して楕円にする
  const waterGeometry = new THREE.CircleGeometry(1, 40);
  waterGeometry.scale(RX, RY, 1);
  const waterTexture = createDepthTexture(shallow, deep);
  const water = new THREE.Mesh(
    waterGeometry,
    new THREE.MeshBasicMaterial({ map: waterTexture, toneMapped: false })
  );
  water.name = 'water.surface';
  group.add(water);

  // 岸。水面より一回り大きい楕円の輪。**水面より奥**に置くので、
  // 出てきた魚を隠すことが原理的にない
  const bankGeometry = new THREE.RingGeometry(1, BANK_SCALE, 40);
  bankGeometry.scale(RX, RY, 1);
  const bank = new THREE.Mesh(
    bankGeometry,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(bankColors[0]), roughness: 1, metalness: 0 })
  );
  bank.name = 'water.bank';
  bank.position.z = -0.02;
  group.add(bank);

  // 手前の岸。魚の腹を隠す。**水面より手前**に置く唯一の部品なので、
  // 高さを `BANK_H` に抑えて、出きった魚にかからないようにする
  const lipGeometry = new THREE.CircleGeometry(1, 32, Math.PI, Math.PI);
  lipGeometry.scale(RX * 1.06, BANK_H * 2.2, 1);
  const lip = new THREE.Mesh(
    lipGeometry,
    new THREE.MeshStandardMaterial({ color: new THREE.Color(bankColors[1]), roughness: 1, metalness: 0 })
  );
  lip.name = 'water.lip';
  lip.position.set(0, -RY * 0.5, 0.08);
  group.add(lip);

  return {
    group,
    rimY: RY * 0.2,
    update(elapsed: number) {
      // **ゆっくり。** 1周 2.6秒 ＝ 0.38回/秒 で、不変条件6（3回/秒）の
      // はるか下。魚が出ていないあいだも画面が止まらないようにするためで、
      // 目を引くための動きではない
      const t = (elapsed / RIPPLE_PERIOD) * Math.PI * 2;
      water.scale.set(1 + Math.sin(t) * 0.012, 1 + Math.sin(t * 1.3) * 0.02, 1);
    },
    dispose() {
      // **1つでも漏らすとリークする**（不変条件8）
      waterGeometry.dispose();
      waterTexture.dispose();
      (water.material as THREE.Material).dispose();
      bankGeometry.dispose();
      (bank.material as THREE.Material).dispose();
      lipGeometry.dispose();
      (lip.material as THREE.Material).dispose();
    },
  };
}

/**
 * 水の深さのグラデーション。
 *
 * **真っ黒にしないこと**（§5-2）。暗いだけの穴に見えると、
 * 水たまりではなく「地面の穴」になる。
 * `document` が無い環境（単体テスト）では null を返さず、
 * **単色のテクスチャを作らずに済ませる**ため呼び出し側で分岐しない ——
 * ここは必ず値を返す。
 */
function createDepthTexture(shallow: string, deep: string): THREE.DataTexture {
  // **Canvas を使わない。** 単体テストは node で走るので `document` が無い。
  // 16×16 の DataTexture なら DOM に依存しない（不変条件7）
  const N = 16;
  const data = new Uint8Array(N * N * 4);
  const a = new THREE.Color(shallow);
  const b = new THREE.Color(deep);
  const c = new THREE.Color();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      // 中心ほど深い（暗い）。縁は浅い色
      const dx = (x / (N - 1)) * 2 - 1;
      const dy = (y / (N - 1)) * 2 - 1;
      const r = Math.min(1, Math.hypot(dx, dy));
      c.copy(b).lerp(a, r);
      const i = (y * N + x) * 4;
      data[i] = Math.round(c.r * 255);
      data[i + 1] = Math.round(c.g * 255);
      data[i + 2] = Math.round(c.b * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, N, N);
  texture.colorSpace = THREE.SRGBColorSpace;
  // **補間を明示すること。** `DataTexture` の既定は `NearestFilter` なので、
  // 16×16 を画面いっぱいに拡大すると**モザイクになる**（実機の絵で確認した）。
  // グラデーションが目的なので、拡大も縮小も線形でよい
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
