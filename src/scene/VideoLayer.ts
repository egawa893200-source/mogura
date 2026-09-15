/**
 * 背景の実写ループ動画（設計書 §8-1）
 *
 * ==========================================================================
 * **出どころ: 水族館アプリ「みずのなか」（suizokukan）の `scene/VideoLayer.ts`。**
 * 実機で検証済みの作りをそのまま引き継ぐ。
 *
 * `<video>` を全画面に敷き、その上に**透過した WebGL キャンバス**を重ねる。
 * 動画を WebGL のテクスチャに持ち込むと毎フレームの転送が要るので、
 * **ブラウザの合成に任せる**（rAF のフレーム時間に出ない）。
 *
 * 2026-09-14、人間の指示で手続き生成の水中の絵から差し替えた。
 * 「以前に作成した suizokukan の3D魚や背景の動画をそのまま使用してください」。
 *
 * **動画が読めなくてもアプリは動く**（不変条件7）。
 * `StageRoot` が手続き生成の背景に落とす。
 * ==========================================================================
 */

export class VideoLayer {
  private video: HTMLVideoElement | null = null;

  constructor(private readonly container: HTMLElement) {}

  /** 動画を差し替える。null なら消す */
  setVideo(video: HTMLVideoElement | null): void {
    this.clear();
    if (!video) return;
    this.video = video;
    video.loop = true;
    // **必ずミュート。** 音が出ると不変条件9（初期ミュート）に反するし、
    // iOS は音ありの自動再生を拒否する
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('aria-hidden', 'true');
    video.className = 'background-video';
    this.container.appendChild(video);
    void video.play().catch(() => {
      // 自動再生が拒否されても静かに諦める（§2 エラー画面を出さない）。
      // 最初のタップで `resume()` が呼ばれる
    });
  }

  /**
   * 最初のタップで呼ぶ。
   *
   * iOS / Android は、ユーザー操作の前の自動再生を拒否することがある。
   * **止まった絵のまま気づかない**ことになるので、タップのたびに試す。
   */
  resume(): void {
    if (!this.video || !this.video.paused) return;
    void this.video.play().catch(() => {});
  }

  isActive(): boolean {
    return this.video !== null;
  }

  clear(): void {
    if (!this.video) return;
    this.video.pause();
    this.video.remove();
    // **src を外して load() する。** 外さないと、差し替えたあとも
    // 端末が動画を読み続ける（みずのなかの実測）
    this.video.removeAttribute('src');
    this.video.load();
    this.video = null;
  }
}
