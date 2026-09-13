/**
 * E2E（設計書 §11-3）
 *
 * **fps の数値判定とスクリーンショットの画素比較はしない**（§11-2）。
 * 開発コンテナにも CI にも GPU が無いので、実機性能を反映しない。
 *
 * --------------------------------------------------------------------------
 * **待つのは更新時計、壁時計は固まったときに止めるためだけ**（§11-4）。
 * `Loop` は1フレームに最大3ステップしか進めないので、GPU の無い環境では
 * 壁時計と更新時計が2倍近くずれる。「ばあ！」では壁時計で待っていた3箇所が、
 * 見た目を重くするたびに足りなくなって**通し実行のときだけ落ちた**。
 * --------------------------------------------------------------------------
 */

import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __poko: {
      getTapCount(): number;
      getHoleHitCount(): number;
      getStageId(): string;
      getHoles(): { id: string; x: number; y: number; radiusPx: number }[];
      setStage(id: string): Promise<void>;
      getSimulatedSeconds(): number;
      getRenderInfo(): {
        triangles: number;
        calls: number;
        geometries: number;
        textures: number;
      };
      reloadStage(): Promise<void>;
    };
  }
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__poko !== undefined);
  // 水たまりが並ぶまで待つ（構築は非同期）
  await page.waitForFunction(() => window.__poko.getHoles().length === 4);
}

/** 更新時計で待つ。壁時計は「固まったときに止める」ためだけに使う */
async function waitSimulated(page: Page, seconds: number): Promise<void> {
  const from = await page.evaluate(() => window.__poko.getSimulatedSeconds());
  await page.waitForFunction(
    ([start, need]) => window.__poko.getSimulatedSeconds() - start >= need,
    [from, seconds] as const,
    { timeout: 60_000 }
  );
}

test.describe('骨組み（Phase 1）', () => {
  test('起動して、フレームが進む', async ({ page }) => {
    await boot(page);
    // **fps は見ない。** 進んでいることだけを見る（§11-2）
    await waitSimulated(page, 0.5);
    const info = await page.evaluate(() => window.__poko.getRenderInfo());
    expect(info.triangles).toBeGreaterThan(0);
  });

  test('起動から5秒間 console.error が出ない', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await boot(page);
    await waitSimulated(page, 3);
    expect(errors).toEqual([]);
  });

  test('画面のどこをタップしても波紋が出る（右上 24×24px を除く）', async ({ page }) => {
    // ==================================================================
    // 不変条件1。**`Input` を `document.body` に付けていないとここが落ちる。**
    // `#overlay-layer` は `pointer-events: none` なので、そこに付けると
    // タップが1度もハンドラに届かない（「ばあ！」で実際にやった）。
    //
    // **右上だけは 40px 内側に寄せる。** ペアレンタルゲートの
    // ホットスポット（不変条件5 の唯一の例外）で、ここは遊びの当たり判定を
    // 持たない。**「無反応のバグ」と読み違えないこと。**
    // ==================================================================
    await boot(page);
    const size = page.viewportSize()!;
    const points: [number, number][] = [
      [8, 8],
      [size.width - 40, 40],
      [8, size.height - 8],
      [size.width - 8, size.height - 8],
      [size.width / 2, size.height / 2],
      [size.width / 2, 60],
    ];
    for (const [x, y] of points) {
      const before = await page.evaluate(() => window.__poko.getTapCount());
      await page.mouse.click(x, y);
      await expect
        .poll(() => page.evaluate(() => window.__poko.getTapCount()))
        .toBe(before + 1);
    }
  });

  test('水たまりの中心を押すと、水たまりに当たる', async ({ page }) => {
    await boot(page);
    const holes = await page.evaluate(() => window.__poko.getHoles());
    expect(holes).toHaveLength(4);
    for (const hole of holes) {
      const before = await page.evaluate(() => window.__poko.getHoleHitCount());
      await page.mouse.click(hole.x, hole.y);
      await expect
        .poll(() => page.evaluate(() => window.__poko.getHoleHitCount()))
        .toBe(before + 1);
    }
  });

  test('水たまりどうしの当たり判定が重ならない', async ({ page }) => {
    await boot(page);
    const holes = await page.evaluate(() => window.__poko.getHoles());
    for (let i = 0; i < holes.length; i++) {
      for (let j = i + 1; j < holes.length; j++) {
        const d = Math.hypot(holes[i].x - holes[j].x, holes[i].y - holes[j].y);
        const sum = holes[i].radiusPx + holes[j].radiusPx;
        expect(sum, `${holes[i].id}-${holes[j].id}`).toBeLessThanOrEqual(d);
      }
    }
  });

  test('水たまりが画面の中に収まっている', async ({ page }) => {
    // 「置いたのに見えない」ときは、まず画面に入っているかを疑う（§11-4）
    await boot(page);
    const size = page.viewportSize()!;
    const holes = await page.evaluate(() => window.__poko.getHoles());
    for (const hole of holes) {
      expect(hole.x, hole.id).toBeGreaterThan(0);
      expect(hole.x, hole.id).toBeLessThan(size.width);
      expect(hole.y, hole.id).toBeGreaterThan(0);
      expect(hole.y, hole.id).toBeLessThan(size.height);
    }
  });

  test('ステージを切り替えても、どこを押しても反応が返る', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => window.__poko.getStageId())).toBe('ike');
    await page.evaluate(() => window.__poko.setStage('umi'));
    await page.waitForFunction(() => window.__poko.getStageId() === 'umi');
    const holes = await page.evaluate(() => window.__poko.getHoles());
    expect(holes).toHaveLength(4);
    const before = await page.evaluate(() => window.__poko.getTapCount());
    await page.mouse.click(holes[0].x, holes[0].y);
    await expect.poll(() => page.evaluate(() => window.__poko.getTapCount())).toBe(before + 1);
  });

  test('ステージを10往復しても geometry と texture が増え続けない', async ({ page }) => {
    // ==================================================================
    // 不変条件8。**数え終わる前に測ると「漏れている」と出る**（§11-4）。
    // 2回続けて同じ数になるまで描いてから測る
    // ==================================================================
    await boot(page);
    const settle = async (): Promise<{ geometries: number; textures: number }> => {
      let last = await page.evaluate(() => window.__poko.getRenderInfo());
      for (let i = 0; i < 30; i++) {
        await waitSimulated(page, 0.2);
        const now = await page.evaluate(() => window.__poko.getRenderInfo());
        if (now.geometries === last.geometries && now.textures === last.textures) return now;
        last = now;
      }
      return last;
    };
    const before = await settle();
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.__poko.setStage('umi'));
      await page.waitForFunction(() => window.__poko.getStageId() === 'umi');
      await page.evaluate(() => window.__poko.setStage('ike'));
      await page.waitForFunction(() => window.__poko.getStageId() === 'ike');
    }
    const after = await settle();
    expect(after.geometries).toBeLessThanOrEqual(before.geometries + 2);
    expect(after.textures).toBeLessThanOrEqual(before.textures + 2);
  });

  test('素材が1つも無くても起動して、どこを押しても反応が返る（不変条件7）', async ({ page }) => {
    // **`public/` を空にしたのと同じ状況**を作る。背景が 404 でも
    // 手続き生成のグラデーションに落ち、例外は表に出ない
    await page.route('**/backgrounds/**', (route) => route.abort());
    await boot(page);
    const size = page.viewportSize()!;
    const before = await page.evaluate(() => window.__poko.getTapCount());
    await page.mouse.click(size.width / 2, size.height / 2);
    await expect.poll(() => page.evaluate(() => window.__poko.getTapCount())).toBe(before + 1);
  });
});
