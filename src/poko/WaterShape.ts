/**
 * 穴（水のわきでる縦穴）の手続き生成（設計書 §5-2）
 *
 * ==========================================================================
 * **縦向きの穴にする**（2026-09-13、実機を見て人間が決めた）。
 *
 * 最初は横長の楕円（見下ろした池）にして、魚が下から浮き上がる形にした。
 * 実機で「魚の出方（見え方）があまり良くない」と言われた。
 * 見下ろし 11.8° のカメラでは池がほとんど潰れて見えるので、
 * **魚が上下に動いても「水から出てきた」に見えない**。
 *
 * 縦長の穴にして、**魚が左（穴）から右へ泳ぎ出る**形にした。
 * 横向きの動きなら、魚の輪郭（頭から尾まで）がそのまま見えるので、
 * 「穴から出てきた」が一目で分かる。
 *
 * 隠すのは板ではなく**切り取り**（`renderer.localClippingEnabled`）。
 * 穴の口より左は描かないので、**隠れているあいだは1画素も見えない。**
 * 板で覆う手もあるが、縦長の穴だと覆う板のほうが大きくなって背景を隠す。
 * ==========================================================================
 */

import * as THREE from 'three';

/** 穴の横半径（ワールド）。**縦長にするので横は狭い** */
const RX = 0.3;
/** 穴の縦半径。魚の高さ（0.44）より大きく取って、口から出入りできるようにする */
const RY = 0.5;
/** 縁の太さ（外側の倍率） */
const RIM_SCALE = 1.22;

/**
 * 奥行きの順番。
 *
 * 穴の中（暗がり）＜ 魚 ＜ 縁。
 * **縁より手前に魚を出さないこと** —— 出ると穴の縁をまたいで見えて、
 * 穴から出ている感じが消える。
 */
export const HOLE_Z = 0;
export const FISH_Z = 0.06;
export const RIM_Z = 0.12;

/**
 * 魚が出てくる口の位置（穴の中心からの x）。
 *
 * **ここより左は描かない**（切り取り面）。穴の右の縁のあたりに置く。
 */
export const MOUTH_X = -RX * 0.35;

/** 魚が出きったときの中心の x（穴の中心から右へ） */
export const OUT_X = 0.48;

/** 見かけの外周（ワールド）。画面の端との距離はこれで測る */
export const OUTER_RX = RX * RIM_SCALE;
export const OUTER_RY = RY * RIM_SCALE;

/** 水面がひと揺れする周期（秒）。**3回/秒を超えない**（不変条件6） */
const RIPPLE_PERIOD = 2.6;

export interface WaterShape {
  readonly group: THREE.Group;
  /** 魚の縦の中心（ローカル y） */
  readonly centerY: number;
  /** ゆっくり揺らす。`elapsed` は更新時計の秒 */
  update(elapsed: number): void;
  dispose(): void;
}

export function createWaterShape(
  waterColors: readonly [string, string],
  bankColors: readonly [string, string]
): WaterShape {
  const group = new THREE.Group();
  const [shallow, deep] = waterColors;

  // 穴の中。**真っ黒にしない**（背景より少し暗い程度）。
  // 中心ほど暗いグラデーションで、奥行きを出す
  const holeGeometry = new THREE.CircleGeometry(1, 36);
  holeGeometry.scale(RX, RY, 1);
  const holeTexture = createDepthTexture(shallow, deep);
  const hole = new THREE.Mesh(
    holeGeometry,
    new THREE.MeshBasicMaterial({ map: holeTexture, toneMapped: false })
  );
  hole.name = 'hole.inside';
  hole.position.z = HOLE_Z;
  group.add(hole);

  // 縁。穴の外周をぐるりと囲む輪。**魚より手前**に置くので、
  // 魚が口から出てくるときに縁の裏を通る
  const rimGeometry = new THREE.RingGeometry(1, RIM_SCALE, 36);
  rimGeometry.scale(RX, RY, 1);
  const rim = new THREE.Mesh(
    rimGeometry,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(bankColors[0]),
      roughness: 1,
      metalness: 0,
    })
  );
  rim.name = 'hole.rim';
  rim.position.z = RIM_Z;
  group.add(rim);

  return {
    group,
    centerY: 0,
    update(elapsed: number) {
      // **ゆっくり。** 1周 2.6秒 ＝ 0.38回/秒 で、不変条件6（3回/秒）の
      // はるか下。魚が出ていないあいだも画面が止まらないようにするためで、
      // 目を引くための動きではない
      const t = (elapsed / RIPPLE_PERIOD) * Math.PI * 2;
      hole.scale.set(1 + Math.sin(t) * 0.02, 1 + Math.sin(t * 1.3) * 0.015, 1);
    },
    dispose() {
      // **1つでも漏らすとリークする**（不変条件8）
      holeGeometry.dispose();
      holeTexture.dispose();
      (hole.material as THREE.Material).dispose();
      rimGeometry.dispose();
      (rim.material as THREE.Material).dispose();
    },
  };
}

/**
 * 穴の奥のグラデーション。
 *
 * **`document` を使わない。** 単体テストは node で走るので DOM が無い。
 * 16×16 の `DataTexture` なら依存しない（不変条件7）。
 */
function createDepthTexture(shallow: string, deep: string): THREE.DataTexture {
  const N = 16;
  const data = new Uint8Array(N * N * 4);
  const a = new THREE.Color(shallow);
  const b = new THREE.Color(deep);
  const c = new THREE.Color();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
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
  // **補間を明示すること。** 既定は `NearestFilter` なので、拡大するとモザイクになる
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
