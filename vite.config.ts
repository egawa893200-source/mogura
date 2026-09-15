import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Netlify はサイトの直下（/）で配信するので base は '/'。
// サブディレクトリに置くホスト（GitHub Pages など）に変えるときだけ
// BASE_PATH を指定する。**素材のURLは必ず resolveAssetUrl() を通すこと**
// （通っていないと、素材を置いた瞬間に 404 になるのに気づけない）。
const base = process.env.BASE_PATH ?? '/';

/**
 * **Service Worker を外してビルドする逃げ道**（`NO_PWA=1`）。
 *
 * 実機で試すために Artifact として公開するときに使う。
 * SW が入っていると、こちらが作り直しても端末に古いキャッシュが残って
 * 「直したはずのものが直っていない」になる。
 * **本番（Netlify）では外さない** —— 機内モードでも起動する価値は大きい。
 */
const noPwa = process.env.NO_PWA === '1';

export default defineConfig({
  base,
  plugins: [
    // PWA: オフラインキャッシュ。ホーム画面に追加でフルスクリーン起動する。
    // **プラグイン自体は外さない** —— `virtual:pwa-register` が解決できなくなって
    // ビルドが落ちる。`disable` で中身だけ止める
    VitePWA({
      disable: noPwa,
      registerType: 'autoUpdate',
      // 開発中は SW を動かさない（古いキャッシュが残ると原因の切り分けができない）
      devOptions: { enabled: false },
      manifest: {
        name: 'ぽこ！',
        short_name: 'ぽこ！',
        description: 'さかなをたたいて遊ぶアプリ',
        lang: 'ja',
        start_url: '.',
        scope: '.',
        // 不変条件5: ブラウザUIに触れさせない
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'any',
        background_color: '#12203a',
        theme_color: '#12203a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // アプリ本体は全てプリキャッシュする（機内モードでも起動する）
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        // ==============================================================
        // モデル・音・背景は大きいので、実際に見た場面のぶんだけ後から
        // キャッシュする。
        //
        // **置き場所を増やしたら、ここも増やすこと**（2026-09-15、本番へ
        // 出す前に見つけた）。v0.4 で足した `models` / `textures` /
        // `videos` がどれも入っておらず、**3D の魚も背景の動画も
        // 1バイトもキャッシュされていなかった**。
        // 不変条件7 があるので**オフラインでも「一応動く」** ——
        // 手続き生成の魚とグラデーションに落ちるだけなので、
        // **壊れたことに気づけない**（CLAUDE.md の
        // 「フォールバックが効くので通っていないことに気づけない」そのもの）。
        //
        // 逆に `audio` と `fish` は**存在しない**ディレクトリだった
        // （`public/` にあるのは backgrounds / models / posters /
        // textures / videos / voice）。実態に合わせる。
        // ==============================================================
        runtimeCaching: [
          {
            urlPattern: /\/(backgrounds|models|posters|textures|videos|voice)\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'poko-assets',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 60 },
              rangeRequests: true,
              cacheableResponse: { statuses: [0, 200, 206] },
            },
          },
        ],
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
      },
    }),
  ],
  server: {
    host: true, // 実機（iPhone / Android）から LAN 経由で開けるようにする
    port: 5173,
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
