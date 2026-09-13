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
  },
  {
    id: 'koi',
    label: 'こい',
    color: 0xf2f0e6,
    accent: 0xd8452f,
    // きんぎょ（0.85）と 0.35 離す。細長く、ひれは小さい
    bodyHeight: 0.5,
    bodyWidth: 0.26,
    tail: 'fork',
    fins: 'small',
    pattern: 'spot',
    squashStyle: 'wide',
    cutoutUrl: null,
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
  },
  {
    id: 'fugu',
    label: 'ふぐ',
    color: 0xcfc08a,
    accent: 0x4a4030,
    // まん丸。**叩くと膨らんでから沈む**（§6-2。潰れの 0.12秒には足さず、
    // そのあとの 0.33秒で見せる ——「出かたの癖は出たあとに見せる」と同じ話）
    bodyHeight: 0.95,
    bodyWidth: 0.45,
    tail: 'round',
    fins: 'small',
    pattern: 'spot',
    squashStyle: 'spin',
    cutoutUrl: null,
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
  },
];

export function findFish(id: string): FishConfig | null {
  return FISH.find((f) => f.id === id) ?? null;
}
