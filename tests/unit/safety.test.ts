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

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { FISH, SPARE_FISH, findFish } from '../../src/data/fish';
import { SPECIAL, SURPRISE, pickVariant } from '../../src/data/special';
import { STAGES, findStage } from '../../src/data/stages';
import { ASSIST, MAX_UP_FISH, ROCK_TIMING, TIMING } from '../../src/data/timing';
import { FishSystem } from '../../src/poko/FishSystem';
import { HoleSystem } from '../../src/poko/HoleSystem';
import {
  HIDDEN_Z as ROCK_HIDDEN_Z,
  HIDE_LIFT as ROCK_HIDE_LIFT,
  RockSystem,
} from '../../src/poko/RockSystem';
import { Spawner, seededRandom } from '../../src/poko/Spawner';
import { SurpriseFish } from '../../src/poko/SurpriseFish';
import { STARS_PER_FLOWER } from '../../src/ui/Score';
import { FISH_Z, HOLE_Z, MOUTH_X, OUT_X, RIM_Z } from '../../src/poko/WaterShape';

/**
 * 端末4種。**当たり判定の円が重ならないことを見る**ときに使う。
 *
 * **半径は定数では決められない**（「ばあ！」の実測）。ワールド座標を固定した
 * まま画面の大きさだけ変わるので、どんな定数を選んでも全端末では成立しない。
 * `radiusAt()` が隣との距離を見て縮めているかを、数値にして見張る。
 *
 * カメラは「ばあ！」と同じ `(0, 0.3, 7.2)` 固定・fov 66°。
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

  it('同じステージに、同じモデルの魚を2匹置かない', () => {
    // ==================================================================
    // **輪郭が同じ2匹が並ぶと、色を変えても「同じ魚を2色に塗った」に見える**
    // （「ばあ！」で岩とくさむらに判定からそう言われている）。
    //
    // 「みずのなか」のモデルは3体しかないので、クマノミのモデルは
    // **ステージをまたいで**色違いで使い回している（`hagi` と `kumanomi`）。
    // 子どもが同時に見ることはないので、そこは許す。
    // **同じステージの中だけは必ず別の輪郭にする。**
    // ==================================================================
    for (const stage of STAGES) {
      const models = stage.fish.map((id) => findFish(id)!.modelUrl ?? id);
      expect(new Set(models).size, stage.id).toBe(models.length);
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

describe('魚は穴の口から出る（§5-2）', () => {
  it('奥行きの順番が 穴の中 < 魚 < 縁', () => {
    // ==================================================================
    // **この3つの大小関係が、隠れる／出るのすべて。**
    //
    // 最初は魚を池の面より奥に置いていた。隠れはしたが、**池の上に
    // 浮かんで出てくる**ように見えた（実装して絵で確認した）。
    // 「ばあ！」の前板・背板と同じサンドイッチにして直した。
    //
    // **`FISH_Z` が `LIP_Z` を超えた時点で隠れなくなる。**
    // 「ばあ！」では切り抜きの板を `FORWARD`（0.26）だけ手前に出していて、
    // 水面が薄いせいで隠せず、クマノミが丸ごと画面に出ていた（実機で発覚）。
    // ==================================================================
    expect(HOLE_Z).toBeLessThan(FISH_Z);
    expect(FISH_Z).toBeLessThan(RIM_Z);
  });

  it('出てくる向きが左から右（口より右へ出る）', () => {
    // **横向きの動きにする**（2026-09-13、実機を見て人間が決めた）。
    // 上下に浮き上がる形は、見下ろし 11.8° の浅い角度では
    // 「水から出てきた」に見えなかった
    expect(OUT_X).toBeGreaterThan(MOUTH_X);
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

  it('魚が出きっているときの当たり半径（いちばん狭くなる瞬間）', () => {
    // ==================================================================
    // **魚は穴の右へ泳ぎ出るので、右隣の穴に近づく**（2026-09-13）。
    // いちばん狭くなるのはこの瞬間なので、ここを測っておく。
    //
    // 当たり判定の中心も魚について動く（`HoleSystem.measure` の
    // `offsetX`）ので、「魚を叩いたのに隣の空振りになる」は起きない。
    // 代わりに**円どうしが近づく**ぶん、半径が縮む。
    // ==================================================================
    const out = STAGES[0].holes.map((_, i) => (i % 2 === 0 ? OUT_X : 0));
    const measured: Record<string, number> = {};
    for (const [name, width, height] of DEVICES) {
      const holes = new HoleSystem(STAGES[0]);
      holes.measure(project(width, height), out);
      measured[name] = Math.min(...holes.describe().map((s) => s.radiusPx));
      // **円は重ならない**（これは何があっても守る）
      const spots = holes.describe();
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
          const d = Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y);
          expect(spots[i].radiusPx + spots[j].radiusPx, `${name} ${i}-${j}`).toBeLessThanOrEqual(d);
        }
      }
    }
    // 実測（2026-09-13）。**配置や `OUT_X` を触ったらここも動く**
    // | 端末 | 穴だけ | 魚が出きったとき |
    // |---|---|---|
    // | Pixel 7 | 89.3px | **76.6px** |
    // | iPhone 12 | 79.7px | **68.4px** |
    // | 360×600 | 63.6px | 54.5px |
    // | 横持ち | 41.0px | 35.1px |
    //
    // **見た目の的は円より大きい。** 魚は長さ 1.1・高さ 0.44（Pixel 7 で
    // およそ 100×40px）あるので、体のどこを押しても中心から 76px に入る。
    expect(measured['Pixel 7']).toBeGreaterThan(72);
    expect(measured['iPhone 12']).toBeGreaterThan(64);
    expect(measured['小さい端末']).toBeGreaterThan(50);
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

describe('さかなの状態遷移（§4-1 / §4-3）', () => {
  function makeSystem(): FishSystem {
    return new FishSystem(STAGES[0].fish.map((id) => findFish(id)!));
  }
  /** 固定タイムステップで n 秒ぶん進める。**壁時計を読まない**（§11-4） */
  function advance(fish: FishSystem, seconds: number): void {
    const dt = 1 / 60;
    for (let i = 0; i < Math.round(seconds / dt); i++) fish.update(dt);
  }

  it('声が先、姿はあと（`calling` のあいだは1画素も出さない）', () => {
    // ==================================================================
    // 実機で「**『ばあっ』する前にチラッと見えている**」と言われた
    // （2026-09-13）。声と同時に動きはじめていたのが原因。
    // 「何も見えない状態で『ばあっ』と言って出てくる」が人間の指定。
    // ==================================================================
    const fish = makeSystem();
    fish.spawn(0, 0, 1);
    expect(fish.actors[0].state).toBe('calling');
    advance(fish, TIMING.callSec * 0.5);
    expect(fish.actors[0].state).toBe('calling');
    // **`calling` のあいだ reveal は 0 のまま**（＝穴の中から出ていない）
    expect(fish.actors[0].reveal).toBe(0);
    advance(fish, TIMING.callSec * 0.6);
    expect(fish.actors[0].state).toBe('rising');
  });

  it('`calling` の魚は叩けない（まだ見えていないので）', () => {
    const fish = makeSystem();
    fish.spawn(0, 0, 1);
    expect(fish.actors[0].state).toBe('calling');
    expect(fish.hit(0)).toBe(false);
  });

  it('出てくるのは 0.65秒（v0.1 の 0.22秒から遅くした）', () => {
    expect(TIMING.risingSec).toBeCloseTo(0.65, 5);
    const fish = makeSystem();
    fish.spawn(0, 0, 1);
    advance(fish, TIMING.callSec + 0.3);
    // 途中では出きっていない
    expect(fish.actors[0].state).toBe('rising');
    expect(fish.actors[0].reveal).toBeGreaterThan(0);
    expect(fish.actors[0].reveal).toBeLessThan(1);
    advance(fish, 0.4);
    expect(fish.actors[0].state).toBe('up');
    expect(fish.actors[0].reveal).toBe(1);
  });

  it('叩くとたんこぶができる（2026-09-13 に人間が決めた）', () => {
    // **叩かれたことが形に残る**ので、当たったかどうかが一目で分かる
    const fish = makeSystem();
    fish.spawn(0, 0, 1);
    advance(fish, TIMING.callSec + 0.7);
    expect(fish.actors[0].state).toBe('up');
    expect(fish.actors[0].bump).toBe(0);
    fish.hit(0);
    // **叩いたその場で育ちはじめる**（0フレーム原則と同じ）
    expect(fish.actors[0].bump).toBeGreaterThan(0);
    advance(fish, 0.25);
    expect(fish.actors[0].bump).toBeCloseTo(1, 1);
  });

  it('出ている時間は 6.0秒（2026-09-16 に 4.0 から伸ばした）', () => {
    // **実機で「魚の戻るのが早くて、叩けない時が多々ある」**（2026-09-16）。
    // 数字ごと後ろへずらした。**下げ直すときは人間が決めること**
    expect(TIMING.upSec).toBeCloseTo(6.0, 5);
    const fish = makeSystem();
    fish.spawn(0, 0, 1);
    advance(fish, TIMING.callSec + 0.7 + TIMING.upSec - 0.5);
    expect(fish.actors[0].state).toBe('up');
    advance(fish, 0.7);
    expect(fish.actors[0].state).toBe('retreating');
  });

  it('叩ける時間は、いちばん厳しい設定でも 5.5秒ある（2026-09-16）', () => {
    // ==================================================================
    // **介助は「当たるようにする仕掛け」なのに、常に難しくしていた。**
    //
    // 4通りの遊びかた（反応 1.2〜3.0秒・狙い外し 15〜30%）で 400秒ずつ
    // 回して測ったら、**4通りとも下限に張り付いた**。沈む最中の遅い指も
    // 当たりに数える（§4-3）ので、当たりは連続しやすく外しは連続しにくい。
    //
    // だから**下限そのもの**を見る。ここが「叩ける最短の時間」になる
    // ==================================================================
    const worst = ASSIST.minUpSec + TIMING.retreatSec;
    expect(worst, `いちばん厳しくて ${worst.toFixed(1)}秒`).toBeGreaterThanOrEqual(5.5);
    // 出はじめ（`rising`）からも叩けるので、実際はさらに長い
    expect(TIMING.risingSec).toBeGreaterThan(0);
  });

  it('叩いた同じ呼び出しで潰れが始まる（§4-3 の0フレーム原則）', () => {
    // ==================================================================
    // **このアプリでいちばん重要な規則。**
    // `update()` を待って 0 のままにしないこと。「ばあ！」は押してから
    // 0.35秒後に山が来る作りで、そこが受けなかった。
    // ==================================================================
    const fish = makeSystem();
    fish.spawn(0, 0, 1);
    advance(fish, TIMING.callSec + 0.7);
    expect(fish.actors[0].state).toBe('up');
    const ok = fish.hit(0);
    expect(ok).toBe(true);
    // **update を1度も呼ばずに**見る
    expect(fish.actors[0].state).toBe('hit');
    expect(fish.actors[0].squash).toBeGreaterThan(0);
  });

  it('出てくる途中でも叩ける（不変条件2）', () => {
    // 「みずのなか」の貝は開閉中のタップで向きを反転していたため、
    // 連打すると開き量の最大が 0.037 にしかならなかった
    const fish = makeSystem();
    fish.spawn(0, 0, 1);
    advance(fish, TIMING.callSec + 0.2);
    expect(fish.actors[0].state).toBe('rising');
    expect(fish.hit(0)).toBe(true);
    expect(fish.actors[0].squash).toBeGreaterThan(0);
  });

  it('潰れている最中に叩いても反応は返るが、得点は増えない（§4-6）', () => {
    const fish = makeSystem();
    fish.spawn(0, 0, 1);
    advance(fish, TIMING.callSec + 0.7);
    expect(fish.hit(0)).toBe(true);
    // 2回目以降は false（得点が増えない）。**例外は投げない**
    expect(fish.hit(0)).toBe(false);
    expect(() => fish.hit(0)).not.toThrow();
  });

  it('60Hz で連打しても、沈みきるまで完走する', () => {
    // **「連打しても壊れない」は「連打しても動く」まで確かめる**（§14-1）
    const fish = makeSystem();
    fish.spawn(0, 0, 1);
    advance(fish, TIMING.callSec + 0.7);
    fish.hit(0);
    let maxSquash = 0;
    for (let i = 0; i < 60; i++) {
      fish.hit(0); // 連打
      fish.update(1 / 60);
      maxSquash = Math.max(maxSquash, fish.actors[0].squash);
    }
    // 潰れが最後まで進んでいる（0.037 のような値で止まらない）
    expect(maxSquash).toBeGreaterThan(0.9);
    expect(fish.actors[0].state).toBe('hidden');
  });

  it('同じ魚が同時に2箇所に出ない（1種につき1匹しか持たない）', () => {
    const fish = makeSystem();
    expect(fish.spawn(0, 0, 1)).toBe(true);
    // 同じ魚をもう1箇所には出せない
    expect(fish.spawn(0, 3, 1)).toBe(false);
  });
});

describe('出現の抽選（§4-2 / §4-7）', () => {
  function makeBoth(seed = 1234): { fish: FishSystem; spawner: Spawner } {
    const fish = new FishSystem(STAGES[0].fish.map((id) => findFish(id)!));
    return { fish, spawner: new Spawner(STAGES[0].holes.length, seed) };
  }

  it('叩ける相手が 0 になる時間が無い（不変条件4c）', () => {
    // ==================================================================
    // **画面に何も無い時間を作らない。**
    // 「ばあ！」は押すまで画面が止まっていた。ここが 0 になると、
    // 子どもが「叩くものが無い」画面を見ることになる。
    // ==================================================================
    // ==================================================================
    // **数えはじめるのは、最初の1匹が見えてから**（2026-09-13）。
    //
    // 「何も見えない状態で『ばあっ』と言って出てくる」を人間が指定したので、
    // 起動直後は `calling`（0.38秒）のあいだ叩ける相手が居ない。
    // これは**仕様どおり**で、遊んでいる最中の「画面が空になる」とは別。
    // 実測でもここだけが 21フレーム（＝0.38秒ぶん）だった。
    // ==================================================================
    const { fish, spawner } = makeBoth();
    const dt = 1 / 60;
    // 最初の1匹が見えるまで進める
    for (let i = 0; i < 600 && fish.countHittable() === 0; i++) {
      spawner.update(dt, fish);
      fish.update(dt);
    }
    expect(fish.countHittable()).toBeGreaterThan(0);

    let zeroFrames = 0;
    for (let i = 0; i < 60 * 60; i++) {
      spawner.update(dt, fish);
      fish.update(dt);
      if (fish.countHittable() === 0) zeroFrames++;
    }
    expect(zeroFrames).toBe(0);
  });

  it('同時に出るのは 2匹まで（2026-09-13 に人間が決めた）', () => {
    const { fish, spawner } = makeBoth();
    const dt = 1 / 60;
    let max = 0;
    for (let i = 0; i < 60 * 60; i++) {
      spawner.update(dt, fish);
      fish.update(dt);
      max = Math.max(max, fish.countActive());
    }
    expect(max).toBeLessThanOrEqual(MAX_UP_FISH);
    // 2匹出る回がちゃんとある（1匹ずつしか出ないと「ばあ！」に戻る）
    expect(max).toBe(2);
  });

  it('同じ水たまりから続けて出さない', () => {
    const { fish, spawner } = makeBoth();
    const dt = 1 / 60;
    // **出た瞬間（`calling` に入った最初のフレーム）だけを拾う。**
    // 状態と経過時間で拾うと、同じ1匹を2フレーム数えてしまう
    const order: number[] = [];
    const wasHidden = fish.actors.map(() => true);
    for (let i = 0; i < 60 * 120; i++) {
      spawner.update(dt, fish);
      fish.update(dt);
      for (let a = 0; a < fish.actors.length; a++) {
        const hidden = fish.actors[a].state === 'hidden';
        if (wasHidden[a] && !hidden) order.push(fish.actors[a].holeIndex);
        wasHidden[a] = hidden;
      }
    }
    expect(order.length).toBeGreaterThan(10);
    for (let i = 1; i < order.length; i++) {
      expect(order[i], `${i} 回目`).not.toBe(order[i - 1]);
    }
  });

  it('6箇所すべてが使われる（偏らない）', () => {
    const { fish, spawner } = makeBoth();
    const dt = 1 / 60;
    const used = new Set<number>();
    for (let i = 0; i < 60 * 180; i++) {
      spawner.update(dt, fish);
      fish.update(dt);
      for (const actor of fish.actors) if (actor.holeIndex >= 0) used.add(actor.holeIndex);
    }
    expect(used.size).toBe(6);
  });

  it('介助は 3.2〜5.2秒の外に出ない（§4-7）', () => {
    const { fish, spawner } = makeBoth();
    // 外し続けても上限で止まる
    for (let i = 0; i < 50; i++) {
      spawner.reportHit(false);
      spawner.applyAssist(fish);
    }
    expect(fish.getUpSec()).toBeLessThanOrEqual(ASSIST.maxUpSec);
    // 当て続けても下限で止まる
    for (let i = 0; i < 50; i++) {
      spawner.reportHit(true);
      spawner.applyAssist(fish);
    }
    expect(fish.getUpSec()).toBeGreaterThanOrEqual(ASSIST.minUpSec);
  });

  it('同じ種からは必ず同じ列が出る（乱数は独立したシードから引く）', () => {
    // three は generateUUID() で 1オブジェクトにつき Math.random() を4回
    // 消費するので、共有の乱数を使うとオブジェクトを1つ足しただけで抽選が変わる
    const a = makeBoth(999);
    const b = makeBoth(999);
    const dt = 1 / 60;
    for (let i = 0; i < 600; i++) {
      a.spawner.update(dt, a.fish);
      a.fish.update(dt);
      b.spawner.update(dt, b.fish);
      b.fish.update(dt);
    }
    expect(a.fish.actors.map((x) => x.holeIndex)).toEqual(b.fish.actors.map((x) => x.holeIndex));
  });
});

/**
 * 3D モデル（2026-09-14。人間の指示で「みずのなか」の魚をそのまま使った）。
 *
 * **ここは全部、数値のテストが通っているのに絵が間違っていた項目。**
 * 撮って見るまで分からなかったので、分かったことを数値に落として残す。
 */
describe('3D モデル（§5-1）', () => {
  it('モデルを使う魚は、ステージの中で同じ .glb を2匹置かない', () => {
    // **クマノミのモデルを2枠で使い回している**（モデルが3体しかないため）。
    // 同じ輪郭が並ぶと、色を変えても「同じ魚を2色に塗った」に見える。
    // ステージをまたぐぶんは、子どもが同時に見ないので許す
    for (const stage of STAGES) {
      const models = stage.fish
        .map((id) => findFish(id)?.modelUrl)
        .filter((url): url is string => !!url);
      expect(new Set(models).size, `${stage.id} で同じモデルが2匹`).toBe(models.length);
    }
  });

  it('展開図を貼らないモデルには、塗り替える色がある', () => {
    // **モデルのマテリアル色は、明るい色を指定しても変わらない。**
    // エイは模型側が暗い青灰で、青い映像の上では**影にしか見えなかった**
    // （みずのなかが同じ失敗を記録している）。`tintModelGeometry` が
    // 「陰影はモデル・色は設定」で塗り替えるので、色が要る
    for (const fish of FISH) {
      if (!fish.modelUrl || fish.skinUrl) continue;
      expect(typeof fish.color, `${fish.id} に color が無い`).toBe('number');
      expect(typeof fish.accent, `${fish.id} に accent が無い`).toBe('number');
    }
  });

  it('動画のあるステージは、背景の絵を持たない', () => {
    // **動画のときは地の板を1枚も置かない**（`StageRoot`）。
    // 置くと、`<video>` の上に重ねた**透過キャンバスが動画を丸ごと隠す**。
    // 実際に隠れていて、画面には空のグラデーションしか映っていなかった。
    // 読み込みも再生も成功している（206 が返る）ので、**動画の側を疑っても
    // 永遠に見つからない**種類の事故だった
    for (const stage of STAGES) {
      if (!stage.videoUrl) continue;
      expect(stage.backgroundUrl, `${stage.id} に動画と絵の両方がある`).toBeNull();
    }
  });

  it('モデルの素材はすべて public/ に実在する', () => {
    // **素材が無ければ canvas の絵に落ちる**（不変条件7）ので落ちはしないが、
    // 綴り違いに気づけない。「ばあ！」で `resolveAssetUrl` を通し忘れた話と同じ
    for (const fish of FISH) {
      for (const url of [fish.modelUrl, fish.skinUrl]) {
        if (!url) continue;
        expect(existsSync(join(process.cwd(), 'public', url)), `${url} が無い`).toBe(true);
      }
    }
    for (const stage of STAGES) {
      if (!stage.videoUrl) continue;
      expect(existsSync(join(process.cwd(), 'public', stage.videoUrl)), stage.videoUrl).toBe(true);
    }
  });
});

/**
 * 岩陰のばあ（§4-8。2026-09-14、人間が決めた）。
 *
 * 「画面の上が空いているので岩を設置して、タップすると魚が前に
 * 突き出してくるように（ばあっ！）」。
 * **「みずのなか」の `HideoutSystem` から持ってきたが、3箇所変えてある** ——
 * どれもこのアプリの不変条件のため。ここで数値にして見張る。
 */
describe('岩陰のばあ（§4-8）', () => {
  function rocksOf(stageId: string) {
    const stage = findStage(stageId)!;
    return new RockSystem(stage, stage.rockFish ? findFish(stage.rockFish) : null);
  }

  it('どのステージにも岩が2つある', () => {
    for (const stage of STAGES) {
      expect(stage.rocks?.length, stage.id).toBe(2);
    }
  });

  it('岩の魚は、そのステージの水たまりに出ない種', () => {
    // **同じ種を使うと「同じ魚が同時に2箇所に出る」**（§4-2 が禁じている）。
    // 岩の魚は `FishSystem` のスロットを使わない別の1匹なので、
    // 同じ種を指定すると本当に2匹が同時に出る
    for (const stage of STAGES) {
      if (!stage.rockFish) continue;
      expect(findFish(stage.rockFish), stage.id).not.toBeNull();
      expect(stage.fish, stage.id).not.toContain(stage.rockFish);
    }
  });

  it('岩の魚も入れて、ステージの中で同じ .glb を2匹置かない', () => {
    // 水たまり2匹＋岩1匹の3匹で見る。輪郭が同じ2匹が居ると、
    // 色を変えても「同じ魚を2色に塗った」に見える
    for (const stage of STAGES) {
      const ids = [...stage.fish, ...(stage.rockFish ? [stage.rockFish] : [])];
      const models = ids.map((id) => findFish(id)?.modelUrl).filter((u): u is string => !!u);
      expect(new Set(models).size, `${stage.id} で同じモデルが2匹`).toBe(models.length);
    }
  });

  it('押すまで、魚は1画素も見えていない（人間の指定）', () => {
    // 「**何も見えない状態で『ばあっ』と言って出てくる**」（2026-09-13）。
    // みずのなかは尻尾を岩から覗かせているが、ここでは消す
    const rocks = rocksOf('ike');
    expect(rocks.state).toBe('hidden');
    expect(rocks.fish?.group.visible).toBe(false);
  });

  it('「ばあっ」の 0.38秒は、声だけで姿が出ない', () => {
    const rocks = rocksOf('ike');
    expect(rocks.tap(0)).toBe('baa');
    expect(rocks.state).toBe('calling');
    // `callSec` に届くまでは 1画素も出さない
    for (let i = 0; i < Math.floor(ROCK_TIMING.callSec * 60) - 1; i++) {
      rocks.update(1 / 60);
      expect(rocks.state, `${i}フレーム目`).toBe('calling');
      expect(rocks.reveal).toBe(0);
      expect(rocks.fish?.group.visible).toBe(false);
    }
  });

  it('前に突き出してくる（z がカメラ側へ動く）', () => {
    // 「**魚が前に突き出してくるように**」（人間の指示）。
    // 上下や左右ではなく、奥から手前へ出る
    const rocks = rocksOf('ike');
    rocks.tap(0);
    let last = -Infinity;
    for (let i = 0; i < 300; i++) {
      rocks.update(1 / 60);
      if (rocks.state !== 'popping') continue;
      const z = rocks.fish!.group.position.z;
      expect(z, `${i}フレーム目で z が戻った`).toBeGreaterThan(last);
      last = z;
    }
    // 出きったところではカメラ側（z > 0）に来ている
    expect(last).toBeGreaterThan(0.5);
  });

  it('叩いたその場で潰れる（§4-3 の0フレーム原則）', () => {
    const rocks = rocksOf('ike');
    rocks.tap(0);
    while (rocks.state !== 'out') rocks.update(1 / 60);
    expect(rocks.tap(0)).toBe('hit');
    // **`update()` を待たない**
    expect(rocks.squash).toBeGreaterThan(0);
    expect(rocks.bump).toBeGreaterThan(0);
  });

  it('引っ込む途中に押したら「叩いた」になる（§4-3 / 不変条件2）', () => {
    // ==================================================================
    // **みずのなかから変えたところ。**
    // 向こうは `retreating` 中と `cooldown` 中のタップを捨てていたが、
    // それは「アニメーション中だから無視」そのもので、この app では禁止。
    // 向こうの貝がまさにそれで壊れている（連打すると 0.45秒の開閉が
    // 一度も完了せず、開き量の最大が 0.037 だった）。
    //
    // **さらに「叩いた」に数える**（2026-09-16、実機で「戻るのが早くて
    // 叩けない」と言われて）。前は押すともう一度ばあに戻していた。
    // 反応は返るので不変条件2 は満たしていたが、**「いてっ」も★も返らない**
    // ので、子どもには「当たらなかった」と同じに見える。
    // 水たまりの魚は沈む最中も当たりに数えている（§4-3）ので、そろえた
    // ==================================================================
    const rocks = rocksOf('ike');
    rocks.tap(0);
    while (rocks.state !== 'retreating') rocks.update(1 / 60);
    expect(rocks.tap(0)).toBe('hit');
    expect(rocks.state).toBe('hit');
    // **その場で潰れる**（§4-3 の0フレーム原則）
    expect(rocks.squash).toBeGreaterThan(0);
  });

  it('引っ込む途中に「別の」岩を押したら、そこから出し直す（不変条件2）', () => {
    // そこには居ないので叩きようがない。**押した岩から出る**のが約束
    const rocks = rocksOf('ike');
    rocks.tap(0);
    while (rocks.state !== 'retreating') rocks.update(1 / 60);
    expect(rocks.tap(1)).toBe('baa');
    expect(rocks.state).toBe('calling');
    expect(rocks.rockIndex).toBe(1);
  });

  it('連打しても、出きるところまで必ず進む（不変条件2）', () => {
    // 「連打しても壊れない」は「**連打しても動く**」まで確かめること。
    // 押すたびに `calling` へ戻すので、**押し続けると永遠に出ない**形に
    // なっていないかを見る（みずのなかの貝と同じ壊れ方）
    const rocks = rocksOf('ike');
    let maxReveal = 0;
    for (let i = 0; i < 600; i++) {
      // 4フレームに1回押す（1歳半の連打より速い）
      if (i % 4 === 0) rocks.tap(0);
      rocks.update(1 / 60);
      maxReveal = Math.max(maxReveal, rocks.reveal);
    }
    // **0.037 になっていないこと。** 押すたびに `calling` へ戻るので
    // 1 には届かないが、姿は必ず出る
    expect(maxReveal).toBeGreaterThan(0.5);
  });

  it('魚が出ている岩ともう一方の岩を、取り違えない', () => {
    // 岩は2つあるが魚は1匹。**押した岩から出る**。
    // 出ているあいだにもう一方を押しても、そこには居ない（空振り）
    const rocks = rocksOf('ike');
    rocks.tap(1);
    while (rocks.state !== 'out') rocks.update(1 / 60);
    expect(rocks.rockIndex).toBe(1);
    expect(rocks.tap(0)).toBe('empty');
    // **空振りでも揺れは返る**（不変条件1・3b）
    expect(rocks.runtimes[0].shake).toBeGreaterThan(0);
    // 出ている魚は消えない
    expect(rocks.state).toBe('out');
  });

  for (const [name, width, height] of DEVICES) {
    it(`${name} ${width}×${height} で、岩の円が水たまりの円に食い込まない`, () => {
      // ==================================================================
      // **岩は水たまりとは別の当たり判定**なので、`HoleSystem.radiusAt()` は
      // 岩を見ていない。食い込むと「押したのに隣が反応する」が起きる
      // （みずのなかの貝と岩で実際に起きた）。`RockSystem.radiusAt()` が
      // 水たまりの円を受け取って縮めているかを、ここで数値にする
      // ==================================================================
      for (const stage of STAGES) {
        const holes = new HoleSystem(stage);
        const p = project(width, height);
        holes.measure(p);
        const rocks = new RockSystem(stage, null);
        rocks.measure(p, holes);

        const spots = holes.describe();
        const iwa = rocks.describe();
        for (const rock of iwa) {
          for (const spot of spots) {
            const d = Math.hypot(rock.x - spot.x, rock.y - spot.y);
            expect(
              rock.radiusPx + spot.radiusPx,
              `${stage.id} ${rock.id}-${spot.id}`
            ).toBeLessThanOrEqual(d);
          }
        }
        for (let i = 0; i < iwa.length; i++) {
          for (let j = i + 1; j < iwa.length; j++) {
            const d = Math.hypot(iwa[i].x - iwa[j].x, iwa[i].y - iwa[j].y);
            expect(iwa[i].radiusPx + iwa[j].radiusPx, `${stage.id} 岩どうし`).toBeLessThanOrEqual(d);
          }
        }
      }
    });
  }

  it('実機（Pixel 7 / iPhone 12）の縦持ちで、岩も 70px を下回らない', () => {
    // 水たまりと同じ基準（§5-3）。**下限を設けて広げるのではない** ——
    // 狭すぎたら岩の位置のほうを直す
    for (const [name, width, height] of DEVICES.slice(0, 2)) {
      for (const stage of STAGES) {
        const holes = new HoleSystem(stage);
        const p = project(width, height);
        holes.measure(p);
        const rocks = new RockSystem(stage, null);
        rocks.measure(p, holes);
        for (const rock of rocks.describe()) {
          expect(rock.radiusPx, `${name} ${stage.id}/${rock.id}`).toBeGreaterThanOrEqual(70);
        }
      }
    }
  });

  it('岩は画面の中に入っている', () => {
    // **「置いたのに見えない」ときは、まず画面に入っているかを疑う**
    // （「ばあ！」で飾りを x = ±5.2 に並べて 9株のうち4株が画面の外だった）
    for (const stage of STAGES) {
      const rocks = new RockSystem(stage, null);
      rocks.measure(project(412, 839), null);
      for (const rock of rocks.describe()) {
        expect(rock.x, `${stage.id}/${rock.id} x`).toBeGreaterThan(0);
        expect(rock.x, `${stage.id}/${rock.id} x`).toBeLessThan(412);
        expect(rock.y, `${stage.id}/${rock.id} y`).toBeGreaterThan(0);
        expect(rock.y, `${stage.id}/${rock.id} y`).toBeLessThan(839);
      }
    }
  });
});

/**
 * 岩が魚を隠しているか（2026-09-14、人間の指示「岩に隠れるようにしてください」）。
 *
 * ==========================================================================
 * **位置ではなく遮蔽で確かめる。**
 *
 * 「ばあ！」で**高さが正しくても見えていない**ことが3回あった（どれも数値の
 * テストは通っていた）。逆に、隠しているつもりで**絵では隠れていない**ことも
 * あった（うみ の すいめん で、クマノミが丸ごと画面に出ていた）。
 * 画素比較は禁止（魚が常に動く）なので、**カメラからレイを飛ばして**見る。
 *
 * **格子は 15×15。** 「ばあ！」で 7×9 にしたら 0.05 幅の隙間をすり抜けた。
 *
 * 魚の代わりに**いちばん大きい魚（エイ 1.09 × 1.24 × 0.35）の箱**を置く。
 * node には DOM が無いので `createProceduralFish` は canvas の絵に落ち、
 * **実際より小さい板**になる。それで測ると**甘い方向に外れる**ので、
 * 本番でいちばん大きくなる形を自分で置く。
 * ==========================================================================
 */
describe('岩が魚を隠す（§4-8）', () => {
  /** いちばん大きい魚の、隠れているときの見かけの大きさ（ワールド） */
  const RAY = { w: 1.09, h: 1.24, d: 0.35 };

  function occlusionMisses(stageId: string, rockIndex: number): number {
    const stage = findStage(stageId)!;
    const rocks = new RockSystem(stage, null);
    const scene = new THREE.Group();
    scene.add(rocks.group);

    // 魚の箱を、`place()` が reveal 0 で置くのと同じ姿勢で置く
    const runtime = rocks.runtimes[rockIndex];
    const s = ROCK_TIMING.fishScale * ROCK_TIMING.hiddenScale;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(RAY.w * s, RAY.h * s, RAY.d * s),
      new THREE.MeshBasicMaterial()
    );
    box.name = 'fish';
    box.position.set(
      runtime.worldPosition.x,
      runtime.worldPosition.y + ROCK_HIDE_LIFT,
      ROCK_HIDDEN_Z
    );
    scene.add(box);
    scene.updateMatrixWorld(true);

    const camera = new THREE.PerspectiveCamera(66, 412 / 839, 0.1, 100);
    camera.position.set(0, 0.3, 7.2);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    // 箱の見かけの矩形（8隅を投影して囲む）
    const bb = new THREE.Box3().setFromObject(box);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? bb.max.x : bb.min.x,
        i & 2 ? bb.max.y : bb.min.y,
        i & 4 ? bb.max.z : bb.min.z
      );
      corner.project(camera);
      minX = Math.min(minX, corner.x);
      maxX = Math.max(maxX, corner.x);
      minY = Math.min(minY, corner.y);
      maxY = Math.max(maxY, corner.y);
    }

    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let misses = 0;
    const N = 15;
    for (let iy = 0; iy < N; iy++) {
      for (let ix = 0; ix < N; ix++) {
        ndc.set(
          minX + ((maxX - minX) * ix) / (N - 1),
          minY + ((maxY - minY) * iy) / (N - 1)
        );
        raycaster.setFromCamera(ndc, camera);
        const hits = raycaster.intersectObject(scene, true);
        if (hits.length === 0) continue;
        // **いちばん手前が魚なら、そこは見えている**
        if (hits[0].object.name === 'fish') misses++;
      }
    }
    box.geometry.dispose();
    (box.material as THREE.Material).dispose();
    rocks.dispose();
    return misses;
  }

  for (const stage of STAGES) {
    for (let i = 0; i < 2; i++) {
      it(`${stage.id} の岩${i + 1} は、出はじめの魚を1点も見せない`, () => {
        // **出はじめ（reveal 0）で1画素も見えていないこと。**
        // ここが 0 でないと、「何もない水の中にぽっと湧く」が戻る
        expect(occlusionMisses(stage.id, i)).toBe(0);
      });
    }
  }
});

/**
 * やさしい得点とステージの入れ替え（§4-6 / §5-3。Phase 4）。
 *
 * ==========================================================================
 * **★の数え方そのものは DOM が要る**（`ui/Score.ts` は `document` を使う）ので、
 * ここでは**入れ替えの仕掛け**を見る。E2E 側が「10回叩くと花が咲いて
 * ステージが変わる」を通しで見ている。
 *
 * ここで押さえるのは **「花が咲いてもステージが永遠に変わらない」** という
 * 壊れ方。抽選を止めたあと魚が引っ込みきらないと `countActive()` が 0 に
 * ならず、切り替えが起きない。**目で見ても「たまに変わらない」としか
 * 分からない**ので、数値にして残す。
 * ==========================================================================
 */
describe('得点とステージの入れ替え（§4-6 / §5-3）', () => {
  function makeBoth(seed: number): { fish: FishSystem; spawner: Spawner } {
    const fish = new FishSystem(STAGES[0].fish.map((id) => findFish(id)!));
    return { fish, spawner: new Spawner(STAGES[0].holes.length, seed) };
  }
  const DT = 1 / 60;

  it('★10個で花が1つ（§4-6）', () => {
    expect(STARS_PER_FLOWER).toBe(10);
  });

  it('抽選を止めれば、魚は必ず引っ込みきる（§5-3）', () => {
    // ==================================================================
    // **ここが 0 にならないとステージが永遠に変わらない。**
    //
    // `FishSystem` の「最後の1匹は代わりが出るまで沈まない」（不変条件4c）が
    // 引っかかるのでは、と思って解除する仕掛けを書いたが、**実測して
    // 要らないと分かった**（8通りのうち7通りでフレーム数が同じ）。
    // あの決まりが効くのは「相棒が沈んでいる最中」だけで、相棒はすぐ
    // `hidden` になるので自然に解ける。
    //
    // **いろいろな時点で止めて確かめる。** 止めた瞬間の状態によって
    // 引っかかり方が変わるので、1点だけ見ても意味が無い
    // ==================================================================
    for (const warmup of [300, 600, 900, 1200, 1500, 1800, 2100, 2400]) {
      const { fish, spawner } = makeBoth(4321);
      for (let i = 0; i < warmup; i++) {
        spawner.update(DT, fish);
        fish.update(DT);
      }
      spawner.setPaused(true);

      let frames = -1;
      for (let f = 0; f < 60 * 30; f++) {
        fish.update(DT);
        if (fish.countActive() === 0) {
          frames = f;
          break;
        }
      }
      expect(frames, `${warmup}フレームで止めたら引っ込みきらなかった`).toBeGreaterThanOrEqual(0);
      // 実測は 32〜283フレーム。**待たせすぎていないこと**も見る
      expect(frames, `${warmup}フレームで止めたら ${frames}フレーム掛かった`).toBeLessThan(60 * 8);
    }
  });

  it('引っ込みきるまで、叩ける相手は居続ける（不変条件2）', () => {
    // **入れ替えを待つあいだも叩ける。** 沈んでいる途中も `hit()` は通る
    const { fish, spawner } = makeBoth(4321);
    for (let i = 0; i < 60 * 20; i++) {
      spawner.update(DT, fish);
      fish.update(DT);
    }
    spawner.setPaused(true);
    let sawHittable = 0;
    for (let i = 0; i < 60 * 12; i++) {
      if (fish.countHittable() > 0) sawHittable++;
      fish.update(DT);
      if (fish.countActive() === 0) break;
    }
    expect(sawHittable, '止めた瞬間から叩けなくなっていた').toBeGreaterThan(0);
  });

  it('抽選を再開すると、また出はじめる', () => {
    // **解き忘れると、入れ替えたあとのステージで魚が1匹も出ない**
    const { fish, spawner } = makeBoth(4321);
    spawner.setPaused(true);
    for (let i = 0; i < 60 * 12; i++) {
      spawner.update(DT, fish);
      fish.update(DT);
    }
    expect(fish.countActive()).toBe(0);

    spawner.setPaused(false);
    for (let i = 0; i < 60 * 6; i++) {
      spawner.update(DT, fish);
      fish.update(DT);
    }
    expect(fish.countActive(), '解いても出てこない').toBeGreaterThan(0);
  });
});

/**
 * 叩けるかどうかを、遊びかたごとに測る（§4-7。2026-09-16）。
 *
 * ==========================================================================
 * **実機で「魚の戻るのが早くて、叩けない時が多々ある」と言われた。**
 *
 * 原因は `up` の長さそのものではなく、**介助（`ASSIST`）が常に下限まで
 * 縮めていた**こと。沈む最中の遅い指も「当たり」に数える（§4-3）ので、
 * **当たりは連続しやすく、外しは連続しにくい**。結果、どんな遊びかたでも
 * 下限に張り付いた。設計書 §4-7 が「当たるようになってきたからと
 * 速くしていくと、いちばん当たっていた設定を自分で壊す」と警告していた
 * とおりの壊れ方をしていた。
 *
 * **目で見ても「たまに間に合わない」としか分からない**ので、
 * 1歳半らしい遊びかたを数値にして見張る。
 * ==========================================================================
 */
describe('叩けるかどうか（§4-7）', () => {
  /**
   * 反応 `react` 秒（ばらつき `jitter`）で、`wrongAim` の割合で別の場所を押す
   * 子どもが `seconds` 秒遊んだときの結果。
   *
   * **出きってから気づく**（`rising` 中は見ていない）。
   * **間に合わなかった指は空の水たまりに落ちる** —— 実機ではそれが
   * 「外し」になり、介助が効く。捨ててしまうと介助が測れない
   */
  function play(react: number, jitter: number, wrongAim: number, seconds = 400) {
    const fish = new FishSystem(STAGES[0].fish.map((id) => findFish(id)!));
    const spawner = new Spawner(STAGES[0].holes.length, 4321);
    const DT = 1 / 60;
    let seed = 98765;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    const aim = new Map<number, number>();
    const seen = new Set<number>();
    let t = 0;
    let hits = 0;
    let misses = 0;
    /** **間に合わずに逃げられた回。ここが増えるのが「叩けない」** */
    let tooLate = 0;

    for (let f = 0; f < seconds * 60; f++) {
      spawner.update(DT, fish);
      fish.update(DT);
      t += DT;

      fish.actors.forEach((a, i) => {
        if (a.state === 'up' && !seen.has(i)) {
          seen.add(i);
          aim.set(i, t + react + (rnd() - 0.5) * 2 * jitter);
        }
        if (a.state === 'hidden' && seen.has(i)) seen.delete(i);
      });

      for (const [i, when] of [...aim]) {
        if (t < when) continue;
        aim.delete(i);
        if (rnd() < wrongAim) {
          misses++;
          spawner.reportHit(false);
          spawner.applyAssist(fish);
          continue;
        }
        const a = fish.actors[i];
        const reachable = a.state === 'rising' || a.state === 'up' || a.state === 'retreating';
        if (reachable && fish.hit(i)) {
          hits++;
          spawner.reportHit(true);
        } else {
          misses++;
          tooLate++;
          spawner.reportHit(false);
        }
        spawner.applyAssist(fish);
      }
    }
    return { hits, misses, tooLate, finalUpSec: fish.getUpSec() };
  }

  /** 反応の速さ・ばらつき・狙いの外しかた。**いちばん遅い子まで見る** */
  const PLAYERS: [string, number, number, number][] = [
    ['速い', 1.2, 0.4, 0.15],
    ['ふつう', 1.8, 0.6, 0.2],
    ['遅い', 2.4, 0.8, 0.25],
    ['とても遅い', 3.0, 1.0, 0.3],
  ];

  for (const [name, react, jitter, wrongAim] of PLAYERS) {
    it(`${name}子（反応 ${react}±${jitter}秒）が、間に合わずに逃げられない`, () => {
      const r = play(react, jitter, wrongAim);
      // **狙いを外すのは構わない**（それは当たり判定の話）。
      // ここで見るのは「**狙ったのに、もう居なかった**」回
      expect(r.tooLate, `${r.tooLate}回 間に合わなかった`).toBe(0);
    });
  }

  it('介助が、いちばん難しい設定に張り付かない', () => {
    // **`minUpSec` を下げ直すときは、ここが落ちることを承知で人間が決めること。**
    // 4通りとも下限に張り付くのは仕様どおり（当たりは連続しやすい）。
    // **張り付いた先が十分に長いか**を見る
    const worst = ASSIST.minUpSec + TIMING.retreatSec;
    expect(worst, `張り付いても ${worst.toFixed(1)}秒`).toBeGreaterThanOrEqual(5.5);
    for (const [name, react, jitter, wrongAim] of PLAYERS) {
      const r = play(react, jitter, wrongAim);
      expect(r.finalUpSec, `${name}子`).toBeGreaterThanOrEqual(ASSIST.minUpSec);
    }
  });
});

/**
 * ときどき出る特別な魚（§6-2。2026-09-16、人間が選んだ）。
 *
 * ==========================================================================
 * **抽選の当たりと、実際に出る割合は違う。**
 *
 * 「ばあ！」でサプライズの当たりに 1/3 をそのまま入れたら、2連続で出さない
 * 規則があったせいで**実測は 3.7〜4.0回に1回**だった。設計書 §6-2 は
 * 「**必ず数えて確かめること**」と書いている。ここがその数え役。
 * ==========================================================================
 */
describe('特別な魚（§6-2）', () => {
  it('乱数の数直線を3つに区切っているだけ（片方が他方を押し出さない）', () => {
    // **先に金を判定して残りで大を判定すると、大の実測が 1/20 にならない**
    // （1/17.1 になる）。1本の数直線を切れば、どちらも指定どおりになる
    expect(pickVariant(0)).toBe('gold');
    expect(pickVariant(SPECIAL.goldChance - 1e-9)).toBe('gold');
    expect(pickVariant(SPECIAL.goldChance)).toBe('big');
    expect(pickVariant(SPECIAL.goldChance + SPECIAL.bigChance - 1e-9)).toBe('big');
    expect(pickVariant(SPECIAL.goldChance + SPECIAL.bigChance)).toBe('normal');
    expect(pickVariant(0.999)).toBe('normal');
  });

  it('実測の割合が、指定どおりになる（きんいろ 1/16・大きい 1/20）', () => {
    // **一様な乱数で数える。** `Spawner` の乱数そのものではなく、
    // 区切りかたが正しいかを見る（`Spawner` 側は下のテストで見る）
    const N = 200000;
    let gold = 0;
    let big = 0;
    for (let i = 0; i < N; i++) {
      const v = pickVariant((i + 0.5) / N);
      if (v === 'gold') gold++;
      else if (v === 'big') big++;
    }
    expect(N / gold, `きんいろは ${(N / gold).toFixed(1)}回に1回`).toBeCloseTo(16, 1);
    expect(N / big, `大きいは ${(N / big).toFixed(1)}回に1回`).toBeCloseTo(20, 1);
  });

  it('実際に出してみても、その割合になる（§6-2「必ず数えて確かめる」）', () => {
    // ==================================================================
    // **`Spawner` を通して数える。** 区切りかたが正しくても、
    // 乱数の引きかたを変えたときにここがずれる。
    // 「ばあ！」はここを確かめずに 1/3 を入れて、実測 1/3.7〜4.0 だった
    // ==================================================================
    const counts = { normal: 0, big: 0, gold: 0 };
    const DT = 1 / 60;
    // シードを変えて何回も回す（1本の列だけだと偏りを見逃す）
    for (let seed = 1; seed <= 40; seed++) {
      const fish = new FishSystem(STAGES[0].fish.map((id) => findFish(id)!));
      const spawner = new Spawner(STAGES[0].holes.length, seed * 7919);
      const seen = new Set<number>();
      for (let f = 0; f < 60 * 600; f++) {
        spawner.update(DT, fish);
        fish.update(DT);
        fish.actors.forEach((a, i) => {
          if (a.state !== 'hidden' && !seen.has(i)) {
            seen.add(i);
            counts[a.variant]++;
          }
          if (a.state === 'hidden') seen.delete(i);
        });
      }
    }
    const total = counts.normal + counts.big + counts.gold;
    const goldRate = total / counts.gold;
    const bigRate = total / counts.big;
    // **実測を報告する。** ずれたら当たりのほうを直すこと（基準は動かさない）
    expect(total, `${total}回ぶん数えた`).toBeGreaterThan(3000);
    expect(goldRate, `きんいろは実測 ${goldRate.toFixed(1)}回に1回`).toBeGreaterThan(13);
    expect(goldRate, `きんいろは実測 ${goldRate.toFixed(1)}回に1回`).toBeLessThan(19);
    expect(bigRate, `大きいは実測 ${bigRate.toFixed(1)}回に1回`).toBeGreaterThan(17);
    expect(bigRate, `大きいは実測 ${bigRate.toFixed(1)}回に1回`).toBeLessThan(24);
  });

  it('引っ込んだら、色も大きさも元に戻る', () => {
    // **魚は1種につき1匹しか持っていない。** 戻し忘れると、
    // 次に同じ魚が出たときも金のまま・大きいままになる
    const fish = new FishSystem(STAGES[0].fish.map((id) => findFish(id)!));
    fish.spawn(0, 0, 1, 'gold');
    expect(fish.actors[0].variant).toBe('gold');
    for (let i = 0; i < 60 * 30; i++) {
      fish.update(1 / 60);
      if (fish.actors[0].state === 'hidden') break;
    }
    expect(fish.actors[0].state).toBe('hidden');
    expect(fish.actors[0].variant, '金のままになっている').toBe('normal');
  });

  it('大きいさかなは、出ている時間を変えない（当てやすさは同じ）', () => {
    // §6-2:「1.4倍で、叩くと星が3つ増える。**出ている時間は同じ**」
    const a = new FishSystem(STAGES[0].fish.map((id) => findFish(id)!));
    const b = new FishSystem(STAGES[0].fish.map((id) => findFish(id)!));
    a.spawn(0, 0, 1, 'normal');
    b.spawn(0, 0, 1, 'big');
    let ta = -1;
    let tb = -1;
    for (let i = 0; i < 60 * 30; i++) {
      a.update(1 / 60);
      b.update(1 / 60);
      if (ta < 0 && a.actors[0].state === 'retreating') ta = i;
      if (tb < 0 && b.actors[0].state === 'retreating') tb = i;
    }
    expect(tb).toBe(ta);
  });
});


/**
 * サプライズ（§6-3）— 画面の下から大きく1匹
 *
 * ==========================================================================
 * **絵に重ねて測ってから書いた**（2026-09-17）。
 * 芯の1点を投影して円で見ていたころは、エイ（横 302px・縦 224px の平たい魚）の
 * **右の翼が円の外**に出ていて、見えているのに叩けなかった。
 * ここに置いてあるのは、そのとき測った数値そのもの。
 * ==========================================================================
 */
describe('サプライズ（§6-3）', () => {
  const rockFish = () => findFish(STAGES[0].rockFish!)!;
  /** 出てくるまで進める。**壁時計を読まない**（更新時計だけ） */
  function runUntil(
    fish: SurpriseFish,
    want: (f: SurpriseFish) => boolean,
    maxSec = 120,
    rockHidden = true
  ): number {
    for (let i = 0; i < maxSec * 60; i++) {
      fish.update(1 / 60, rockHidden);
      if (want(fish)) return i / 60;
    }
    return -1;
  }

  it('時計で出る。間隔は 22〜34秒（叩いた数に依らない）', () => {
    // **抽選ではなく時計**（`data/special.ts`）。出現数に紐づけると、
    // よく叩く子ほどサプライズが増えて「大きいのが普通」になる
    const fish = new SurpriseFish(rockFish(), null, null, seededRandom(0x3f7a19c5));
    let last = 0;
    let elapsed = 0;
    const gaps: number[] = [];
    for (let i = 0; i < 60 * 60 * 5; i++) {
      const before = fish.count;
      fish.update(1 / 60, true);
      elapsed += 1 / 60;
      if (fish.count > before) {
        gaps.push(elapsed - last);
        last = elapsed;
      }
    }
    expect(gaps.length, `5分で ${gaps.length}回`).toBeGreaterThan(5);
    for (const gap of gaps) {
      // 前の1周（出て沈むまで）のぶん、間隔は待ち時間より長くなる
      expect(gap).toBeGreaterThanOrEqual(SURPRISE.minGapSec);
      expect(gap).toBeLessThanOrEqual(
        SURPRISE.maxGapSec +
          SURPRISE.callSec +
          SURPRISE.riseSec +
          SURPRISE.outSec +
          SURPRISE.sinkSec +
          0.1
      );
    }
  });

  it('岩の魚が出ているあいだは始まらない。ただし時計は進む', () => {
    // **同じ種を使っている**ので、2匹同時に出ると「同じ魚が2箇所」になる。
    // 時計まで止めると、岩をよく押す子にはサプライズが永遠に来ない
    const fish = new SurpriseFish(rockFish(), null, null, seededRandom(1));
    const held = runUntil(fish, (f) => f.state !== 'hidden', 60, false);
    expect(held, '岩が出ているのに始まった').toBe(-1);
    // 岩が引っ込んだ瞬間に出る（時計は溜まっている）
    fish.update(1 / 60, true);
    expect(fish.state).toBe('calling');
  });

  it('出はじめから沈みきるまで、どのフレームでも叩ける（不変条件2）', () => {
    // **「アニメーション中だから無視」は禁止。** 「ばあ！」の貝で
    // 連打すると開閉が一度も完了せず、開き量の最大が 0.037 だった
    const fish = new SurpriseFish(rockFish(), null, null, seededRandom(2));
    fish.forceNow();
    runUntil(fish, (f) => f.state === 'rising');
    const p = project(412, 839);
    let frames = 0;
    for (let i = 0; i < 60 * 10; i++) {
      fish.update(1 / 60, true);
      if (fish.state === 'hidden') break;
      fish.measure(p);
      // **姿が出ているあいだは必ず叩ける**（芯を押した場合）
      const d = fish.describe();
      expect(fish.hitTest(d.x, d.y), `${fish.state} で押せない`).toBe(true);
      frames++;
    }
    expect(frames, '一度も出なかった').toBeGreaterThan(60);
  });

  it('叩いたら、その場で潰れが始まる（0フレーム原則・§4-3）', () => {
    const fish = new SurpriseFish(rockFish(), null, null, seededRandom(3));
    fish.forceNow();
    runUntil(fish, (f) => f.state === 'out');
    expect(fish.squash).toBe(0);
    expect(fish.hit()).toBe(true);
    // **`update()` を待たない**
    expect(fish.squash).toBeGreaterThan(0);
    expect(fish.state).toBe('hit');
  });

  it('隠れているあいだは、タップを横取りしない', () => {
    // サプライズは**タップの列でいちばん先**に見られる（`App.onTap`）。
    // 隠れているのに当たると、水たまりが押せなくなる
    const fish = new SurpriseFish(rockFish(), null, null, seededRandom(4));
    fish.measure(project(412, 839));
    expect(fish.hitTest(206, 700)).toBe(false);
    expect(fish.hit()).toBe(false);
  });

  for (const [name, width, height] of DEVICES) {
    it(`${name} ${width}×${height} で、当たり楕円が下の段より上の水たまりを取らない`, () => {
      // ==================================================================
      // **下の段は覆う。** 画面の下から大きく出るので、下の段の真上に来る
      // （実測 412×839 で、下の段の芯は楕円の内側 0.32 / 0.63）。
      // そこは `Spawner.setHeld()` で魚を出さないことで塞いである。
      // **上の段まで取ってはいけない** —— 覆っていないのに押しを奪うと、
      // 「見えている魚を押したのに違うものが反応する」になる
      // ==================================================================
      const holes = new HoleSystem(STAGES[0]);
      const p = project(width, height);
      holes.measure(p);
      const spots = holes.describe();
      const fish = new SurpriseFish(rockFish(), null, null, seededRandom(5));
      fish.forceNow();
      for (let i = 0; i < 60 * 60; i++) {
        fish.update(1 / 60, true);
        if (fish.state === 'out') break;
      }
      expect(fish.state).toBe('out');
      fish.measure(p);
      const d = fish.describe();
      // 下の段（画面のいちばん下）以外は、芯が楕円の外にあること
      const bottom = Math.max(...spots.map((s) => s.y));
      for (const spot of spots) {
        if (Math.abs(spot.y - bottom) < 1) continue;
        const t = Math.hypot((spot.x - d.x) / d.rx, (spot.y - d.y) / d.ry);
        expect(t, `${spot.id} が楕円の中（${t.toFixed(2)}）`).toBeGreaterThan(1);
      }
    });
  }

  it('当たり楕円の中心が、見かけの体の中心と一致する', () => {
    // **芯の1点を投影するだけでは足りない**（2026-09-17、絵で測った）。
    // 体の世界の境界箱を投影して、その矩形の中心で見ること
    const fish = new SurpriseFish(rockFish(), null, null, seededRandom(6));
    fish.forceNow();
    for (let i = 0; i < 60 * 60; i++) {
      fish.update(1 / 60, true);
      if (fish.state === 'out') break;
    }
    const p = project(412, 839);
    fish.measure(p);
    const d = fish.describe();
    // 体は画面の中ほどより下（下から出てくるので）
    expect(d.y).toBeGreaterThan(839 * 0.5);
    // **平たい魚を円で見ない。** 横と縦が別に測れていること
    expect(d.rx).toBeGreaterThan(40);
    expect(d.ry).toBeGreaterThan(40);
  });

  it('サプライズが出ているあいだ、水たまりに新しい魚を出さない', () => {
    // 覆われて見えない魚が下の段に出るのを防ぐ（`Spawner.setHeld()`）
    const fish = new FishSystem(STAGES[0].fish.map((id) => findFish(id)!));
    const spawner = new Spawner(6);
    spawner.setHeld(true);
    for (let i = 0; i < 60 * 10; i++) spawner.update(1 / 60, fish);
    expect(fish.countActive(), '止めているのに出た').toBe(0);
    // **解けば出る**（止めっぱなしにならないこと）
    spawner.setHeld(false);
    for (let i = 0; i < 60 * 10; i++) spawner.update(1 / 60, fish);
    expect(fish.countActive()).toBeGreaterThan(0);
  });

  it('止めかたが2つあっても、片方を解いたらもう片方まで解けない', () => {
    // **1つの旗を2箇所から立てると、サプライズが終わった瞬間に
    // 入れ替え待ちの停止まで解けて、入れ替えが永遠に終わらない**
    const fish = new FishSystem(STAGES[0].fish.map((id) => findFish(id)!));
    const spawner = new Spawner(6);
    spawner.setPaused(true);
    spawner.setHeld(true);
    spawner.setHeld(false);
    for (let i = 0; i < 60 * 10; i++) spawner.update(1 / 60, fish);
    expect(fish.countActive(), '入れ替え待ちの停止が解けている').toBe(0);
  });
});
