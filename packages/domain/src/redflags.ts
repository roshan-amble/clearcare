/**
 * Red flags: a safety net in code, not a diagnosis. It reads what a person typed and finds signs that need a call to
 * 911 or a call to the doctor today. The AI must rate urgency at least this high (D3 in docs/design.md), and the page
 * shows the advice before any model has answered. It looks only for well-known warning signs; a clean result never
 * means "safe".
 */

export type FlagLevel = "EMERGENCY" | "TODAY";

export interface RedFlagHit {
  readonly id: string;
  readonly level: FlagLevel;
  readonly label: string;
  readonly advice: string;
  /** The words that matched. */
  readonly matched: readonly string[];
}

export interface RedFlagResult {
  readonly level: FlagLevel | null;
  readonly hits: readonly RedFlagHit[];
}

export interface RedFlagContext {
  /** Names of her active medications, to know whether she takes a blood thinner. */
  readonly activeMedicationNames?: readonly string[];
}

const SIGNALS = {
  chestPain: [
    /chest\s+(pain|pressure|tightness|discomfort|heaviness|hurts?|hurting|aches?|aching|is\s+(tight|heavy|hurting|sore)|feels?\s+(tight|heavy))/,
    /(pain|pressure|tightness|discomfort|heaviness|squeezing|ache)\s+(in|on|across|around)\s+(her\s+|the\s+|my\s+|his\s+)?chest/,
  ],
  armPain: [
    /(arm|shoulder|jaw)s?\s+(pain|hurts?|hurting|aches?|aching|soreness|discomfort|is\s+sore|is\s+painful)/,
    /(arm|shoulder|jaw)s?\s+(has|have)\s+been\s+(hurting|aching|sore|painful)/,
    /(arm|shoulder|jaw)s?\s+(is|are|was|were|keeps?)\s+(hurting|aching|sore|painful)/,
    /(pain|ache|aching|soreness|discomfort)\s+(in|on|down)\s+(her\s+|the\s+|my\s+|his\s+|both\s+)?(left\s+|right\s+)?(arm|shoulder|jaw)/,
    /sore\s+(left\s+|right\s+)?(arm|shoulder|jaw)/,
  ],
  limbWeak: [
    /(arm|leg|hand)s?\s+(is\s+|feels?\s+|went\s+|seems?\s+|got\s+)?(weak|numb|limp|dead)\b/,
    /(weakness|numbness)\s+(in|of|on)\s+(her\s+|his\s+|the\s+|my\s+|one\s+)?(left\s+|right\s+)?(arm|leg|hand|face|side)/,
    /can'?t\s+(lift|raise|move|grip\s+with)\s+(her|his|my|the)\s+(left\s+|right\s+)?(arm|leg|hand)/,
    /(one|left|right)\s+side(\s+of\s+(her|his|the)\s+(body|face))?\s+(is\s+|feels?\s+|went\s+)?(weak|numb|drooping)/,
  ],
  faceDroop: [
    /face\s+(is\s+|looks\s+|seems\s+)?(droop|drooping|droopy|uneven|lopsided)/,
    /droop(ing|y)?\s+(face|mouth|smile)/,
    /(mouth|smile)\s+(droops|drooped|is\s+crooked|looks\s+crooked)/,
    /uneven\s+smile/,
  ],
  speech: [
    /slurr?(ed|ing)\s+(speech|words|her\s+words|his\s+words)?/,
    /speech\s+(is\s+|was\s+|sounds\s+)?(slurred|garbled)/,
    /trouble\s+(speaking|talking|finding\s+words)/,
    /can'?t\s+(speak|talk)\b/,
    /\bgarbled\b/,
  ],
  sudden: [/\b(sudden|suddenly|all\s+of\s+a\s+sudden|out\s+of\s+nowhere|came\s+on\s+fast)\b/],
  confusion: [/\b(confused|confusion|disoriented|delirious)\b/, /doesn'?t\s+know\s+where\s+she\s+is/, /not\s+making\s+sense/],
  breathSevere: [
    /can'?t\s+(catch\s+(her|his|my)\s+)?breathe?/,
    /(struggling|fighting)\s+to\s+breathe/,
    /\bgasping\b/,
    /(trouble|difficulty)\s+breathing/,
    /hard\s+(time\s+)?(to\s+)?breath(e|ing)/,
    /labou?red\s+breathing/,
    /(turning|lips\s+(are\s+|look\s+)?)blue/,
  ],
  breath: [/short(ness)?\s+of\s+breath/, /out\s+of\s+breath/, /\bbreathless\b/, /\bwinded\b/],
  faint: [/\bfaint(ed|ing)\b/, /pass(ed|es|ing)\s+out/, /\bunresponsive\b/, /lost\s+consciousness/, /\bcollapsed\b/, /blacked\s+out/, /won'?t\s+wake/],
  worstHeadache: [/worst\s+headache/, /thunderclap/, /sudden\s+(severe\s+|bad\s+|terrible\s+)?headache/, /headache\s+came\s+on\s+(suddenly|fast)/],
  seizure: [/\bseizure/, /\bconvuls/],
  bleeding: [
    /(won'?t|doesn'?t|can'?t)\s+stop\s+bleeding/,
    /bleeding\s+(heavily|a\s+lot)/,
    /(vomit(ing|ed)?|throw(ing|s)?\s+up|cough(ing|ed|s)?\s+up)\s+(up\s+)?blood/,
    /blood\s+in\s+(her\s+|his\s+)?vomit/,
  ],
  selfHarm: [/suicid/, /kill\s+(her|him|my)self/, /wants?\s+to\s+die/, /end\s+(her|his|my)\s+life/],
  allergy: [/throat\s+(is\s+)?(closing|swelling|tight)/, /swelling\s+(of|in)\s+(her\s+|his\s+|the\s+)?(face|lips|tongue|throat)/, /(lips|tongue)\s+(is\s+|are\s+)?swell/],
  sweat: [/\b(sweaty|sweating|sweats|clammy|cold\s+sweat)\b/],
  nausea: [/\b(nausea|nauseous|nauseated|queasy|throwing\s+up|vomiting|vomited)\b/],
  lightheaded: [/light-?\s?headed/, /\bdizzy\b/, /\bdizziness\b/],
  fatigue: [/\b(weak|weakness|tired|tiredness|fatigue|fatigued|exhausted|sluggish|lethargic|worn\s+out|wiped\s+out)\b/, /(no|low)\s+energy/],
  fall: [/\bfell\b(?!\s+asleep)/, /\bhad\s+a\s+fall\b/, /\bhas\s+fallen\b/, /\btripped\b/, /\bslipped\s+and\b/],
  headHit: [/(hit|bumped|banged|struck)\s+(her|his|my|the)\s+head/, /head\s+(injury|wound)/],
  fever: [/\bfever(ish)?\b/, /temp(erature)?\s+(of\s+|is\s+|was\s+)?(10[1-9]|11\d)/],
  stoolBlood: [/black\s+(tarry\s+)?stools?/, /tarry\s+stools?/, /blood\s+in\s+(her\s+|his\s+|the\s+)?(stool|urine|poop|pee)/, /bloody\s+(stool|urine)/],
  legSwelling: [/(one|left|right)\s+(leg|calf)\s+(is\s+)?(swollen|swelling)/, /swollen\s+(left|right|one)\s+(leg|calf)/, /calf\s+(pain|is\s+painful|hurts)/],
  noFluids: [/can'?t\s+keep\s+(anything|food|water|fluids|liquids)\s+down/, /(not|isn'?t|hasn'?t\s+been)\s+(eating\s+or\s+drinking|drinking)/],
} as const satisfies Record<string, readonly RegExp[]>;

type Signal = keyof typeof SIGNALS;

/** "never" is left out on purpose: "she never had chest pain like this before" means she has it now. */
const NEGATION = /^(no|not|denies|denied|without|none|isn'?t|wasn'?t|hasn'?t|doesn'?t|didn'?t|don'?t|nor)$/;

const BLOOD_THINNERS = [
  "warfarin", "coumadin", "jantoven", "apixaban", "eliquis", "rivaroxaban", "xarelto", "dabigatran", "pradaxa", "edoxaban",
  "savaysa", "enoxaparin", "lovenox", "heparin", "clopidogrel", "plavix", "prasugrel", "effient", "ticagrelor", "brilinta",
];

export function takesBloodThinner(names: readonly string[]): boolean {
  return names.some((name) => BLOOD_THINNERS.some((drug) => name.toLowerCase().includes(drug)));
}

/** Lowercases and splits into clauses, so "no chest pain, but her arm hurts" negates only the chest pain. */
function clauses(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .split(/[.!?;\n]+|,\s*but\s+|\s+but\s+|\s+however\s+/)
    .map((c) => c.trim())
    .filter((c) => c !== "");
}

/**
 * A match is negated when one of the 3 words before it is a negation ("she has no chest pain"), or when it continues
 * a short negated list joined by "or" ("no chest pain or sweating"). Anything less clear counts as present: a false
 * alarm is safer than a missed one.
 */
function negated(clause: string, index: number): boolean {
  const words = clause.slice(0, index).split(/[\s,]+/).filter((w) => w !== "");
  if (words.slice(-3).some((word) => NEGATION.test(word))) return true;
  let at = -1;
  words.forEach((word, i) => {
    if (NEGATION.test(word)) at = i;
  });
  if (at < 0) return false;
  const between = words.slice(at + 1);
  return between.length <= 8 && between.some((word) => word === "or" || word === "nor");
}

function findSignals(text: string): Map<Signal, string[]> {
  const found = new Map<Signal, string[]>();
  for (const clause of clauses(text)) {
    for (const [signal, patterns] of Object.entries(SIGNALS) as [Signal, readonly RegExp[]][]) {
      for (const pattern of patterns) {
        const global = new RegExp(pattern.source, "g");
        for (const match of clause.matchAll(global)) {
          if (negated(clause, match.index)) continue;
          found.set(signal, [...(found.get(signal) ?? []), match[0].trim()]);
        }
      }
    }
  }
  return found;
}

interface Rule {
  readonly id: string;
  readonly level: FlagLevel;
  readonly label: string;
  readonly advice: string;
  /** Each inner list is "all of"; the rule fires when every group has one present signal. */
  readonly when: readonly (readonly Signal[])[];
  readonly needsBloodThinner?: boolean;
}

const CALL_911 = "Call 911 now. Do not drive to the hospital.";

const RULES: readonly Rule[] = [
  { id: "chest-pain", level: "EMERGENCY", label: "Chest pain or pressure", advice: `${CALL_911} Chest pain or pressure can be a heart attack.`, when: [["chestPain"]] },
  {
    id: "stroke",
    level: "EMERGENCY",
    label: "Possible stroke signs: face, arm or leg weakness, or speech",
    advice: "Call 911 now and note the time the signs started. Stroke treatment works best in the first hours. Remember BE FAST: balance, eyes, face, arm, speech, time.",
    when: [["faceDroop", "speech", "limbWeak"]],
  },
  {
    id: "arm-with-cardiac-signs",
    level: "EMERGENCY",
    label: "Arm, shoulder or jaw pain with sweating, nausea, breathlessness or dizziness",
    advice: `${CALL_911} In women, a heart attack often shows up as arm, shoulder or jaw pain with these signs rather than crushing chest pain.`,
    when: [["armPain"], ["sweat", "nausea", "breath", "breathSevere", "lightheaded"]],
  },
  { id: "breathing", level: "EMERGENCY", label: "Severe trouble breathing", advice: CALL_911, when: [["breathSevere"]] },
  { id: "fainting", level: "EMERGENCY", label: "Fainting, collapse or unresponsiveness", advice: CALL_911, when: [["faint"]] },
  { id: "sudden-confusion", level: "EMERGENCY", label: "Sudden confusion", advice: `${CALL_911} Sudden confusion can be a stroke, an infection, or very low blood sugar.`, when: [["confusion"], ["sudden"]] },
  { id: "worst-headache", level: "EMERGENCY", label: "Sudden, severe headache", advice: CALL_911, when: [["worstHeadache"]] },
  { id: "seizure", level: "EMERGENCY", label: "Seizure", advice: CALL_911, when: [["seizure"]] },
  { id: "bleeding", level: "EMERGENCY", label: "Heavy bleeding, or vomiting or coughing up blood", advice: CALL_911, when: [["bleeding"]] },
  { id: "allergy", level: "EMERGENCY", label: "Swelling of the face, lips, tongue or throat", advice: `${CALL_911} This can be a severe allergic reaction.`, when: [["allergy"]] },
  {
    id: "self-harm",
    level: "EMERGENCY",
    label: "Talk of suicide or self-harm",
    advice: "Call or text 988, the Suicide and Crisis Lifeline, now, or 911 if there is danger right now. Do not stay alone.",
    when: [["selfHarm"]],
  },
  {
    id: "head-injury-blood-thinner",
    level: "EMERGENCY",
    label: "A fall with a hit to the head while on a blood thinner",
    advice: `${CALL_911} A blood thinner raises the risk of bleeding inside the head, which may not show for hours.`,
    when: [["headHit"]],
    needsBloodThinner: true,
  },
  {
    id: "arm-with-fatigue",
    level: "TODAY",
    label: "Arm, shoulder or jaw pain with unusual tiredness or weakness",
    advice:
      "Call the doctor today. In older women, heart trouble can show up as arm or jaw pain with unusual tiredness. Call 911 if chest pain, shortness of breath, sweating, nausea or dizziness join in.",
    when: [["armPain"], ["fatigue"]],
  },
  { id: "short-of-breath", level: "TODAY", label: "Shortness of breath", advice: "Call the doctor today. Call 911 if it happens at rest, gets worse, or comes with chest pain.", when: [["breath"]] },
  {
    id: "confusion",
    level: "TODAY",
    label: "New confusion",
    advice: "Call the doctor today. New confusion in an older adult can come from an infection, a medication, or blood sugar. Call 911 if it came on suddenly.",
    when: [["confusion"]],
  },
  { id: "fall", level: "TODAY", label: "A fall", advice: "Call the doctor today, especially after a hit to the head, while taking a blood thinner, or if moving hurts.", when: [["fall"]] },
  { id: "head-injury", level: "TODAY", label: "A hit to the head", advice: "Call the doctor today. Call 911 for vomiting, confusion, a bad headache, or unusual sleepiness.", when: [["headHit"]] },
  { id: "fever", level: "TODAY", label: "Fever", advice: "Call the doctor today. In older adults an infection can be serious even with a low fever.", when: [["fever"]] },
  { id: "blood-in-stool", level: "TODAY", label: "Blood in stool or urine, or black stool", advice: "Call the doctor today, sooner when taking a blood thinner or feeling faint.", when: [["stoolBlood"]] },
  { id: "leg-swelling", level: "TODAY", label: "One swollen or painful leg", advice: "Call the doctor today. One swollen, painful calf can be a blood clot. Call 911 for any shortness of breath.", when: [["legSwelling"]] },
  { id: "fluids", level: "TODAY", label: "Not keeping fluids down", advice: "Call the doctor today. Older adults dehydrate quickly.", when: [["noFluids"]] },
];

export function redFlags(text: string, context: RedFlagContext = {}): RedFlagResult {
  const signals = findSignals(text);
  const thinner = takesBloodThinner(context.activeMedicationNames ?? []);
  const hits: RedFlagHit[] = [];
  for (const rule of RULES) {
    if (rule.needsBloodThinner === true && !thinner) continue;
    const matched: string[] = [];
    let fires = true;
    for (const group of rule.when) {
      const present = group.filter((signal) => signals.has(signal));
      if (present.length === 0) {
        fires = false;
        break;
      }
      for (const signal of present) matched.push(...(signals.get(signal) ?? []));
    }
    if (fires) hits.push({ id: rule.id, level: rule.level, label: rule.label, advice: rule.advice, matched: [...new Set(matched)] });
  }
  // A combined rule already explains its parts at a higher level; keep the advice short.
  const ids = new Set(hits.map((h) => h.id));
  const kept = hits.filter((h) => {
    if (h.id === "arm-with-fatigue" && ids.has("arm-with-cardiac-signs")) return false;
    if (h.id === "confusion" && ids.has("sudden-confusion")) return false;
    if (h.id === "head-injury" && ids.has("head-injury-blood-thinner")) return false;
    return true;
  });
  const level: FlagLevel | null = kept.some((h) => h.level === "EMERGENCY") ? "EMERGENCY" : kept.length > 0 ? "TODAY" : null;
  return { level, hits: kept };
}

/** The text a check-in contributes: each symptom with its body area, and the note. */
export function checkInText(checkIn: { readonly symptoms: readonly { readonly name: string; readonly bodyArea: string }[]; readonly note: string }): string {
  return [...checkIn.symptoms.map((s) => (s.bodyArea === "" ? s.name : `${s.name} (${s.bodyArea})`)), checkIn.note].join(". ");
}
