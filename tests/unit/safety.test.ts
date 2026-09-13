/**
 * 不変条件（設計書 §2）を数値で押さえるテスト。
 *
 * **このファイルが落ちたら、設計書ではなく実装を直すこと。**
 * ここは「実装が正」の例外で、設計書 §2 が正。
 *
 * ここに置くのは「壊れても静かに壊れる」もの。目で見て気づけないから数値にする。
 *
 * --------------------------------------------------------------------------
 * **`npx vitest run | tail -3` で要約行を隠さないこと**（§11-4）。
 * 「ばあ！」でこれをやって、単体テストが1件落ちたまま16サイクル進んだ。
 * `grep -E "Tests "` で要約を必ず見る。
 * --------------------------------------------------------------------------
 */

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { FISH, SPARE_FISH, findFish } from '../../src/data/fish';
import { STAGES, findStage } from '../../src/data/stages';
import { HoleSystem } from '../../src/poko/HoleSystem';
import { FISH_Z } from '../../src/poko/WaterShape';

describe('ステージと魚のデータ（§5-1 / §5-3）', () => {
  it('ステージは2つ', () => {
    expect(STAGES).toHaveLength(2);
    expect(STAGES.map((s) => s.id).sort()).toEqual(['ike', 'umi']);
  });

  it('1ステージに出る魚は2種まで（2026-09-13 に人間が決めた）', () => {
    for (const stage of STAGES) {
      expect(stage.fish.length).toBeLessThanOrEqual(2);
    }
  });

  it('魚の定義がすべて実在する', () => {
    for (const stage of STAGES) {
      for (const id of stage.fish) expect(findFish(id), `${stage.id}/${id}`).not.toBeNull();
    }
  });

  it('同じ魚を2つのステージに出さない', () => {
    const seen = new Set<string>();
    for (const stage of STAGES) {
      for (const id of stage.fish) {
        expect(seen.has(id), `${id} が2つのステージに出ている`).toBe(false);
        seen.add(id);
      }
    }
  });

  it('同じステージの2種は体高が 0.25 以上離れている（輪郭で見分ける）', () => {
    // **色だけで分けないこと。** 「みずのなか」で体型を指定しなかったら
    // チョウチョウウオもメダカも同じ魚になった
    for (const stage of STAGES) {
      const heights = stage.fish.map((id) => findFish(id)!.bodyHeight);
      for (let i = 0; i < heights.length; i++) {
        for (let j = i + 1; j < heights.length; j++) {
          expect(Math.abs(heights[i] - heights[j]), stage.id).toBeGreaterThanOrEqual(0.25);
        }
      }
    }
  });

  it('id が重複しない（予備も含めて）', () => {
    const ids = [...FISH, ...SPARE_FISH].map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('予備の4種を消していない（入れ替え用。§5-1）', () => {
    expect(SPARE_FISH.length).toBeGreaterThanOrEqual(4);
  });

  it('見つからない id には null を返す（例外を投げない）', () => {
    expect(findFish('いない魚')).toBeNull();
    expect(findStage('いないステージ')).toBeNull();
  });
});

describe('水たまりの配置（§3-2）', () => {
  it('水たまりは6箇所（2026-09-13 に人間が決めた）', () => {
    for (const stage of STAGES) expect(stage.holes).toHaveLength(6);
  });

  it('水たまりの id が重複しない', () => {
    for (const stage of STAGES) {
      const ids = stage.holes.map((h) => h.id);
      expect(new Set(ids).size, stage.id).toBe(ids.length);
    }
  });

  it('すべて地平線より下にある（上の段を空に浮かせない）', () => {
    // ==================================================================
    // 「ばあ！」の最大の欠点をここで潰す。
    // 隠れ場所を y = +1.90 / -2.00 の2段に置いていたせいで
    // **上の段が空に浮き**、見た目の判定が4場面で -12 を付け続けた。
    //
    // 画面に入る範囲は「ばあ！」の実測: 背景の絵の板（z = -1.55、
    // カメラから 8.75）で縦 11.36。絵の上端が y = +5.68、下端が -5.68。
    // `horizonV` は 0 が上端・1 が下端なので、ワールドの y に直すと
    //   horizonY = 5.68 - horizonV * 11.36
    // ==================================================================
    const IMAGE_H = 11.36;
    for (const stage of STAGES) {
      const horizonY = IMAGE_H / 2 - stage.horizonV * IMAGE_H;
      for (const hole of stage.holes) {
        expect(hole.position[1], `${stage.id}/${hole.id}`).toBeLessThan(horizonY);
      }
    }
  });

  it('地平線は手で入れてある（自動検出の閾値に届かない絵なので）', () => {
    // のはら 10.9 / うみ 5.9 で、`sampleBackdropHorizon()` の閾値 14 に届かない。
    // **0 のままにしない**（0 だと画面の上端が地平線になる）
    for (const stage of STAGES) {
      expect(stage.horizonV, stage.id).toBeGreaterThan(0.1);
      expect(stage.horizonV, stage.id).toBeLessThan(0.9);
    }
  });
});

describe('魚は水面より奥から出る（§5-2）', () => {
  it('FISH_Z が負（手前に出ると隠れなくなる）', () => {
    // 「ばあ！」では切り抜きの板を `FORWARD`（0.26）だけ手前に出していて、
    // 水面が薄いせいで隠せず、**クマノミが丸ごと画面に出ていた**（実機で発覚）。
    // ここが 0 以上になった時点で、同じ壊れ方をする
    expect(FISH_Z).toBeLessThan(0);
  });
});

describe('当たり判定（§3-3）', () => {
  /**
   * 端末4種で、当たり判定の円が重ならないことを見る。
   *
   * ==========================================================================
   * **半径は定数では決められない**（「ばあ！」の実測）。
   * ワールド座標を固定したまま画面の大きさだけ変わるので、
   * どんな定数を選んでも全端末では成立しない。
   * `radiusAt()` が隣との距離を見て縮めているかを、ここで数値にする。
   *
   * カメラは「ばあ！」と同じ `(0, 0.3, 7.2)` 固定・fov 66°。
   * ==========================================================================
   */
  const DEVICES: [string, number, number][] = [
    ['Pixel 7', 412, 839],
    ['iPhone 12', 390, 750],
    ['小さい端末', 360, 600],
    ['横持ち', 844, 390],
  ];

  function project(width: number, height: number) {
    const camera = new THREE.PerspectiveCamera(66, width / height, 0.1, 100);
    camera.position.set(0, 0.3, 7.2);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    return {
      project(world: THREE.Vector3, out: { x: number; y: number }): boolean {
        v.copy(world).project(camera);
        if (v.z > 1) return false;
        out.x = ((v.x + 1) / 2) * width;
        out.y = ((1 - v.y) / 2) * height;
        return true;
      },
    };
  }

  for (const [name, width, height] of DEVICES) {
    it(`${name} ${width}×${height} で円が重ならない`, () => {
      for (const stage of STAGES) {
        const holes = new HoleSystem(stage);
        holes.measure(project(width, height));
        const spots = holes.describe();
        for (let i = 0; i < spots.length; i++) {
          for (let j = i + 1; j < spots.length; j++) {
            const d = Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y);
            const sum = spots[i].radiusPx + spots[j].radiusPx;
            expect(sum, `${stage.id} ${spots[i].id}-${spots[j].id}`).toBeLessThanOrEqual(d);
          }
        }
      }
    });
  }

  it('実機（Pixel 7 / iPhone 12）の縦持ちで 70px を下回らない', () => {
    // ==================================================================
    // **下限を設けて広げるのではない。** 下限が効いた瞬間に円が重なって
    // 「押したのに隣が反応する」が復活する（みずのなかの貝と岩）。
    // ここは「狭すぎたら配置のほうを直せ」という警告として置く（§5-3）。
    //
    // **実際に3回これが落ちて、そのたびに配置のほうを直した**（2026-09-13）:
    //  ① 4箇所の版が 360×600 で 62.2px。いちばん近い組は左右ではなく
    //     奥と手前の斜めだった → 縦の間隔を広げて 72.8px
    //  ② 6箇所にしたら 68.5px。行をワールドの y で等間隔にしていたため、
    //     見下ろしのぶん下の行が画面上で詰まっていた → 画面上で等間隔に
    //  ③ いちばん上の行が遠くの丘に重なって「地平線に浮いて」見えた →
    //     行を草地まで下げた。**そのぶん間隔が縮む**（下の it に実測）
    //
    // **実機2種だけを見る。** 理由は下の it に書いてある。
    // ==================================================================
    for (const [name, width, height] of DEVICES.slice(0, 2)) {
      for (const stage of STAGES) {
        const holes = new HoleSystem(stage);
        holes.measure(project(width, height));
        for (const spot of holes.describe()) {
          expect(spot.radiusPx, `${name} ${stage.id}/${spot.id}`).toBeGreaterThanOrEqual(70);
        }
      }
    }
  });

  it('小さい端末と横持ちの実測を固定する（人間の判断待ち）', () => {
    // ==================================================================
    // **これは「通っているから良い」テストではない。実測を固定して、
    // 忘れないようにするためのもの。**
    //
    // 水たまりを6箇所にしたのは人間の決定（2026-09-13）。そのうえで
    // **いちばん上の行を地平線まで上げない**と決めたので（上げると遠くの
    // 丘に重なって「浮いて」見える。§3-2 がこの設計の出発点）、
    // 縦の間隔はこれ以上広げられない。
    //
    // 実測:
    // | 端末 | 半径 | 70px |
    // |---|---|---|
    // | Pixel 7 412×839 | 89.1px | ○ |
    // | iPhone 12 390×750 | 79.5px | ○ |
    // | 360×600 | **63.4px** | × |
    // | 844×390（横持ち）| **40.9px** | × |
    //
    // 上の行を地平線まで上げれば 360×600 でも 71.3px になるが、
    // **「ばあ！」が最後まで直せなかった欠点を取り戻すことになる**ので採らない。
    //
    // 選べるのは (a) このまま（実機2種は 79px 以上ある）
    // (b) 6箇所を減らす (c) 上の行を上げ直す —— で、
    // **どれを採るかは人間が決めること。** 決まるまでは
    // 「円が重ならない」だけを守る（上の it が見ている）。
    // ==================================================================
    const measured: Record<string, number> = {};
    for (const [name, width, height] of DEVICES.slice(2)) {
      const holes = new HoleSystem(STAGES[0]);
      holes.measure(project(width, height));
      measured[name] = Math.min(...holes.describe().map((s) => s.radiusPx));
    }
    // **配置を触ったらここも動く。** 動いたら上の表を測り直すこと
    expect(measured['小さい端末']).toBeGreaterThan(60);
    expect(measured['小さい端末']).toBeLessThan(70);
    expect(measured['横持ち']).toBeGreaterThan(35);
    expect(measured['横持ち']).toBeLessThan(50);
  });

  it('どこを押しても、当たるか null が返る（例外を投げない。不変条件1）', () => {
    const holes = new HoleSystem(STAGES[0]);
    holes.measure(project(412, 839));
    for (let x = 0; x < 412; x += 37) {
      for (let y = 0; y < 839; y += 53) {
        expect(() => holes.pick(x, y)).not.toThrow();
      }
    }
  });
});
