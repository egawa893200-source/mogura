/**
 * 岩陰のばあ（§4-8）
 *
 * ==========================================================================
 * **画面の上が空いているので岩を置き、タップすると魚が前に突き出してくる**
 * （2026-09-14、人間の指示）。
 * 「suizokukan の下にある岩陰のばあの機能です」と言われたとおり、
 * 「みずのなか」の `creatures/HideoutSystem.ts` を持ってきたもの。
 *
 * ```
 * hidden ──(タップ)──> calling ──> popping ──> out ──┬──(叩かれた)──> hit ──> hidden
 *                                                    └──(時間切れ)──> retreating ──> hidden
 * ```
 *
 * **みずのなかから変えたところが3つある。どれも、この app の決まりのため:**
 *
 * 1. **「引っ込む途中は反応しない」を外した。** 向こうは `retreating` 中と
 *    `cooldown` 中のタップを捨てていたが、この app の不変条件2 は
 *    「どの瞬間に押しても反応する。**アニメーション中だから無視は禁止**」。
 *    みずのなかの貝がまさにそれで壊れている（連打すると 0.45秒の開閉が
 *    一度も完了せず、開き量の最大が 0.037 だった）
 * 2. **隠れているあいだは `visible = false`。** 向こうは岩の形で隠していて、
 *    分割1・ばらつき 0.78 の岩では**面の隙間からウツボが透けていた**。
 *    この app は人間が「**何も見えない状態で『ばあっ』と言って出てくる**」と
 *    決めている（2026-09-13）ので、形に頼らず消す。**確実で、速い。**
 * 3. **声が先、姿はあと**（`calling` 0.38秒）。水たまりの魚と同じ順番にする。
 *    向こうは出はじめと同時に鳴らしていた
 *
 * **岩は1つの魚を共有する。** 岩を2つ置いても魚は1匹で、
 * **押した岩から出る**。2匹にすると同じ種が同時に2箇所へ出ることになり、
 * §4-2 の決まりを破る。魚が出ているあいだにもう一方の岩を押しても、
 * 音と揺れは返る（不変条件1・3b。水たまりの空振りと同じ扱い）。
 * ==========================================================================
 */

import * as THREE from 'three';

import { ROCK_TIMING } from '../data/timing';
import type { FishConfig, RockConfig, StageConfig } from '../types';
import type { Projector } from './HoleSystem';

/**
 * 水たまり側から、当たり判定に要るものだけを読む口。
 *
 * **`HoleSystem` をそのまま要求しない。** 単体テストが「水たまりが無い」
 * 場合も測れるようにしておく（`null` を渡す）。`HoleSystem` はこれを満たす。
 */
export interface HoleScreens {
  readonly count: number;
  isOnScreen(index: number): boolean;
  screenXAt(index: number): number;
  screenYAt(index: number): number;
  radiusAt(index: number): number;
}
import { createProceduralFish, type ProceduralFish } from './ProceduralFish';

export type RockState = 'hidden' | 'calling' | 'popping' | 'out' | 'hit' | 'retreating';

/**
 * 岩の塊を、当たり判定の点よりどれだけ上に置くか（ワールド）。
 *
 * **岩の上を画面の外まで伸ばすため。** 画面の中で完結する塊にすると
 * 「岩が水に浮いている」に見える ——「ばあ！」で隠れ場所を上下2段に置いて
 * **上の段が空に浮き**、見た目の判定が4場面で −12 を付け続けた。
 * 上端を切らせると「画面の外へ続く岩場」に読めるので、浮かない。
 */
const LIFT = 1.55;

/**
 * 岩の縦横比。**1 より大きい = 縦長。**
 *
 * 0.88（横長）から上げた（2026-09-14、人間の指示で
 * 「岩に隠れるようにしてください」）。**魚が隠れる場所が要る。**
 * 横長のままだと、魚が待つ高さ（`HIDE_LIFT`）が岩の下端より下に来て、
 * **岩の外の水の中で消えたり現れたりしていた**。
 */
const Y_SQUASH = 1.15;
/** 奥行きは潰す。真球だと「岩」ではなく岩石惑星に見える */
const Z_SQUASH = 0.55;

/** 岩を少し奥に置く。魚は岩より手前（+z）へ突き出してくる */
const ROCK_Z = -0.35;

/**
 * 隠れている魚を、当たり判定の点よりどれだけ上に置くか。
 *
 * ==========================================================================
 * **岩の塊の中で待たせるための値**（2026-09-14、人間の指示
 * 「岩に隠れるようにしてください」）。
 *
 * 前は 0 で、**魚は岩の下端よりさらに下（開けた水の中）で待っていた**。
 * `visible = false` で消してはいたので「見えない」は守れていたが、
 * 出はじめの1フレームで**何もない水の中にぽっと湧いて**見えた。
 * 岩の輪郭の中に置けば、出はじめは岩が隠してくれる。
 *
 * **岩の中心（`LIFT`）まで上げないこと。** そこまで上げると、出きった魚が
 * 画面の上端に張りついて頭が切れる（`SCREEN_TOP_Y` は 4.76 しかない）。
 * ==========================================================================
 */
export const HIDE_LIFT = 1.35;
/**
 * 出ながら下がる量（ワールド）。
 *
 * ==========================================================================
 * **これは演出ではなく、遠近の打ち消し**（2026-09-14、絵を見て決めた）。
 *
 * 手前へ出ると、**画面の上では上へ動く**。カメラは原点を見ているので、
 * 近づくほど画面の中心から離れる向きに広がるため。岩は画面の中心より
 * 上にあるので、**真っすぐ手前へ出すだけだと魚が上へ逃げて**、
 * 出きったところで岩の上に乗り、下端が画面の外に近づいた（実測: 中心が
 * 画面 y = 113px、岩の下端は 178px）。
 *
 * 倍率で言うと、隠れている z = −1.35 では 0.84、出きった z = +1.25 では
 * 1.21。**画面上の高さを変えないだけなら 1.10** で足りるが、それだと
 * 魚が岩の輪郭にすっぽり収まったままで体の形が読めない。
 * **少し余分に下げて、岩の下端をまたがせる**。
 * ==========================================================================
 */
const DROP = 1.55;

/**
 * 隠れているときの魚の z（`position` からの相対）。
 *
 * **岩の背中より奥。** 岩の奥行きの半分は最大 `1.15 × 0.55 × 1.20 = 0.76` で、
 * 中心が `ROCK_Z` なので背中は −1.11。そこより奥に置く。
 * 実際に隠れているかは**カメラからレイを飛ばして**単体テストが見る
 * （「ばあ！」の「隠しているつもりが、絵では隠れていない」と同じ作り）。
 */
export const HIDDEN_Z = -1.35;
/** 出きったときの魚の z。**カメラ側に突き出す**ぶんだけ大きく見える */
const OUT_Z = 1.25;

/**
 * 出きったときの向き（体軸まわり、ラジアン）。
 *
 * 魚は +x を向いて泳ぐので、`-π/2` で頭がカメラ（+z）を向く。
 * **真正面まで回さない** —— 魚を真後ろから見ると薄い断面になって
 * 「何の魚か」が読めない（みずのなかが `OUT_YAW = 0.75` で同じ結論を出している）。
 * 出はじめは正面寄り（突き出してくる勢い）、出きったら斜めにして輪郭を見せる。
 */
const YAW_START = -1.30;
const YAW_OUT = -0.72;

/** 岩の頂点のばらつき。丸い球のままだと「岩」に見えない */
const NOISE_MIN = 0.80;
const NOISE_MAX = 1.20;

/** 0..1 になめらかに収める（出入りの加速を緩やかにする） */
function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** 決まった形の岩を作るための擬似乱数。**共有の乱数を消費しない**（§4-2） */
function pseudo(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export interface RockRuntime {
  readonly config: RockConfig;
  readonly group: THREE.Group;
  /** 当たり判定に使うワールド座標。**毎フレーム作り直さない**（§10-3） */
  readonly worldPosition: THREE.Vector3;
  /** 叩かれた／押された揺れの残り秒 */
  shake: number;
}

export class RockSystem {
  readonly group = new THREE.Group();
  readonly runtimes: RockRuntime[] = [];

  /** 岩に住んでいる魚。素材が無ければ手続き生成に落ちる（不変条件7） */
  readonly fish: ProceduralFish | null;
  readonly fishConfig: FishConfig | null;

  state: RockState = 'hidden';
  /** 出ている量 0..1。**タップはここを直接書き換えない**（§4-1 と同じ作り） */
  reveal = 0;
  squash = 0;
  bump = 0;
  /** いまどの岩から出ているか。`hidden` のときは -1 */
  rockIndex = -1;
  elapsed = 0;

  private readonly sx: number[] = [];
  private readonly sy: number[] = [];
  private readonly onScreen: boolean[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  constructor(
    stage: StageConfig,
    fishConfig: FishConfig | null,
    model: THREE.Object3D | null = null,
    skin: THREE.Texture | null = null
  ) {
    for (const config of stage.rocks ?? []) {
      const group = new THREE.Group();
      group.position.set(config.position[0], config.position[1], 0);
      group.add(this.buildRock(config));
      this.group.add(group);
      this.runtimes.push({
        config,
        group,
        worldPosition: new THREE.Vector3(config.position[0], config.position[1], 0),
        shake: 0,
      });
      this.sx.push(0);
      this.sy.push(0);
      this.onScreen.push(false);
    }

    this.fishConfig = fishConfig;
    this.fish = fishConfig ? createProceduralFish(fishConfig, model, skin) : null;
    if (this.fish) {
      // **切り取りを効かせない。** 水たまりの魚は穴の口（x）で切っているが、
      // 岩の魚は `visible` で消すので、面はうんと左に逃がして無効にする
      this.fish.setClipX(-9999);
      this.fish.group.visible = false;
      this.group.add(this.fish.group);
      this.disposables.push(this.fish);
    }
  }

  /**
   * 岩の塊。**素材が無くても必ず出す**ので手続き生成（不変条件7）。
   *
   * みずのなかは分割1・ばらつき 0.78 で作って**面の隙間から中身が透けた**が、
   * ここは中身を `visible` で消すので、隙間は問題にならない。
   * 分割2 は三角形が 80 → 320 になるので**分割1のまま**にしてある。
   */
  private buildRock(config: RockConfig): THREE.Mesh {
    const geometry = new THREE.IcosahedronGeometry(config.scale, 1);
    const pos = geometry.getAttribute('position');

    // ==================================================================
    // **ばらつきは「頂点の番号」ではなく「頂点の向き」で決めること**
    // （2026-09-14、絵を見て直した）。
    //
    // `IcosahedronGeometry` は**索引を持たない** —— 実測で
    // 42箇所の座標が 240頂点に複製されていて、同じ角が最大6個ある。
    // 番号でばらつかせると**同じ角が別々に動いて岩が裂け**、
    // 割れ目から背景の青が**明るい線**になって見えた（実機の絵で確認）。
    // みずのなかが「面の隙間から中身が透けていた」と書いているのも同じ話で、
    // 向こうはばらつきの幅を狭めて誤魔化している（0.78→0.90）。
    // **向きで決めれば複製もそろって動く**ので、裂けない。幅も戻せる。
    // ==================================================================
    const seed = config.position[0] * 3.1;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const n =
        NOISE_MIN +
        (NOISE_MAX - NOISE_MIN) * pseudo(x * 4.7 + y * 9.3 + z * 6.1 + seed);
      // **縦に伸ばして奥行きを潰す。** 縦長にするのは、魚が隠れる場所を
      // 岩の中に作るため（`HIDE_LIFT`）。真球だと岩石惑星に見えるし、
      // 奥行きはカメラが正面固定なので薄くてよい
      pos.setXYZ(i, x * n, y * n * Y_SQUASH, z * n * Z_SQUASH);
    }
    geometry.computeVertexNormals();

    // ==================================================================
    // **上を明るく、下を暗くした頂点カラーを焼き込む**（「ばあ！」の実測）。
    //
    // 平行光も半球光も法線しか見ないので、面1枚の中では明るさが変わらない。
    // 素の `MeshStandardMaterial` だと、**下半分が真っ黒な塊**になっていた。
    // 「絵の描き手と同じことを頂点カラーでやる」（CLAUDE.md）。
    // ==================================================================
    const colors = new Float32Array(pos.count * 3);
    // **岩は寒色の灰、魚は暖色**（2026-09-14、絵を見て決めた）。
    // 茶色い岩にしていたら、かわ の岩から出てくる**エイ（砂色）が
    // 岩と同じ色**で、出きったところで輪郭が消えていた。
    // **下を黒にしない** —— 素の材質だと下半分が真っ黒な塊になる
    const top = new THREE.Color(0xd2d6d4);
    const bottom = new THREE.Color(0x8b9092);
    const mix = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) / config.scale + 1) * 0.5;
      mix.copy(bottom).lerp(top, Math.min(1, Math.max(0, t)));
      colors[i * 3] = mix.r;
      colors[i * 3 + 1] = mix.g;
      colors[i * 3 + 2] = mix.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshStandardMaterial({
      // **暗くしすぎない。** みずのなかで暗い岩が「穴」に見えて直している。
      // 実写の水中映像は青いので、岩は暖かい灰色にして浮かせる
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.02,
      // ==================================================================
      // **陰の側が真っ黒になるのを止める**（2026-09-14、絵を見て足した）。
      //
      // 下を向いた面には主光も補助光も当たらないので、頂点カラーを
      // どれだけ明るくしても**黒い塊**のままだった（実際に2回外した）。
      // 弱い自発光で底上げする。**強くしないこと** —— 強いと
      // 岩の丸みが消えて、切り抜いた紙に見える
      // ==================================================================
      emissive: 0x2a3033,
    });
    this.disposables.push(geometry, material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'rock';
    mesh.position.set(0, LIFT, ROCK_Z);
    return mesh;
  }

  /**
   * 画面座標を測り直す。**毎フレーム呼ぶこと**（画面の向きが変わるとずれる）。
   *
   * `holes` は水たまりの側（`HoleSystem`）。**岩の円が水たまりの円に
   * 食い込まない**ように、ここで受け取って `radiusAt()` が縮める。
   * **`describe()` の結果を渡さないこと** —— 毎フレームの配列生成になる（§10-3）。
   *
   * **水たまりを測ったあとに呼ぶこと。** 先に呼ぶと、1フレーム前の
   * 画面座標で縮めることになる（画面の向きが変わった直後にずれる）。
   */
  measure(projector: Projector, holes: HoleScreens | null): void {
    this.holes = holes;
    for (let i = 0; i < this.runtimes.length; i++) {
      const ok = projector.project(this.runtimes[i].worldPosition, _screen);
      this.onScreen[i] = ok;
      if (ok) {
        this.sx[i] = _screen.x;
        this.sy[i] = _screen.y;
      }
    }
  }

  private holes: HoleScreens | null = null;

  /**
   * この岩の当たり半径（px）。
   *
   * **上限は `hitRadiusPx`**。隣の岩とは半分ずつ分け合い、
   * 水たまりとは**相手の半径を引いた残り**まで縮める。
   * **下限は設けない**（§3-3。下限が効いた瞬間に円が重なる）。
   */
  radiusAt(index: number): number {
    const runtime = this.runtimes[index];
    if (!runtime || !this.onScreen[index]) return 0;
    let r = runtime.config.hitRadiusPx;

    for (let j = 0; j < this.runtimes.length; j++) {
      if (j === index || !this.onScreen[j]) continue;
      const d = Math.hypot(this.sx[index] - this.sx[j], this.sy[index] - this.sy[j]);
      r = Math.min(r, d / 2 - HIT_GUARD_PX);
    }
    // **`describe()` を使わないこと。** 毎フレーム呼ばれるので、
    // 配列と object を作ると 1秒あたり 360個のゴミになる（§10-3）
    const holes = this.holes;
    if (holes) {
      for (let j = 0; j < holes.count; j++) {
        if (!holes.isOnScreen(j)) continue;
        const d = Math.hypot(this.sx[index] - holes.screenXAt(j), this.sy[index] - holes.screenYAt(j));
        r = Math.min(r, d - holes.radiusAt(j) - HIT_GUARD_PX);
      }
    }
    return Math.max(0, r);
  }

  /**
   * 画面のこの位置にいちばん近い岩。届かなければ null。
   *
   * **null を返しても無反応にしないこと**（不変条件1）。呼び出し側が波紋と音を返す。
   */
  pick(screenX: number, screenY: number): number {
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.runtimes.length; i++) {
      if (!this.onScreen[i]) continue;
      const d = Math.hypot(this.sx[i] - screenX, this.sy[i] - screenY);
      if (d > this.radiusAt(i) || d >= bestDist) continue;
      bestDist = d;
      best = i;
    }
    return best;
  }

  /**
   * 岩を押した（§4-3 の0フレーム原則）。
   *
   * **ここに「ため」を1フレームも入れてはいけない。** `update()` を待たずに
   * 状態を進める。揺れも潰れもこの中で始まる。
   *
   * @returns `'baa'` = 魚が出はじめた（呼び出し側が「ばあっ！」を鳴らす）
   *          `'hit'` = 出ている魚を叩いた（「いてっ」）
   *          `'empty'` = 空振り（音と揺れだけ）
   */
  tap(index: number): 'baa' | 'hit' | 'empty' {
    const runtime = this.runtimes[index];
    if (!runtime) return 'empty';
    // **揺れは必ず返す**（当たっても外しても。不変条件1・3b）
    runtime.shake = ROCK_TIMING.shakeSec;
    if (!this.fish) return 'empty';

    // ==================================================================
    // **引っ込む途中でも受け付ける**（不変条件2）。
    // みずのなかは `retreating` 中と `cooldown` 中を捨てていたが、
    // それは「アニメーション中だから無視」そのもので、この app では禁止。
    // 1歳半は指を運ぶのが遅く、**沈みはじめてから当たる回のほうが多い**
    // （§4-3 で水たまりの魚に同じ判断をしている）
    // ==================================================================
    // ==================================================================
    // **沈んでいる最中に、その岩を押したら「叩いた」にする**
    // （2026-09-16、実機で「戻るのが早くて叩けない」と言われて直した）。
    //
    // 前は引っ込みはじめた時点で叩けなくなり、押すと**もう一度ばあ**に
    // 戻していた。反応は返るので不変条件2 は満たしていたが、
    // **「いてっ」も★も返らない**ので、子どもには「当たらなかった」と
    // 同じに見える。水たまりの魚は沈む最中も当たりに数えている（§4-3。
    // 「1歳半は指を運ぶのが遅く、沈みはじめてから当たる回のほうが多い」）
    // ので、そちらにそろえる。
    //
    // **別の岩を押したときだけ、そこから出し直す。** そこには居ないので
    // 叩きようがないし、押した岩から出るのがこの遊びの約束
    // ==================================================================
    if (this.state === 'retreating' && index === this.rockIndex) {
      this.state = 'hit';
      this.elapsed = 0;
      this.squash = 0.001;
      this.bump = 0.001;
      return 'hit';
    }

    if (this.state === 'hidden' || this.state === 'retreating') {
      this.state = 'calling';
      this.reveal = 0;
      this.squash = 0;
      this.bump = 0;
      this.rockIndex = index;
      this.elapsed = 0;
      this.fish.group.visible = false;
      return 'baa';
    }

    // 出ている魚を叩いた。**別の岩を押したときは空振り**
    // （魚はそこには居ない。水たまりの空振りと同じ扱い）
    if (index !== this.rockIndex) return 'empty';

    if (this.state === 'popping' || this.state === 'out') {
      this.state = 'hit';
      this.elapsed = 0;
      // **次の更新を待たない**（§4-3）
      this.squash = 0.001;
      this.bump = 0.001;
      return 'hit';
    }
    // `calling`（まだ1画素も見えていない）と `hit`（潰れている最中）は
    // 得点にしない。**反応は上の `shake` で返している**
    return 'empty';
  }

  update(dt: number): void {
    for (const runtime of this.runtimes) {
      if (runtime.shake > 0) {
        runtime.shake = Math.max(0, runtime.shake - dt);
        // **横に揺らす。** 上下だと岩が跳ねて見える
        const t = runtime.shake / ROCK_TIMING.shakeSec;
        runtime.group.rotation.z = Math.sin(t * Math.PI * 6) * 0.05 * t;
      } else if (runtime.group.rotation.z !== 0) {
        runtime.group.rotation.z = 0;
      }
    }

    if (!this.fish) return;
    this.elapsed += dt;
    switch (this.state) {
      case 'hidden':
        break;
      case 'calling':
        // **姿を出さない。** ここで「ばあっ！」が鳴る（`App` が拾う）
        this.reveal = 0;
        this.fish.group.visible = false;
        if (this.elapsed >= ROCK_TIMING.callSec) {
          this.state = 'popping';
          this.elapsed = 0;
        }
        break;
      case 'popping':
        this.reveal = Math.min(1, this.elapsed / ROCK_TIMING.popSec);
        if (this.reveal >= 1) {
          this.state = 'out';
          this.elapsed = 0;
        }
        break;
      case 'out':
        this.reveal = 1;
        if (this.elapsed >= ROCK_TIMING.outSec) {
          this.state = 'retreating';
          this.elapsed = 0;
        }
        break;
      case 'hit': {
        const t = Math.min(1, this.elapsed / ROCK_TIMING.hitSec);
        this.squash = Math.min(1, this.elapsed / 0.12);
        this.bump = Math.min(1, Math.max(0, (this.elapsed - 0.06) / 0.16));
        this.reveal = 1 - t;
        if (t >= 1) this.retire();
        break;
      }
      case 'retreating': {
        const t = Math.min(1, this.elapsed / ROCK_TIMING.retreatSec);
        this.reveal = 1 - t;
        if (t >= 1) this.retire();
        break;
      }
    }
    this.place();
  }

  private retire(): void {
    this.state = 'hidden';
    this.reveal = 0;
    this.squash = 0;
    this.bump = 0;
    this.rockIndex = -1;
    this.elapsed = 0;
    if (this.fish) this.fish.group.visible = false;
  }

  /** 魚を岩の手前へ突き出す */
  private place(): void {
    const fish = this.fish;
    if (!fish) return;
    if (this.state === 'hidden' || this.state === 'calling') {
      fish.group.visible = false;
      return;
    }
    const runtime = this.runtimes[this.rockIndex];
    if (!runtime) return;
    fish.group.visible = true;

    const eased = smoothstep(this.reveal);
    // ==================================================================
    // **岩の中で待って、そこから手前へ突き出してくる**
    // （2026-09-14、人間の指示「岩に隠れるようにしてください」）。
    //
    // 出はじめ（reveal 0）は岩の輪郭の中・岩の背中より奥なので、
    // **岩が隠している**。`visible` を立てても1画素も出ない。
    // 進むにつれて岩を突き抜けて手前へ出る。深度は three が見るので、
    // 岩から出るまでは自動的に隠れる。
    //
    // **少し下がりながら出る**（`DROP`）。真っすぐ手前だけだと、
    // 出きったところで岩の輪郭にすっぽり収まって体の形が読めない
    // （岩と同系色の エイ で実際にそうなった）。
    // ==================================================================
    fish.group.position.set(
      runtime.worldPosition.x,
      runtime.worldPosition.y + HIDE_LIFT - DROP * eased,
      HIDDEN_Z + eased * (OUT_Z - HIDDEN_Z)
    );
    fish.group.rotation.y = YAW_START + (YAW_OUT - YAW_START) * eased;

    // ==================================================================
    // **出るときに等倍を少し超えてから戻す**（「ばあっ！」の勢い）。
    // 山は reveal 0.75 付近で、出きった 1.0 では等倍に戻る。
    // **不変条件6 に触れない** —— 1回のタップにつき出る→戻るの1往復だけで、
    // 全画面のフラッシュでもない（みずのなかと同じ理屈）
    // ==================================================================
    const pop = 1 + 0.2 * Math.sin(Math.PI * Math.min(1, this.reveal) ** 0.7);
    const grow = ROCK_TIMING.hiddenScale + (1 - ROCK_TIMING.hiddenScale) * eased;
    const s = ROCK_TIMING.fishScale * grow * pop;
    // 潰れ。**縦に潰して横に広がる**（§4-4。水たまりの魚と同じ形）
    fish.group.scale.set(s * (1 + this.squash * 0.3), s * (1 - this.squash * 0.55), s);
    fish.setBump(this.bump);
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

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }
}

/** 隣り合う円のあいだに必ず空ける隙間（px）。`HoleSystem` と同じ 1px */
const HIT_GUARD_PX = 1;
const _screen = { x: 0, y: 0 };
