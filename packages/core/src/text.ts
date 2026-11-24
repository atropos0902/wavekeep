/**
 * Text folded for matching, with a map back to the original string.
 * Offsets everywhere are JavaScript string indexes (UTF-16 code units).
 */
export interface Folded {
  text: string;
  /** start[i] and end[i] are the original range behind folded unit i. */
  start: number[];
  end: number[];
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });
const URL_RE = /\bhttps?:\/\/[^\s<>()[\]"']+|\bwww\.[^\s<>()[\]"']+/giu;
const MASK = "";

function foldCluster(cluster: string): string {
  return cluster
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[​-‍⁠﻿­]/gu, "")
    .replace(/[‘’ʼ′]/gu, "'")
    .replace(/[‐-―−]/gu, "-")
    .replace(/[*`\s]/gu, " ")
    .toLowerCase();
}

export function fold(original: string): Folded {
  const hidden = new Uint8Array(original.length);
  for (const m of original.matchAll(URL_RE)) hidden.fill(1, m.index, m.index + m[0].length);
  let text = "";
  const start: number[] = [];
  const end: number[] = [];
  for (const { segment, index } of graphemes.segment(original)) {
    const out = hidden[index] ? MASK : foldCluster(segment);
    for (let i = 0; i < out.length; i++) {
      const ch = out[i]!;
      if (ch === " " && text.endsWith(" ")) continue;
      text += ch;
      start.push(index);
      end.push(index + segment.length);
    }
  }
  return { text, start, end };
}

export const foldName = (name: string): string => fold(name).text.trim();

/** The stored quote must still be what sits at the stored offset. */
export const quoteHolds = (text: string, start: number, quote: string): boolean =>
  text.slice(start, start + quote.length) === quote;
