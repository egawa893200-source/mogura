/**
 * やさしい得点（設計書 §4-6 / §5-3）
 *
 * ==========================================================================
 * **得点は入れるが、ゲームにはしない**（2026-09-13、人間が決めた）。
 *
 *  - 叩いた数だけ **★が左から並ぶ**
 *  - **10個たまると1行がまとめて花に変わり、★は 0 に戻る**。花は右へ積まれる
 *  - **数字を使わない**（1歳半は読めない）
 *  - **減らない。終わらない。制限時間が無い**（不変条件11）
 *  - 花が何個たまっても**何も起きない**。画面の端で折り返して並び続ける。
 *    「クリア」も「おめでとう」も作らない（終わりを作ると、そこで遊びが切れる）
 *
 * **`pointer-events: none` を外さないこと**（§3-4）。
 * 「みずのなか」で切替ボタンを 88px × 5個 並べたら 390px 幅の端末で
 * 2行に折り返し、バーの高さが 172px になって**画面下部の岩に覆いかぶさった**。
 * 押しても岩が反応せず、水槽の切替になっていた。
 * ここは**岩（画面の上）の当たり判定の上に乗る**ので、塞いだ瞬間に
 * 岩のばあが死ぬ。単体テストではなく E2E が見張っている。
 *
 * **three ではなく DOM で描く。** 毎フレーム描き直すものではないし、
 * WebGL に置くと当たり判定（`ScreenProjector`）と場所を取り合う。
 * ==========================================================================
 */

/** 1行ぶんの★。**10個たまると花1つに変わる**（§4-6） */
export const STARS_PER_FLOWER = 10;

/** ★と花の大きさ（px）。**小さく保つこと** —— 主役は魚で、得点ではない */
const MARK_PX = 22;

export class Score {
  /** いま並んでいる★の数（0〜9）。**10 になった瞬間に花へ変わる** */
  private stars = 0;
  /** 咲いた花の数。**減らない** */
  private flowers = 0;

  /** 花が咲いた瞬間に呼ばれる。ステージの切り替えはここから起きる（§5-3） */
  onFlower: (() => void) | null = null;

  private readonly root: HTMLElement;
  private readonly flowerRow: HTMLElement;
  private readonly starRow: HTMLElement;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'score';
    this.root.setAttribute('aria-hidden', 'true');

    this.flowerRow = document.createElement('div');
    this.flowerRow.className = 'score-row score-flowers';
    this.starRow = document.createElement('div');
    this.starRow.className = 'score-row score-stars';

    // 花が上、★が下。**別の行にする** ——
    // 同じ行に混ぜると、花が増えるたびに★の位置が右へずれて
    // 「さっきまであった★が動いた」に見える
    this.root.append(this.flowerRow, this.starRow);
    container.append(this.root);
  }

  /**
   * 1回叩けた。**増えるだけ**（§4-6）。
   *
   * 呼ぶのは「得点が増える叩き」のときだけ。
   * 潰れている魚を連打しても増えない（`FishSystem.hit()` が false を返す）。
   */
  add(): void {
    this.stars++;
    if (this.stars >= STARS_PER_FLOWER) {
      this.stars = 0;
      this.flowers++;
      this.render();
      // **描いてから知らせる。** 先に知らせると、ステージの切り替えが
      // 始まったあとで花が現れて、因果が逆に見える
      this.onFlower?.();
      return;
    }
    this.render();
  }

  /**
   * 花を1つ咲かせる（§6-2 のきんいろのさかな）。
   *
   * **★を経由しない。** ★10個ぶんの近道なので、いま並んでいる★は
   * そのまま残す（消すと「叩いたのに減った」に見える。不変条件11）。
   */
  addFlower(): void {
    this.flowers++;
    this.render();
    this.onFlower?.();
  }

  /**
   * ★も花も 0 に戻す（Phase 7。おとなの画面の「さいしょから」）。
   *
   * **遊びの最中には呼ばれない。** 減ることがあるのはここだけで、
   * 不変条件11（叩いたのに減らない）は大人が明示的に押したときの例外。
   * **花が咲いた合図（`onFlower`）は出さない** —— 出すとステージが替わる
   */
  reset(): void {
    this.stars = 0;
    this.flowers = 0;
    this.render();
  }

  /** 開発と E2E 用 */
  describe(): { stars: number; flowers: number } {
    return { stars: this.stars, flowers: this.flowers };
  }

  private render(): void {
    this.fill(this.starRow, this.stars, starSvg);
    this.fill(this.flowerRow, this.flowers, flowerSvg);
  }

  /**
   * 行の中身を数に合わせる。
   *
   * **毎回すべて作り直さない。** 足りないぶんだけ足す。
   * 花は増え続けるので、作り直すと叩くたびに DOM が膨らむ
   */
  private fill(row: HTMLElement, count: number, make: () => string): void {
    while (row.childElementCount > count) row.lastElementChild?.remove();
    while (row.childElementCount < count) {
      const mark = document.createElement('span');
      mark.className = 'score-mark';
      mark.innerHTML = make();
      row.append(mark);
    }
  }

  dispose(): void {
    this.root.remove();
  }
}

/** ★。**数字を使わない**ので、形で分かるようにする */
function starSvg(): string {
  return `<svg viewBox="0 0 24 24" width="${MARK_PX}" height="${MARK_PX}" fill="none">
    <path d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z"
      fill="#ffd34d" stroke="#b07d14" stroke-width="1.1" stroke-linejoin="round"/>
  </svg>`;
}

/** 花。**★10個ぶん**。輪郭が★とはっきり違うようにする（丸い花びら） */
function flowerSvg(): string {
  return `<svg viewBox="0 0 24 24" width="${MARK_PX}" height="${MARK_PX}" fill="none">
    <g fill="#ff9ec4" stroke="#c4527f" stroke-width="1">
      <ellipse cx="12" cy="5.6" rx="3.5" ry="4.2"/>
      <ellipse cx="18.1" cy="10.1" rx="3.5" ry="4.2" transform="rotate(72 18.1 10.1)"/>
      <ellipse cx="15.8" cy="17.3" rx="3.5" ry="4.2" transform="rotate(144 15.8 17.3)"/>
      <ellipse cx="8.2" cy="17.3" rx="3.5" ry="4.2" transform="rotate(216 8.2 17.3)"/>
      <ellipse cx="5.9" cy="10.1" rx="3.5" ry="4.2" transform="rotate(288 5.9 10.1)"/>
    </g>
    <circle cx="12" cy="12" r="3.1" fill="#ffe08a" stroke="#c4a33f" stroke-width="1"/>
  </svg>`;
}
