/**
 * 1ステージぶんの生成と破棄（設計書 §5-2 / §5-3）
 *
 * **場面を捨てるときに geometry / material / texture を1つでも漏らすと
 * リークする**（不変条件8）。`dispose()` に全部並べること。
 *
 * 出どころ: 「ばあ！」（peek-aboo）の `scene/SceneRoot.ts`。
 * 背景の敷きかたはそのままで、隠れ場所のかわりに水たまりを置く。
 */

import * as THREE from 'three';

import type { AssetLoader } from '../core/AssetLoader';
import { findFish } from '../data/fish';
import { FishSystem } from '../poko/FishSystem';
import { HitEffect } from '../poko/HitEffect';
import { HoleSystem } from '../poko/HoleSystem';
import { Spawner, seededRandom } from '../poko/Spawner';
import { createWaterShape, type WaterShape } from '../poko/WaterShape';
import type { StageConfig } from '../types';
import { createBackdropImage, createBackdropTexture, sampleBackdropLight } from './Backdrop';
import { createWaterSceneTexture } from './WaterScene';

export class StageRoot {
  readonly group = new THREE.Group();
  readonly holes: HoleSystem;
  readonly fish: FishSystem;
  readonly spawner: Spawner;
  readonly effect: HitEffect;
  /** しぶきの散りかた。**遊びの乱数は独立したシードから引く**（§4-2） */
  readonly rng = seededRandom(0x5bf03635);
  readonly ambient: { sky: THREE.Color; ground: THREE.Color };

  private readonly waters: WaterShape[] = [];
  private readonly _offsets: number[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  private constructor(
    readonly config: StageConfig,
    holes: HoleSystem,
    fish: FishSystem,
    spawner: Spawner,
    effect: HitEffect,
    waters: WaterShape[],
    ambient: { sky: THREE.Color; ground: THREE.Color },
    parts: THREE.Object3D[],
    disposables: { dispose(): void }[]
  ) {
    this.holes = holes;
    this.fish = fish;
    this.spawner = spawner;
    this.effect = effect;
    this.waters = waters;
    this.ambient = ambient;
    this.disposables = disposables;
    for (const part of parts) this.group.add(part);
    this.group.add(holes.group);
    // しぶきは**水たまりより手前**。奥だと水面に隠れて1粒も見えない
    // （「ばあ！」で足あとを置いて見えなかったのと同じ失敗）
    this.effect.group.position.z = 0.3;
    this.group.add(this.effect.group);
  }

  /**
   * ステージを組み立てる。
   *
   * **素材が1つも無くても必ず返る**（不変条件7）。
   * `backgroundUrl` が null でも 404 でも `AssetLoader` が黙って null を返し、
   * 手続き生成のグラデーションに落ちる。**ここで例外を投げない。**
   */
  /** 背景のループ動画。読めなければ null（手続き生成の絵に落ちる） */
  video: HTMLVideoElement | null = null;

  static async build(config: StageConfig, assets: AssetLoader): Promise<StageRoot> {
    const holes = new HoleSystem(config);
    const parts: THREE.Object3D[] = [];
    const disposables: { dispose(): void }[] = [];

    // **素材のURLは必ず `resolveAssetUrl()` を通す**（`AssetLoader` の中で通している）。
    // 通っていないと、フォールバックが効いて「一応動く」ので気づけない
    // **動画があれば、絵は敷かない**（動画が全画面を覆う）
    const video = config.videoUrl ? await assets.loadVideo(config.videoUrl) : null;
    const loaded = video ? null : await assets.loadOptionalTexture(config.backgroundUrl);

    // ==================================================================
    // **手続き生成の水中も「絵」として扱う**（2026-09-14）。
    //
    // 地の板（16×16 の正方形）に貼ってはいけない。この絵は縦 1:2 なので
    // **横に潰れる**。「ばあ！」で
    // 「正方形の板に貼らないこと。縦長の絵が横に潰れる」と実測している。
    // 読み込んだ絵とまったく同じ道（`createBackdropImage`）を通す
    // ==================================================================
    const generated = !video && !loaded && config.waterScene
      ? createWaterSceneTexture(config.waterScene, config.waterScene.seed)
      : null;
    const background = loaded ?? generated;
    // **手続き生成したぶんは自分で捨てる**（`AssetLoader` の持ち物ではない）
    if (generated) disposables.push(generated);

    // ==================================================================
    // 地の板。**動画のときは1枚も置かない**（2026-09-14、絵を見て直した）。
    //
    // 動画は `<video>` を全画面に敷き、**透過した WebGL キャンバス**を
    // その上に重ねて見せている（`scene/VideoLayer.ts`）。
    // ここで不透明な板を置くと、**動画が丸ごと隠れる**。
    // 実際に隠れていて、画面には空のグラデーションしか映っていなかった。
    // 読み込みも再生も成功していた（trace に `RES 206 river.webm`）ので、
    // **動画の側を疑っても永遠に見つからない**種類の事故。
    //
    // 動画が読めなければ `video` は null なので、板は今までどおり出る
    // （不変条件7）。
    // ==================================================================
    if (!video) {
      const backdrop =
        !background && typeof document !== 'undefined'
          ? createBackdropTexture(config.sky[0], config.sky[1])
          : null;
      const floorMaterial = new THREE.MeshBasicMaterial({
        color: backdrop ? 0xffffff : new THREE.Color(config.sky[1]),
        toneMapped: false,
        ...(backdrop ? { map: backdrop } : {}),
      });
      // **画面いっぱいを覆う大きさにする。** 14×10 では縦が足りず、
      // 上下にレンダラのクリア色の帯が出た（「ばあ！」の実測）
      const floorGeometry = new THREE.PlaneGeometry(16, 16);
      const floor = new THREE.Mesh(floorGeometry, floorMaterial);
      floor.position.set(0, 0, -1.6);
      floor.rotation.x = -0.12;
      parts.push(floor);
      disposables.push(floorGeometry, floorMaterial);
      if (backdrop) disposables.push(backdrop);
    }

    // 背景の絵。**縦横比を崩さない**（正方形の板に貼ると横に潰れる）。
    // **光を当てない**（`MeshBasicMaterial` ＋ `toneMapped = false`）
    if (background) {
      const image = createBackdropImage(background);
      parts.push(image);
      disposables.push(image.geometry, image.material as THREE.Material);
    }

    // 場面の光の色は絵から読む。絵が無ければ `sky` の2色に落ちる（不変条件7）
    const sampled = background ? sampleBackdropLight(background) : null;
    const ambient = sampled ?? {
      sky: new THREE.Color(config.sky[0]),
      ground: new THREE.Color(config.sky[1]),
    };

    // 水たまり。**6箇所とも同じ形**（作り分けは要らない。§5-2）
    const waters: WaterShape[] = [];
    for (const runtime of holes.runtimes) {
      const water = createWaterShape(config.water, config.bank);
      runtime.group.add(water.group);
      waters.push(water);
    }

    // さかな。**1種につき1匹だけ作る**（同じ魚を同時に2箇所へ出さないので足りる）。
    // **素材が無くても手続き生成で必ず作れる**（不変条件7）
    const configs = config.fish.map(findFish).filter((f): f is NonNullable<typeof f> => f !== null);
    // ==================================================================
    // **モデルと体の画像を先に読む**（2026-09-14、人間の指示で
    // 「みずのなか」の 3D 魚を使うことにした）。
    // **1つでも読めなければ、その種だけ canvas の絵に落ちる**（不変条件7）。
    // ここで待つのは `FishSystem` の組み立てが同期だから。
    // ステージの構築はもともと非同期なので待ち時間は増えない
    // ==================================================================
    const models = new Map<string, THREE.Object3D>();
    const skins = new Map<string, THREE.Texture>();
    await Promise.all(
      configs.map(async (f) => {
        const [model, skin] = await Promise.all([
          assets.loadModel(f.modelUrl ?? null),
          f.skinUrl ? assets.loadOptionalTexture(f.skinUrl) : Promise.resolve(null),
        ]);
        if (model) models.set(f.id, model);
        if (skin) skins.set(f.id, skin);
      })
    );
    const fish = new FishSystem(configs, models, skins);
    // 魚は水たまりの子にする。水面（z = 0）より奥（`FISH_Z`）に置くので、
    // 沈んでいるあいだは水に隠れる
    for (const actor of fish.actors) holes.runtimes[0].group.add(actor.group);
    const spawner = new Spawner(holes.runtimes.length);
    // しぶきは水の色。**白い粒にしない**（うみ では背景に溶ける）
    const effect = new HitEffect(config.water[0]);

    const root = new StageRoot(config, holes, fish, spawner, effect, waters, ambient, parts, disposables);
    root.video = video;
    return root;
  }

  /**
   * 穴ごとの「いま魚が居る x のずれ」。当たり判定の中心をここへ動かす。
   *
   * **毎フレーム作り直さない**（§10-3）ので配列を使い回す。
   */
  fishOffsets(): readonly number[] {
    this._offsets.length = this.holes.runtimes.length;
    this._offsets.fill(0);
    for (const actor of this.fish.actors) {
      if (actor.holeIndex < 0 || actor.state === 'hidden' || actor.state === 'calling') continue;
      this._offsets[actor.holeIndex] = actor.group.position.x;
    }
    return this._offsets;
  }

  /**
   * `elapsed` は**更新時計**の秒（`Loop.simulatedSeconds`）。壁時計を読まない。
   * `dt` は固定タイムステップ（1/60）。
   */
  update(dt: number, elapsed: number): void {
    for (const water of this.waters) water.update(elapsed);
    this.spawner.update(dt, this.fish);
    this.fish.update(dt);
    this.effect.update(
      dt,
      this.holes.runtimes.map((r) => r.group)
    );
    // **切り取り面を穴の口に合わせる。** これが無いと、
    // 隠れている魚が穴の外に見える（実機で「チラッと見えている」と言われた）
    this.fish.updateClipping(this.holes.runtimes.map((r) => r.worldPosition.x));
    // 魚は**いま居る水たまりの子**に付け替える。
    // `holeIndex` が変わったときだけ動かす（毎フレーム付け替えない）
    for (const actor of this.fish.actors) {
      if (actor.holeIndex < 0) continue;
      const want = this.holes.runtimes[actor.holeIndex]?.group;
      if (want && actor.group.parent !== want) want.add(actor.group);
    }
  }

  dispose(): void {
    this.effect.dispose();
    this.fish.dispose();
    for (const water of this.waters) water.dispose();
    for (const item of this.disposables) item.dispose();
  }
}
