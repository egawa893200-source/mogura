/**
 * 出現の抽選（設計書 §4-2 / §4-7）
 *
 * ==========================================================================
 * **押さなくても画面が動き続ける**のが、「ばあ！」との決定的な違い。
 * 「ばあ！」は押すまで画面が止まっていて、押した結果も「現れる」だけだった。
 *
 * 決まりごと:
 *  - 同時に出ているのは **1〜2匹**（`MAX_UP_FISH`）
 *  - **最低1匹は常に出ているか、出はじめている**（不変条件4c）。
 *    0匹になりそうなら、次の抽選を待たずに即座に1匹出す
 *  - **同じ水たまりから続けて出さない**
 *  - 出る魚はそのステージの2種から選ぶ。**同じ魚が同時に2箇所に出ない**
 *    （`FishSystem` が1種につき1匹しか持たないので、原理的に起きない）
 *
 * **乱数は独立したシードから引く**（§4-2）。three は `generateUUID()` で
 * 1オブジェクトにつき `Math.random()` を4回消費するので、共有の乱数を使うと
 * **オブジェクトを1つ足しただけで抽選が変わる**（みずのなかで実測。
 * 触っていない水槽の測定値が 0.980 → 0.173 に動いた）。
 * ==========================================================================
 */

import { ASSIST, MAX_UP_FISH, TIMING } from '../data/timing';
import type { FishSystem } from './FishSystem';

/** mulberry32。小さくて速く、同じ種からは必ず同じ列が出る */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Spawner {
  private readonly rng: () => number;
  private wait = 0;
  private lastHole = -1;
  /** 介助（§4-7）。**画面には出さない** */
  private missStreak = 0;
  private hitStreak = 0;

  constructor(
    private readonly holeCount: number,
    seed = 0x9e3779b9
  ) {
    this.rng = seededRandom(seed);
    this.wait = this.nextWait();
  }

  /** 叩けた／外したを伝える。介助がこれを見て `up` の長さを動かす（§4-7） */
  reportHit(success: boolean): void {
    if (success) {
      this.hitStreak++;
      this.missStreak = 0;
    } else {
      this.missStreak++;
      this.hitStreak = 0;
    }
  }

  update(dt: number, fish: FishSystem): void {
    // ==================================================================
    // **叩ける相手が途切れないこと**（不変条件4c）。
    // 0匹になりそうなら、待ち時間を無視して即座に出す。
    // **画面に何も無い時間を作らない。**
    // ==================================================================
    // **沈みはじめた時点で次を出す。** 沈みきってから出すと、
    // そのあいだ叩ける相手が居なくなる（実測で 6フレーム空いた）
    if (fish.countRisingOrUp() === 0) {
      this.trySpawn(fish);
      return;
    }

    // **上限に達しているあいだは時計を進めない**（§4-2）。
    // 進めてしまうと、1匹沈んだ瞬間に溜まっていたぶんが一気に出る
    if (fish.countActive() >= MAX_UP_FISH) return;

    this.wait -= dt;
    if (this.wait > 0) return;
    this.wait = this.nextWait();
    this.trySpawn(fish);
  }

  /** 介助。**範囲外には出さない**（§4-7） */
  applyAssist(fish: FishSystem): void {
    let up = fish.getUpSec();
    if (this.missStreak >= ASSIST.missesToEase) {
      up = Math.min(ASSIST.maxUpSec, up + ASSIST.step);
      this.missStreak = 0;
    } else if (this.hitStreak >= ASSIST.hitsToTighten) {
      up = Math.max(ASSIST.minUpSec, up - ASSIST.step);
      this.hitStreak = 0;
    }
    fish.setUpSec(up);
  }

  private nextWait(): number {
    return TIMING.spawnMinSec + this.rng() * (TIMING.spawnMaxSec - TIMING.spawnMinSec);
  }

  private trySpawn(fish: FishSystem): boolean {
    if (fish.countActive() >= MAX_UP_FISH) return false;

    // 空いている魚
    const free: number[] = [];
    for (let i = 0; i < fish.actors.length; i++) {
      if (fish.actors[i].state === 'hidden') free.push(i);
    }
    if (free.length === 0) return false;

    // 空いている水たまり。**直前に使った場所を外す**
    const used = new Set<number>();
    for (const actor of fish.actors) {
      if (actor.holeIndex >= 0) used.add(actor.holeIndex);
    }
    const open: number[] = [];
    for (let i = 0; i < this.holeCount; i++) {
      if (!used.has(i) && i !== this.lastHole) open.push(i);
    }
    // **外した結果が空なら、直前の場所も許す。** 無反応を作らないほうが優先
    const pool = open.length > 0 ? open : [...Array(this.holeCount).keys()].filter((i) => !used.has(i));
    if (pool.length === 0) return false;

    const actorIndex = free[Math.floor(this.rng() * free.length) % free.length];
    const holeIndex = pool[Math.floor(this.rng() * pool.length) % pool.length];
    // §6-1 のばらつき。**速さを ±10% 振る**（合計時間は待ちで吸収する）
    const speed = 0.9 + this.rng() * 0.2;
    if (!fish.spawn(actorIndex, holeIndex, speed)) return false;
    this.lastHole = holeIndex;
    return true;
  }
}
