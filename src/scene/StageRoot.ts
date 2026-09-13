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
import { HoleSystem } from '../poko/HoleSystem';
import { Spawner } from '../poko/Spawner';
import { createWaterShape, type WaterShape } from '../poko/WaterShape';
import type { StageConfig } from '../types';
import { createBackdropImage, createBackdropTexture, sampleBackdropLight } from './Backdrop';

export class StageRoot {
  readonly group = new THREE.Group();
  readonly holes: HoleSystem;
  readonly fish: FishSystem;
  readonly spawner: Spawner;
  readonly ambient: { sky: THREE.Color; ground: THREE.Color };

  private readonly waters: WaterShape[] = [];
  private readonly disposables: { dispose(): void }[] = [];

  private constructor(
    readonly config: StageConfig,
    holes: HoleSystem,
    fish: FishSystem,
    spawner: Spawner,
    waters: WaterShape[],
    ambient: { sky: THREE.Color; ground: THREE.Color },
    parts: THREE.Object3D[],
    disposables: { dispose(): void }[]
  ) {
    this.holes = holes;
    this.fish = fish;
    this.spawner = spawner;
    this.waters = waters;
    this.ambient = ambient;
    this.disposables = disposables;
    for (const part of parts) this.group.add(part);
    this.group.add(holes.group);
  }

  /**
   * ステージを組み立てる。
   *
   * **素材が1つも無くても必ず返る**（不変条件7）。
   * `backgroundUrl` が null でも 404 でも `AssetLoader` が黙って null を返し、
   * 手続き生成のグラデーションに落ちる。**ここで例外を投げない。**
   */
  static async build(config: StageConfig, assets: AssetLoader): Promise<StageRoot> {
    const holes = new HoleSystem(config);
    const parts: THREE.Object3D[] = [];
    const disposables: { dispose(): void }[] = [];

    // **素材のURLは必ず `resolveAssetUrl()` を通す**（`AssetLoader` の中で通している）。
    // 通っていないと、フォールバックが効いて「一応動く」ので気づけない
    const background = await assets.loadOptionalTexture(config.backgroundUrl);

    // 地の板。絵があってもうしろに残す（横持ちで地の色が出ないように）
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
    const fish = new FishSystem(configs);
    // 魚は水たまりの子にする。水面（z = 0）より奥（`FISH_Z`）に置くので、
    // 沈んでいるあいだは水に隠れる
    for (const actor of fish.actors) holes.runtimes[0].group.add(actor.group);
    const spawner = new Spawner(holes.runtimes.length);

    return new StageRoot(config, holes, fish, spawner, waters, ambient, parts, disposables);
  }

  /**
   * `elapsed` は**更新時計**の秒（`Loop.simulatedSeconds`）。壁時計を読まない。
   * `dt` は固定タイムステップ（1/60）。
   */
  update(dt: number, elapsed: number): void {
    for (const water of this.waters) water.update(elapsed);
    this.spawner.update(dt, this.fish);
    this.fish.update(dt);
    // 魚は**いま居る水たまりの子**に付け替える。
    // `holeIndex` が変わったときだけ動かす（毎フレーム付け替えない）
    for (const actor of this.fish.actors) {
      if (actor.holeIndex < 0) continue;
      const want = this.holes.runtimes[actor.holeIndex]?.group;
      if (want && actor.group.parent !== want) want.add(actor.group);
    }
  }

  dispose(): void {
    this.fish.dispose();
    for (const water of this.waters) water.dispose();
    for (const item of this.disposables) item.dispose();
  }
}
