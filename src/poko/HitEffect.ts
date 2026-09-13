/**
 * 叩いた手ごたえ（設計書 §4-4）
 *
 * ==========================================================================
 * **1つでは弱い。** 「ばあ！」は声だけで、それが受けなかった理由の1つ。
 * ここでは**しぶき**と**揺れ**を出す（形・音・声・得点は別のところ）。
 *
 * **全画面フラッシュは禁止**（不変条件6）。光らせたいなら、
 * 叩いた地点のしぶきの明るさで表現する。
 * 揺らすのも**叩いた水たまりのまわりだけ**で、画面全体は揺らさない。
 *
 * **毎フレーム new をしない**（§10-3）。しぶきの粒は最初に作って使い回す。
 * ==========================================================================
 */

import * as THREE from 'three';

/** しぶきの粒の数（1回ぶん） */
const SPLASH_COUNT = 8;
/** 外したときの粒の数（§4-5。当たりより控えめ） */
const MISS_COUNT = 3;
/** 粒が消えるまで（秒） */
const SPLASH_SEC = 0.5;
/** 揺れの角度（度）と長さ（秒）。**全画面は揺らさない** */
const SHAKE_DEG = 2.5;
const SHAKE_SEC = 0.15;

interface Drop {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  life: number;
}

export class HitEffect {
  readonly group = new THREE.Group();

  private readonly drops: Drop[] = [];
  private readonly geometry: THREE.SphereGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  /** 揺れている水たまり。index → 残り秒数 */
  private readonly shakes = new Map<number, number>();

  constructor(color: string) {
    // **粒は最初に作って使い回す。** 叩くたびに作ると、連打でゴミが出る
    this.geometry = new THREE.SphereGeometry(0.5, 6, 4);
    this.material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      toneMapped: false,
    });
    for (let i = 0; i < SPLASH_COUNT * 2; i++) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.visible = false;
      mesh.scale.setScalar(0.07);
      this.group.add(mesh);
      this.drops.push({ mesh, vx: 0, vy: 0, life: 0 });
    }
  }

  /**
   * しぶきを出す。`strong` は当たり、そうでなければ空振り（§4-5）。
   *
   * **空振りでも必ず何かを返す**（不変条件1・3b）。数を減らすだけ。
   */
  splash(at: THREE.Vector3, strong: boolean, rng: () => number): void {
    const count = strong ? SPLASH_COUNT : MISS_COUNT;
    let spawned = 0;
    for (const drop of this.drops) {
      if (spawned >= count) break;
      if (drop.life > 0) continue;
      drop.mesh.position.copy(at);
      drop.mesh.visible = true;
      const angle = Math.PI * (0.15 + rng() * 0.7); // 上向きに散る
      const speed = (strong ? 1.5 : 0.8) * (0.7 + rng() * 0.6);
      drop.vx = Math.cos(angle) * speed;
      drop.vy = Math.sin(angle) * speed;
      drop.life = SPLASH_SEC;
      drop.mesh.scale.setScalar(strong ? 0.08 : 0.05);
      spawned++;
    }
  }

  /** 叩いた水たまりだけを揺らす */
  shake(holeIndex: number): void {
    this.shakes.set(holeIndex, SHAKE_SEC);
  }

  /**
   * @param holeGroups 水たまりの group。**揺れはここに掛ける**
   */
  update(dt: number, holeGroups: readonly THREE.Object3D[]): void {
    for (const drop of this.drops) {
      if (drop.life <= 0) continue;
      drop.life -= dt;
      if (drop.life <= 0) {
        drop.mesh.visible = false;
        continue;
      }
      drop.mesh.position.x += drop.vx * dt;
      drop.mesh.position.y += drop.vy * dt;
      drop.vy -= 4.5 * dt; // 落ちる
      // 消えぎわに小さくする（透明度は material を共有しているので触らない）
      drop.mesh.scale.setScalar(0.08 * (drop.life / SPLASH_SEC));
    }

    for (const [index, left] of this.shakes) {
      const next = left - dt;
      const group = holeGroups[index];
      if (!group) {
        this.shakes.delete(index);
        continue;
      }
      if (next <= 0) {
        group.rotation.z = 0;
        this.shakes.delete(index);
        continue;
      }
      this.shakes.set(index, next);
      // 減衰しながら1往復半。**全画面ではなくこの水たまりだけ**
      const t = next / SHAKE_SEC;
      group.rotation.z = THREE.MathUtils.degToRad(SHAKE_DEG) * t * Math.sin(t * Math.PI * 3);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
