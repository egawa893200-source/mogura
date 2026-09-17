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

import { SPECIAL, type FishVariant } from '../data/special';
import { TIMING } from '../data/timing';
import type { FishConfig } from '../types';
import { createProceduralFish, type ProceduralFish } from './ProceduralFish';
import { FISH_Z, MOUTH_X, OUT_X } from './WaterShape';

export type FishState = 'hidden' | 'calling' | 'rising' | 'up' | 'hit' | 'retreating';

/**
 * 隠れているときの中心 x（穴の中心からの左方向の距離）。
 *
 * **口（`MOUTH_X`）より左に体がまるごと入る位置。**
 * 切り取り面が口に置いてあるので、ここに居るあいだは1画素も描かれない。
 */
const HIDE_X = -1.15;

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
 * 出きったときの中心 x（`OUT_X`）は `WaterShape` が持っている。
 * ==========================================================================
 */
const BOB = 0.04;

export interface FishActor {
  readonly config: FishConfig;
  readonly group: THREE.Group;
  state: FishState;
  /** 出ている量 0..1。**この値が状態機械の本体** */
  reveal: number;
  /** 潰れの進み 0..1（§4-3。叩いた**その場**で 0 より大きくする） */
  squash: number;
  /**
   * たんこぶの育ち 0..1（2026-09-13、人間が決めた）。
   *
   * **叩かれたことが形に残る**ので、当たったかどうかが一目で分かる。
   * 叩いた**その場**で 0 より大きくする（`squash` と同じ理由）。
   */
  bump: number;
  /** いまどの水たまりに居るか。`hidden` のときは -1 */
  holeIndex: number;
  /** いまの状態に入ってからの秒数 */
  elapsed: number;
  /** この登場だけの速さの倍率（§6-1。1 より大きいと遅い） */
  speed: number;
  /**
   * この登場だけの種類（§6-2）。**大きい と きんいろ は同時に起きない。**
   *
   * `Spawner` が出すときに決める。**引っ込んだら必ず `normal` に戻す**
   * —— 戻し忘れると、次に同じ魚が出たときも金のままになる
   * （魚は1種につき1匹しか持っていない）
   */
  variant: FishVariant;
}

export class FishSystem {
  readonly group = new THREE.Group();
  readonly actors: FishActor[] = [];

  private readonly shapes: ProceduralFish[] = [];
  /** 出ている時間。介助（§4-7）が動かす */
  private upSec: number = TIMING.upSec;

  constructor(
    fish: readonly FishConfig[],
    /** 種ごとの `.glb`。無い種は canvas の絵に落ちる（不変条件7） */
    models: ReadonlyMap<string, THREE.Object3D> = new Map(),
    /** 種ごとの体の画像 */
    skins: ReadonlyMap<string, THREE.Texture> = new Map()
  ) {
    // **1種につき1匹だけ作る。** 同じ魚を同時に2箇所へ出さない決まり（§4-2）
    // なので、これで足りる。毎回作り直すとゴミが出る
    for (const config of fish) {
      const shape = createProceduralFish(
        config,
        models.get(config.id) ?? null,
        skins.get(config.id) ?? null
      );
      shape.group.visible = false;
      this.group.add(shape.group);
      this.shapes.push(shape);
      this.actors.push({
        config,
        group: shape.group,
        state: 'hidden',
        reveal: 0,
        squash: 0,
        bump: 0,
        holeIndex: -1,
        elapsed: 0,
        speed: 1,
        variant: 'normal',
      });
    }
  }

  /**
   * 切り取り面を、いま居る穴の口に合わせる。
   *
   * **これが無いと、隠れている魚が穴の外に見える。**
   * 面はワールド座標なので、穴が変わるたびに置き直す。
   */
  updateClipping(holeWorldX: readonly number[]): void {
    for (let i = 0; i < this.actors.length; i++) {
      const actor = this.actors[i];
      const shape = this.shapes[i];
      if (!shape) continue;
      const base = actor.holeIndex >= 0 ? (holeWorldX[actor.holeIndex] ?? 0) : 0;
      shape.setClipX(base + MOUTH_X);
    }
  }

  /** 出ている時間を介助で動かす（§4-7）。範囲外には出さない */
  setUpSec(sec: number): void {
    this.upSec = sec;
  }

  getUpSec(): number {
    return this.upSec;
  }

  /** 開発と E2E 用。魚の見かけの大きさ（ワールド） */
  describeSizes(): { id: string; width: number; height: number }[] {
    return this.actors.map((a, i) => ({
      id: a.config.id,
      width: +(this.shapes[i]?.width ?? 0).toFixed(3),
      height: +(this.shapes[i]?.height ?? 0).toFixed(3),
    }));
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
  spawn(
    actorIndex: number,
    holeIndex: number,
    speed = 1,
    variant: FishVariant = 'normal'
  ): boolean {
    const actor = this.actors[actorIndex];
    if (!actor || actor.state !== 'hidden') return false;
    // **まず `calling`。** 声が鳴ってから出てくる
    actor.state = 'calling';
    actor.reveal = 0;
    actor.squash = 0;
    actor.bump = 0;
    actor.holeIndex = holeIndex;
    actor.elapsed = 0;
    actor.speed = speed;
    // **色は出す前に決める**（§6-2）。`calling` のあいだは見えていないので、
    // 姿が出た最初の1フレームからきんいろで見える
    actor.variant = variant;
    this.shapes[actorIndex]?.setGold(variant === 'gold');
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
    // **`calling` は叩けない。** まだ1画素も見えていないので、
    // 当たっても子どもには「何に当たったか」が分からない
    if (actor.state !== 'rising' && actor.state !== 'up' && actor.state !== 'retreating') {
      return false;
    }
    actor.state = 'hit';
    actor.elapsed = 0;
    // **次の更新を待たない。** ここで潰れとたんこぶを始める
    actor.squash = 0.001;
    actor.bump = 0.001;
    return true;
  }

  update(dt: number): void {
    for (const actor of this.actors) {
      actor.elapsed += dt;
      switch (actor.state) {
        case 'hidden':
          break;
        case 'calling':
          // **姿を出さない。** ここで「ばあっ！」が鳴る（`App` が拾う）。
          // 実機で「『ばあっ』する前にチラッと見えている」と言われたので、
          // 声が先、姿はあと、の順にした
          actor.reveal = 0;
          if (actor.elapsed >= TIMING.callSec) {
            actor.state = 'rising';
            actor.elapsed = 0;
          }
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
          // **潰れは 0.12秒で最大、そこから引っ込む**（§4-4）
          actor.squash = Math.min(1, actor.elapsed / 0.12);
          // たんこぶは潰れより少し遅れて育つ（潰れきってから膨らむ）
          actor.bump = Math.min(1, Math.max(0, (actor.elapsed - 0.06) / 0.16));
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
    // **色と大きさを必ず戻す。** 魚は1種につき1匹しか持っていないので、
    // 戻し忘れると次に出たときも金のまま・大きいままになる
    this.shapes[this.actors.indexOf(actor)]?.setGold(false);
    actor.variant = 'normal';
    actor.state = 'hidden';
    actor.reveal = 0;
    actor.squash = 0;
    actor.bump = 0;
    actor.holeIndex = -1;
    actor.elapsed = 0;
    actor.group.visible = false;
  }

  /**
   * 穴のローカル座標に置く。`HoleSystem` 側の group の子になっている。
   *
   * **左（穴の中）から右へ泳ぎ出る**（2026-09-13、実機を見て人間が決めた）。
   * 上下に浮き上がる形は、見下ろしの浅い角度では「出てきた」に見えなかった。
   */
  private place(actor: FishActor): void {
    if (actor.state === 'hidden') return;
    const index = this.actors.indexOf(actor);
    const shape = this.shapes[index];
    const x = HIDE_X + actor.reveal * (OUT_X - HIDE_X);
    // 出ているあいだ、ゆっくり上下に揺れる（止まって見えないように）
    const y = actor.state === 'up' ? Math.sin(actor.elapsed * 2.2) * BOB : 0;
    actor.group.position.set(x, y, FISH_Z);
    // 潰れ。**縦に潰して横に広がる**（§4-4 の「形」）。
    // **大きいさかな（§6-2）はここで倍率を掛ける** —— 出ている時間も
    // 当たり判定も変えない（当てやすさは同じで、見た目だけ特別）。
    // **高さに上限を掛ける** —— 倍率だけだと、元から大きいエイが暴れる
    const baseHeight = shape?.height ?? 0;
    const big =
      actor.variant === 'big'
        ? Math.min(SPECIAL.bigScale, baseHeight > 0 ? SPECIAL.bigMaxHeight / baseHeight : SPECIAL.bigScale)
        : 1;
    const s = 1 - actor.squash * 0.55;
    actor.group.scale.set(big * (1 + actor.squash * 0.3), big * s, big);
    shape?.setBump(actor.bump);
  }

  dispose(): void {
    for (const shape of this.shapes) shape.dispose();
  }
}
