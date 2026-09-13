/**
 * さかなの手続き生成（設計書 §5-1 / §9）
 *
 * ==========================================================================
 * **輪郭で見分けられるように作ること。**
 *
 * 「みずのなか」で体型（`bodyHeight` / `bodyWidth`）を指定しなかったら、
 * **チョウチョウウオもメダカも同じ魚になった**。色を変えても、
 * 輪郭が同じなら同じ魚に見える。
 * 「ばあ！」でも、岩とくさむらが左右反転して重ねた IoU 0.789〜0.879 で
 * 判定に「同じ塊を2色に塗っただけ」と言われている。
 *
 * だから `FishConfig` を**読むだけで輪郭が決まる**ようにする。
 * **`switch (cfg.id)` を書かない** ——「ばあ！」で動物が17体になった時点で
 * 分岐が「顔」「頭の上」「尾」の3箇所に散り、新しい動物を足したときに
 * 1箇所だけ入れ忘れる形になった（実際に既存5体の耳と尾が消えた）。
 *
 * **横向きに作る。** 魚は真正面から見ると輪郭が消える。
 * カメラは動かないので、常に横を向かせておけばよい。
 * ==========================================================================
 */

import * as THREE from 'three';

import type { FishConfig } from '../types';

/** 体の長さ（ワールド）。体高と体幅はこれに対する比 */
const LENGTH = 0.95;

/** 尾の形ごとの、長さと広がり（体長に対する比） */
const TAILS: Record<FishConfig['tail'], { len: number; spread: number; split: number }> = {
  // 金魚のひらひらした尾。長くて広い
  fan: { len: 0.42, spread: 1.25, split: 0.0 },
  // 二股。鯉・鯛・チョウチョウウオ
  fork: { len: 0.34, spread: 0.95, split: 0.55 },
  // 丸い。くまのみ・ふぐ・なまず
  round: { len: 0.22, spread: 0.78, split: 0.0 },
  // 細長い
  long: { len: 0.5, spread: 0.5, split: 0.0 },
};

/** ひれの大きさ（体高に対する比） */
const FINS: Record<FishConfig['fins'], number> = {
  small: 0.3,
  wide: 0.55,
  flowing: 0.8,
};

export interface ProceduralFish {
  readonly group: THREE.Group;
  /** **見かけの**高さ（ワールド） */
  readonly height: number;
  /** 見かけの幅（ワールド） */
  readonly width: number;
  /**
   * **この x より左を描かない**（ワールド座標）。
   *
   * 穴の口に合わせておくと、隠れているあいだ1画素も見えない。
   * 板で覆うのと違って、**形に関係なく確実に消える。**
   */
  setClipX(worldX: number): void;
  /** たんこぶの育ち 0..1。叩かれた印（2026-09-13、人間が決めた） */
  setBump(t: number): void;
  dispose(): void;
}

/**
 * 見かけの高さ（ワールド）。**幅ではなく高さでそろえる。**
 *
 * ==========================================================================
 * **幅でそろえたら、背の高い魚が池に沈みきらなかった**（2026-09-13 の実測）。
 *
 * 手前の水面が隠せるのは水面の線から `RY`（0.45）ぶんだけなので、
 * **魚の高さがそれを超えると、沈んでいるのに体が見える。**
 * 幅をそろえると きんぎょ（体高 0.85）は 0.9 の高さになって収まらない。
 *
 * 高さでそろえると、
 *  - どの魚も**同じだけ沈み、同じだけ出る**（当たりやすさが種類で変わらない）
 *  - **長さの差はそのまま残る** —— きんぎょは短くて丸く、こいは細長い。
 *    見分けは輪郭で決まるので、これで足りる
 * ==========================================================================
 */
const TARGET_H = 0.44;

/**
 * `FishConfig` から魚を1匹作る。
 *
 * **素材が無くてもここで必ず作れる**（不変条件7）。
 * 絵（`cutoutUrl`）を置いたら `CutoutFish` に差し替わるが、こちらは消さない。
 */
export function createProceduralFish(config: FishConfig): ProceduralFish {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  const h = LENGTH * config.bodyHeight;
  const w = LENGTH * config.bodyWidth;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: config.color,
    roughness: 0.55,
    metalness: 0,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: config.accent,
    roughness: 0.6,
    metalness: 0,
  });
  disposables.push(bodyMaterial, accentMaterial);

  // 胴。**球を潰して作る。** 体高と体幅がそのまま輪郭になる
  const bodyGeometry = new THREE.SphereGeometry(0.5, 16, 12);
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.name = 'fish.body';
  body.scale.set(LENGTH, h, w);
  group.add(body);
  disposables.push(bodyGeometry);

  // 尾。**形ごとに変える**（`TAILS`）。ここが輪郭のいちばん目立つ差
  const tail = TAILS[config.tail];
  const tailGeometry = new THREE.ConeGeometry(0.5, 1, 10);
  const tailHeight = h * tail.spread;
  if (tail.split > 0) {
    // 二股。上下に分けて外へ開く
    for (const side of [-1, 1]) {
      const half = new THREE.Mesh(tailGeometry, bodyMaterial);
      half.name = `fish.tail.${side < 0 ? 'd' : 'u'}`;
      half.scale.set(tailHeight * 0.6, LENGTH * tail.len, w * 0.5);
      half.position.set(-LENGTH * 0.5 - LENGTH * tail.len * 0.4, side * tailHeight * 0.22, 0);
      half.rotation.z = Math.PI / 2 + side * tail.split * 0.6;
      group.add(half);
    }
  } else {
    const fin = new THREE.Mesh(tailGeometry, bodyMaterial);
    fin.name = 'fish.tail';
    fin.scale.set(tailHeight, LENGTH * tail.len, w * 0.6);
    fin.position.set(-LENGTH * 0.5 - LENGTH * tail.len * 0.45, 0, 0);
    fin.rotation.z = Math.PI / 2;
    group.add(fin);
  }
  disposables.push(tailGeometry);

  // 背びれと胸びれ。大きさは `fins` で変わる
  const finSize = FINS[config.fins];
  const finGeometry = new THREE.ConeGeometry(0.5, 1, 8);
  const dorsal = new THREE.Mesh(finGeometry, accentMaterial);
  dorsal.name = 'fish.fin.dorsal';
  dorsal.scale.set(LENGTH * 0.34, h * finSize, w * 0.4);
  dorsal.position.set(-LENGTH * 0.02, h * 0.46, 0);
  group.add(dorsal);

  const pectoral = new THREE.Mesh(finGeometry, accentMaterial);
  pectoral.name = 'fish.fin.pectoral';
  pectoral.scale.set(LENGTH * 0.2, h * finSize * 0.55, w * 0.3);
  pectoral.position.set(LENGTH * 0.16, -h * 0.16, w * 0.45);
  pectoral.rotation.z = -0.9;
  group.add(pectoral);
  disposables.push(finGeometry);

  // 模様。**`pattern` を読むだけで決まる**（`switch (cfg.id)` を書かない）
  const patternGeometry = addPattern(group, config, h, w, accentMaterial);
  if (patternGeometry) disposables.push(patternGeometry);

  // たんこぶ。**叩かれるまで見えない**（`setBump(0)` で潰しておく）。
  // 頭の上に出す ——「叩かれた」が形に残るので、当たったかどうかが一目で分かる
  const bumpGeometry = new THREE.SphereGeometry(0.5, 10, 8);
  const bumpMaterial = new THREE.MeshStandardMaterial({
    color: 0xff8a8a,
    roughness: 0.5,
    metalness: 0,
  });
  const bump = new THREE.Mesh(bumpGeometry, bumpMaterial);
  bump.name = 'fish.bump';
  bump.position.set(LENGTH * 0.18, h * 0.52, 0);
  bump.visible = false;
  group.add(bump);
  disposables.push(bumpGeometry, bumpMaterial);

  // 目。**白目を大きく取る**（幼児向けの絵は目で表情が決まる）
  const eyeGeometry = new THREE.SphereGeometry(0.5, 10, 8);
  const whiteMaterial = new THREE.MeshStandardMaterial({ color: 0xfdfdf8, roughness: 0.4 });
  const pupilMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 });
  disposables.push(eyeGeometry, whiteMaterial, pupilMaterial);
  for (const side of [-1, 1]) {
    const white = new THREE.Mesh(eyeGeometry, whiteMaterial);
    white.name = 'fish.eye';
    white.scale.setScalar(h * 0.3);
    white.position.set(LENGTH * 0.3, h * 0.16, side * w * 0.42);
    group.add(white);
    const pupil = new THREE.Mesh(eyeGeometry, pupilMaterial);
    pupil.name = 'fish.pupil';
    pupil.scale.setScalar(h * 0.15);
    pupil.position.set(LENGTH * 0.34, h * 0.16, side * w * 0.52);
    group.add(pupil);
  }

  // ==========================================================================
  // **輪郭を中央に寄せて、大きさをそろえる**（2026-09-13 に踏んだ）。
  //
  // 胴を原点に置いて尾を後ろに伸ばしていたので、**輪郭全体では左に寄っていた**。
  // 実機の絵で、魚が池の左にずれて出てきた。
  // 「ばあ！」の「体の底は、作り手ではなく生成側で y=0 に揃える」と同じ話で、
  // **組み上がったあとに境界箱を測って機械的に揃える。**
  //
  // 大きさも同じ理由でここでそろえる。作り手（`TAILS` / `FINS`）が
  // 気をつける形にすると、種類を足したときに必ず1つ忘れる。
  // ==========================================================================
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const scale = TARGET_H / Math.max(1e-6, size.y);
  // 先に中心をずらしてから、group ごと縮める
  for (const child of group.children) {
    child.position.x -= center.x;
    child.position.y -= center.y;
  }
  group.scale.setScalar(scale);

  // 切り取り面。**材質ごとに持たせる**（three は material 単位で見る）
  const clip = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  const materials: THREE.Material[] = [
    bodyMaterial,
    accentMaterial,
    whiteMaterial,
    pupilMaterial,
    bumpMaterial,
  ];
  for (const material of materials) material.clippingPlanes = [clip];

  return {
    group,
    height: size.y * scale,
    width: size.x * scale,
    setClipX(worldX: number) {
      // 面の向きは +x なので、constant は -x
      clip.constant = -worldX;
    },
    setBump(t: number) {
      bump.visible = t > 0;
      if (t <= 0) return;
      // ぷくっと出る。**大きくしすぎない**（魚の輪郭が壊れる）
      const r = h * 0.22 * Math.min(1, t * 1.2);
      bump.scale.set(r, r * 1.15, r);
    },
    dispose() {
      // **1つでも漏らすとリークする**（不変条件8）
      for (const item of disposables) item.dispose();
    },
  };
}

/**
 * 模様を足す。**`pattern` だけを読む。**
 *
 * 返した geometry は呼び出し側が dispose する（使わなかったら null）。
 */
function addPattern(
  group: THREE.Group,
  config: FishConfig,
  h: number,
  w: number,
  material: THREE.Material
): THREE.BufferGeometry | null {
  if (config.pattern === 'plain') return null;

  if (config.pattern === 'band' || config.pattern === 'stripe') {
    // 帯。くまのみは3本の太い白帯、ちょうちょうおは細い縦縞
    const wide = config.pattern === 'band';
    const count = wide ? 3 : 5;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < count; i++) {
      const band = new THREE.Mesh(geometry, material);
      band.name = `fish.band.${i}`;
      const t = (i + 0.5) / count;
      band.scale.set(LENGTH * (wide ? 0.13 : 0.06), h * 0.98, w * 1.01);
      band.position.set(LENGTH * (0.42 - t * 0.85), 0, 0);
      group.add(band);
    }
    return geometry;
  }

  // 斑点。鯉・ふぐ。**等間隔に置かない**（等間隔だと模様が機械に見える）
  const geometry = new THREE.SphereGeometry(0.5, 8, 6);
  const spots: [number, number][] = [
    [0.26, 0.22],
    [-0.04, -0.18],
    [-0.3, 0.16],
    [0.1, 0.34],
    [-0.22, -0.3],
  ];
  for (let i = 0; i < spots.length; i++) {
    const spot = new THREE.Mesh(geometry, material);
    spot.name = `fish.spot.${i}`;
    const r = h * (0.14 + (i % 3) * 0.045);
    spot.scale.set(r, r, w * 1.02);
    spot.position.set(LENGTH * spots[i][0], h * spots[i][1], 0);
    group.add(spot);
  }
  return geometry;
}
