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
import { ASSIST, MAX_UP_FISH, TIMING } from '../../src/data/timing';
import { FishSystem } from '../../src/poko/FishSystem';
import { HoleSystem } from '../../src/poko/HoleSystem';
import { Spawner } from '../../src/poko/Spawner';
import { FISH_Z, LIP_Z, WATER_Z } from '../../src/poko/WaterShape';

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

describe('魚は水面の2枚のあいだから出る（§5-2）', () => {
  it('奥行きの順番が 池の面 < 魚 < 手前の水面', () => {
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
    expect(WATER_Z).toBeLessThan(FISH_Z);
    expect(FISH_Z).toBeLessThan(LIP_Z);
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

describe('さかなの状態遷移（§4-1 / §4-3）', () => {
  function makeSystem(): FishSystem {
    return new FishSystem(STAGES[0].fish.map((id) => findFish(id)!));
  }
  /** 固定タイムステップで n 秒ぶん進める。**壁時計を読まない**（§11-4） */
  function advance(fish: FishSystem, seconds: number): void {
    const dt = 1 / 60;
    for (let i = 0; i < Math.round(seconds / dt); i++) fish.update(dt);
  }

  it('出てくるのは 0.65秒（v0.1 の 0.22秒から遅くした）', () => {
    expect(TIMING.risingSec).toBeCloseTo(0.65, 5);
    const fish = makeSystem();
    fish.spawn(0, 0, 1);
    advance(fish, 0.3);
    // 途中では出きっていない
    expect(fish.actors[0].state).toBe('rising');
    expect(fish.actors[0].reveal).toBeGreaterThan(0);
    expect(fish.actors[0].reveal).toBeLessThan(1);
    advance(fish, 0.4);
    expect(fish.actors[0].state).toBe('up');
    expect(fish.actors[0].reveal).toBe(1);
  });

  it('出ている時間は 4.0秒（v0.1 の 2.6秒から伸ばした）', () => {
    expect(TIMING.upSec).toBeCloseTo(4.0, 5);
    const fish = makeSystem();
    fish.spawn(0, 0, 1);
    advance(fish, 0.7 + 3.5);
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
    advance(fish, 0.7);
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
    advance(fish, 0.2);
    expect(fish.actors[0].state).toBe('rising');
    expect(fish.hit(0)).toBe(true);
    expect(fish.actors[0].squash).toBeGreaterThan(0);
  });

  it('潰れている最中に叩いても反応は返るが、得点は増えない（§4-6）', () => {
    const fish = makeSystem();
    fish.spawn(0, 0, 1);
    advance(fish, 0.7);
    expect(fish.hit(0)).toBe(true);
    // 2回目以降は false（得点が増えない）。**例外は投げない**
    expect(fish.hit(0)).toBe(false);
    expect(() => fish.hit(0)).not.toThrow();
  });

  it('60Hz で連打しても、沈みきるまで完走する', () => {
    // **「連打しても壊れない」は「連打しても動く」まで確かめる**（§14-1）
    const fish = makeSystem();
    fish.spawn(0, 0, 1);
    advance(fish, 0.7);
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
    const { fish, spawner } = makeBoth();
    const dt = 1 / 60;
    let zeroFrames = 0;
    // 最初の1フレームで出はじめる
    spawner.update(dt, fish);
    fish.update(dt);
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
    const order: number[] = [];
    const seen = new Set<number>();
    for (let i = 0; i < 60 * 120; i++) {
      spawner.update(dt, fish);
      fish.update(dt);
      for (const actor of fish.actors) {
        if (actor.state === 'rising' && actor.reveal < 0.05 && !seen.has(actor.holeIndex * 1e6 + i)) {
          if (actor.elapsed <= dt * 1.5) order.push(actor.holeIndex);
        }
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
