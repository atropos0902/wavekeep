// A second 300 answers with other names and other sentences, written after version 3 and scored once.
import { type BrandName, detectorV1, detectorV2, detectorV3 } from "@wavekeep/core";
import { save } from "./save.ts";

const names: BrandName[] = [
  ...["Pioneer", "Anchor", "Compass", "Element", "Harvest"].map((name) => ({ brand: name, name, needsContext: true })),
  { brand: "Brien", name: "O'Brien & Daughters", needsContext: false },
  { brand: "Welle", name: "Grüne Welle Pflege", needsContext: false },
  { brand: "Mid", name: "Mid-Town Care Co.", needsContext: false },
  { brand: "North", name: "Northgate General Hospital", needsContext: false },
  { brand: "North", name: "Northgate General", needsContext: false },
];
const meant = [
  "Most people I read about were happier at {b}.",
  "{b} has the shortest commute of the four.",
  "Night staff moved from the county site to {b} last spring.",
  "The short list: {b}, the county hospital and two agencies.",
  "{b} interviews within a week, which is rare.",
  "What sets {b} apart is the mentoring.",
  "Ask friends who worked for {b} what the rota looks like.",
  "Honestly? {b}.",
  "{b} (the one near the river) trains on site.",
  "2) {b} - better pay, worse parking",
  "I wouldn't rule out {b} either.",
  "With {b}, the first year is hard.",
  "**{b}** is the safest bet for parents.",
  "Some switched to {b}; few came back.",
  "Is {b} any good for part-timers? Mostly yes.",
  "Pay at “{b}” beats the average.",
];
const other: Record<string, string[]> = {
  Pioneer: [
    "She was a pioneer in home care.",
    "Pioneer units try new rotas first.",
    "Pioneer work rarely pays well.",
    "The Pioneer Valley has three hospitals.",
    "Pioneer is a word recruiters overuse.",
    "Be a pioneer on your ward.",
    "Pioneers get the first pick of shifts.",
    "Programs that pioneer new training help.",
    "A Pioneer spirit is mentioned in ads.",
    "Pioneer Day is a paid holiday there.",
    "Pioneer nurses wrote the guide.",
    "They pioneer new methods.",
    "Pioneer new ways to cut paperwork.",
    "Our pioneer cohort graduates soon.",
  ],
  Anchor: [
    "Anchor shifts are the ones nobody swaps.",
    "An anchor tenant draws foot traffic.",
    "Anchor your request to a published band.",
    "The anchor of the team is the charge nurse.",
    "Don't anchor on the first offer.",
    "Anchor Street has no parking.",
    "Anchor days are Tuesday and Thursday.",
    "A news anchor reported on it.",
    "Anchor: the first number anyone says.",
    "Anchor the talk in facts.",
    "Boat anchor jokes get old.",
    "Anchor institutions hire locally.",
    "Her anchor was a good mentor.",
    "Anchor points help in ratings.",
  ],
  Compass: [
    "Compass courses start in autumn.",
    "A moral compass helps.",
    "Use the pay survey as a compass.",
    "Compass Road is under repair.",
    "The compass on the app shows the site.",
    "Compass: a tool, not a map.",
    "Your compass should be patient care.",
    "Compass points to better units.",
    "Compass directions confuse new hires.",
    "Values work as a compass.",
    "Compass training teaches triage.",
    "No compass will replace a visit.",
    "Compass needles drift.",
    "Compass reading isn't required.",
  ],
  Element: [
    "Element one is pay.",
    "The human element matters.",
    "Pay is only one element.",
    "Element by element, compare the offers.",
    "Every element of the rota is fixed.",
    "Element lists help in interviews.",
    "An element of luck is involved.",
    "Element checks come before hiring.",
    "The key element is the manager.",
    "Surprise is an element of night work.",
    "Element: staffing ratio.",
    "Element scores are averaged.",
    "Out of your element? Ask for a mentor.",
    "Element counts vary.",
  ],
  Harvest: [
    "Harvest season brings farm injuries.",
    "Organ harvest teams are on call.",
    "The harvest festival closes the clinic.",
    "Harvest feedback after each shift.",
    "Harvest time means overtime.",
    "A good harvest of reviews came in.",
    "Harvest Moon is the local bar.",
    "Harvest data from job boards.",
    "The Harvest Festival is unpaid leave.",
    "Harvest workers need checkups.",
    "Nurses harvest grafts in theatre.",
    "Harvest: the yearly bonus round.",
    "Harvest leave exists in rural areas.",
    "Harvest what you learn.",
  ],
};
const plain: [string, string[]][] = [
  ["O'Brien & Daughters runs three homes.", ["Brien"]],
  ["O’Brien & Daughters runs three homes.", ["Brien"]],
  ["O'Brien &amp; Daughters runs three homes.", ["Brien"]],
  ["O'Brien and Daughters runs three homes.", ["Brien"]],
  ["Ask for Ms O'Brien at reception.", []],
  ["O'BRIEN & DAUGHTERS is hiring.", ["Brien"]],
  ["Grüne Welle Pflege zahlt pünktlich.", ["Welle"]],
  ["Grune Welle Pflege pays on time.", ["Welle"]],
  ["Grüne Welle Pflege pays on time.", ["Welle"]],
  ["Gruene Welle Pflege pays on time.", ["Welle"]],
  ["Die grüne Welle im Verkehr hilft.", []],
  ["_Grüne Welle Pflege_ is small.", ["Welle"]],
  ["Mid-Town Care Co. answers quickly.", ["Mid"]],
  ["Mid-Town Care Co answers quickly.", ["Mid"]],
  ["Mid Town Care Co. answers quickly.", ["Mid"]],
  ["Midtown Care Co. answers quickly.", ["Mid"]],
  ["Midtown is expensive.", []],
  ["I liked Mid-Town Care Co.", ["Mid"]],
  ["Northgate General Hospital and O'Brien & Daughters share a site.", ["North", "Brien"]],
  ["Northgate General is older than it looks.", ["North"]],
  ["Northgate Generals play on Sunday.", []],
  ["Northgate mall is next door.", []],
  ["Northgate General Hospital's ICU is calm.", ["North"]],
  ["(Northgate General)", ["North"]],
  ["🏥Northgate General🏥", ["North"]],
  ["NORTHGATE GENERAL HOSPITAL: open roles", ["North"]],
  ["Northgate\tGeneral", ["North"]],
  ["https://jobs.example/northgate-general-hospital", []],
  ["northgate general is how locals write it", ["North"]],
  ["The North gate, General admission.", []],
  ["No names here.", []],
];
const wraps = ["{t}", "I checked several review sites. {t}", "{t}\n\nAsk the recruiter to confirm.", "1. {t}"];
const cases: { text: string; brands: string[] }[] = [];
for (const b of Object.keys(other)) {
  for (const t of meant) cases.push({ text: t.replaceAll("{b}", b), brands: [b] });
  for (const t of other[b]!) cases.push({ text: t, brands: [] });
}
for (let i = 0; cases.length < 300; i++) {
  const [t, brands] = plain[i % plain.length]!;
  cases.push({ text: wraps[Math.floor(i / plain.length) % wraps.length]!.replace("{t}", t), brands });
}
function score(detector: typeof detectorV2) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const wrong: string[] = [];
  for (const c of cases) {
    const got = new Set(detector(c.text, names).map((m) => m.brand));
    for (const b of new Set([...got, ...c.brands])) {
      if (got.has(b) && c.brands.includes(b)) tp++;
      else {
        if (got.has(b)) fp++;
        else fn++;
        wrong.push(`${got.has(b) ? "wrongly found" : "missed"} ${b}: ${c.text}`);
      }
    }
  }
  return { precision: tp / (tp + fp), recall: tp / (tp + fn), tp, fp, fn, wrong };
}
const short = (d: typeof detectorV2) => {
  const { wrong: _, ...rest } = score(d);
  return rest;
};
save("mentions-heldout", {
  answers: cases.length,
  "version 1": short(detectorV1),
  "version 2": short(detectorV2),
  "version 3": score(detectorV3),
});
