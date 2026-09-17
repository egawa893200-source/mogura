/**
 * 保護者用パネル（ペアレンタルゲートの奥）
 *
 * ==========================================================================
 * **2026-09-17、人間の指示で作った。**
 * 「スマホでも特別な魚を確実に出せる口が欲しい」。
 *
 * きんいろ（16回に1回）と 大きい（20回に1回）は、実測すると1歳半の
 * 遊びかたで**5分に 9匹・7匹**出る。レアすぎはしないが、
 * **いま見たい**ときに待つのは現実的でない。
 * `__poko.forceVariant()` は開発者コンソールが要るので、**スマホからは
 * 打てなかった**。
 *
 * **ここは子どもには届かない。** 開くには右上 24×24px を2秒長押しして、
 * さらに3択を当てる必要がある（当てずっぽうで 1/3）。
 * **不変条件5 の例外はゲートだけ**で、この中身はその奥にある。
 *
 * **遊びの画面には1画素も出さない。** 閉じているあいだ DOM に何も無い
 * （`pointer-events` の心配をしなくて済む。§3-4 の事故を作らない）。
 * ==========================================================================
 */

export interface ParentPanelActions {
  /** 次の1匹を決め打ちする（§6-2） */
  forceVariant(v: 'big' | 'gold'): void;
  /** サプライズをいますぐ出す（§6-3）。**22〜34秒 待たないため** */
  forceSurprise(): void;
  /** ステージを切り替える */
  setStage(id: string): void;
  /** いまのステージ */
  currentStage(): string;
  /** 選べるステージ（id と ひらがなの名前） */
  stages(): readonly { id: string; label: string }[];
  /** 音の大きさ 0..1（0 は消音） */
  volume(): number;
  setVolume(v: number): void;
  /** ★と花を 0 に戻して、最初のステージへ（Phase 7） */
  resetProgress(): void;
}

/**
 * 音の大きさの選択肢（Phase 7）。
 *
 * **細かいつまみにしない。** 遊んでいる最中に片手で押すので、3択で足りる。
 * 既定は 0.13 で、これは `AudioBus.DEFAULT_VOLUME` と同じ値
 * （**素材側で大きさを作ってある**ので、ここを上げると割れる）
 */
const VOLUMES: readonly { label: string; value: number }[] = [
  { label: 'なし', value: 0 },
  { label: 'ちいさめ', value: 0.07 },
  { label: 'ふつう', value: 0.13 },
];

export class ParentPanel {
  private root: HTMLDivElement | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly actions: ParentPanelActions
  ) {}

  /** 開いているか（E2E 用） */
  isOpen(): boolean {
    return this.root !== null;
  }

  open(): void {
    if (this.root) return;
    const root = document.createElement('div');
    root.className = 'parent-panel';
    // **読み上げには出す。** 見た目は大人向けなので、子ども向けの配慮は不要
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'ほごしゃせってい');

    root.append(
      this.section('つぎの さかな', [
        this.button('きんいろ', () => {
          this.actions.forceVariant('gold');
          this.close();
        }),
        this.button('おおきい', () => {
          this.actions.forceVariant('big');
          this.close();
        }),
        // **サプライズだけは「次の1匹」ではない**（水たまりではなく画面の下から出る）。
        // 同じ段に置いてあるのは、大人が見たいものが並んでいるほうが探しやすいため
        this.button('したから おおきいの', () => {
          this.actions.forceSurprise();
          this.close();
        }),
      ]),
      this.section(
        'ステージ',
        this.actions.stages().map((s) =>
          this.button(s.label, () => {
            this.actions.setStage(s.id);
            this.close();
          }, s.id === this.actions.currentStage())
        )
      )
    );

    const current = this.actions.volume();
    root.append(
      this.section(
        'おと',
        VOLUMES.map((v) =>
          this.button(
            v.label,
            () => {
              this.actions.setVolume(v.value);
              this.close();
            },
            Math.abs(current - v.value) < 0.005
          )
        )
      ),
      // **「さいしょから」は押し間違えても取り返しがつく。**
      // 減るのは★と花だけで、遊びかたは何も変わらない（不変条件11 の例外）
      this.section('とくてん', [
        this.button('さいしょから', () => {
          this.actions.resetProgress();
          this.close();
        }),
      ])
    );

    const close = this.button('とじる', () => this.close());
    close.classList.add('parent-panel__close');
    root.append(close);

    // ==================================================================
    // **タップを下へ通さない**（2026-09-17、E2E が捕まえた）。
    // ボタン側で `click` を止めていたが、`Input` は `pointerdown` を
    // 見ているので**遊びのタップが1回通っていた**（パネルの後ろの魚が
    // 叩かれる）。`ParentalGate` が `pointerdown` を止めているのと同じ形にする
    // ==================================================================
    root.addEventListener('pointerdown', (e) => e.stopPropagation());

    this.root = root;
    this.container.append(root);
  }

  close(): void {
    this.root?.remove();
    this.root = null;
  }

  dispose(): void {
    this.close();
  }

  private section(title: string, items: HTMLElement[]): HTMLElement {
    const box = document.createElement('div');
    box.className = 'parent-panel__section';
    const h = document.createElement('div');
    h.className = 'parent-panel__title';
    h.textContent = title;
    const row = document.createElement('div');
    row.className = 'parent-panel__row';
    row.append(...items);
    box.append(h, row);
    return box;
  }

  private button(label: string, onClick: () => void, current = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'parent-panel__button';
    if (current) b.classList.add('is-current');
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => {
      // **タップを下へ通さない。** 通すと、閉じた直後に水たまりが反応する
      e.stopPropagation();
      onClick();
    });
    return b;
  }
}
