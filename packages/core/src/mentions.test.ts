import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type BrandName, detectorV1, detectorV2, detectorV3 } from "./mentions.ts";
import { fold, foldName, quoteHolds } from "./text.ts";
import { cleanUrl, hostBelongsTo } from "./urls.ts";

const names: BrandName[] = [
  { brand: "mary", name: "Saint Mary’s Health", needsContext: false },
  { brand: "mary", name: "St. Mary's", needsContext: false },
  { brand: "summit", name: "Summit", needsContext: true },
  { brand: "summit-care", name: "Summit Care Network", needsContext: false },
  { brand: "cafe", name: "Café Lumière", needsContext: false },
];
const found = (t: string) => detectorV2(t, names).map((m) => `${m.brand}:${m.quote}`);

describe("mentions", () => {
  it("survives emoji, markdown, curly quotes and accents, with a quote that still matches", () => {
    const t = "🎉👩‍⚕️ Try **Saint Mary's** Health, St. Mary’s, or Café Lumière.";
    const ms = detectorV2(t, names);
    expect(ms.map((m) => m.brand)).toEqual(["mary", "mary", "cafe"]);
    for (const m of ms) expect(quoteHolds(t, m.start, m.quote)).toBe(true);
    expect(t.slice(ms[1]!.start, ms[1]!.start + ms[1]!.quote.length)).toBe("St. Mary’s");
  });
  it("takes the longest name first and doesn't count its parts", () => {
    expect(found("Summit Care Network hires nurses.")).toEqual(["summit-care:Summit Care Network"]);
  });
  it("needs whole words and ignores links, handles and domains", () => {
    expect(found("Summits, summitry, see https://summit.com/at/Summit or Summit.com, @Summit #Summit")).toEqual([]);
  });
  it("counts an everyday word only when the employer is meant", () => {
    expect(found("Nurses at Summit get paid more.")).toEqual(["summit:Summit"]);
    expect(found("1. **Summit** pays well")).toEqual(["summit:Summit"]);
    expect(found("Reach the Summit of your career.")).toEqual([]);
    expect(found("The summit hires guides.")).toEqual([]);
    expect(detectorV1("Reach the Summit of your career.", names)).toHaveLength(1);
  });
  it("version 3 reads a capital in mid sentence as a name and knows common spellings", () => {
    const v3 = (t: string) => detectorV3(t, names).map((m) => m.brand);
    expect(v3("I'd put Summit first.")).toEqual(["summit"]);
    expect(v3("Summit pays well. Summit season is busy.")).toEqual(["summit"]);
    expect(v3("Ask about the Summit. A summit. Meet at Summit Hall.")).toEqual([]);
    expect(v3("- **Summit**: good\n- Summit fever")).toEqual(["summit"]);
    expect(v3("St Mary's is near. Saint Mary's Healths are not.")).toEqual(["mary"]);
    expect(v3("post-Summit, Summit-like")).toEqual([]);
  });
  it.each([
    detectorV1,
    detectorV2,
    detectorV3,
  ])("never reports an offset that doesn't hold its quote (%#)", (detector) => {
    const bits = fc.constantFrom(
      "Summit",
      " at ",
      "🎉",
      "é",
      "**",
      "St. Mary’s",
      "​",
      "ﬁ",
      " ",
      "İ",
      "https://x.y/Summit",
      "\n- ",
    );
    fc.assert(
      fc.property(fc.array(bits, { maxLength: 30 }), (parts) => {
        const t = parts.join("");
        const ms = detector(t, names);
        for (const m of ms) expect(quoteHolds(t, m.start, m.quote)).toBe(true);
        for (let i = 1; i < ms.length; i++)
          expect(ms[i]!.start).toBeGreaterThanOrEqual(ms[i - 1]!.start + ms[i - 1]!.quote.length);
      }),
    );
  });
  it("folds names the same way as text", () => {
    expect(foldName("  ÉCOLE – Nord ")).toBe("ecole - nord");
    const f = fold("a🎉b");
    expect([f.text, f.start, f.end]).toEqual(["a🎉b", [0, 1, 1, 3], [1, 3, 3, 4]]);
  });
});

describe("urls", () => {
  it("cleans tracking and keeps what identifies the page", () => {
    expect(cleanUrl("https://WWW.Example.com:443/jobs/?utm_source=openai&b=2&a=1#:~:text=hi")).toEqual({
      url: "https://example.com/jobs?a=1&b=2",
      host: "example.com",
    });
    expect(cleanUrl("http://example.com")?.url).toBe("https://example.com");
    expect(cleanUrl("http://u:p@example.com:8080/x")?.url).toBe("https://example.com:8080/x");
  });
  it("refuses anything but http and https", () => {
    for (const u of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "nope", ""])
      expect(cleanUrl(u)).toBeNull();
  });
  it("doesn't take a lookalike for the owner", () => {
    expect(hostBelongsTo("careers.example.com", "example.com")).toBe(true);
    expect(hostBelongsTo("example.com", "www.Example.com")).toBe(true);
    expect(hostBelongsTo("notexample.com", "example.com")).toBe(false);
    expect(hostBelongsTo("example.com.evil.net", "example.com")).toBe(false);
  });
});
