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
import { STAGES, findStage } from '../data/stages';
import { StageRoot } from '../scene/StageRoot';
import { ParentalGate } from '../ui/ParentalGate';
import { Ripple } from '../ui/Ripple';
import type { StageId } from '../types';

/** 叩いた場所。**毎フレーム new をしない**（§10-3） */
const _hitAt = new THREE.Vector3();

export interface AppElements {
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
  private readonly audio = new AudioBus();
  private readonly assets = new AssetLoader();
  private readonly wakeLock = new WakeLock();
  private readonly quality = new QualityManager();

  private stageRoot: StageRoot | null = null;
  private stageId: StageId = 'ike';
  private building = false;

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
  /** どの魚が `rising` に入ったかを覚えておく（入った瞬間だけ鳴らす） */
  private readonly wasRising: boolean[] = [];

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
      this.stageRoot?.holes.measure(this.projector);
      // **更新時計を渡す。壁時計を読まない**（§11-4）
      this.stageRoot?.update(ctx.dt, this.loop.simulatedSeconds);
      this.speakOnRise();
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
      this.scene.add(next.group);
      next.holes.measure(this.projector);
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
    this.ripple.spawn(screenX, screenY);

    const root = this.stageRoot;
    const hole = root?.holes.pick(screenX, screenY) ?? null;
    if (!root || !hole) {
      // 水たまりでも何でもないところ。**波紋と音だけ**（不変条件1）
      this.audio.playOneShot('plop');
      return;
    }

    this.holeHitCount++;
    const holeIndex = root.holes.runtimes.indexOf(hole);
    const actorIndex = root.fish.actors.findIndex(
      (a) => a.holeIndex === holeIndex && a.state !== 'hidden'
    );
    const scored = actorIndex >= 0 ? root.fish.hit(actorIndex) : false;

    // しぶきと揺れは**当たっても外しても**返す（不変条件1・3b）
    _hitAt.set(hole.worldPosition.x, hole.worldPosition.y + 0.2, 0);
    root.effect.splash(_hitAt, scored, root.rng);
    root.effect.shake(holeIndex);

    if (scored) {
      this.fishHitCount++;
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
   * 魚が水面から見えはじめたフレームで「ばあっ！」と言う（§4-4）。
   *
   * ========================================================================
   * **`rising` に入った瞬間だけ鳴らす。** `hidden` では鳴らさない ——
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
      const rising = root.fish.actors[i].state === 'rising';
      if (rising && !this.wasRising[i]) {
        // すでに待っている声があれば、そのぶん後ろへずらす
        const delay = this.pendingBaa.length * 0.12;
        this.pendingBaa.push({ actor: i, at: now + delay });
      }
      this.wasRising[i] = rising;
    }

    while (this.pendingBaa.length > 0 && this.pendingBaa[0].at <= now) {
      this.pendingBaa.shift();
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
          holeIndex: a.holeIndex,
        })) ?? [],
      getHittableCount: () => this.stageRoot?.fish.countHittable() ?? 0,
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
