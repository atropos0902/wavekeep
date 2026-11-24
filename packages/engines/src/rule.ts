export interface Judge {
  version: number;
  /** Does this answer tell the reader to pick the brand, as opposed to only naming it? */
  recommends(answer: string, brand: string, quotes: { start: number; quote: string }[]): Promise<boolean>;
}

const FOR =
  /\b(?:recommend(?:ed)?|best|top pick|strong(?:est)? choice|great (?:choice|option)|worth applying|stands? out|first choice|go with|good place to start)\b/i;
const AGAINST =
  /\b(?:avoid|not recommended|wouldn['’]t recommend|don['’]t recommend|steer clear|weak|poor(?:ly)?|complain(?:ts?)?|worst|least)\b/i;

/**
 * A rule over the sentence around each mention. It is what the demo and the tests run on,
 * so nothing written inside an answer can talk it into a label.
 */
export const ruleJudge: Judge = {
  version: 1,
  async recommends(answer, _brand, quotes) {
    return quotes.some(({ start, quote }) => {
      const from =
        Math.max(
          ...["\n", "! ", "? "].map((s) => answer.lastIndexOf(s, start)),
          answer.slice(0, start).search(/[a-z]\. (?=[^.]*$)/) + 1,
        ) + 1;
      const ends = ["\n", "! ", "? ", ". "].map((s) => answer.indexOf(s, start + quote.length)).filter((i) => i !== -1);
      const sentence = answer.slice(from, ends.length ? Math.min(...ends) + 1 : undefined);
      return FOR.test(sentence) && !AGAINST.test(sentence);
    });
  },
};
