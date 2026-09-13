/**
 * さかなの状態遷移（設計書 §4-1 / §4-3）
 *
 * ==========================================================================
 * **`reveal`（出ている量 0..1）が状態機械の本体。**
 * タップは `reveal` を直接書き換えない —— 状態を変えるだけで、
 * 進みかたは `update()` が決める。「ばあ！」と同じ作り。
 *
 * ```
 * hidden ──(抽選)──> rising ──> up ──┬──(叩かれた)──> hit ──> hidden
 *                      │             │
 *                      │             └──(時間切れ)──> retreating ──> hidden
 *                      └──(叩かれた)──> hit ──> hidden
 * ```
 *
 * **`rising` の途中でも叩ける**こと（不変条件2）。出きるまで待たせない。
 * 「みずのなか」の貝は開閉中のタップで向きを反転していたため、連打すると
 * 0.45秒の開閉が一度も完了せず、**開き量の最大が 0.037**（1回押しなら 1.0）
 * だった。実機で「触っても反応しない」と報告された。
 * ==========================================================================
 */

import * as THREE from 'three';

import { TIMING } from '../data/timing';
import type { FishConfig } from '../types';
import { createProceduralFish, type ProceduralFish } from './ProceduralFish';
import { FISH_Z, WATERLINE_Y } from './WaterShape';

export type FishState = 'hidden' | 'rising' | 'up' | 'hit' | 'retreating';

/**
 * 沈んでいるとき、水面の線より下に置く量（体の高さに対する比）。
 *
 * **0 だと頭が覗く。** 「ばあ！」でも、縁とちょうど同じ高さに置くと
 * 見下ろし 11.8° のカメラから頭が見えた。
 */
const SINK = 0.52;

/**
 * 出きったとき、水面の線より上に出る量（**体の高さに対する比**）。
 *
 * ==========================================================================
 * **絶対値ではなく比にすること**（「ばあ！」の実測）。
 *
 * 沈める深さを絶対値にすると、**小さい魚ほど出てくる量が減る**。
 * 「ばあ！」では、隠れ場所を大きくしたときに
 * 大きい絵 0.225 / 小さい手続き生成 0.127 と2倍近い差がついた。
 * 体の高さで割ってそろえると、大きさによらず一定になる。
 *
 * 0.30 ＝ 体の中心が水面の 0.30 ぶん上。体の **8割**が水面の上に出て、
 * 残りが手前の水面に隠れる（＝水から出ている形になる）。
 * **1.0 にしないこと** —— 体が水面から完全に離れて、池の上に浮いて見える。
 * ==========================================================================
 */
const LIFT = 0.3;

export interface FishActor {
  readonly config: FishConfig;
  readonly group: THREE.Group;
  state: FishState;
  /** 出ている量 0..1。**この値が状態機械の本体** */
  reveal: number;
  /** 潰れの進み 0..1（§4-3。叩いた**その場**で 0 より大きくする） */
  squash: number;
  /** いまどの水たまりに居るか。`hidden` のときは -1 */
  holeIndex: number;
  /** いまの状態に入ってからの秒数 */
  elapsed: number;
  /** この登場だけの速さの倍率（§6-1。1 より大きいと遅い） */
  speed: number;
}

export class FishSystem {
  readonly group = new THREE.Group();
  readonly actors: FishActor[] = [];

  private readonly shapes: ProceduralFish[] = [];
  /** 出ている時間。介助（§4-7）が動かす */
  private upSec: number = TIMING.upSec;

  constructor(fish: readonly FishConfig[]) {
    // **1種につき1匹だけ作る。** 同じ魚を同時に2箇所へ出さない決まり（§4-2）
    // なので、これで足りる。毎回作り直すとゴミが出る
    for (const config of fish) {
      const shape = createProceduralFish(config);
      shape.group.visible = false;
      this.group.add(shape.group);
      this.shapes.push(shape);
      this.actors.push({
        config,
        group: shape.group,
        state: 'hidden',
        reveal: 0,
        squash: 0,
        holeIndex: -1,
        elapsed: 0,
        speed: 1,
      });
    }
  }

  /** 出ている時間を介助で動かす（§4-7）。範囲外には出さない */
  setUpSec(sec: number): void {
    this.upSec = sec;
  }

  getUpSec(): number {
    return this.upSec;
  }

  /**
   * いま叩ける魚の数。**0 にしてはいけない**（不変条件4c）。
   *
   * ==========================================================================
   * **沈んでいる途中（`retreating`）も数に入れる**（2026-09-13 に直した）。
   *
   * 最初は `rising` と `up` だけ数えていたが、**2匹が同時に沈みはじめると
   * 叩ける相手が 0 になる瞬間ができた**（実測 5フレーム）。
   * 魚は1種につき1匹しか持たないので、2匹とも沈んでいると出す相手も居ない。
   *
   * そこで沈んでいる途中も「叩ける」に数えることにした。
   * これは辻褄合わせではなく、**不変条件2 がもともと要求していること** ——
   * 「出ている途中・引っ込む途中でも受け付ける」。
   * 1歳半は指を運ぶのが遅いので、**沈みはじめてから当たる回のほうが多い。**
   * そこで「はずれ」にするのは、いちばんしてはいけない仕打ちになる。
   * ==========================================================================
   */
  countHittable(): number {
    let n = 0;
    for (const actor of this.actors) {
      if (actor.state === 'rising' || actor.state === 'up' || actor.state === 'retreating') n++;
    }
    return n;
  }

  /**
   * 出はじめている／出きっている数（沈んでいる途中は入れない）。
   *
   * `Spawner` が「そろそろ次を出す」を判断するのに使う。
   * **沈みはじめた時点で次を出す**ので、画面が空にならない（不変条件4c）。
   */
  countRisingOrUp(): number {
    let n = 0;
    for (const actor of this.actors) {
      if (actor.state === 'rising' || actor.state === 'up') n++;
    }
    return n;
  }

  /** 空いている（出せる）魚が居るか */
  hasFree(): boolean {
    return this.actors.some((a) => a.state === 'hidden');
  }

  /** いま画面に出ている（沈みきっていない）数 */
  countActive(): number {
    let n = 0;
    for (const actor of this.actors) if (actor.state !== 'hidden') n++;
    return n;
  }

  /** この水たまりに居る魚。居なければ null */
  atHole(holeIndex: number): FishActor | null {
    for (const actor of this.actors) {
      if (actor.holeIndex === holeIndex && actor.state !== 'hidden') return actor;
    }
    return null;
  }

  /**
   * 出す。すでに出ているものは動かさない。
   *
   * `speed` は §6-1 のばらつき（±10%）。**合計時間は変えない**ので、
   * 速くなったぶんは `Spawner` の待ちで吸収する。
   */
  spawn(actorIndex: number, holeIndex: number, speed = 1): boolean {
    const actor = this.actors[actorIndex];
    if (!actor || actor.state !== 'hidden') return false;
    actor.state = 'rising';
    actor.reveal = 0;
    actor.squash = 0;
    actor.holeIndex = holeIndex;
    actor.elapsed = 0;
    actor.speed = speed;
    actor.group.visible = true;
    return true;
  }

  /**
   * 叩かれた（§4-3 の0フレーム原則）。
   *
   * ==========================================================================
   * **ここに「ため」を1フレームも入れてはいけない。**
   * `update()` を待たずに、**この中で `squash` を 0 より大きくする**。
   * 単体テストが `hit()` の直後にそれを見る。
   *
   * 「ばあ！」は押してから 0.35秒後に山が来る作りで、そこが受けなかった。
   * ==========================================================================
   *
   * @returns 得点が増える叩きなら true（`rising` か `up` のときだけ）
   */
  hit(actorIndex: number): boolean {
    const actor = this.actors[actorIndex];
    if (!actor) return false;
    // **潰れている最中（`hit`）に叩いても反応は返す**（不変条件2）が、
    // 得点は増えない（増えると連打で無限に増え、★が一瞬で埋まる）。
    //
    // **沈んでいる途中（`retreating`）は得点が増える。**
    // 1歳半は指を運ぶのが遅く、沈みはじめてから当たる回のほうが多い。
    // そこを「はずれ」にすると、当たっているのに報われない回ができる
    // （§4-6 の「外れを失敗にしない」と同じ考え）。
    // 連打で稼げる心配は無い —— 叩いた時点で `hit` に移るので、
    // 2回目からは下の条件で弾かれる
    if (actor.state !== 'rising' && actor.state !== 'up' && actor.state !== 'retreating') {
      return false;
    }
    actor.state = 'hit';
    actor.elapsed = 0;
    // **次の更新を待たない。** ここで潰れを始める
    actor.squash = 0.001;
    return true;
  }

  update(dt: number): void {
    for (const actor of this.actors) {
      actor.elapsed += dt;
      switch (actor.state) {
        case 'hidden':
          break;
        case 'rising': {
          const dur = TIMING.risingSec * actor.speed;
          actor.reveal = Math.min(1, actor.elapsed / dur);
          if (actor.reveal >= 1) {
            actor.state = 'up';
            actor.elapsed = 0;
          }
          break;
        }
        case 'up':
          actor.reveal = 1;
          if (actor.elapsed >= this.upSec) {
            // ==========================================================
            // **最後の1匹は、代わりが出るまで沈まない**（不変条件4c）。
            //
            // 自分以外に出ている魚が無く、出せる魚も残っていないなら、
            // ここで沈むと**叩ける相手が 0 になる**。
            // 実測でそうなった（60秒回して 6フレーム）。
            //
            // 魚は1種につき1匹しか持たないので、2匹とも沈みはじめると
            // 出す相手が居ない。**時間で沈めるより、画面を空にしないほうが
            // 優先**（「ばあ！」は押すまで画面が止まっていた）。
            // 待たされるのは最大でも次の抽選まで（0.8〜2.0秒）。
            // ==========================================================
            const alone = this.countRisingOrUp() === 1;
            if (alone && !this.hasFree()) break;
            actor.state = 'retreating';
            actor.elapsed = 0;
          }
          break;
        case 'hit': {
          const t = Math.min(1, actor.elapsed / TIMING.hitSec);
          // **潰れは 0.12秒で最大、そこから沈む**（§4-4）
          actor.squash = Math.min(1, actor.elapsed / 0.12);
          actor.reveal = 1 - t;
          if (t >= 1) this.retire(actor);
          break;
        }
        case 'retreating': {
          const t = Math.min(1, actor.elapsed / TIMING.retreatSec);
          actor.reveal = 1 - t;
          if (t >= 1) this.retire(actor);
          break;
        }
      }
      this.place(actor);
    }
  }

  private retire(actor: FishActor): void {
    actor.state = 'hidden';
    actor.reveal = 0;
    actor.squash = 0;
    actor.holeIndex = -1;
    actor.elapsed = 0;
    actor.group.visible = false;
  }

  /** 水たまりのローカル座標に置く。`HoleSystem` 側の group の子になっている */
  private place(actor: FishActor): void {
    if (actor.state === 'hidden') return;
    const shape = this.shapes[this.actors.indexOf(actor)];
    const height = shape?.height ?? 0.5;
    // **水面の線から測る。** 沈んでいるとき下、出きったとき上。
    // どちらも体の高さに対する比なので、種類によらず同じだけ出る
    const y = WATERLINE_Y + height * (-SINK + actor.reveal * (SINK + LIFT));
    actor.group.position.set(0, y, FISH_Z);
    // 潰れ。**縦に潰して横に広がる**（§4-4 の「形」）
    const s = 1 - actor.squash * 0.55;
    actor.group.scale.set(1 + actor.squash * 0.3, s, 1);
  }

  dispose(): void {
    for (const shape of this.shapes) shape.dispose();
  }
}
