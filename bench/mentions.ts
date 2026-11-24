// 300 labeled answers. The label comes from how each text was written, not from any detector.
import { type BrandName, detectorV1, detectorV2, detectorV3 } from "@wavekeep/core";
import { save } from "./save.ts";

const names: BrandName[] = [
  ...["Target", "Block", "Gap", "Summit", "Beacon"].map((name) => ({ brand: name, name, needsContext: true })),
  { brand: "Mary", name: "Saint Mary's Health", needsContext: false },
  { brand: "Mary", name: "St. Mary's", needsContext: false },
  { brand: "Lake", name: "Lakeside Medical Center", needsContext: false },
  { brand: "Lake", name: "Lakeside Medical", needsContext: false },
  { brand: "Cafe", name: "Café Lumière", needsContext: false },
  { brand: "Nord", name: "Nord-Ost Logistik", needsContext: false },
];
const employer = [
  "If you want steady hours, look at {b} first.",
  "Employees at {b} say breaks are respected.",
  "{b} pays a little more than the local average.",
  "1. **{b}**: good training, long commute.",
  "- {b} (retail, several sites)",
  "I'd put {b} ahead of the others for new graduates.",
  "Reviews of {b} mention a fair rota.",
  "She joined {b} after school and moved up twice.",
  "Large employers such as {b} publish pay ranges.",
  "{b}'s benefits start on day one.",
  "Compared with {b}, smaller firms move faster.",
  "Apply to {b} early, the list fills up.",
  "Both {b} and its rivals hire in spring.",
  "Former {b} staff are easy to find online.",
  "My pick would be {b}.",
  "You could also consider {b}, Inc. for office roles.",
];
const ordinary: Record<string, string[]> = {
  Target: [
    "Target a salary in the upper band.",
    "Your target should be a written offer.",
    "Set a target for each interview.",
    "Hitting the target matters less than the trend.",
    "Target companies that publish ranges.",
    "Target date: two weeks from now.",
    "The Target Operating Model is being revised.",
    "Aim for the target, then negotiate.",
    "Sales target pressure is common in stores.",
    "Target roles with training.",
    "A moving target makes reviews hard.",
    "Target: three applications a week.",
    "On target bonuses vary.",
    "Off-target advice is worse than none.",
  ],
  Block: [
    "Block off two hours for the form.",
    "A block of shifts is easier to swap.",
    "Block scheduling suits parents.",
    "Don't let one rejection block you.",
    "Writer's block is normal.",
    "Block B is the training wing.",
    "Ask which block you'd work in.",
    "Block your calendar for interviews.",
    "The surgery block runs late.",
    "Block leave needs notice.",
    "A road block near the site adds time.",
    "Nerve block certification helps.",
    "Block patterns: four on, four off.",
    "Block any recruiter who asks for money.",
  ],
  Gap: [
    "Gap years don't hurt.",
    "Explain the gap in one sentence.",
    "A pay gap still exists in some units.",
    "Gap insurance isn't included.",
    "Mind the gap between titles.",
    "Gap analysis is part of the job.",
    "Close the skills gap with a course.",
    "A Gap in coverage is common in August.",
    "Gap one: no mentoring.",
    "There's a gap between policy and practice.",
    "Gap filling shifts pay extra.",
    "The generation gap shows in reviews.",
    "Gap: no night differential listed.",
    "Bridge the gap with part-time work.",
  ],
  Summit: [
    "Summit season is busy for events staff.",
    "Ask about the leadership Summit in spring.",
    "Reach the summit of your pay band.",
    "Summit talks slowed hiring.",
    "The Summit Room hosts interviews.",
    "Summit: the top step of the ladder.",
    "Nurses meet at the annual Summit each year.",
    "Summit fever is real in sales.",
    "Summit day is unpaid for volunteers.",
    "Not every career has a summit.",
    "A hiring summit takes place in June.",
    "Summit attendance counts as training.",
    "Summit speakers share offers.",
    "Past the summit, growth slows.",
  ],
  Beacon: [
    "A beacon for new hires.",
    "Beacon status is given to a few schools.",
    "Look for a beacon unit with low turnover.",
    "Beacon awards recognise good ICUs.",
    "Beacon Street is where the clinic sits.",
    "She was a beacon during a hard year.",
    "Beacon schemes pay for courses.",
    "The Beacon prize went to a small team.",
    "Beacon hires, as managers call them, get mentors.",
    "Beacon: a short distance signal device.",
    "Beacon hospitals are a category, not a company.",
    "Beacon tags track equipment.",
    "Beacon programs help returners.",
    "Hope is a beacon.",
  ],
};
const plain: [string, string[]][] = [
  ["Saint Mary's Health has a strong residency.", ["Mary"]],
  ["Saint Mary’s Health has a strong residency.", ["Mary"]],
  ["SAINT MARY'S HEALTH is hiring.", ["Mary"]],
  ["**Saint Mary's Health** 🎉 is hiring.", ["Mary"]],
  ["**Saint** Mary's Health is hiring.", ["Mary"]],
  ["Try St. Mary's, then Lakeside Medical.", ["Mary", "Lake"]],
  ["St. Mary’s and Lakeside Medical Center both reply fast.", ["Mary", "Lake"]],
  ["St Mary's is close to the station.", ["Mary"]],
  ["Saint Mary's College isn't a hospital.", []],
  ["Mary's unit was well run.", []],
  ["Lakeside living is cheaper.", []],
  ["Lakeside Medical Centers of other states are unrelated.", []],
  ["Lakeside Medical Center pays weekly.", ["Lake"]],
  ["Lakeside  Medical  Center pays weekly.", ["Lake"]],
  ["Lakeside Medical\nCenter pays weekly.", ["Lake"]],
  ["See https://lakeside.example/Lakeside-Medical-Center for details.", []],
  ["[jobs](https://x.example/?q=St. Mary's)", []],
  ["Email jobs@lakesidemedical.example.", []],
  ["Cafe Lumiere trains its own baristas.", ["Cafe"]],
  ["Café Lumière trains its own baristas.", ["Cafe"]],
  ["CAFÉ LUMIÈRE trains its own baristas.", ["Cafe"]],
  ["Café Lumières is a different place.", []],
  ["Nord‑Ost Logistik runs nights.", ["Nord"]],
  ["Nord–Ost Logistik runs nights.", ["Nord"]],
  ["Nord-Ost­ Logistik runs nights.", ["Nord"]],
  ["Nord Ost Logistik runs nights.", ["Nord"]],
  ["NordOst is a street.", []],
  ["👩‍⚕️👨‍👩‍👧 St. Mary's is family friendly.", ["Mary"]],
  ["“St. Mary’s” came up most.", ["Mary"]],
  ["I'd avoid St. Mary's-style contracts.", ["Mary"]],
  ["pre-St. Mary's merger pay", ["Mary"]],
  ["No hospital stood out.", []],
  ["Lakeside Medical Center, Lakeside Medical Center, Lakeside Medical Center.", ["Lake"]],
  ["Lake side medical center", []],
  ["`Lakeside Medical Center` is in the data.", ["Lake"]],
  ["Lakeside Med. Center was renamed.", ["Lake"]],
  ["ＳＴ． ＭＡＲＹ'Ｓ is listed.", ["Mary"]],
];
const wraps = ["{t}", "Here's what I found. {t}", "{t} Check the posting first.", "Short answer 👇\n\n{t}"];
const cases: { text: string; brands: string[] }[] = [];
for (const b of Object.keys(ordinary)) {
  for (const t of employer) cases.push({ text: t.replaceAll("{b}", b), brands: [b] });
  for (const t of ordinary[b]!) cases.push({ text: t, brands: [] });
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
const v1 = score(detectorV1);
const v2 = score(detectorV2);
const { wrong: _, ...v1short } = v1;
save("mentions-tuning", {
  answers: cases.length,
  "version 1": v1short,
  "version 2": v2,
  "version 3": score(detectorV3),
});
