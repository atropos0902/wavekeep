import { fold, foldName } from "./text.ts";

export interface BrandName {
  brand: string;
  name: string;
  /** Common words like Target need a sign that the employer is meant. */
  needsContext: boolean;
}

export interface Mention {
  brand: string;
  start: number;
  quote: string;
}

export type Detector = (text: string, names: BrandName[]) => Mention[];

const WORD = /[\p{L}\p{N}]/u;
const TLD_AFTER = /^\.(?:com|org|net|io|co|gov|edu|careers|jobs|health)(?![\p{L}\p{N}])/u;

interface Hit {
  brand: string;
  from: number;
  to: number;
  needsContext: boolean;
  name: string;
}

function scan(text: string, names: BrandName[]) {
  const folded = fold(text);
  const taken = new Uint8Array(folded.text.length);
  const hits: Hit[] = [];
  const ordered = names
    .map((n) => ({ ...n, folded: foldName(n.name) }))
    .filter((n) => n.folded.length > 0)
    .sort((a, b) => b.folded.length - a.folded.length || (a.folded < b.folded ? -1 : 1));
  for (const n of ordered) {
    let at = folded.text.indexOf(n.folded);
    while (at !== -1) {
      const to = at + n.folded.length;
      const before = folded.text[at - 1] ?? " ";
      const after = folded.text[to] ?? " ";
      const free = !taken.subarray(at, to).includes(1);
      const whole = !WORD.test(before) && !WORD.test(after) && before !== "@" && before !== "#";
      const domain = TLD_AFTER.test(folded.text.slice(to, to + 12));
      if (free && whole && !domain) {
        taken.fill(1, at, to);
        hits.push({ brand: n.brand, from: at, to, needsContext: n.needsContext, name: n.name });
      }
      at = folded.text.indexOf(n.folded, at + 1);
    }
  }
  hits.sort((a, b) => a.from - b.from);
  return { folded, hits };
}

const toMention = (text: string, folded: ReturnType<typeof fold>, h: Hit): Mention => {
  const start = folded.start[h.from]!;
  return { brand: h.brand, start, quote: text.slice(start, folded.end[h.to - 1]!) };
};

const CUE =
  /\b(?:work(?:s|ed|ing)? (?:at|for)|jobs? (?:at|with)|hir(?:es|ed|ing)|employ(?:er|ers|ee|ees|s)|pays?|careers?|staff|team members?|benefits?|recruit(?:s|ing|ers?)|inc\b|corp(?:oration)?\b|compan(?:y|ies)|offers?|nurses?|associates?|managers?|stores?)/u;
const JOIN_BEFORE = /\b(?:at|with|join|joining|including|like|and|or|than|by)\s*$/u;
const ORDINARY_BEFORE =
  /\b(?:a|an|the|your|my|our|their|his|her|its|this|that|every|each|salary|pay|hiring|on|off|city|same|main|per|next|first|second)\s*$/u;

/** A name that is also an everyday word counts only when the sentence treats it as an employer. */
function employerMeant(text: string, folded: ReturnType<typeof fold>, h: Hit): boolean {
  const quote = text.slice(folded.start[h.from]!, folded.end[h.to - 1]!);
  if (quote.replace(/[*`]/g, "") !== h.name) return false;
  const sentenceStart = Math.max(
    folded.text.lastIndexOf(". ", h.from),
    folded.text.lastIndexOf("! ", h.from),
    folded.text.lastIndexOf("? ", h.from),
  );
  const ends = [". ", "! ", "? "].map((e) => folded.text.indexOf(e, h.to)).filter((i) => i !== -1);
  const sentenceEnd = ends.length ? Math.min(...ends) : folded.text.length;
  const before = folded.text.slice(sentenceStart + 1, h.from);
  const after = folded.text.slice(h.to, sentenceEnd);
  if (ORDINARY_BEFORE.test(before)) return false;
  const rawBefore = text.slice(0, folded.start[h.from]!);
  const listLead = /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s*\**$/u.test(rawBefore);
  if (listLead) return true;
  return JOIN_BEFORE.test(before) || CUE.test(after) || CUE.test(before);
}

/** Names matched as whole words, longest first. Everyday words are counted too, which is the known weakness. */
export const detectorV1: Detector = (text, names) => {
  const { folded, hits } = scan(text, names);
  return hits.map((h) => toMention(text, folded, h));
};

/** Version 1 plus the context rule. */
export const detectorV2: Detector = (text, names) => {
  const { folded, hits } = scan(text, names);
  return hits.filter((h) => !h.needsContext || employerMeant(text, folded, h)).map((h) => toMention(text, folded, h));
};

const DETERMINER =
  /(?:^|[^\p{L}\p{N}])(?:a|an|the|your|my|our|their|his|her|its|this|that|every|each|no|any|annual|big|whole|same|next|first|second|last|new|old|real|main)\s$/u;
/** What an employer does, as the word right after its name. */
const EMPLOYER_VERB =
  /^(?:['’]s\b|\s(?:is|was|has|had|does|pays?|paid|offers?|hires|hired|gives?|lets|runs|treats|trains|promotes|employs|posts|posted|lists|listed|keeps|requires|covers|matches|matched|provides|publishes|published|recruits|rates|scores|ranks|comes|came|stands|wins|gets|tends|replies|replied|responds|responded|announced|raised|cut|closed|opened|also|still|can|will|would|does|and|or|inc|corp|llc|ltd|employees|staff|reviews|careers|jobs|workers|managers|nurses|associates)\b|\s?\(|,)/u;
const IMPERATIVE_OBJECT =
  /^\s(?:is|was)\s(?:a|an|the)\s(?:step|word|goal|day|place|way|term|kind|type|sort|distance)\b/u;

/** A capital letter in mid sentence is the sign of a name. At the start of one it says nothing. */
function namedHere(text: string, folded: ReturnType<typeof fold>, h: Hit): boolean {
  const from = folded.start[h.from]!;
  const to = folded.end[h.to - 1]!;
  if (text.slice(from, to).replace(/[*`]/g, "") !== h.name) return false;
  const before = folded.text.slice(0, h.from);
  const after = folded.text.slice(h.to);
  if (/[\p{L}\p{N}]-$/u.test(before) || /^-[\p{L}]/u.test(after)) return false;
  if (DETERMINER.test(before)) return false;
  // Followed by another capitalized word, it's the first half of some other name.
  const next = /^[*`]*\s+(\p{Lu}[\p{L}]*)/u.exec(text.slice(to));
  if (next && !/^(?:Inc|Corp|LLC|Ltd|Co|I|HR|ICU|ER|US)$/u.test(next[1]!)) return false;
  const lead = /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+[*`]*$/u.test(text.slice(0, from));
  if (lead) return !/^\s\p{Ll}/u.test(after) || EMPLOYER_VERB.test(after);
  const opens = /(?:^|[.!?:\n]["”’')\s]*|[^\p{L}\p{N}\s,;'’&)-]\s*)$/u.test(
    before.replace(/\b(?:st|dr|vs|e\.g|i\.e)\.\s$/u, "x "),
  );
  if (!opens) return true;
  return EMPLOYER_VERB.test(after) && !IMPERATIVE_OBJECT.test(after);
}

/** St. Mary's is also written St Mary's, and Nord-Ost is also written Nord Ost. */
function spellings(names: BrandName[]): BrandName[] {
  return names.flatMap((n) => {
    const forms = new Set([n.name, n.name.replace(/\.(?=\s)/g, ""), n.name.replace(/(\p{L})-(?=\p{L})/gu, "$1 ")]);
    return [...forms].map((name) => ({ ...n, name }));
  });
}

/** A short name followed by a changed ending of the long one ("Medical Centers") is somebody else. */
function otherEnding(folded: ReturnType<typeof fold>, h: Hit, names: { brand: string; folded: string }[]): boolean {
  const short = foldName(h.name);
  return names.some((n) => {
    if (n.brand !== h.brand || !n.folded.startsWith(`${short} `)) return false;
    const rest = n.folded.slice(short.length);
    return folded.text.startsWith(rest, h.to) && WORD.test(folded.text[h.to + rest.length] ?? " ");
  });
}

/** Version 3: names by capital letter, common spelling variants, changed endings. */
export const detectorV3: Detector = (text, names) => {
  const all = spellings(names);
  const { folded, hits } = scan(text, all);
  const known = all.map((n) => ({ brand: n.brand, folded: foldName(n.name) }));
  return hits
    .filter((h) => (h.needsContext ? namedHere(text, folded, h) : !otherEnding(folded, h, known)))
    .map((h) => toMention(text, folded, h));
};

/** Versions are never edited once a report was approved under them. */
export const DETECTORS: ReadonlyMap<number, Detector> = new Map([
  [1, detectorV1],
  [2, detectorV2],
  [3, detectorV3],
]);
export const CURRENT_DETECTOR = 3;
