/**
 * 配布された GLTF モデルを、この app の約束に正規化する。
 *
 * ==========================================================================
 * **出どころ: 水族館アプリ「みずのなか」（suizokukan）の
 * `creatures/ProceduralFish.ts`。実機で検証済みなので、そのまま持ってくる。**
 *
 * 2026-09-14、人間の指示（「以前に作成した suizokukan の3D魚や背景の動画を
 * そのまま使用してください」）で移植した。
 *
 * **自前で書き直して2回失敗している**ので、その記録を残す:
 *
 * 1. **マテリアルをそのまま使うと、模様が出ない。**
 *    配布モデルは UV を持たないことが多く、`material.map` に体表の絵を
 *    貼っても全頂点が uv(0,0) を読む。実機では「濃い茶色の魚」になった。
 *    → `normalizeModelGeometry` が **UV を作る**（u = 頭0→尾1 / v = 腹0→背1）。
 *
 * 2. **モデルのマテリアル色は、明るい色を指定しても変わらない。**
 *    エイは模型側が暗い青灰（0.19, 0.28, 0.34）で、青い映像の上では
 *    **影にしか見えない**。みずのなかが同じ失敗を記録している。
 *    → `tintModelGeometry` が「陰影はモデルから・色は設定から」塗り替える。
 *
 * **この約束**: 体長 1.0 / 体軸は z（頭が +z）/ 原点が中心。
 * この app の魚は +x へ泳ぐので、`ModelFish` 側で +z → +x に倒す。
 * ==========================================================================
 */

import * as THREE from 'three';

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 索引付きジオメトリを1つにまとめる（position / uv / color のみ） */
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of list) {
    vertexCount += g.getAttribute('position').count;
    indexCount += g.getIndex()!.count;
  }
  const position = new Float32Array(vertexCount * 3);
  const uv = new Float32Array(vertexCount * 2);
  const color = new Float32Array(vertexCount * 3);
  /** 目の頂点の印。**繋ぎ忘れると、マージした瞬間に目が消える** */
  const eyeMask = new Float32Array(vertexCount);
  const index = new Uint32Array(indexCount);

  let vo = 0;
  let io = 0;
  for (const g of list) {
    const p = g.getAttribute('position');
    const u = g.getAttribute('uv');
    const c = g.getAttribute('color');
    const e = g.getAttribute('eyeMask');
    const idx = g.getIndex()!;
    position.set(p.array as Float32Array, vo * 3);
    if (u) uv.set(u.array as Float32Array, vo * 2);
    if (c) color.set(c.array as Float32Array, vo * 3);
    if (e) eyeMask.set(e.array as Float32Array, vo);
    for (let i = 0; i < idx.count; i++) index[io + i] = idx.getX(i) + vo;
    vo += p.count;
    io += idx.count;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  out.setAttribute('eyeMask', new THREE.BufferAttribute(eyeMask, 1));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/**
 * GLTF モデルから最初の Mesh のジオメトリを取り出し、
 * 「体長1.0・頭が+z・原点が中心」の規約に正規化する。
 * 取り出せなければ null（呼び出し側が createFishGeometry にフォールバック）。
 */
export function normalizeModelGeometry(
  root: THREE.Object3D | null,
  /**
   * 体軸まわりの回転［ラジアン］。
   *
   * この関数は「いちばん長い軸が体軸」としか決められない。体軸を +z に
   * 合わせたあと、その軸まわりのどちらが背かは、モデルごとに違うので分からない。
   * 琉金のモデル（背が +z・頭が -x）はここが 90度ずれていて、そのままだと
   * 横倒しで泳ぐ。**UV を作る前に掛ける**ので、v = 腹0→背1 の規約も保たれる
   */
  rollRadians = 0
): THREE.BufferGeometry | null {
  if (!root) return null;

  // glTF は「1メッシュ = 複数プリミティブ」を three.js 上では複数の Mesh に展開する。
  // 最初の1つだけ拾うと、体だけ／輪郭だけ、のように大半が欠ける。
  // （実際、クマノミは Outline / Body / Stripes の3つ、エイは4つに分かれていた）
  root.updateWorldMatrix(true, true);
  const parts: THREE.BufferGeometry[] = [];
  let anyMissingUv = false;
  // モデルに目のメッシュが入っているか（R6 の判定用）。
  // メッシュを1つに統合してしまうと、あとから「目があるか」を知る手段が無い。
  // 名前で見るのは乱暴だが、配布モデルは目を Eye / Pupil / eyeball のような
  // 名前の別メッシュにしているのが普通で、実際に琉金のモデルもそうなっている
  let hasEyeMesh = false;

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const isEye = /eye|pupil|iris/i.test(mesh.name);
    if (isEye) hasEyeMesh = true;

    const g = mesh.geometry.clone();
    // 親のスケール・回転をジオメトリに焼き込む（ノードの入れ子を潰す）
    g.applyMatrix4(mesh.matrixWorld);

    const posAttr = g.getAttribute('position');
    if (!posAttr) return;
    const count = posAttr.count;

    // 配布されているモデルは UV も頂点色も持たず、色はマテリアルにしかないことが多い。
    // マテリアル色を頂点色に焼き込まないと、全部まっ白な魚になる。
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const matColor = (mat as THREE.MeshStandardMaterial | undefined)?.color;
    const src = g.getAttribute('color');
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = src ? src.getX(i) : 1;
      const gg = src ? src.getY(i) : 1;
      const b = src ? src.getZ(i) : 1;
      colors[i * 3] = r * (matColor ? matColor.r : 1);
      colors[i * 3 + 1] = gg * (matColor ? matColor.g : 1);
      colors[i * 3 + 2] = b * (matColor ? matColor.b : 1);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // ==================================================================
    // **目の頂点に印を付ける**（2026-09-19）。
    //
    // 展開図（`skinUrl`）を貼るモデルは頂点色を白に戻す（下の `ModelFish`）
    // ので、**目まで体表の絵で塗られて顔が消える**。
    // ふぐのモデルで実際にそうなった —— 斑点は出たが目が無くなり、
    // 1歳半には「生き物」に見えない顔になった。
    //
    // マージすると頂点の出どころが分からなくなるので、**属性で持ち歩く**。
    // 印の付いた頂点だけ、貼ったあとに暗くする
    // ==================================================================
    const eyeMask = new Float32Array(count).fill(isEye ? 1 : 0);
    g.setAttribute('eyeMask', new THREE.BufferAttribute(eyeMask, 1));

    if (!g.getIndex()) {
      const idx = new Uint32Array(count);
      for (let i = 0; i < count; i++) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    }
    if (!g.getAttribute('uv')) {
      // 中身は後で生成する（正規化が済んでからでないと座標が定まらない）
      anyMissingUv = true;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    parts.push(g);
  });

  if (parts.length === 0) return null;
  const geom = parts.length === 1 ? parts[0] : mergeGeometries(parts);

  geom.computeBoundingBox();
  const box = geom.boundingBox;
  if (!box) return null;

  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  // 一番長い軸を体軸とみなし、+z に合わせる
  const longest = Math.max(size.x, size.y, size.z);
  if (longest <= 0) return null;
  geom.translate(-center.x, -center.y, -center.z);
  if (size.x === longest) {
    geom.rotateY(Math.PI / 2);
  } else if (size.y === longest) {
    geom.rotateX(-Math.PI / 2);
  }
  // 体軸まわりの向き直し（背を +y に持ってくる）。
  // スケールより前でも後でも結果は同じだが、UV 生成より前であることが重要
  if (rollRadians !== 0) geom.rotateZ(rollRadians);
  geom.scale(1 / longest, 1 / longest, 1 / longest);

  // ここまでで体軸は z に乗るが、頭が +z か -z かは分からない。
  // 頂点の重心で当てようとしたが、尾ビレが大きい魚（クマノミ）では重心が
  // 尾側に寄り、判定を誤って後ろ向きに泳いだ。推定はやめて、
  // SpeciesConfig.modelFlip で明示する（CreatureSystem 側で反転する）。

  // 配布モデルは UV を持たないものが多い。体表の展開図（skinUrl）を貼れるよう、
  // 手続き生成の魚と同じ規約で作る: u = 頭0→尾1 / v = 腹0→背1。
  // 体軸は z（頭が +z）、体長1.0に正規化済みなのでここで計算できる。
  if (anyMissingUv) {
    const pos = geom.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    geom.computeBoundingBox();
    const bb = geom.boundingBox!;
    const yLo = bb.min.y;
    const ySpan = Math.max(1e-6, bb.max.y - yLo);
    const zLo = bb.min.z;
    const zSpan = Math.max(1e-6, bb.max.z - zLo);
    for (let i = 0; i < pos.count; i++) {
      // z が大きいほど頭側なので、u は反転させる
      uv[i * 2] = 1 - (pos.getZ(i) - zLo) / zSpan;
      uv[i * 2 + 1] = (pos.getY(i) - yLo) / ySpan;
    }
    geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }

  if (!geom.getAttribute('color')) {
    const count = geom.getAttribute('position').count;
    const white = new Float32Array(count * 3).fill(1);
    geom.setAttribute('color', new THREE.BufferAttribute(white, 3));
  }
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  geom.userData.hasEyeMesh = hasEyeMesh;
  return geom;
}

/**
 * モデルの頂点色を種の体色に塗り替える（skinUrl が無いモデル用）。
 *
 * normalizeModelGeometry はモデルのマテリアル色を頂点色に焼き込む。
 * そのため SpeciesConfig.color は黙って無視されていた。マンタは
 * モデル側が暗い青灰（0.19, 0.28, 0.34）で、青い実写映像の上では
 * 影にしか見えず、色を明るくしても何も変わらなかったのはこのため。
 *
 * ただしマテリアル色を丸ごと捨てると、白い腹や黒い目まで体色で塗り潰されて
 * のっぺりする。そこで「明暗（陰影）はモデルから、色は種から」取る:
 *   陰影 = その頂点の明度 ÷ 全頂点の明度の中央値（0.3〜1.25 に制限）
 *   色   = 背色と腹色を高さで混ぜたもの（手続き生成の魚と同じ規約）
 *
 * @param geometry 正規化済みのジオメトリ（体長1.0・体軸 z・頭が +z）
 */
export function tintModelGeometry(
  geometry: THREE.BufferGeometry,
  color: THREE.ColorRepresentation,
  bellyColor: THREE.ColorRepresentation
): void {
  const pos = geometry.getAttribute('position');
  const src = geometry.getAttribute('color');
  if (!pos || !src) return;

  const n = pos.count;
  const back = new THREE.Color(color);
  const belly = new THREE.Color(bellyColor);

  // 明度の中央値。平均だと、面積の小さい真っ白なパーツに引っ張られる
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = 0.2126 * src.getX(i) + 0.7152 * src.getY(i) + 0.0722 * src.getZ(i);
  }
  const median = [...lum].sort((a, b) => a - b)[n >> 1] || 1;

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return;
  const yLo = bb.min.y;
  const ySpan = Math.max(1e-6, bb.max.y - yLo);

  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // 0 = 腹（下）, 1 = 背（上）
    const up = (pos.getY(i) - yLo) / ySpan;
    // 手続き生成の魚と同じく、白くなるのは体の下側だけ
    const mix = smoothstep(0.58, 1.0, 1 - up);
    const shade = Math.min(1.25, Math.max(0.3, lum[i] / median));
    out[i * 3] = (back.r + (belly.r - back.r) * mix) * shade;
    out[i * 3 + 1] = (back.g + (belly.g - back.g) * mix) * shade;
    out[i * 3 + 2] = (back.b + (belly.b - back.b) * mix) * shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(out, 3));
}
