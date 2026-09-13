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

    this.loop.onUpdate(() => {
      this.quality.sample(this.loop.rawDelta);
      this.renderer.setResolutionScale(this.quality.settings.resolutionScale);
      // **画面座標は毎フレーム測り直す。** 画面の向きが変わると全部ずれる
      this.stageRoot?.holes.measure(this.projector);
      // **更新時計を渡す。壁時計を読まない**（§11-4）
      this.stageRoot?.update(this.loop.simulatedSeconds);
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
   * Phase 1 ではまだ魚が居ないので、水たまりに当たっても当たらなくても
   * 波紋と音だけ。**当たったかどうかは数えておく**（E2E が見る）。
   */
  private onTap(screenX: number, screenY: number): void {
    this.tapCount++;
    // **音は初期ミュート。最初のタップで解禁する**（不変条件9）
    void this.audio.unlock();
    this.ripple.spawn(screenX, screenY);
    const hole = this.stageRoot?.holes.pick(screenX, screenY) ?? null;
    if (hole) {
      this.holeHitCount++;
      // 水たまりに当たった。Phase 3 で魚の判定が入る
      this.audio.playOneShot('bubble');
    } else {
      this.audio.playOneShot('plop');
    }
  }

  /** E2E と実機確認のためのデバッグ API。**本番ビルドでも公開する** */
  createDebugApi() {
    return {
      getTapCount: () => this.tapCount,
      getHoleHitCount: () => this.holeHitCount,
      getStageId: () => this.stageId,
      getHoles: () => this.stageRoot?.holes.describe() ?? [],
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
