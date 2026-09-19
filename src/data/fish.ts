/**
 * さかな4種（設計書 §5-1）
 *
 * **データだけを置く。ロジックを書かない。**
 * 輪郭の作り分けは `poko/ProceduralFish.ts` がこの値を読んで行う。
 *
 * ==========================================================================
 * **1ステージに2種だけ**（2026-09-13、人間が決めた）。
 *
 * 「ばあ！」は動物25体を出したが、種類の多さが面白さにつながった形跡は
 * 無かった。**2種なら「どっちが出た」が分かる**ので、出るたびに意味がある。
 *
 * **同じステージの2種は、体高を 0.25 以上離すこと。**
 * 「みずのなか」で体型（`bodyHeight` / `bodyWidth`）を指定しなかったら、
 * チョウチョウウオもメダカも同じ魚になった。
 * **見分けは色ではなく輪郭で決まる。**
 * ==========================================================================
 */

import type { FishConfig } from '../types';

export const FISH: readonly FishConfig[] = [
  /* ---- いけ ---- */
  {
    id: 'kingyo',
    label: 'きんぎょ',
    color: 0xe8502a,
    accent: 0xfff1e0,
    // 丸くて背が高い。ひれがひらひらして、輪郭がいちばん賑やか
    bodyHeight: 0.85,
    bodyWidth: 0.38,
    tail: 'fan',
    fins: 'flowing',
    pattern: 'plain',
    squashStyle: 'flat',
    cutoutUrl: null,
    // ==================================================================
    // **「みずのなか」の琉金のモデル**（2026-09-14、人間の指示）。
    //
    // **向きの値は向こうの `tanks.ts`（種 `wakin`）をそのまま写す。**
    // 自分で測り直して2回外している。`modelRollDeg: 90` は
    // 「モデルの背が +z を向いていて、そのままだと横倒しで泳ぐ」ため。
    //
    // **展開図は貼らない**（向こうも `skinUrl: null`）。
    // このモデルは UV を持たないので、生成した UV に和金用の絵を貼っても
    // 模様が合わない。色は `color` / `accent` から塗り直す
    // ==================================================================
    modelUrl: '/models/goldfish_ryukin.glb',
    modelRollDeg: 90,
    modelScale: 0.95,
  },
  {
    id: 'ei',
    label: 'えい',
    // **みずのなかと同じ灰褐色**。以前の暗い青灰は「影」にしか見えなかった
    color: 0x7d6f5e,
    accent: 0xf2ece2,
    // 平たくて横に広い。金魚・くまのみと輪郭がまったく違う
    bodyHeight: 0.38,
    bodyWidth: 0.62,
    tail: 'long',
    fins: 'wide',
    pattern: 'spot',
    squashStyle: 'wide',
    cutoutUrl: null,
    // ==================================================================
    // **「みずのなか」のマンタのモデル**（480三角形）。向きの値は
    // 向こうの `tanks.ts`（種 `ray`）をそのまま写す —— 反転も回転も要らない。
    //
    // **色は必ず塗り直す。** 向こうが
    // 「モデルのマテリアル色（暗い青灰 0.19, 0.28, 0.34）が頂点色に
    // 焼き込まれ、青い映像の上では**影にしか見えなかった**」と実測している。
    // 2026-09-14、ここでも**黒い影**として出た。`color` は向こうと同じ
    // 灰褐色（#7d6f5e 系）にしてある
    //
    // **体軸まわりの 90度だけは、みずのなかと変える。**
    // 向こうの魚は横向きに泳ぐので、エイは**水平に寝ている**のが正しい。
    // この app はカメラの正面へ顔を出すので、寝かせると
    // **厚み 0.18 の板を真横から見る**ことになって線にしか見えない
    // （実測: 回さないと 1.09 × 0.18 × 1.03）。平らな面をカメラへ向ける
    // ==================================================================
    // **頭が逆を向く**（2026-09-14、絵で確認した）。
    // 体軸まわりに 90度 回したぶん、向こうの `modelFlip: false` とは変わる
    modelUrl: '/models/ray.glb',
    modelFlip: true,
    modelRollDeg: 90,
    // **大きく見せるときだけ、体軸を上に向ける**（§6-3）。
    // 横向きのままだと平たい茶色の凧に見えた（実機の指摘）
    surprisePose: [0, 0, 90],
    modelScale: 1.15,
  },
  {
    id: 'hagi',
    label: 'はぎ',
    color: 0x2f6fd0,
    accent: 0xf5d24a,
    // きんぎょ（0.85）と 0.35 離す。細長く、ひれは小さい
    bodyHeight: 0.5,
    bodyWidth: 0.26,
    tail: 'fork',
    fins: 'small',
    pattern: 'stripe',
    squashStyle: 'wide',
    cutoutUrl: null,
    // ==================================================================
    // **クマノミのモデルに別の体の画像を貼る**（2026-09-14）。
    //
    // 「みずのなか」のモデルは3体（クマノミ・琉金・エイ）しかない。
    // 2ステージ × 2種 = 4枠には足りないので、1体を色違いで使い分ける。
    //
    // **`modelFlip` は向こうの値（true）をそのまま写すと逆を向いた。**
    // 絵で確かめて外してある（尾が穴の中・頭が右で出てくる）。
    // CLAUDE.md「モデルを追加したら必ず動かして向きを見る」。
    // **向きの値だけは、写さずに毎回見ること。**
    //
    // **同じステージには置かない。** 輪郭が同じ2匹が並ぶと、
    // 色を変えても「同じ魚を2色に塗った」に見える
    // （「ばあ！」で岩とくさむらに同じことを言われている）。
    // ステージをまたぐぶんは、子どもが同時に見ないので許す。
    // ==================================================================
    modelUrl: '/models/clownfish.glb',
    skinUrl: '/textures/skin_tang.jpg',
  },

  /* ---- うみ ---- */
  {
    id: 'kumanomi',
    label: 'くまのみ',
    color: 0xf2802a,
    accent: 0xfdfbf4,
    // ふぐ（0.95）と 0.25 離す。白い帯が3本
    bodyHeight: 0.7,
    bodyWidth: 0.3,
    tail: 'round',
    fins: 'wide',
    pattern: 'band',
    squashStyle: 'wide',
    cutoutUrl: null,
    // **「みずのなか」のクマノミのモデル**。
    // **反転は要らない**（向こうの `modelFlip: true` を写すと逆を向く。
    // はぎ の項に書いた理由と同じで、絵で確かめて決めた）
    modelUrl: '/models/clownfish.glb',
    skinUrl: '/textures/skin_clownfish.jpg',
  },
  {
    id: 'fugu',
    label: 'ふぐ',
    color: 0xcfc08a,
    accent: 0x4a4030,
    // まん丸。**叩くと膨らんでから沈む**（§6-2。潰れの 0.12秒には足さず、
    // そのあとの 0.33秒で見せる ——「出かたの癖は出たあとに見せる」と同じ話）。
    // **1.0 にした**（2026-09-19、モデルが入ったとき）。ふぐは体長と体高が
    // ほぼ同じで、モデルの輪郭もそうなっている。うみ の相棒（くまのみ 0.7）
    // との差も 0.25 ちょうどから 0.30 になる
    bodyHeight: 1.0,
    bodyWidth: 0.45,
    tail: 'round',
    fins: 'small',
    pattern: 'spot',
    squashStyle: 'spin',
    cutoutUrl: null,
    // ==================================================================
    // **人間が ChatGPT で作ったモデル**（2026-09-19）。
    // 12メッシュ・1,948三角形。目は `Eye_L` / `Eye_R` という名前なので、
    // `normalizeModelGeometry` の「目があるか」の判定にも乗る。
    //
    // **元の .glb に貼ってあった参考写真は剥がした**（263KB → 59KB）。
    // 読み込み側はマテリアルの `map` を読まない（UV を作り直すため）ので、
    // 持っていても1画素も使われない。模様は下の `skinUrl` で入れる。
    //
    // **`modelFlip` は絵を見て決めた**（自動判定はしないと決めてある）。
    // 頭が +X のモデルで、正規化が体軸を +z に倒すと頭が -z 側に来る。
    // そのままだと**左を向いたまま右へ泳ぐ**（撮って確かめた）
    // ==================================================================
    modelUrl: '/models/fugu.glb',
    // 参考写真の「斑点のある背」と「淡い腹」だけを切り出して並べた展開図。
    // **ヒレと目は入れない** —— 体に貼るとヒレの絵がもう1枚乗って見える
    skinUrl: '/textures/skin_fugu.jpg',
    modelFlip: true,
  },
];

/**
 * 予備。**採らなかった4種**（§5-1）。
 *
 * 実機で刺さらなかったときに入れ替えるために残す（付録B の 7）。
 * **種類を増やして解決しようとしないこと** —— 25体出した「ばあ！」が
 * それで受けなかった。
 *
 * めだか は**小さすぎて叩きにくい**ので、入れ替えるなら体高を上げること。
 */
export const SPARE_FISH: readonly FishConfig[] = [
  {
    id: 'medaka',
    label: 'めだか',
    color: 0xd8c88a,
    accent: 0x8a7a4a,
    bodyHeight: 0.4,
    bodyWidth: 0.18,
    tail: 'fork',
    fins: 'small',
    pattern: 'plain',
    squashStyle: 'flat',
    cutoutUrl: null,
  },
  {
    id: 'namazu',
    label: 'なまず',
    color: 0x6b6350,
    accent: 0xb8ac8c,
    bodyHeight: 0.45,
    bodyWidth: 0.3,
    tail: 'round',
    fins: 'wide',
    pattern: 'plain',
    squashStyle: 'wide',
    cutoutUrl: null,
  },
  {
    id: 'tai',
    label: 'たい',
    color: 0xe8607a,
    accent: 0xfbdfe4,
    bodyHeight: 0.75,
    bodyWidth: 0.3,
    tail: 'fork',
    fins: 'small',
    pattern: 'plain',
    squashStyle: 'flat',
    cutoutUrl: null,
  },
  {
    id: 'chouchouuo',
    label: 'ちょうちょうお',
    color: 0xf5d24a,
    accent: 0x2e2a22,
    bodyHeight: 0.9,
    bodyWidth: 0.28,
    tail: 'fork',
    fins: 'wide',
    pattern: 'stripe',
    squashStyle: 'spin',
    cutoutUrl: null,
    // ==================================================================
    // **人間が ChatGPT で作ったモデル**（2026-09-19）。
    // 12メッシュ・1,948三角形。目は `Eye_L` / `Eye_R` という名前なので、
    // `normalizeModelGeometry` の「目があるか」の判定にも乗る。
    //
    // **元の .glb に貼ってあった参考写真は剥がした**（263KB → 59KB）。
    // 読み込み側はマテリアルの `map` を読まない（UV を作り直すため）ので、
    // 持っていても1画素も使われない。模様は下の `skinUrl` で入れる。
    //
    // **`modelFlip` は絵を見て決めた**（自動判定はしないと決めてある）。
    // 頭が +X のモデルで、正規化が体軸を +z に倒すと頭が -z 側に来る。
    // そのままだと**左を向いたまま右へ泳ぐ**（撮って確かめた）
    // ==================================================================
    modelUrl: '/models/fugu.glb',
    // 参考写真の「斑点のある背」と「淡い腹」だけを切り出して並べた展開図。
    // **ヒレと目は入れない** —— 体に貼るとヒレの絵がもう1枚乗って見える
    skinUrl: '/textures/skin_fugu.jpg',
    modelFlip: true,
  },
];

export function findFish(id: string): FishConfig | null {
  return FISH.find((f) => f.id === id) ?? null;
}
