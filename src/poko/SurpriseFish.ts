/**
 * サプライズ（§6-3）— 画面の下から大きく1匹
 *
 * ==========================================================================
 * **2026-09-17、人間が選んだ追加要素。**
 *
 * ```
 * hidden ──(時間)──> calling ──> rising ──> out ──┬──(叩かれた)──> hit ──> hidden
 *                                                 └──(時間切れ)──> retreating ──> hidden
 * ```
 *
 * **「ばあ！」の `Surprise.ts` とは別物。**
 * 向こうは**押せない見た目だけ**の演出（「画面の入力を塞がない」と書いてある）。
 * こちらは設計書 §6-3 が「**叩くと星が5つ**」と決めているので、押せる必要がある。
 * だから当たり判定を持ち、`App` のタップの列で**いちばん先に**見る。
 *
 * **魚は岩と同じ種を使う。** モデルは3体しかなく、1ステージの水たまり2種と
 * 同じ `.glb` を使うと「同じ魚を2色に塗った」に見える（単体テストが見張る）。
 * 岩と同時に出ないよう、**岩が隠れているときだけ**出る。
 *
 * **抽選ではなく時計で出す。** 魚の出現数に紐づけると、よく叩く子ほど
 * サプライズが増えて「大きいのが普通」になる。時計なら遊びかたに依らない。
 * ==========================================================================
 */

import * as THREE from 'three';

import { SURPRISE } from '../data/special';
import type { FishConfig } from '../types';
import type { Projector } from './HoleSystem';
import { createProceduralFish, type ProceduralFish } from './ProceduralFish';

export type SurpriseState = 'hidden' | 'calling' | 'rising' | 'out' | 'hit' | 'retreating';

/** 当たり判定の半径の下限（px）。出はじめの数フレームを押せるようにするため */
const MIN_HIT_PX = 40;

/**
 * 予告のゆらぎ（§6-3）。**薄く・低く・短く。**
 *
 * **暗い影にしたら、画面で判別できなかった**（2026-10-17、撮って確かめた。
 * 濃さ 0.336 でも水の色に沈む）。水が濃紺なので、**暗いものは暗い背景に
 * 溶ける** —— 下から来る何かを知らせるには、**明るいほう**しかない。
 * 白に近い水色で、水がかき回されたように見せる。
 *
 * **濃くしない** —— 下の段の水たまりに重なるので、濃いと「隠れた」に見える。
 * **光らせない**（加算にしない。§2 の明滅の禁止に近づく）
 */
const HERALD_ALPHA = 0.5;
const HERALD_Y = -3.72;
const HERALD_COLOR = 0xcdeef7;

/**
 * 影の絵（中心が濃く、縁がぼける円）。
 *
 * **`document` が無い環境では null**（単体テスト。不変条件7 と同じ扱いで、
 * そのときは縁のはっきりした円になるが、描画しないので問題にならない）
 */
function createHeraldTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(205, 238, 247, 0.95)');
  g.addColorStop(0.5, 'rgba(205, 238, 247, 0.45)');
  g.addColorStop(1, 'rgba(205, 238, 247, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 度 → ラジアン */
function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 0..1 をなめらかに。出入りの加速を緩やかにする */
function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export class SurpriseFish {
  readonly group = new THREE.Group();

  state: SurpriseState = 'hidden';
  /** 出ている量 0..1。**タップはここを直接書き換えない** */
  reveal = 0;
  squash = 0;
  bump = 0;
  elapsed = 0;
  /** 出た回数（E2E と実測用） */
  count = 0;

  private readonly fish: ProceduralFish | null;
  /** 次に出るまでの残り秒 */
  private wait: number;
  private readonly rng: () => number;
  /** 画面座標。**毎フレーム作り直さない**（§10-3） */
  private sx = 0;
  private sy = 0;
  private onScreen = false;
  /** 見かけの半径（px）。横と縦で別に持つ —— 下の `measure()` を読むこと */
  private rx = 0;
  private ry = 0;

  /**
   * 来るぞ、の前触れ（2026-10-17 に足した）。
   *
   * ==========================================================================
   * **`calling` の 0.5秒 は、声だけで画面に何も無かった。**
   * 1歳半は「来るぞ」が分かるほうが喜ぶし、**いきなり画面の 1/4 を覆うものが
   * 出る**のは、§2 が禁じている突発的な動きに近い。
   *
   * これは**押せない**（当たり判定を持たない）。`calling` のあいだは
   * サプライズ自身もまだ叩けないが、水たまりの魚は止めていない（抽選を
   * 止めはじめるのは `rising` から）ので、叩ける相手は居る（不変条件4c）。
   *
   * **薄くする。** 下の段の水たまりに重なるので、濃いと「隠れた」に見える
   * （押せることは変わらないが、見えなくなるのは別の話）。
   * ==========================================================================
   */
  private readonly herald: THREE.Mesh | null = null;
  private readonly heraldMaterial: THREE.MeshBasicMaterial | null = null;
  /** **1つでも漏らすとリークする**（不変条件8） */
  private readonly disposables: { dispose(): void }[] = [];

  constructor(
    config: FishConfig | null,
    model: THREE.Object3D | null,
    skin: THREE.Texture | null,
    rng: () => number
  ) {
    this.rng = rng;
    this.wait = this.nextWait();
    this.fish = config ? createProceduralFish(config, model, skin) : null;
    if (this.fish) {
      // **切り取りを効かせない**（水たまりの口で切るためのもの）
      this.fish.setClipX(-9999);
      // ==================================================================
      // **向きを先に決めてから、大きさを測る。**
      // `fish.height` はモデルを組んだときの高さで、**向きを変えると変わる**
      // （えいは翼が縦なので 1.24 あるが、体軸を上に向けると体長のほうが
      // 見かけの高さになる）。先に回してから境界箱を測れば、
      // どの魚でも「画面に出る高さ」がそろう
      // ==================================================================
      const pose = config?.surprisePose;
      if (pose) {
        this.fish.group.rotation.set(rad(pose[0]), rad(pose[1]), rad(pose[2]));
      } else {
        // **カメラの方を向かせる。** 魚は +x を向いて泳ぐので、
        // 斜めに構えて輪郭を見せる（岩の魚と同じ理由）
        this.fish.group.rotation.set(0, SURPRISE.yaw, 0);
      }
      this.group.add(this.fish.group);

      // 予告のゆらぎ。**円を1枚**（手続き生成なので素材は要らない。不変条件7）
      const art = createHeraldTexture();
      this.heraldMaterial = new THREE.MeshBasicMaterial({
        ...(art ? { map: art } : { color: HERALD_COLOR }),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
      });
      const geometry = new THREE.PlaneGeometry(1, 1);
      this.herald = new THREE.Mesh(geometry, this.heraldMaterial);
      this.herald.name = 'surprise.herald';
      this.herald.visible = false;
      this.herald.renderOrder = -1;
      this.group.add(this.herald);
      this.disposables.push(geometry, this.heraldMaterial);
      if (art) this.disposables.push(art);
      this.fish.group.updateWorldMatrix(true, true);
      _box.makeEmpty();
      expandVisible(_box, this.fish.group);
      // **隠すのは測ったあと。** `expandVisible()` は見えていないものを数えない
      // ので、先に隠すと箱が空になり、倍率が 220倍になった（実際にやった）
      const tall = _box.isEmpty() ? 0 : _box.max.y - _box.min.y;
      const wide = _box.isEmpty() ? 0 : _box.max.x - _box.min.x;
      // **高さと幅の両方で頭打ちにする。** 高さだけでそろえると、
      // 横向きのきんぎょが画面幅を越えて顔が切れる（`SURPRISE.maxWidth`）
      this.baseScale = Math.min(
        SURPRISE.height / Math.max(0.01, tall),
        SURPRISE.maxWidth / Math.max(0.01, wide)
      );
      this.fish.group.scale.setScalar(this.baseScale);
      this.fish.group.visible = false;
    }
  }

  /** 回してから測った倍率。**`fish.height` から出すと向きの変更で狂う** */
  private baseScale = 1;

  /**
   * 画面座標を測り直す。**毎フレーム呼ぶこと**
   *
   * ==========================================================================
   * **芯の1点を投影するだけでは、当たり判定が体からずれる**（2026-09-17、絵で測った）。
   *
   * 最初は `fish.group.position`（体の中心）を投影して、そこから
   * 高さの半分ぶん上の点までの距離を半径にしていた。絵に重ねて測ると:
   *
   *   見えている体   x 2〜304 / y 614〜838
   *   当たり円       中心 (141, 763) 半径 161
   *
   * 芯の位置そのものは合っていた（体の下半分が画面の外なので、
   * 見えている画素の中心だけが上にずれる）。**外していたのは形のほう。**
   * エイは横 302px・縦 224px の平たい魚なので、円で覆うと
   * **右の翼の先（x 290 付近）が円の外**に出て、見えているのに叩けない。
   * 逆に円の下は画面の外（y 924 まで）に伸びていて、そのぶんは何の役にも立たない。
   *
   * **見かけの矩形を測って、そこに内接する楕円で見る。**
   * 矩形は体の世界の境界箱を投影して求める（向きも潰れも自動で入る）。
   * 四角いまま使わないのは、「ばあ！」で踏んだ
   * 「板は四角いのでレイは透明な角にも当たる」と同じ事故を避けるため ——
   * 角は水しか無いのに、押すと★が5つ入ってしまう。
   * ==========================================================================
   */
  measure(projector: Projector): void {
    if (!this.fish || this.state === 'hidden' || this.state === 'calling') {
      this.onScreen = false;
      return;
    }
    // 投影の前に行列を作り直す。**`measure()` は描画より前に呼ばれる**ので、
    // これが無いと1フレーム前の位置で測ることになる
    this.group.updateWorldMatrix(true, true);
    _box.makeEmpty();
    expandVisible(_box, this.fish.group);
    if (_box.isEmpty()) {
      this.onScreen = false;
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let any = false;
    // **奥行きは中央だけで測る。** 8隅すべてを投影すると、カメラに近い面の角が
    // 大きく写って矩形がふくらむ（実測: 縦 448px ＝ 見えている体の 2倍）。
    // エイは斜めに構えていて奥行きが体長ぶんあるので、これがそのまま効く
    const z = (_box.min.z + _box.max.z) * 0.5;
    for (let i = 0; i < 4; i++) {
      _at.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, z);
      if (!projector.project(_at, _screen)) continue;
      any = true;
      if (_screen.x < minX) minX = _screen.x;
      if (_screen.x > maxX) maxX = _screen.x;
      if (_screen.y < minY) minY = _screen.y;
      if (_screen.y > maxY) maxY = _screen.y;
    }
    this.onScreen = any;
    if (!any) return;
    this.sx = (minX + maxX) * 0.5;
    this.sy = (minY + maxY) * 0.5;
    // **下限を置く。** 出はじめ（`reveal` が小さい）は体がほとんど画面の外に
    // あって矩形が潰れるので、そのままだと最初の数フレームが押せない
    this.rx = Math.max(MIN_HIT_PX, (maxX - minX) * 0.5);
    this.ry = Math.max(MIN_HIT_PX, (maxY - minY) * 0.5);
  }

  /** 画面のこの位置が、この魚に当たるか */
  hitTest(screenX: number, screenY: number): boolean {
    if (!this.onScreen) return false;
    if (this.state !== 'rising' && this.state !== 'out' && this.state !== 'retreating') return false;
    // 矩形に内接する楕円。**角は水しか無いので入れない**
    const dx = (screenX - this.sx) / this.rx;
    const dy = (screenY - this.sy) / this.ry;
    return dx * dx + dy * dy <= 1;
  }

  /**
   * 叩かれた（§4-3 の0フレーム原則）。
   *
   * **ここに「ため」を1フレームも入れない。** `update()` を待たずに潰れを始める。
   */
  hit(): boolean {
    if (this.state !== 'rising' && this.state !== 'out' && this.state !== 'retreating') return false;
    this.state = 'hit';
    this.elapsed = 0;
    this.squash = 0.001;
    this.bump = 0.001;
    return true;
  }

  /** いま叩けるか（E2E 用） */
  isHittable(): boolean {
    return this.state === 'rising' || this.state === 'out' || this.state === 'retreating';
  }

  /**
   * @param rockHidden 岩の魚が隠れているか。**出ていたら始めない**
   *   （同じ種なので、2匹同時に出ると「同じ魚が2箇所」になる）
   */
  update(dt: number, rockHidden: boolean): void {
    if (!this.fish) return;
    this.elapsed += dt;

    switch (this.state) {
      case 'hidden':
        this.wait -= dt;
        // **岩が出ているあいだは時計を進めたまま待つ。** 止めると、
        // 岩をよく押す子にはサプライズが永遠に来ない
        if (this.wait <= 0 && rockHidden) {
          this.state = 'calling';
          this.elapsed = 0;
          this.reveal = 0;
          this.squash = 0;
          this.bump = 0;
          this.count++;
        }
        break;
      case 'calling':
        // **姿を出さない。** ここで「ばあっ！」が鳴る（`App` が拾う）
        this.reveal = 0;
        if (this.elapsed >= SURPRISE.callSec) {
          this.state = 'rising';
          this.elapsed = 0;
        }
        break;
      case 'rising':
        // **大きいぶん、ゆっくり出す**（§6-3）。速いと驚かせるだけになる
        this.reveal = Math.min(1, this.elapsed / SURPRISE.riseSec);
        if (this.reveal >= 1) {
          this.state = 'out';
          this.elapsed = 0;
        }
        break;
      case 'out':
        this.reveal = 1;
        if (this.elapsed >= SURPRISE.outSec) {
          this.state = 'retreating';
          this.elapsed = 0;
        }
        break;
      case 'hit': {
        const t = Math.min(1, this.elapsed / SURPRISE.hitSec);
        this.squash = Math.min(1, this.elapsed / 0.12);
        this.bump = Math.min(1, Math.max(0, (this.elapsed - 0.06) / 0.16));
        this.reveal = 1 - t;
        if (t >= 1) this.retire();
        break;
      }
      case 'retreating': {
        const t = Math.min(1, this.elapsed / SURPRISE.sinkSec);
        this.reveal = 1 - t;
        if (t >= 1) this.retire();
        break;
      }
    }
    this.place();
    this.placeHerald();
  }

  private retire(): void {
    this.state = 'hidden';
    this.reveal = 0;
    this.squash = 0;
    this.bump = 0;
    this.elapsed = 0;
    this.wait = this.nextWait();
    if (this.fish) this.fish.group.visible = false;
  }

  /** 予告のゆらぎを置く。**`calling` で濃く、出てくるにつれて消える** */
  private placeHerald(): void {
    const herald = this.herald;
    const material = this.heraldMaterial;
    if (!herald || !material) return;
    let t = 0;
    if (this.state === 'calling') {
      // 0.5秒かけて濃くなる（**突発音と同じで、突発的な見た目も作らない**）
      t = Math.min(1, this.elapsed / Math.max(0.01, SURPRISE.callSec));
    } else if (this.state === 'rising') {
      // 体が出てくるぶんだけ薄くする（ゆらぎと体が二重に見えないように）
      t = Math.max(0, 1 - this.reveal * 1.6);
    }
    if (t <= 0) {
      herald.visible = false;
      return;
    }
    herald.visible = true;
    material.opacity = HERALD_ALPHA * t;
    // 近づくにつれて大きくなる（下から上がってくるものの影）
    const w = SURPRISE.maxWidth * (0.55 + 0.45 * t);
    herald.scale.set(w, w * 0.42, 1);
    herald.position.set(SURPRISE.x, HERALD_Y, SURPRISE.z - 0.02);
  }

  private place(): void {
    const fish = this.fish;
    if (!fish) return;
    if (this.state === 'hidden' || this.state === 'calling') {
      fish.group.visible = false;
      return;
    }
    fish.group.visible = true;
    const eased = smoothstep(this.reveal);
    fish.group.position.set(
      SURPRISE.x,
      SURPRISE.hiddenY + eased * (SURPRISE.outY - SURPRISE.hiddenY),
      SURPRISE.z
    );
    const scale = this.baseScale;
    // 潰れ。**縦に潰して横に広がる**（§4-4。水たまりの魚と同じ形）
    fish.group.scale.set(
      scale * (1 + this.squash * 0.3),
      scale * (1 - this.squash * 0.55),
      scale
    );
    fish.setBump(this.bump);
  }

  private nextWait(): number {
    return SURPRISE.minGapSec + this.rng() * (SURPRISE.maxGapSec - SURPRISE.minGapSec);
  }

  /**
   * いますぐ出す（開発と E2E 用）。
   * **22〜34秒 待たないため。** 実機で確かめるときにも使う
   */
  forceNow(): void {
    if (this.state === 'hidden') this.wait = 0;
  }

  /** 開発と E2E 用 */
  describe(): {
    state: SurpriseState;
    reveal: number;
    x: number;
    y: number;
    rx: number;
    ry: number;
    herald: number;
  } {
    return {
      state: this.state,
      reveal: +this.reveal.toFixed(3),
      x: +this.sx.toFixed(1),
      y: +this.sy.toFixed(1),
      rx: +this.rx.toFixed(1),
      ry: +this.ry.toFixed(1),
      // 予告のゆらぎの濃さ（0〜1。E2E と単体テスト用）
      herald: this.herald?.visible ? +(this.heraldMaterial?.opacity ?? 0).toFixed(3) : 0,
    };
  }

  dispose(): void {
    this.fish?.dispose();
    for (const item of this.disposables) item.dispose();
  }
}

/**
 * 見えているメッシュだけで世界の境界箱を広げる。
 *
 * **`Box3.setFromObject()` を使わない。** あれは `visible` を見ないので、
 * 隠してあるたんこぶ（体の上 0.71倍の高さまで伸びる板）まで数えて、
 * 当たり判定が体より上へ 2割ふくらむ。
 */
function expandVisible(box: THREE.Box3, object: THREE.Object3D): void {
  if (!object.visible) return;
  if (object instanceof THREE.Mesh) {
    const geometry = object.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const local = geometry.boundingBox;
    if (local) {
      _gbox.copy(local).applyMatrix4(object.matrixWorld);
      box.union(_gbox);
    }
  }
  for (const child of object.children) expandVisible(box, child);
}

const _screen = { x: 0, y: 0 };
/** **毎フレーム new をしない**（§10-3） */
const _at = new THREE.Vector3();
const _box = new THREE.Box3();
const _gbox = new THREE.Box3();
