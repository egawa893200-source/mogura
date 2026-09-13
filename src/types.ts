/**
 * アプリ全体で使う型（設計書 §5-1）
 *
 * **データだけを置く。ロジックを書かない。**
 * ステージの定義は `data/stages.ts`、魚の定義は `data/fish.ts`。
 *
 * 出どころ: いないいないばあアプリ「ばあ！」（peek-aboo）の `src/types.ts`。
 * ループと品質の型はそのまま、場面まわりは水たまり用に作り直してある。
 */

/* ---- ループと品質 -------------------------------------------------------- */

export type QualityLevel = 0 | 1 | 2 | 3 | 4;

/** 毎フレームの更新に渡す情報 */
export interface FrameContext {
  /** 固定タイムステップ（秒） */
  dt: number;
  /** アプリ起動からの経過秒 */
  elapsed: number;
  /** 通しフレーム番号 */
  frame: number;
}

/* ---- ステージ ------------------------------------------------------------ */

/** ステージは2つだけ（§5-3。2026-09-13 に人間が決めた） */
export type StageId = 'ike' | 'umi';

export interface StageConfig {
  id: StageId;
  /** ひらがな。開発用で、画面には文字を出さない（§2 不変条件10） */
  label: string;
  /** null なら手続き生成のグラデーションに落ちる（不変条件7） */
  backgroundUrl: string | null;
  /** 手続き生成の背景（上・下）。絵があるときは使われない */
  sky: readonly [string, string];
  /**
   * 水たまりを置く基準（0 が画面上端、1 が下端）。
   *
   * **手で入れる**（§3-2）。`sampleBackdropHorizon()` は絵の行ごとの
   * 明るさの段差で地平線を探すが、**使う2枚はどちらも段差が閾値 14 に
   * 届かない**（のはら 10.9・うみ 5.9）ので自動検出が効かない。
   * 自動検出に頼ると「置いたのに見えない」を作る。
   */
  horizonV: number;
  /** 水面の色（浅い・深い）。§5-2 */
  water: readonly [string, string];
  /**
   * 縁の色（岸・手前の唇）。
   *
   * **ステージごとにデータで持つこと。** `if (stage.id === 'umi')` と
   * 書かない（「ばあ！」で動物17体のときに、分岐が3箇所に散って
   * 新しいものを足すと1箇所だけ入れ忘れる形になった）。
   *
   * うみ は**水の中の絵**なので、土の茶色だと「海底に土の穴」に見える。
   * §5-3 が「岩のくぼみ」と書いているとおり、岩の色にする。
   */
  bank: readonly [string, string];
  holes: readonly HoleConfig[];
  /** このステージに出る魚。**2種だけ**（§5-1） */
  fish: readonly string[];
}

export interface HoleConfig {
  id: string;
  /** ワールド座標の x, y。**地平線より下**（§3-2） */
  position: readonly [number, number];
  /**
   * 当たり判定の半径（px）。**これは上限**で、実際は
   * `HoleSystem.radiusAt()` が隣との距離を見て縮める（§3-3）。
   * **下限は設けない** —— 下限が効いた瞬間に円が重なって
   * 「押したのに隣が反応する」が復活する
   */
  hitRadiusPx: number;
}

/* ---- さかな -------------------------------------------------------------- */

/** 尾の形。**輪郭で見分ける**ので、ここを埋めないと全部同じ魚になる */
export type FishTail = 'fan' | 'fork' | 'round' | 'long';
export type FishFins = 'small' | 'wide' | 'flowing';
export type FishPattern = 'plain' | 'stripe' | 'spot' | 'band';
/** 叩かれたときの潰れかた（§6-1） */
export type SquashStyle = 'flat' | 'wide' | 'spin';

export interface FishConfig {
  id: string;
  /** ひらがな。画面には出さない */
  label: string;
  color: number;
  accent: number;
  /**
   * 体高（体長に対する比）。
   *
   * **同じステージの2種は 0.25 以上離すこと**（§5-1）。
   * 「みずのなか」で体型を指定しなかったら、チョウチョウウオもメダカも
   * 同じ魚になった。**見分けは色ではなく輪郭で決まる。**
   */
  bodyHeight: number;
  /** 体幅（同上） */
  bodyWidth: number;
  tail: FishTail;
  fins: FishFins;
  pattern: FishPattern;
  squashStyle: SquashStyle;
  /** 絵を置いたら使う。無ければ手続き生成（不変条件7） */
  cutoutUrl: string | null;
}
