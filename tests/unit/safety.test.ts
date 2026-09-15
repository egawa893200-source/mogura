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
import { STAGES, findStage } from '../../src/data/stages';
import { ASSIST, MAX_UP_FISH, ROCK_TIMING, TIMING } from '../../src/data/timing';
import { FishSystem } from '../../src/poko/FishSystem';
import { HoleSystem } from '../../src/poko/HoleSystem';
import {
  HIDDEN_Z as ROCK_HIDDEN_Z,
  HIDE_LIFT as ROCK_HIDE_LIFT,
  RockSystem,
} from '../../src/poko/RockSystem';
import { Spawner } from '../../src/poko/Spawner';
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

  it('出ている時間は 4.0秒（v0.1 の 2.6秒から伸ばした）', () => {
    expect(TIMING.upSec).toBeCloseTo(4.0, 5);
    const fish = makeSystem();
    fish.spawn(0, 0, 1);
    advance(fish, TIMING.callSec + 0.7 + 3.5);
    expect(fish.actors[0].state).toBe('up');
    advance(fish, 0.7);
    expect(fish.actors[0].state).toBe('retreating');
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

  it('引っ込む途中に押しても、もう一度出てくる（不変条件2）', () => {
    // ==================================================================
    // **みずのなかから変えたところ。**
    // 向こうは `retreating` 中と `cooldown` 中のタップを捨てていたが、
    // それは「アニメーション中だから無視」そのもので、この app では禁止。
    // 向こうの貝がまさにそれで壊れている（連打すると 0.45秒の開閉が
    // 一度も完了せず、開き量の最大が 0.037 だった）
    // ==================================================================
    const rocks = rocksOf('ike');
    rocks.tap(0);
    while (rocks.state !== 'retreating') rocks.update(1 / 60);
    expect(rocks.tap(0)).toBe('baa');
    expect(rocks.state).toBe('calling');
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
