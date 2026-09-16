/**
 * 全体制御・ステージ切替・各システムの配線（設計書 §7-4）
 *
 * ここは**配線だけ**。遊びの規則は `poko/` に置く。
 *
 * 出どころ: 「ばあ！」（peek-aboo）の `app/App.ts`。
 * Renderer / Loop / Input / Ripple / AudioBus / WakeLock / ParentalGate の
 * 配線はそのまま。中身が隠れ場所から水たまりに変わっている。
 */

import * as THREE from 'three';

import { AssetLoader } from '../core/AssetLoader';
import { AudioBus } from '../core/AudioBus';
import { Input } from '../core/Input';
import { Loop } from '../core/Loop';
import { QualityManager } from '../core/QualityManager';
import { Renderer } from '../core/Renderer';
import { ScreenProjector } from '../core/ScreenProjector';
import { WakeLock } from '../core/WakeLock';
import { LIGHTS } from '../data/look';
import { SPECIAL } from '../data/special';
import { STAGES, findStage } from '../data/stages';
import { StageRoot } from '../scene/StageRoot';
import { VideoLayer } from '../scene/VideoLayer';
import { ParentalGate } from '../ui/ParentalGate';
import { Ripple } from '../ui/Ripple';
import { Score } from '../ui/Score';
import type { StageId } from '../types';

/** 叩いた場所。**毎フレーム new をしない**（§10-3） */
const _hitAt = new THREE.Vector3();

export interface AppElements {
  /** 背景のループ動画を敷く場所。WebGL キャンバスはこの上に透過で重なる */
  backgroundLayer: HTMLElement;
  webglLayer: HTMLElement;
  overlayLayer: HTMLElement;
  ripples: HTMLElement;
  uiRoot: HTMLElement;
}

export class App {
  private readonly renderer: Renderer;
  private readonly scene = new THREE.Scene();
  private readonly loop = new Loop();
  private readonly input: Input;
  private readonly ripple: Ripple;
  private readonly projector: ScreenProjector;
  private readonly gate: ParentalGate;
  /** やさしい得点（§4-6）。**減らない・終わらない** */
  private readonly score: Score;
  private readonly videoLayer: VideoLayer;
  private readonly audio = new AudioBus();
  private readonly assets = new AssetLoader();
  private readonly wakeLock = new WakeLock();
  private readonly quality = new QualityManager();

  private stageRoot: StageRoot | null = null;
  private stageId: StageId = 'ike';
  private building = false;
  /** 花が咲いて、ステージの入れ替えを待っているか（§5-3） */
  private changingStage = false;

  /** 開発と E2E 用。押した回数と、水たまりに当たった回数 */
  private tapCount = 0;
  private holeHitCount = 0;
  /** 魚を叩いた回数（得点が増える叩き） */
  private fishHitCount = 0;
  /** 空振りの回数（魚の居ない水たまり） */
  private missCount = 0;
  /** 声を鳴らした記録。E2E が「役割を混ぜていない」ことを見る */
  private readonly voiceLog: { clip: string; at: number }[] = [];
  /** 「ばあっ！」をまだ鳴らしていない魚。0.12秒ずらして鳴らす（§4-4） */
  private readonly pendingBaa: { actor: number; at: number }[] = [];
  /** 前に声を鳴らした更新時刻。**声どうしを 0.12秒 空ける**ために見る */
  private lastVoiceAt = -1;
  /** どの魚が `calling` に入ったかを覚えておく（入った瞬間だけ鳴らす） */
  private readonly wasCalling: boolean[] = [];
  /** 岩の魚が `calling` に入った瞬間を拾うため（§4-8） */
  private wasRockCalling = false;
  /** 岩を押した回数。E2E が「押したら必ず反応する」を見る */
  private rockTapCount = 0;

  constructor(elements: AppElements) {
    this.renderer = new Renderer(elements.webglLayer);
    // ==================================================================
    // **`document.body` に付けること。**
    // `#overlay-layer` は `pointer-events: none`（子要素で個別に有効化する）
    // なので、そこに付けるとタップが**1度もハンドラに届かない**。
    // 「ばあ！」の骨組みを作ったときに実際にやって、画面のどこを押しても
    // タップ数が 0 のままだった（不変条件1 が丸ごと死ぬ）。
    // ==================================================================
    this.input = new Input(document.body, this.renderer.camera);
    this.ripple = new Ripple(elements.ripples);
    this.projector = new ScreenProjector(document.body, this.renderer.camera);
    this.gate = new ParentalGate(elements.uiRoot);
    // ==================================================================
    // 得点（§4-6）と、花が咲いたらステージが変わる仕掛け（§5-3）。
    //
    // **画面に切替バーを置かない。** 1歳半にステージを選ばせる必要は無いし、
    // **バーは当たり判定を塞ぐ**（「みずのなか」で 390px 幅の端末で
    // 実際に起きた事故）。得点が「場面が変わる」という形で返るので、
    // ★の意味が目に見える
    // ==================================================================
    this.score = new Score(elements.uiRoot);
    this.score.onFlower = () => this.beginStageChange();
    this.videoLayer = new VideoLayer(elements.backgroundLayer);
    this.gate.onUnlock(() => {
      // TODO(Phase 7): 音量とステージのリセットを出す
    });

    // 光。**数値は `data/look.ts` に外出ししてある**
    const key = new THREE.DirectionalLight(LIGHTS.key.color, LIGHTS.key.intensity);
    key.position.set(...LIGHTS.key.position);
    this.scene.add(key);
    const hemi = new THREE.HemisphereLight(
      LIGHTS.hemi.sky,
      LIGHTS.hemi.ground,
      LIGHTS.hemi.intensity
    );
    this.scene.add(hemi);
    const fill = new THREE.DirectionalLight(LIGHTS.fill.color, LIGHTS.fill.intensity);
    fill.position.set(...LIGHTS.fill.position);
    this.scene.add(fill);

    this.input.onTap((tap) => this.onTap(tap.screenX, tap.screenY));

    this.loop.onUpdate((ctx) => {
      this.quality.sample(this.loop.rawDelta);
      this.renderer.setResolutionScale(this.quality.settings.resolutionScale);
      // **画面座標は毎フレーム測り直す。** 画面の向きが変わると全部ずれる
      // **当たり判定の中心を、いま魚が居るところに合わせる**
      this.stageRoot?.holes.measure(this.projector, this.stageRoot.fishOffsets());
      // **岩は水たまりの円を測ったあとに測る。** 岩の当たり判定は
      // 水たまりの円に食い込まないところまで縮むので、先に水たまりが要る
      this.stageRoot?.rocks.measure(this.projector, this.stageRoot.holes);
      // **更新時計を渡す。壁時計を読まない**（§11-4）
      this.stageRoot?.update(ctx.dt, this.loop.simulatedSeconds);
      this.speakOnRise();
      // 花が咲いていたら、魚が引っ込みきった時点でステージを入れ替える（§5-3）
      this.pumpStageChange();
    });
    this.loop.onRender(() => this.renderer.render(this.scene));
  }

  async start(): Promise<void> {
    // 先にループを回す。ステージの構築を待たせない。
    // 構築が終わる前に押されても、波紋と効果音は返る（不変条件1）
    this.loop.start();
    void this.wakeLock.request();
    await this.loadStage(this.stageId);
  }

  /** ステージを差し替える。前のステージは必ず捨てる（不変条件8） */
  async loadStage(id: string): Promise<void> {
    if (this.building) return;
    this.building = true;
    try {
      const config = findStage(id) ?? STAGES[0];
      const next = await StageRoot.build(config, this.assets);

      // **古いほうを捨ててから足す。** 順番を逆にすると、一瞬だけ
      // 2ステージぶんのリソースが載って、切替のたびに山が出る
      if (this.stageRoot) {
        this.scene.remove(this.stageRoot.group);
        this.stageRoot.dispose();
      }
      this.stageRoot = next;
      this.stageId = config.id;
      // **入れ替え待ちを必ず解く。** 新しい `StageRoot` は抽選も魚も
      // 作り直されているので、待ちが残っていると次の花で何も起きなくなる
      this.changingStage = false;
      // **背景の動画を差し替える**（前のは `setVideo` の中で止めて捨てる）
      this.videoLayer.setVideo(next.video);
      this.scene.add(next.group);
      next.holes.measure(this.projector, next.fishOffsets());
    } finally {
      this.building = false;
    }
  }

  /**
   * タップ。**必ず何かを返す**（不変条件1）。
   *
   * ========================================================================
   * **0フレーム原則**（§4-3）。ここは `Input` のハンドラの中なので、
   * `FishSystem.hit()` を呼んだ時点で潰れが始まり、音も声も**その場**で鳴る。
   * **次の更新を待たない。** 「ばあ！」は押してから 0.35秒後に山が来る
   * 作りで、そこが受けなかった。
   * ========================================================================
   */
  private onTap(screenX: number, screenY: number): void {
    this.tapCount++;
    // **音は初期ミュート。最初のタップで解禁する**（不変条件9）
    void this.audio.unlock();
    // 自動再生が拒否されていたら、ここで動かす（端末によっては
    // ユーザー操作の前に再生できない。**止まった絵のまま気づかない**のを防ぐ）
    this.videoLayer.resume();
    this.ripple.spawn(screenX, screenY);

    const root = this.stageRoot;
    const hole = root?.holes.pick(screenX, screenY) ?? null;

    // ==================================================================
    // **岩を先に見る**（§4-8）。岩の円は水たまりの円に食い込まないよう
    // 縮めてあるので、両方に当たることは無い。それでも順番を決めておくのは、
    // 丸め誤差で境界にちょうど乗ったときのため
    // ==================================================================
    if (root && !hole) {
      const rockIndex = root.rocks.pick(screenX, screenY);
      if (rockIndex >= 0) {
        this.onRockTap(root, rockIndex);
        return;
      }
    }

    if (!root || !hole) {
      // 水たまりでも岩でもないところ。**波紋と音だけ**（不変条件1）
      this.audio.playOneShot('plop');
      return;
    }

    this.holeHitCount++;
    const holeIndex = root.holes.runtimes.indexOf(hole);
    // **`calling` の魚は叩けない**（まだ1画素も見えていない）
    const actorIndex = root.fish.actors.findIndex(
      (a) => a.holeIndex === holeIndex && a.state !== 'hidden' && a.state !== 'calling'
    );
    const scored = actorIndex >= 0 ? root.fish.hit(actorIndex) : false;

    // しぶき・揺れ・ハンマーは**当たっても外しても**返す（不変条件1・3b）。
    // 叩いた場所は**魚が居るところ**（穴の中心ではない）。
    // 魚は穴の右へ泳ぎ出るので、ずれを足さないと的の外で演出が出る
    const actor = actorIndex >= 0 ? root.fish.actors[actorIndex] : null;
    _hitAt.set(
      hole.worldPosition.x + (actor ? actor.group.position.x : 0),
      hole.worldPosition.y,
      0
    );
    root.effect.splash(_hitAt, scored, root.rng);
    root.effect.shake(holeIndex);
    // **ピコピコハンマー**（2026-09-13、人間が決めた）。
    // 叩いたことが絵で分かるので、1歳半にも「自分がやった」が読める
    root.effect.hammer(_hitAt);

    if (scored) {
      this.fishHitCount++;
      // ==================================================================
      // **増えるだけ**（§4-6）。10個で花になり、花はステージを変える。
      //
      // §6-2 の特別な魚は、ここで返りかたを変える:
      //  - **きんいろ** → 花が1つ咲く（＝その場でステージが変わる）
      //  - **大きい**   → ★が3つ増える
      //
      // **どちらも `actor` を見て決める。** `actor` は `hit()` を呼んだあとも
      // まだ `variant` を持っている（引っ込みきったときに戻る）
      // ==================================================================
      const variant = actor?.variant ?? 'normal';
      if (variant === 'gold') this.score.addFlower();
      else if (variant === 'big') for (let i = 0; i < SPECIAL.bigStars; i++) this.score.add();
      else this.score.add();
      this.audio.playOneShot('plop');
      // **「いてっ」は当たった合図。** `speak()` を通さない（§4-4）
      this.audio.playVoice('ite');
      this.voiceLog.push({ clip: 'ite', at: this.loop.simulatedSeconds });
      this.stageRoot?.spawner.reportHit(true);
    } else {
      this.missCount++;
      // 低い音だけ。**声を出さない**（§4-5。外れを失敗にしないし、
      // 声は「出た」「当たった」の2つの意味に取っておく）
      this.audio.playOneShot('bubble');
      this.stageRoot?.spawner.reportHit(false);
    }
    this.stageRoot?.spawner.applyAssist(root.fish);
  }

  /**
   * 花が咲いた（★10個）。**ステージを入れ替える準備を始める**（§5-3）。
   *
   * ========================================================================
   * **その場で入れ替えない。** 出ている魚が消えてしまうし、叩いた手ごたえが
   * 返る前に画面が変わると、何が起きたのか読めない。
   *
   * 抽選を止めて、いま出ている魚が引っ込みきるのを待つ
   * （`update()` の中で見ている）。**待つあいだも叩ける**（不変条件2）し、
   * 押せば波紋と音が返る（不変条件1）。
   * **暗転もローディングも作らない**（§5-3）。
   *
   * **抽選を止めるだけでよい**（2026-09-15、実測して決めた）。
   * `FishSystem` の「最後の1匹は代わりが出るまで沈まない」（不変条件4c）が
   * 引っかかって永遠に切り替わらないのでは、と思って解除する仕掛けを
   * 書いたが、**8通り測って7通りでフレーム数がまったく同じ**だった
   * （残り1通りも 63 → 32フレーム）。あの決まりが効くのは
   * 「相棒が沈んでいる最中」だけで、相棒はすぐ `hidden` になるので
   * **自然に解ける**。要らない機構は置かない。
   *
   * 実測の待ち時間: **32〜283フレーム（0.5〜4.7秒）**。
   * ========================================================================
   */
  private beginStageChange(): void {
    if (this.changingStage || this.building) return;
    const root = this.stageRoot;
    if (!root) return;
    this.changingStage = true;
    root.spawner.setPaused(true);
  }

  /**
   * 入れ替えの準備ができたか、毎フレーム見る（§5-3）。
   *
   * **岩の魚も引っ込みきるまで待つ。** 待たないと、出ている魚が
   * 岩ごと消えて「いま見ていたものが無くなった」になる。
   */
  private pumpStageChange(): void {
    if (!this.changingStage || this.building) return;
    const root = this.stageRoot;
    if (!root) return;
    if (root.fish.countActive() > 0) return;
    if (root.rocks.state !== 'hidden') return;

    // **2ステージしか無いので、交互に行き来するだけ**（§5-3）
    const next = STAGES.find((s) => s.id !== this.stageId) ?? STAGES[0];
    this.changingStage = false;
    void this.loadStage(next.id);
  }

  /**
   * 岩を押した（§4-8）。**必ず何かを返す**（不変条件1）。
   *
   * ========================================================================
   * **0フレーム原則**（§4-3）。`RockSystem.tap()` の中で揺れと潰れが始まり、
   * 音もここで鳴る。**次の更新を待たない。**
   *
   * 「ばあっ！」だけは `speakOnRise()` が鳴らす —— `calling`（0.38秒）を
   * 挟んで、**姿が1画素も見えないうちに**声を先に出すため。
   * ここで鳴らすと水たまりの魚と順番が変わる。
   * ========================================================================
   */
  private onRockTap(root: StageRoot, rockIndex: number): void {
    this.rockTapCount++;
    const result = root.rocks.tap(rockIndex);
    const rock = root.rocks.runtimes[rockIndex];
    _hitAt.copy(rock.worldPosition);

    if (result === 'hit') {
      this.fishHitCount++;
      // 岩の魚も1匹は1匹。**水たまりと同じに数える**（§4-6）
      this.score.add();
      this.audio.playOneShot('plop');
      // **「いてっ」は当たった合図**（§4-4。`speak()` を通さない）
      this.audio.playVoice('ite');
      this.voiceLog.push({ clip: 'ite', at: this.loop.simulatedSeconds });
      // しぶきとハンマーは**魚が出ている手前**に出す
      root.effect.splash(_hitAt, true, root.rng);
      root.effect.hammer(_hitAt);
      return;
    }

    // 空振りと、出はじめの合図。**声は出さない**（§4-5。外れを失敗にしないし、
    // 「ばあっ」は `speakOnRise()` の役目）
    this.audio.playOneShot(result === 'baa' ? 'plop' : 'bubble');
    root.effect.splash(_hitAt, false, root.rng);
  }

  /**
   * 魚が出てくる**前**に「ばあっ！」と言う（§4-4）。
   *
   * ========================================================================
   * **`calling` に入った瞬間に鳴らす。** 姿はまだ1画素も見えていない。
   *
   * 実機で「**『ばあっ』する前にチラッと見えている**」と言われた
   * （2026-09-13）。声と同時に動きはじめていたので、声が耳に届く前に
   * 姿が見えていた。「何も見えない状態で『ばあっ』と言って出てくる」が
   * 人間の指定なので、`calling`（0.38秒・姿を出さない）を挟んだ。
   *
   * `hidden` では鳴らさない ——
   * 「ばあ！」で**隠れたままなのに「ばあっ」と言う**のが、
   * いちばん紛らわしい間違いだった。
   *
   * **同時に出た2匹を同じフレームで鳴らさない。** `voiceBusyUntil` に
   * 任せると2匹目が無音になるので、0.12秒ずらす（間があると「2匹出た」と分かる）。
   * ========================================================================
   */
  private speakOnRise(): void {
    const root = this.stageRoot;
    if (!root) return;
    const now = this.loop.simulatedSeconds;

    for (let i = 0; i < root.fish.actors.length; i++) {
      const calling = root.fish.actors[i].state === 'calling';
      if (calling && !this.wasCalling[i]) {
        // すでに待っている声があれば、そのぶん後ろへずらす
        const delay = this.pendingBaa.length * 0.12;
        this.pendingBaa.push({ actor: i, at: now + delay });
      }
      this.wasCalling[i] = calling;
    }

    // **岩の魚も同じ列に並べる**（§4-8）。別に鳴らすと、水たまりの魚と
    // 同じフレームで重なる（`voiceBusyUntil` に任せると片方が落ちる）
    const rockCalling = root.rocks.state === 'calling';
    if (rockCalling && !this.wasRockCalling) {
      this.pendingBaa.push({ actor: -1, at: now + this.pendingBaa.length * 0.12 });
    }
    this.wasRockCalling = rockCalling;

    // ==================================================================
    // **前の声から 0.12秒は空ける。**
    //
    // 並べるときに `pendingBaa.length` でずらすだけでは足りなかった
    // （2026-09-13 の実測）。2匹が**続けて**（別のフレームで）出ると、
    // 1匹目を鳴らして列が空になり、2匹目が待ち 0 で入るので
    // **1フレーム差（0.017秒）で重なった**。
    // 並べ方ではなく「前の声からの間隔」で見る。
    // ==================================================================
    while (this.pendingBaa.length > 0 && this.pendingBaa[0].at <= now) {
      if (now - this.lastVoiceAt < 0.12) break;
      this.pendingBaa.shift();
      this.lastVoiceAt = now;
      this.audio.playVoice('baa');
      this.voiceLog.push({ clip: 'baa', at: now });
    }
  }

  /** E2E と実機確認のためのデバッグ API。**本番ビルドでも公開する** */
  createDebugApi() {
    return {
      getTapCount: () => this.tapCount,
      getHoleHitCount: () => this.holeHitCount,
      getStageId: () => this.stageId,
      getHoles: () => this.stageRoot?.holes.describe() ?? [],
      /** 魚の様子。**E2E が「叩ける相手が 0 にならない」を見る**（不変条件4c） */
      getFish: () =>
        this.stageRoot?.fish.actors.map((a) => ({
          id: a.config.id,
          state: a.state,
          reveal: +a.reveal.toFixed(3),
          squash: +a.squash.toFixed(3),
          bump: +a.bump.toFixed(3),
          holeIndex: a.holeIndex,
          variant: a.variant,
        })) ?? [],
      getFishSizes: () => this.stageRoot?.fish.describeSizes() ?? [],
      getFishDebug: () =>
        (this.stageRoot?.fish.actors ?? []).map((a) => {
          const box = new THREE.Box3().setFromObject(a.group);
          const size = new THREE.Vector3();
          box.getSize(size);
          const ws = new THREE.Vector3();
          a.group.getWorldScale(ws);
          let childScale = 'none';
          a.group.traverse((o) => {
            if (o.name === 'fish.plate' || (o as THREE.Mesh).isMesh) return;
            if (o !== a.group) childScale = `${o.scale.x.toFixed(3)}`;
          });
          return {
            id: a.config.id,
            worldSize: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)],
            groupScale: +ws.x.toFixed(3),
            childScale,
          };
        }),
      getHittableCount: () => this.stageRoot?.fish.countHittable() ?? 0,
      /** 岩（§4-8）。画面座標と当たり半径。**水たまりと重ならない**ことを見る */
      getRocks: () => this.stageRoot?.rocks.describe() ?? [],
      getRockTapCount: () => this.rockTapCount,
      /** 得点（§4-6）。**数字は画面に出さない**ので、確認はここから */
      getScore: () => this.score.describe(),
      /**
       * 次に出る1匹の種類を決め打ちする（§6-2）。
       * **16回に1回・20回に1回を待たずに実機で見るための口。**
       * 例: `__poko.forceVariant('gold')`
       */
      forceVariant: (v: 'normal' | 'big' | 'gold' | null) =>
        this.stageRoot?.spawner.forceNext(v),
      /** 花が咲いて、ステージの入れ替えを待っているか（§5-3） */
      isChangingStage: () => this.changingStage,
      /** 岩の魚の様子。E2E が「ばあっ の時点で見えていない」を見る */
      getRockFish: () => {
        const rocks = this.stageRoot?.rocks;
        if (!rocks) return null;
        return {
          id: rocks.fishConfig?.id ?? null,
          state: rocks.state,
          reveal: +rocks.reveal.toFixed(3),
          squash: +rocks.squash.toFixed(3),
          bump: +rocks.bump.toFixed(3),
          rockIndex: rocks.rockIndex,
          visible: rocks.fish?.group.visible ?? false,
          z: +(rocks.fish?.group.position.z ?? 0).toFixed(3),
        };
      },
      getUpSec: () => this.stageRoot?.fish.getUpSec() ?? 0,
      getFishHitCount: () => this.fishHitCount,
      getMissCount: () => this.missCount,
      /** 声の記録。**役割を混ぜていない**ことを E2E が見る（§4-4） */
      getVoiceLog: () => this.voiceLog.slice(),
      setStage: (id: string) => this.loadStage(id),
      /** **壁時計を読まないこと**（§11-4）。待つのはこの時計 */
      getSimulatedSeconds: () => this.loop.simulatedSeconds,
      getRenderInfo: () => {
        const info = this.renderer.renderer.info;
        return {
          triangles: info.render.triangles,
          calls: info.render.calls,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
        };
      },
      /** ステージを作り直す。往復させて数が増えないことを見る（不変条件8） */
      reloadStage: (): Promise<void> => this.loadStage(this.stageId),
    };
  }
}
