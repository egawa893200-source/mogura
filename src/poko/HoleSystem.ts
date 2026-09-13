/**
 * 水たまりの生成・配置・当たり判定（設計書 §3-2 / §3-3）
 *
 * ==========================================================================
 * **当たり判定は 3D のレイではなく画面座標で見る。**
 *
 * 「みずのなか」で岩の裏や真横から当たりが出ず「押したのに反応しない」が
 * 起きた。`ScreenProjector.distancePx()`（ワールド座標→画面座標の距離）で
 * 判定する。
 *
 * **半径は定数では決められない**（「ばあ！」の実測）。
 * ワールド座標を固定したまま画面の大きさだけ変わるので、
 * どんな定数を選んでも全端末では成立しない:
 *
 * | 端末 | いちばん近い組 | 120+120 に対して |
 * |---|---|---|
 * | Pixel 7 412×839 | 204.8px | 35.2px 食い込む |
 * | iPhone 12 390×750 | 183.0px | 57.0px 食い込む |
 * | 360×600 | 146.4px | 93.6px 食い込む |
 * | 844×390（横持ち）| 118.7px | 121.3px 食い込む |
 *
 * `HoleConfig.hitRadiusPx` は**上限**として持ち、`radiusAt()` が
 * 隣との距離を見て縮める。**下限は設けない** ——
 * 下限が効いた瞬間に円が重なって「押したのに隣が反応する」が復活する
 * （みずのなかの貝と岩で実際に起きた）。
 * ==========================================================================
 */

import * as THREE from 'three';

import type { HoleConfig, StageConfig } from '../types';

/**
 * 画面座標に直せるもの。
 *
 * **`ScreenProjector` をそのまま要求しない。** あれは
 * `getBoundingClientRect()` を呼ぶので DOM が要り、node で走る単体テストから
 * 当たり判定の距離を測れなくなる。**必要なのは `project` だけ**なので、
 * そこだけを型にする（`ScreenProjector` はこれを満たす）。
 */
export interface Projector {
  project(world: THREE.Vector3, out: { x: number; y: number }): boolean;
}

/**
 * 隣り合う円のあいだに必ず空ける隙間（px）。
 *
 * 0 にすると、丸め誤差で境界がちょうど重なる回ができる。
 * 「ばあ！」と同じ 1px。
 */
const HIT_GUARD_PX = 1;

/** 水たまり1つぶんの実行時の状態 */
export interface HoleRuntime {
  readonly config: HoleConfig;
  readonly group: THREE.Group;
  /** 当たり判定に使うワールド座標。**毎フレーム作り直さない**（§10-3） */
  readonly worldPosition: THREE.Vector3;
}

export class HoleSystem {
  readonly group = new THREE.Group();
  readonly runtimes: HoleRuntime[] = [];

  /** 画面座標のキャッシュ。**毎フレーム new をしない**（§10-3） */
  private readonly sx: number[] = [];
  private readonly sy: number[] = [];
  private readonly onScreen: boolean[] = [];

  constructor(stage: StageConfig) {
    for (const config of stage.holes) {
      const group = new THREE.Group();
      group.position.set(config.position[0], config.position[1], 0);
      this.group.add(group);
      this.runtimes.push({
        config,
        group,
        worldPosition: new THREE.Vector3(config.position[0], config.position[1], 0),
      });
      this.sx.push(0);
      this.sy.push(0);
      this.onScreen.push(false);
    }
  }

  /**
   * 画面座標を測り直す。
   *
   * **毎フレーム呼ぶこと。** 画面の向きが変わると全部ずれる。
   * ここで測った値を `radiusAt()` と `pick()` が使う。
   */
  measure(projector: Projector): void {
    for (let i = 0; i < this.runtimes.length; i++) {
      const runtime = this.runtimes[i];
      const ok = projector.project(runtime.worldPosition, _screen);
      this.onScreen[i] = ok;
      if (ok) {
        this.sx[i] = _screen.x;
        this.sy[i] = _screen.y;
      }
    }
  }

  /**
   * この水たまりの当たり半径（px）。
   *
   * **上限は `hitRadiusPx`、実際は隣との距離の半分から 1px 引いた値。**
   * 下限は設けない（冒頭の説明を読むこと）。
   */
  radiusAt(index: number): number {
    const runtime = this.runtimes[index];
    if (!runtime || !this.onScreen[index]) return 0;

    let nearest = Infinity;
    for (let j = 0; j < this.runtimes.length; j++) {
      if (j === index || !this.onScreen[j]) continue;
      const d = Math.hypot(this.sx[index] - this.sx[j], this.sy[index] - this.sy[j]);
      if (d < nearest) nearest = d;
    }
    if (!Number.isFinite(nearest)) return runtime.config.hitRadiusPx;
    return Math.max(0, Math.min(runtime.config.hitRadiusPx, nearest / 2 - HIT_GUARD_PX));
  }

  /**
   * 画面のこの位置にいちばん近い水たまり。届かなければ null。
   *
   * **null を返しても無反応にしないこと**（不変条件1）。
   * 呼び出し側が波紋と音を返す。
   */
  pick(screenX: number, screenY: number): HoleRuntime | null {
    let best: HoleRuntime | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < this.runtimes.length; i++) {
      if (!this.onScreen[i]) continue;
      const d = Math.hypot(this.sx[i] - screenX, this.sy[i] - screenY);
      if (d > this.radiusAt(i)) continue;
      // 円が重ならないようにしてあるので、ここで2つ当たることは無い。
      // それでも近いほうを採るのは、丸め誤差で境界に乗ったときの保険
      if (d < bestDist) {
        bestDist = d;
        best = this.runtimes[i];
      }
    }
    return best;
  }

  /** 開発と E2E 用。画面座標と半径を読み出す */
  describe(): { id: string; x: number; y: number; radiusPx: number }[] {
    return this.runtimes.map((runtime, i) => ({
      id: runtime.config.id,
      x: this.sx[i],
      y: this.sy[i],
      radiusPx: this.radiusAt(i),
    }));
  }
}

const _screen = { x: 0, y: 0 };
