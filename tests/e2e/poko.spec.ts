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
      getFish(): {
        id: string;
        state: string;
        reveal: number;
        squash: number;
        bump: number;
        holeIndex: number;
        variant: 'normal' | 'big' | 'gold';
      }[];
      getHittableCount(): number;
      getUpSec(): number;
      getFishHitCount(): number;
      getMissCount(): number;
      getVoiceLog(): { clip: string; at: number }[];
      setStage(id: string): Promise<void>;
      getSimulatedSeconds(): number;
      getRenderInfo(): {
        triangles: number;
        calls: number;
        geometries: number;
        textures: number;
      };
      reloadStage(): Promise<void>;
      getRocks(): { id: string; x: number; y: number; radiusPx: number }[];
      getRockTapCount(): number;
      getScore(): { stars: number; flowers: number };
      isChangingStage(): boolean;
      forceVariant(v: 'normal' | 'big' | 'gold' | null): void;
      getSurprise(): {
        state: string;
        reveal: number;
        x: number;
        y: number;
        rx: number;
        ry: number;
      } | null;
      getSurpriseTapCount(): number;
      forceSurprise(): void;
      isParentPanelOpen(): boolean;
      openParentPanel(): void;
      getAudio(): { muted: boolean; volume: number };
      getRockFish(): {
        id: string | null;
        state: string;
        reveal: number;
        squash: number;
        bump: number;
        rockIndex: number;
        visible: boolean;
        z: number;
      } | null;
    };
  }
}

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__poko !== undefined);
  // 水たまりが並ぶまで待つ（構築は非同期）
  await page.waitForFunction(() => window.__poko.getHoles().length === 6);
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
    expect(holes).toHaveLength(6);
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
    expect(holes).toHaveLength(6);
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
    // **3回続けて同じ数になるまで待つ。** 2回では、たまたま同じ値を
    // 2回読んでしまって「落ち着いた」と誤判定する回があった（実測で
    // 3回に1回落ちた）。CLAUDE.md の
    // 「`renderer.info.memory` は数え終わる前に測ると『漏れている』と出る」
    const settle = async (): Promise<{ geometries: number; textures: number }> => {
      let same = 0;
      let last = await page.evaluate(() => window.__poko.getRenderInfo());
      for (let i = 0; i < 40; i++) {
        await waitSimulated(page, 0.2);
        const now = await page.evaluate(() => window.__poko.getRenderInfo());
        same = now.geometries === last.geometries && now.textures === last.textures ? same + 1 : 0;
        last = now;
        if (same >= 3) return now;
      }
      return last;
    };
    const roundTrip = async (times: number): Promise<void> => {
      for (let i = 0; i < times; i++) {
        await page.evaluate(() => window.__poko.setStage('umi'));
        await page.waitForFunction(() => window.__poko.getStageId() === 'umi');
        await page.evaluate(() => window.__poko.setStage('ike'));
        await page.waitForFunction(() => window.__poko.getStageId() === 'ike');
      }
    };
    // ==================================================================
    // **「前より増えていない」では測れない**（2026-09-13 の実測）。
    //
    // `renderer.info.memory` が数えるのは**描画に使われた**ものなので、
    // 差し替えの途中（古いのを捨てて新しいのがまだ描かれていない）に
    // 落ち着いたと誤判定すると、あとの数のほうが大きく出る。
    // 3回続けて同じ数を待っても、5回に2回そうなった。
    //
    // 見たいのは**増え続けないこと**（不変条件8）なので、
    // 「10往復しても上限を超えない」で見る。捨て漏れていれば
    // 1往復ぶん（20前後）ずつ増えるので、10往復で 200 を超えて一目で分かる。
    // ==================================================================
    await roundTrip(10);
    const after = await settle();
    expect(after.geometries).toBeLessThan(60);
    expect(after.textures).toBeLessThan(30);
  });

  test('叩ける相手が画面から途切れない（不変条件4c）', async ({ page }) => {
    // ==================================================================
    // **画面に何も無い時間を作らない。**
    // 「ばあ！」は押すまで画面が止まっていて、それが受けなかった理由の1つ。
    //
    // **待つのは更新時計**（§11-4）。壁時計で待つと、描画が重くなったときに
    // 足りなくなって「通し実行のときだけ落ちる」テストになる。
    // ==================================================================
    await boot(page);
    // 最初の1匹が出るまで
    await page.waitForFunction(() => window.__poko.getHittableCount() > 0);
    const zero = await page.evaluate(async () => {
      let bad = 0;
      const start = window.__poko.getSimulatedSeconds();
      while (window.__poko.getSimulatedSeconds() - start < 25) {
        if (window.__poko.getHittableCount() === 0) bad++;
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return bad;
    });
    expect(zero).toBe(0);
  });

  test('押さなくても魚が出入りする（§4-2）', async ({ page }) => {
    await boot(page);
    const seen = await page.evaluate(async () => {
      const states = new Set<string>();
      const holes = new Set<number>();
      const start = window.__poko.getSimulatedSeconds();
      while (window.__poko.getSimulatedSeconds() - start < 30) {
        for (const f of window.__poko.getFish()) {
          states.add(f.state);
          if (f.holeIndex >= 0) holes.add(f.holeIndex);
        }
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return { states: [...states], holes: holes.size };
    });
    // **一度も触っていないのに**状態が動いている
    expect(seen.states).toContain('rising');
    expect(seen.states).toContain('up');
    // いくつもの水たまりが使われる（同じ場所に偏らない）
    expect(seen.holes).toBeGreaterThanOrEqual(3);
  });

  test('同時に出るのは2匹まで（§4-2）', async ({ page }) => {
    await boot(page);
    const max = await page.evaluate(async () => {
      let m = 0;
      const start = window.__poko.getSimulatedSeconds();
      while (window.__poko.getSimulatedSeconds() - start < 25) {
        m = Math.max(m, window.__poko.getFish().filter((f) => f.state !== 'hidden').length);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return m;
    });
    expect(max).toBe(2);
  });

  test('魚を叩くと、その場で潰れる（§4-3 の0フレーム原則）', async ({ page }) => {
    // ==================================================================
    // **このアプリでいちばん重要な規則。**
    // タップを受け取った**その場**で潰れが始まる。
    // 「ばあ！」は押してから 0.35秒後に山が来る作りで、そこが受けなかった。
    // ==================================================================
    await boot(page);
    const hole = await page.evaluate(async () => {
      // 魚が出るまで待って、その水たまりの位置を返す
      while (true) {
        const up = window.__poko.getFish().find((f) => f.state === 'up');
        if (up) {
          const holes = window.__poko.getHoles();
          return { ...holes[up.holeIndex], fish: up.id };
        }
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    });
    const before = await page.evaluate(() => window.__poko.getFishHitCount());
    await page.mouse.click(hole.x, hole.y);
    // **クリックの直後に見る。** 次のフレームを待たない
    const after = await page.evaluate(() => ({
      hits: window.__poko.getFishHitCount(),
      squash: Math.max(...window.__poko.getFish().map((f) => f.squash)),
    }));
    expect(after.hits).toBe(before + 1);
    expect(after.squash).toBeGreaterThan(0);
  });

  test('魚の居ない水たまりを叩いても反応は返る（不変条件3b）', async ({ page }) => {
    await boot(page);
    const empty = await page.evaluate(async () => {
      while (true) {
        const used = new Set(
          window.__poko.getFish().filter((f) => f.state !== 'hidden').map((f) => f.holeIndex)
        );
        const holes = window.__poko.getHoles();
        const free = holes.findIndex((_, i) => !used.has(i));
        if (free >= 0) return holes[free];
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    });
    const before = await page.evaluate(() => ({
      taps: window.__poko.getTapCount(),
      miss: window.__poko.getMissCount(),
      hits: window.__poko.getFishHitCount(),
    }));
    await page.mouse.click(empty.x, empty.y);
    const after = await page.evaluate(() => ({
      taps: window.__poko.getTapCount(),
      miss: window.__poko.getMissCount(),
      hits: window.__poko.getFishHitCount(),
    }));
    // **反応は返る**が、**得点は増えない**（§4-5）
    expect(after.taps).toBe(before.taps + 1);
    expect(after.miss).toBe(before.miss + 1);
    expect(after.hits).toBe(before.hits);
  });

  test('声は2本だけで、役割を混ぜていない（§4-4）', async ({ page }) => {
    // ==================================================================
    // 「ばあっ！」＝魚が出た合図、「いてっ」＝当たった合図。
    // **隠れたままなのに「ばあっ」と言わない**（「ばあ！」でいちばん
    // 紛らわしかった間違い）。**空振りでは声を出さない**（§4-5）。
    // ==================================================================
    await boot(page);
    // しばらく放っておく（触らない）
    await page.evaluate(async () => {
      const start = window.__poko.getSimulatedSeconds();
      while (window.__poko.getSimulatedSeconds() - start < 8) {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    });
    const idle = await page.evaluate(() => window.__poko.getVoiceLog());
    // 触っていないので「ばあっ」だけ。「いてっ」は1回も無い
    expect(idle.length).toBeGreaterThan(0);
    expect(idle.every((v) => v.clip === 'baa')).toBe(true);

    // 空振りしても声は増えない
    const empty = await page.evaluate(async () => {
      while (true) {
        const used = new Set(
          window.__poko.getFish().filter((f) => f.state !== 'hidden').map((f) => f.holeIndex)
        );
        const holes = window.__poko.getHoles();
        const free = holes.findIndex((_, i) => !used.has(i));
        if (free >= 0) return holes[free];
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    });
    const beforeMiss = await page.evaluate(() => window.__poko.getVoiceLog().length);
    await page.mouse.click(empty.x, empty.y);
    const afterMiss = await page.evaluate(
      () => window.__poko.getVoiceLog().filter((v) => v.clip === 'ite').length
    );
    expect(afterMiss).toBe(0);
    expect(await page.evaluate(() => window.__poko.getVoiceLog().length)).toBe(beforeMiss);

    // 魚を叩くと「いてっ」が1回だけ増える
    const hole = await page.evaluate(async () => {
      while (true) {
        const up = window.__poko.getFish().find((f) => f.state === 'up');
        if (up) return window.__poko.getHoles()[up.holeIndex];
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    });
    await page.mouse.click(hole.x, hole.y);
    const ite = await page.evaluate(
      () => window.__poko.getVoiceLog().filter((v) => v.clip === 'ite').length
    );
    expect(ite).toBe(1);
  });

  test('同時に出た2匹の「ばあっ」が重ならない（§4-4）', async ({ page }) => {
    // `voiceBusyUntil` に任せると2匹目が無音になるので 0.12秒ずらす
    await boot(page);
    const log = await page.evaluate(async () => {
      const start = window.__poko.getSimulatedSeconds();
      while (window.__poko.getSimulatedSeconds() - start < 20) {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return window.__poko.getVoiceLog();
    });
    expect(log.length).toBeGreaterThan(2);
    for (let i = 1; i < log.length; i++) {
      // 同じ更新時刻に2本重ならない
      expect(log[i].at - log[i - 1].at, `${i} 本目`).toBeGreaterThan(0.05);
    }
  });

  test('連打しても1回ごとに反応が返る（不変条件2）', async ({ page }) => {
    await boot(page);
    const hole = await page.evaluate(async () => {
      while (true) {
        const up = window.__poko.getFish().find((f) => f.state === 'up');
        if (up) return window.__poko.getHoles()[up.holeIndex];
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    });
    const before = await page.evaluate(() => window.__poko.getTapCount());
    for (let i = 0; i < 10; i++) await page.mouse.click(hole.x, hole.y);
    const after = await page.evaluate(() => window.__poko.getTapCount());
    // **10回とも受け取る。** 得点は1回ぶんしか増えない（§4-6）が、反応は返る
    expect(after).toBe(before + 10);
  });

  test('「ばあっ」の時点では1画素も見えていない（実機の指摘）', async ({ page }) => {
    // ==================================================================
    // 実機で「**『ばあっ』する前にチラッと見えている**」と言われた
    // （2026-09-13）。声と同時に動きはじめていたのが原因。
    // `calling`（0.38秒）を挟んで、**声が先・姿はあと**にした。
    // ==================================================================
    await boot(page);
    const seen = await page.evaluate(async () => {
      let callingFrames = 0;
      let leaked = 0;
      const start = window.__poko.getSimulatedSeconds();
      while (window.__poko.getSimulatedSeconds() - start < 20) {
        for (const f of window.__poko.getFish()) {
          if (f.state === 'calling') {
            callingFrames++;
            // **`calling` のあいだ reveal は 0**（穴の外に1画素も出ていない）
            if (f.reveal > 0) leaked++;
          }
        }
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return { callingFrames, leaked };
    });
    expect(seen.callingFrames).toBeGreaterThan(0);
    expect(seen.leaked).toBe(0);
  });

  test('叩くとたんこぶができる（実機の要望）', async ({ page }) => {
    await boot(page);
    const hole = await page.evaluate(async () => {
      while (true) {
        const up = window.__poko.getFish().find((f) => f.state === 'up');
        if (up) return window.__poko.getHoles()[up.holeIndex];
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    });
    await page.mouse.click(hole.x, hole.y);
    // **叩いたその場で育ちはじめる**（0フレーム原則と同じ）
    const bump = await page.evaluate(() =>
      Math.max(...window.__poko.getFish().map((f) => f.bump))
    );
    expect(bump).toBeGreaterThan(0);
  });

  test('岩を押すと、何も見えないまま「ばあっ」と鳴って魚が出る（§4-8）', async ({ page }) => {
    // ==================================================================
    // 「画面の上が空いているので岩を設置して、タップすると魚が前に
    // 突き出してくるように（ばあっ！）」（2026-09-14、人間の指示）。
    //
    // **姿より先に声。** 実機で「『ばあっ』する前にチラッと見えている」と
    // 言われた指摘は、岩にもそのまま当てはまる
    // ==================================================================
    await boot(page);
    const rocks = await page.evaluate(() => window.__poko.getRocks());
    expect(rocks.length).toBe(2);

    const before = await page.evaluate(() => window.__poko.getVoiceLog().length);
    await page.mouse.click(rocks[1].x, rocks[1].y);

    // `calling` のあいだ、魚は1画素も描かれていない
    const leaked = await page.evaluate(async () => {
      let frames = 0;
      let bad = 0;
      while (window.__poko.getRockFish()?.state === 'calling') {
        frames++;
        const f = window.__poko.getRockFish()!;
        if (f.visible || f.reveal > 0) bad++;
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return { frames, bad };
    });
    expect(leaked.frames).toBeGreaterThan(0);
    expect(leaked.bad).toBe(0);

    // 出きるところまで進む（**待つのは更新時計**）
    await page.waitForFunction(() => window.__poko.getRockFish()?.state === 'out', null, {
      timeout: 60_000,
    });
    const out = await page.evaluate(() => window.__poko.getRockFish()!);
    expect(out.visible).toBe(true);
    // **前に突き出してくる**（カメラ側 = z > 0）
    expect(out.z).toBeGreaterThan(0.5);
    // 「ばあっ！」が鳴っている
    const log = await page.evaluate(() => window.__poko.getVoiceLog());
    expect(log.slice(before).some((v) => v.clip === 'baa')).toBe(true);
  });

  test('岩の当たり判定が、水たまりの当たり判定と重ならない（§4-8）', async ({ page }) => {
    // **実際の画面で測る。** 単体テストは自前のカメラで測っているので、
    // レンダラ側の fov やアスペクトの扱いがずれていると気づけない
    await boot(page);
    const { rocks, holes } = await page.evaluate(() => ({
      rocks: window.__poko.getRocks(),
      holes: window.__poko.getHoles(),
    }));
    for (const rock of rocks) {
      expect(rock.radiusPx, rock.id).toBeGreaterThan(0);
      for (const hole of holes) {
        const d = Math.hypot(rock.x - hole.x, rock.y - hole.y);
        expect(rock.radiusPx + hole.radiusPx, `${rock.id}-${hole.id}`).toBeLessThanOrEqual(d);
      }
    }
  });

  test('岩を連打しても、毎回反応が返る（不変条件2）', async ({ page }) => {
    // **「アニメーション中だから無視」は禁止。** みずのなかの岩陰は
    // `retreating` 中と `cooldown` 中のタップを捨てていたので、そこを外してある
    await boot(page);
    const rocks = await page.evaluate(() => window.__poko.getRocks());
    const before = await page.evaluate(() => window.__poko.getRockTapCount());
    for (let i = 0; i < 8; i++) await page.mouse.click(rocks[0].x, rocks[0].y);
    const after = await page.evaluate(() => window.__poko.getRockTapCount());
    expect(after).toBe(before + 8);
    // **連打しても姿が出る**（押すたびに戻して永遠に出ない、にならない）
    const maxReveal = await page.evaluate(async () => {
      let best = 0;
      const start = window.__poko.getSimulatedSeconds();
      while (window.__poko.getSimulatedSeconds() - start < 3) {
        best = Math.max(best, window.__poko.getRockFish()?.reveal ?? 0);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return best;
    });
    expect(maxReveal).toBeGreaterThan(0.5);
  });

  test('出ている岩の魚を叩くと、その場で潰れて「いてっ」と言う（§4-8）', async ({ page }) => {
    await boot(page);
    const rocks = await page.evaluate(() => window.__poko.getRocks());
    await page.mouse.click(rocks[0].x, rocks[0].y);
    await page.waitForFunction(() => window.__poko.getRockFish()?.state === 'out', null, {
      timeout: 60_000,
    });
    const before = await page.evaluate(() => window.__poko.getVoiceLog().length);
    await page.mouse.click(rocks[0].x, rocks[0].y);
    // **潰れは `update()` を待たない**（§4-3 の0フレーム原則）
    const hit = await page.evaluate(() => window.__poko.getRockFish()!);
    expect(hit.state).toBe('hit');
    expect(hit.squash).toBeGreaterThan(0);

    // ==================================================================
    // **たんこぶは潰れより 0.06秒 遅れて育つ**（§4-4「潰れきってから膨らむ」）。
    // ここを「叩いた直後に 0 より大きい」で見てはいけない ——
    // クリックと読み出しのあいだに1フレーム入ると、`update()` が
    // `max(0, (elapsed - 0.06) / 0.16)` を書くので **0 に戻る**。
    // 実際にそれで落ちた（2026-09-14）。**仕様どおりの 0 だった。**
    // 見るべきは「潰れているあいだに膨らむこと」なので、そこを見る
    // ==================================================================
    const maxBump = await page.evaluate(async () => {
      let best = 0;
      while (window.__poko.getRockFish()?.state === 'hit') {
        best = Math.max(best, window.__poko.getRockFish()!.bump);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return best;
    });
    expect(maxBump).toBeGreaterThan(0);

    const log = await page.evaluate(() => window.__poko.getVoiceLog());
    expect(log.slice(before).some((v) => v.clip === 'ite')).toBe(true);
  });

  /** 出ている魚を1匹叩く。**`up` だけを狙う** —— `rising` は動いているので外れる */
  async function whackOne(page: Page): Promise<boolean> {
    const hole = await page.evaluate(async () => {
      const start = window.__poko.getSimulatedSeconds();
      while (window.__poko.getSimulatedSeconds() - start < 8) {
        const f = window.__poko.getFish().find((f) => f.state === 'up');
        if (f) return window.__poko.getHoles()[f.holeIndex];
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return null;
    });
    if (!hole) return false;
    await page.mouse.click(hole.x, hole.y);
    return true;
  }

  test('★が10個たまると花が咲いて、ステージが入れ替わる（§4-6 / §5-3）', async ({ page }) => {
    // ==================================================================
    // **画面に切替バーを置かない**（§5-3）。1歳半にステージを選ばせる
    // 必要は無いし、**バーは当たり判定を塞ぐ**（「みずのなか」で 390px 幅の
    // 端末で実際に起きた事故）。得点が「場面が変わる」形で返る
    // ==================================================================
    await boot(page);
    const first = await page.evaluate(() => window.__poko.getStageId());

    for (let i = 0; i < 40; i++) {
      const score = await page.evaluate(() => window.__poko.getScore());
      if (score.flowers > 0) break;
      await whackOne(page);
    }

    const bloomed = await page.evaluate(() => window.__poko.getScore());
    expect(bloomed.flowers, '10回叩いても花が咲かない').toBe(1);
    // **★は 0 に戻る**（§4-6）
    expect(bloomed.stars).toBe(0);

    // **暗転もローディングも作らない。** 待つあいだも押せば反応が返る
    const before = await page.evaluate(() => window.__poko.getTapCount());
    await page.mouse.click(206, 500);
    await expect
      .poll(() => page.evaluate(() => window.__poko.getTapCount()))
      .toBe(before + 1);

    // 静かに入れ替わる（**2ステージしか無いので交互に行き来する**）
    await page.waitForFunction(
      (from) => window.__poko.getStageId() !== from && window.__poko.getHoles().length === 6,
      first,
      { timeout: 60_000 }
    );
    expect(await page.evaluate(() => window.__poko.isChangingStage())).toBe(false);
    // **得点は減らない**（不変条件11）。ステージが変わっても花は残る
    expect((await page.evaluate(() => window.__poko.getScore())).flowers).toBe(1);
  });

  test('得点表示が当たり判定を塞がない（§3-4）', async ({ page }) => {
    // ==================================================================
    // **`pointer-events: none` を外すとここが落ちる。**
    // ★の帯は**画面の上の岩の当たり判定に重なる**（岩の円は y 80〜296px）。
    // 「みずのなか」で切替ボタンを5個並べたら 390px 幅の端末で2行に折り返し、
    // バーが 172px になって下の岩に覆いかぶさった事故と同じことが起きる
    // ==================================================================
    await boot(page);
    // ★を何個か並べてから測る（0個だと帯が無いので何も証明できない）
    for (let i = 0; i < 12; i++) {
      const score = await page.evaluate(() => window.__poko.getScore());
      if (score.stars >= 3) break;
      await whackOne(page);
    }
    expect((await page.evaluate(() => window.__poko.getScore())).stars).toBeGreaterThanOrEqual(3);

    // ★の真上を押す
    const before = await page.evaluate(() => window.__poko.getTapCount());
    await page.mouse.click(30, 14);
    await expect
      .poll(() => page.evaluate(() => window.__poko.getTapCount()))
      .toBe(before + 1);

    // 岩も押せる（★の帯の下にある）
    const rocks = await page.evaluate(() => window.__poko.getRocks());
    const rockBefore = await page.evaluate(() => window.__poko.getRockTapCount());
    await page.mouse.click(rocks[0].x, rocks[0].y);
    await expect
      .poll(() => page.evaluate(() => window.__poko.getRockTapCount()))
      .toBe(rockBefore + 1);
  });

  /** 次の1匹を `variant` にして、出きるまで待って叩く */
  async function whackVariant(page: Page, variant: 'big' | 'gold'): Promise<void> {
    await page.evaluate((v) => window.__poko.forceVariant(v), variant);
    const hole = await page.evaluate(async (v) => {
      const start = window.__poko.getSimulatedSeconds();
      while (window.__poko.getSimulatedSeconds() - start < 40) {
        const f = window.__poko.getFish().find((f) => f.variant === v && f.state === 'up');
        if (f) return window.__poko.getHoles()[f.holeIndex];
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return null;
    }, variant);
    expect(hole, `${variant} が出てこない`).not.toBeNull();
    await page.mouse.click(hole!.x, hole!.y);
  }

  test('大きいさかなを叩くと ★が3つ増える（§6-2）', async ({ page }) => {
    // **16回に1回・20回に1回を待たない。** `forceVariant` で決め打ちする
    // （出る割合そのものは単体テストが 5,280回ぶん数えている）
    await boot(page);
    const before = await page.evaluate(() => window.__poko.getScore());
    await whackVariant(page, 'big');
    const after = await page.evaluate(() => window.__poko.getScore());
    const gained =
      (after.flowers - before.flowers) * 10 + (after.stars - before.stars);
    expect(gained, `★が ${gained} しか増えていない`).toBe(3);
  });

  test('きんいろのさかなを叩くと 花が咲いてステージが変わる（§6-2 / §5-3）', async ({ page }) => {
    await boot(page);
    const first = await page.evaluate(() => window.__poko.getStageId());
    const before = await page.evaluate(() => window.__poko.getScore());
    await whackVariant(page, 'gold');

    const after = await page.evaluate(() => window.__poko.getScore());
    expect(after.flowers, '花が咲いていない').toBe(before.flowers + 1);
    // **★は減らない**（不変条件11）。近道であって、やり直しではない
    expect(after.stars).toBe(before.stars);

    // ★10個を待たずに場面が変わる
    await page.waitForFunction(
      (from) => window.__poko.getStageId() !== from && window.__poko.getHoles().length === 6,
      first,
      { timeout: 60_000 }
    );
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

test.describe('サプライズ（§6-3）— 画面の下から大きく1匹', () => {
  /** いますぐ出して、出きるまで待つ。**待つのは更新時計** */
  async function popSurprise(page: Page) {
    await page.evaluate(() => window.__poko.forceSurprise());
    await page.waitForFunction(() => window.__poko.getSurprise()?.state === 'out', null, {
      timeout: 60_000,
    });
    return (await page.evaluate(() => window.__poko.getSurprise()))!;
  }

  test('叩くと ★が5つ増える', async ({ page }) => {
    await boot(page);
    const s = await popSurprise(page);
    const before = await page.evaluate(() => window.__poko.getScore());
    await page.mouse.click(s.x, s.y);
    await expect
      .poll(() => page.evaluate(() => window.__poko.getSurpriseTapCount()))
      .toBeGreaterThan(0);
    const after = await page.evaluate(() => window.__poko.getScore());
    const gained = (after.flowers - before.flowers) * 10 + (after.stars - before.stars);
    expect(gained, `★が ${gained} しか増えていない`).toBe(5);
  });

  test('当たり楕円が、下の段より上の水たまりを取らない', async ({ page }) => {
    // ==================================================================
    // **単体テストは canvas の板で測っている。** 実機で出るのは `.glb` の
    // エイで、形が違う（横 302px・縦 224px の平たい魚）。
    // **見えていない魚まで覆うのは下の段だけ**であることを、
    // 本物のモデルで確かめる（下の段は `Spawner.setHeld()` で塞いである）
    // ==================================================================
    await boot(page);
    const s = await popSurprise(page);
    const holes = await page.evaluate(() => window.__poko.getHoles());
    const bottom = Math.max(...holes.map((h) => h.y));
    for (const hole of holes) {
      if (Math.abs(hole.y - bottom) < 1) continue;
      const t = Math.hypot((hole.x - s.x) / s.rx, (hole.y - s.y) / s.ry);
      expect(t, `${hole.id} が楕円の中（${t.toFixed(2)}）`).toBeGreaterThan(1);
    }
  });

  test('出ているあいだ、水たまりに新しい魚を出さない', async ({ page }) => {
    await boot(page);
    await popSurprise(page);
    const before = await page.evaluate(() =>
      window.__poko.getFish().filter((f) => f.state !== 'hidden').length
    );
    // 出きってから沈むまでのあいだ（更新時計で 1.5秒）に増えないこと
    await waitSimulated(page, 1.5);
    const state = await page.evaluate(() => window.__poko.getSurprise());
    expect(['out', 'retreating'], `もう沈んでいる（${state?.state}）`).toContain(state!.state);
    const after = await page.evaluate(() =>
      window.__poko.getFish().filter((f) => f.state !== 'hidden').length
    );
    expect(after, '覆われた下の段に魚が出た').toBeLessThanOrEqual(before);
  });

  test('どちらのステージでも、体が画面の中に収まる', async ({ page }) => {
    // ==================================================================
    // **実機で「うまく表示されていない」と言われた**（2026-09-17）。
    // えい は翼が縦を向いたまま引き伸ばされて**平たい茶色の凧**に見え、
    // きんぎょ は横長なので**顔が左端で切れて**いた。
    // 向き（`FishConfig.surprisePose`）と幅の上限（`SURPRISE.maxWidth`）で
    // 直したので、**体の見かけの矩形が画面から出ていないこと**を数値で見る
    // ==================================================================
    await boot(page);
    const size = page.viewportSize()!;
    for (const stage of ['ike', 'umi']) {
      await page.evaluate((id) => window.__poko.setStage(id), stage);
      await page.waitForFunction(
        (id) => window.__poko.getStageId() === id && window.__poko.getHoles().length === 6,
        stage
      );
      const s = await popSurprise(page);
      expect(s.y - s.ry, `${stage} 上が切れている`).toBeGreaterThanOrEqual(0);
      expect(s.y + s.ry, `${stage} 下が切れている`).toBeLessThanOrEqual(size.height);
      expect(s.x - s.rx, `${stage} 左が切れている`).toBeGreaterThanOrEqual(0);
      expect(s.x + s.rx, `${stage} 右が切れている`).toBeLessThanOrEqual(size.width);
      // **水たまりの魚よりはっきり大きい**（§6-3 の「大きく1匹」）
      const holes = await page.evaluate(() => window.__poko.getHoles());
      expect(s.ry * 2, `${stage} 大きく見えない`).toBeGreaterThan(holes[0].radiusPx);
      // 次のステージへ行く前に、引っ込みきるまで待つ
      await page.waitForFunction(() => window.__poko.getSurprise()?.state === 'hidden', null, {
        timeout: 60_000,
      });
    }
  });

  test('出ている途中に連打しても、必ず反応が返る（不変条件1・2）', async ({ page }) => {
    // ==================================================================
    // **「アニメーション中だから無視」は禁止**（不変条件2）。
    //
    // **押す場所を「いまの芯」から決めない**（2026-09-17、3回書き直した）。
    // 体は 560px/秒 で上がってくるうえ、`describe()` が返すのは
    // **1フレーム前**の位置（`measure()` は `update()` の前に走る）。
    // そこへ evaluate と click の往復（重い環境では 200ms 超）が乗るので、
    // 測ってから押すまでに体が 100px 以上ずれる。
    // 「押す直前に測り直す」でも、**重い日は6回とも外した**。
    //
    // **出きったときの楕円の下のほう**を狙えば、ずれても当たる ——
    // 上がってくる途中から出きるまで、その1点はずっと体の中にある。
    // ==================================================================
    await boot(page);
    const size = page.viewportSize()!;
    // まず1周ぶん出して、出きったときの楕円を測る（そこが動かない的）
    const out = await popSurprise(page);
    const target = { x: out.x, y: Math.min(out.y + out.ry * 0.9, size.height - 10) };
    await page.waitForFunction(() => window.__poko.getSurprise()?.state === 'hidden', null, {
      timeout: 60_000,
    });

    // もう一度出して、**出ている途中**に連打する
    await page.evaluate(() => window.__poko.forceSurprise());
    await page.waitForFunction(
      (h) => {
        const s = window.__poko.getSurprise();
        if (!s) return false;
        if (s.state !== 'rising') return false;
        return s.y - s.ry < h - 60;
      },
      size.height,
      { timeout: 60_000 }
    );
    const before = await page.evaluate(() => window.__poko.getTapCount());
    const taps = await page.evaluate(() => window.__poko.getSurpriseTapCount());
    for (let i = 0; i < 6; i++) await page.mouse.click(target.x, target.y);
    const after = await page.evaluate(() => window.__poko.getTapCount());
    expect(after - before, '連打が落ちている').toBe(6);
    // **出ている途中でも受けている**（引っ込んでからでは意味がない）
    const state = await page.evaluate(() => window.__poko.getSurprise());
    expect(
      await page.evaluate(() => window.__poko.getSurpriseTapCount()),
      `連打が1回も当たっていない（${state?.state}）`
    ).toBeGreaterThan(taps);
  });
});

test.describe('おとなの画面（ペアレンタルゲートの奥）', () => {
  /** 右上 24×24px を2秒押して、3択の右はしを当てる */
  async function openGate(page: Page): Promise<void> {
    const size = page.viewportSize()!;
    await page.mouse.move(size.width - 12, 12);
    await page.mouse.down();
    // **ここだけは壁時計**（ゲートの 2秒は `setTimeout`＝壁時計で数えている）
    await page.waitForTimeout(2400);
    await page.mouse.up();
    await expect(page.locator('.gate__confirm')).toBeVisible();
    await page.locator('.gate__dot').nth(2).click();
  }

  test('2秒長押し＋3択でおとなの画面が開き、閉じると1画素も残らない', async ({ page }) => {
    await boot(page);
    // **閉じているあいだ DOM に何も無い**（§3-4。当たり判定を塞がない）
    expect(await page.locator('.parent-panel').count()).toBe(0);
    await openGate(page);
    await expect(page.locator('.parent-panel')).toBeVisible();
    await page.locator('.parent-panel__close').click();
    expect(await page.locator('.parent-panel').count()).toBe(0);
    // 閉じたあと、遊びのタップがちゃんと通る
    const before = await page.evaluate(() => window.__poko.getTapCount());
    await page.mouse.click(206, 500);
    await expect.poll(() => page.evaluate(() => window.__poko.getTapCount())).toBe(before + 1);
  });

  test('おとなの画面から「したから おおきいの」を選ぶと、サプライズが出る（§6-3）', async ({
    page,
  }) => {
    // **スマホには開発者コンソールが無い。** ここが唯一の口
    await boot(page);
    await page.evaluate(() => window.__poko.openParentPanel());
    await page.getByRole('button', { name: 'したから おおきいの' }).click();
    await page.waitForFunction(() => window.__poko.getSurprise()?.state === 'out', null, {
      timeout: 60_000,
    });
    expect(await page.evaluate(() => window.__poko.isParentPanelOpen())).toBe(false);
  });

  test('きんいろを選ぶと、3秒以内に出てくる（§6-2）', async ({ page }) => {
    // ==================================================================
    // **実機で「きんいろが出現しない」と言われた**（2026-09-17）。
    // 同時に出せるのは2匹まで（§4-2）なので、上限に達しているあいだは
    // 抽選が動かず、**押してから 6.0〜8.2秒**待たされていた。
    // 大人には出ていないのと同じに見える。**待つのは更新時計**（§11-4）
    // ==================================================================
    await boot(page);
    // 2匹出きるまで待つ（上限に達した状態から押す）
    await page.waitForFunction(
      () => window.__poko.getFish().filter((f) => f.state === 'up').length >= 2,
      null,
      { timeout: 60_000 }
    );
    await page.evaluate(() => window.__poko.openParentPanel());
    const sec = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('.parent-panel__button')].find(
        (b) => b.textContent === 'きんいろ'
      );
      (btn as HTMLButtonElement).click();
      const start = window.__poko.getSimulatedSeconds();
      while (window.__poko.getSimulatedSeconds() - start < 20) {
        const g = window.__poko
          .getFish()
          .find((f) => f.variant === 'gold' && (f.state === 'rising' || f.state === 'up'));
        if (g) return window.__poko.getSimulatedSeconds() - start;
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return -1;
    });
    expect(sec, 'きんいろが出てこない').toBeGreaterThan(0);
    expect(sec, `実測 ${sec.toFixed(2)}秒`).toBeLessThanOrEqual(3);
  });

  test('おとなの画面のボタンは、下の遊びにタップを通さない', async ({ page }) => {
    // 通すと、閉じた直後に水たまりが反応する（押していないのに叩けたことになる）
    await boot(page);
    await page.evaluate(() => window.__poko.openParentPanel());
    const before = await page.evaluate(() => window.__poko.getTapCount());
    await page.getByRole('button', { name: 'とじる' }).click();
    expect(await page.evaluate(() => window.__poko.getTapCount())).toBe(before);
  });
});

test.describe('Phase 7 の仕上げ（おと / さいしょから）', () => {
  test('おとなの画面で「なし」を選ぶと音が止まり、「ふつう」で戻る', async ({ page }) => {
    // **子どもの手が届くところに音量を置かない**（不変条件5）。
    // ゲートの奥（2秒長押し＋3択）にだけ置く
    await boot(page);
    await page.evaluate(() => window.__poko.openParentPanel());
    await page.getByRole('button', { name: 'なし' }).click();
    expect((await page.evaluate(() => window.__poko.getAudio())).muted).toBe(true);

    await page.evaluate(() => window.__poko.openParentPanel());
    await page.getByRole('button', { name: 'ふつう' }).click();
    const after = await page.evaluate(() => window.__poko.getAudio());
    expect(after.muted).toBe(false);
    expect(after.volume).toBeGreaterThan(0);
  });

  test('「さいしょから」で★が 0 に戻り、最初のステージになる', async ({ page }) => {
    await boot(page);
    // **★は叩かないと増えない。** 最初に書いたときは きんいろ を出すだけで
    // 花を待ってしまい、誰も叩かないので 60秒 待って落ちた
    await page.evaluate(() => window.__poko.setStage('umi'));
    await page.waitForFunction(
      () => window.__poko.getStageId() === 'umi' && window.__poko.getHoles().length === 6
    );
    const hole = await page.evaluate(async () => {
      const start = window.__poko.getSimulatedSeconds();
      while (window.__poko.getSimulatedSeconds() - start < 30) {
        const f = window.__poko.getFish().find((f) => f.state === 'up');
        if (f) return window.__poko.getHoles()[f.holeIndex];
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      return null;
    });
    expect(hole, '魚が出てこない').not.toBeNull();
    await page.mouse.click(hole!.x, hole!.y);
    await expect.poll(() => page.evaluate(() => window.__poko.getScore().stars)).toBeGreaterThan(0);

    await page.evaluate(() => window.__poko.openParentPanel());
    await page.getByRole('button', { name: 'さいしょから' }).click();
    await expect
      .poll(() => page.evaluate(() => window.__poko.getScore()))
      .toEqual({ stars: 0, flowers: 0 });
    // **ステージの読み込みは非同期**。`getHoles().length === 6` は
    // 前のステージでも満たされるので、id が変わるところまで待つ
    await page.waitForFunction(
      () => window.__poko.getStageId() === 'ike' && window.__poko.getHoles().length === 6,
      null,
      { timeout: 30_000 }
    );
    expect(await page.evaluate(() => window.__poko.getStageId())).toBe('ike');
  });

  test('「さいしょから」のあとも、押したら反応が返る（不変条件1）', async ({ page }) => {
    // **リセットは遊びを壊さない。** 入れ替え待ちも解けていること
    await boot(page);
    await page.evaluate(() => window.__poko.openParentPanel());
    await page.getByRole('button', { name: 'さいしょから' }).click();
    await page.waitForFunction(() => window.__poko.getHoles().length === 6);
    const before = await page.evaluate(() => window.__poko.getTapCount());
    await page.mouse.click(206, 500);
    await expect.poll(() => page.evaluate(() => window.__poko.getTapCount())).toBe(before + 1);
    // 魚もまた出てくる
    await page.waitForFunction(() => window.__poko.getHittableCount() > 0, null, {
      timeout: 60_000,
    });
  });
});
