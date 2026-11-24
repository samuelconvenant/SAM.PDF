import winkNLP from "wink-nlp";
import model from "wink-eng-lite-web-model";
import { parseInstruction } from "./smart-commands";
import type { Instruction, Style } from "./smart-commands";

const nlp = winkNLP(model, ["sbd", "pos", "ner"]);
const tokens = (text: string) => nlp.readDoc(text).tokens();
const actions = /^(change|update|correct|fix|replace|set|rename|amend|edit|revise|modify|make|increase|enlarge|reduce|move|shift|put|fill|enter|add|remove|delete|rotate|turn|insert|place|reorder|number|bold)$/;
const assignment = /\s+(?:to|with|as|so (?:it|that it) reads?)\s*[,=:]?\s+|\s*[:=]\s*/i;
const helpers = /^(?:(?:please|also|then|and|would you mind|could you|can you|would you|will you|i want (?:you )?to|i need (?:you )?to)\b[\s,:]+)+/i;
const named = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const cardinal = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const pageHint = /\s+(?:on|of|in|from)\s+(?:(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)\s+page|page\s+(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|last))\b/i;

const fieldAliases = {
  name: ["name", "full name", "applicant name", "student name", "candidate name", "patient name", "customer name", "participant name", "legal name", "name of applicant", "name of student", "name of candidate"],
  studentId: ["matric number", "matric no", "matriculation number", "matriculation no", "matric id", "registration number", "registration no", "student id", "student number", "student identification number"],
  reference: ["reference", "reference no", "reference number", "ref", "ref no", "ref number", "reference id", "booking reference", "record number", "file reference"],
  date: ["date", "application date", "submission date", "document date", "signed date", "date signed", "issue date"],
  department: ["department", "department name", "program", "programme", "major", "course of study", "school department"],
  address: ["address", "old address", "mailing address", "street address", "postal address", "home address", "applicant address"],
  heading: ["heading", "main heading", "document heading", "title", "document title", "main title", "headline"],
} as const;
export type FieldCategory = keyof typeof fieldAliases;
export type Meaning =
  | { kind: "value"; label: string; value: string; page?: number; exact?: string }
  | { kind: "style"; label: string; style: Style; page?: number }
  | { kind: "move_text"; direction: "up" | "down" | "left" | "right" }
  | { kind: "move_photo"; position: string }
  | { kind: "command"; command: Instruction };

export function normalized(value: string) {
  return value.normalize("NFKC").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function editDistance(a: string, b: string) {
  if (a.length === b.length) {
    const start = [...a].findIndex((letter, index) => letter !== b[index]);
    if (start >= 0 && a[start] === b[start + 1] && a[start + 1] === b[start] && a.slice(start + 2) === b.slice(start + 2)) return 1;
  }
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const previous = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + Number(a[i - 1] !== b[j - 1]));
      diagonal = previous;
    }
  }
  return row[b.length];
}

export function fieldCategory(label: string): FieldCategory | undefined {
  const clean = normalized(label);
  if (!clean || clean.length > 70) return;
  for (const [key, aliases] of Object.entries(fieldAliases)) {
    if (aliases.some((alias) => alias === clean)) return key as FieldCategory;
  }
  // Only correct small differences. For example, a missing word in “date of birth” is meaningful.
  let closest: FieldCategory | undefined;
  let best = Infinity;
  for (const [key, aliases] of Object.entries(fieldAliases)) {
    for (const alias of aliases) {
      if (clean.length < 4 || Math.abs(clean.length - alias.length) > 2 || alias.split(" ").length !== clean.split(" ").length) continue;
      const distance = editDistance(clean, alias);
      const allowance = Math.max(clean.length, alias.length) > 10 ? 2 : 1;
      if (distance <= allowance && distance < best) { best = distance; closest = key as FieldCategory; }
      else if (distance === best && closest !== key) closest = undefined;
    }
  }
  return closest;
}

export function looksLikePerson(value: string) {
  const words = value.trim().split(/\s+/);
  if (words.length < 2 || words.length > 5 || !words.every((word) => /^\p{Lu}[\p{L}'’.-]{1,24}$/u.test(word))) return false;
  const titleCase = value === value.toUpperCase() ? value.toLowerCase().replace(/(^|\s)\p{L}/gu, (letter) => letter.toUpperCase()) : value;
  const tags = tokens(titleCase).out(nlp.its.pos);
  return tags.filter((tag) => tag === "PROPN").length >= Math.max(2, words.length - 1);
}

export function looksLikeDate(value: string) {
  if (/^(?:\d{1,4}[\/.-]\d{1,2}[\/.-]\d{2,4})$/.test(value.trim())) return true;
  const entities = nlp.readDoc(value).entities();
  return entities.out(nlp.its.type)[0] === "DATE" && normalized(entities.out()[0] ?? "") === normalized(value);
}

function descriptor(value: string) {
  return value.replace(/^(?:the|my|our|this|a|an|new)\s+/i, "").replace(/\s+(?:value|field|entry|box|changed|updated|corrected)$/i, "").trim();
}

function action(text: string) {
  const leading = text.trim().replace(helpers, "");
  const parts = tokens(leading);
  // wink's generic output type omits the model-specific addons parameter for its lemma mapper.
  const [lemma] = parts.out(nlp.its.lemma as unknown as (index: number) => string) as string[];
  const [word] = parts.out(nlp.its.value) as string[];
  if (!word) return null;
  if (actions.test(lemma)) return { verb: lemma, rest: leading.slice(word.length).trim() };
  // Correct a missing or mistyped character in an initial imperative.
  if (/^[a-z]{4,15}$/i.test(word)) {
    const verbs = ["change", "update", "correct", "replace", "remove", "insert", "rotate", "make"];
    const matches = verbs.filter((verb) => editDistance(verb, word.toLowerCase()) === 1);
    if (matches.length === 1) return { verb: matches[0], rest: leading.slice(word.length).trim() };
  }
  return null;
}

function clauses(input: string) {
  const out: string[] = [];
  const separators = /"[^"]*"|“[^”]*”|(?:[,;\n]|[.!?](?=\s))\s*(?:(?:and|then)\s+)?|\s+(?:and then|and also|and|then)\s+/gi;
  let start = 0;
  for (const match of input.matchAll(separators)) {
    if (/^["“]/.test(match[0])) continue;
    const next = input.slice(match.index! + match[0].length).trim();
    const joined = /^\s+(?:and|then)/i.test(match[0]);
    const target = descriptor(next.split(assignment)[0]);
    if ((!action(next) && !(assignment.test(next) && fieldCategory(target)) &&
      !(joined && /^(?:increase|reduce)\s+its\s+(?:font\s+)?size/i.test(next))) || !input.slice(start, match.index).trim()) continue;
    out.push(input.slice(start, match.index).trim());
    start = match.index! + match[0].length;
  }
  out.push(input.slice(start).trim());
  return out.filter(Boolean);
}

function extractPage(text: string, count: number) {
  const found = text.match(pageHint);
  if (!found) return { text, page: undefined };
  const word = (found[1] ?? found[2]).toLowerCase();
  const page = word === "last" ? count : /^\d/.test(word) ? Number(word) : Math.max(named.indexOf(word), cardinal.indexOf(word)) + 1;
  if (page < 1 || page > count) throw new Error(`Choose a page from 1 to ${count}.`);
  return { text: text.replace(found[0], "").trim(), page: page - 1 };
}

function cleanValue(value: string, today: string) {
  const trimmed = value.trim().replace(/^["“]([\s\S]+)["”]$/, "$1").trim();
  return /^(?:today(?:['’]s date)?|the current date)$/i.test(trimmed) ? today : trimmed;
}

export function understand(input: string, active: number, count: number, today: string): Meaning[] {
  const pieces = clauses(input);
  if (!pieces.length || pieces.length > 8) throw new Error("Describe between one and eight changes at a time.");
  return pieces.map((piece): Meaning => {
    const sentence = piece.replace(/[.!?]$/, "").trim().replace(helpers, "");
    if (/\b(?:do not|don['’]t|never|without|except|unless|if possible|if it)\b/i.test(sentence.split(assignment)[0]) ||
      /\b(?:secure(?:ly)?|redact|permanently|erase)\b/i.test(sentence.split(assignment)[0])) {
      throw new Error("This request contains a condition or asks to erase content. Give a direct edit. Visual text replacement leaves the original recoverable.");
    }
    const { text, page } = extractPage(sentence, count);
    const parsed = action(text);
    const verb = parsed?.verb;
    let rest = parsed?.rest ?? text;
    if (/^(?:increase|raise|enlarge)\s+(?:its|the)\s+(?:font\s+)?size$/i.test(text)) return { kind: "style", label: "it", style: { size: 0 }, page };
    if (verb === "move" || verb === "shift") {
      const photo = rest.match(/^(?:(?:the|my|our|this)\s+)?(?:uploaded\s+)?(?:photo(?:graph)?|picture|image)\b.*\b(top|bottom)[\s-]+(left|right|center|centre)\b/i);
      if (photo) return { kind: "move_photo", position: `${photo[1].toLowerCase()} ${photo[2].toLowerCase()}` };
      const direction = rest.match(/^(?:it|that|the (?:main )?(?:heading|title))\s+(?:slightly\s+|a little\s+)?(up|down|left|right)$/i);
      if (direction) return { kind: "move_text", direction: direction[1].toLowerCase() as "up" | "down" | "left" | "right" };
    }
    if (verb === "replace") {
      const exact = rest.match(/^["“]([^"”]+)["”]\s+with\s+(.+)$/i);
      if (exact) return { kind: "value", label: "text", exact: exact[1], value: cleanValue(exact[2], today), page };
    }
    if ((verb === "make" || verb === "bold") && /(?:\bbold(?:er)?\b|\blarger\b|\bbigger\b|\bsmaller\b)/i.test(rest + " " + verb)) {
      const label = descriptor(rest.replace(/\s+(?:a little |slightly )?(?:bolder|bold|larger|bigger|smaller)(?:\s+and\s+.*)?$/i, ""));
      return { kind: "style", label, page, style: {
        bold: /\bbold(?:er)?\b/i.test(rest) || verb === "bold" ? true : undefined,
        size: /\b(?:larger|bigger)\b/i.test(rest) ? 0 : /\bsmaller\b/i.test(rest) ? -1 : undefined,
      } };
    }
    if (verb === "fill" || verb === "put" || verb === "enter") {
      rest = rest.replace(/^in\s+/i, "");
      const reversed = rest.match(/^(.+?)\s+(?:in|into)\s+(?:the\s+)?(.+?)(?:\s+field)?$/i);
      if (reversed && !/photo|image|picture/i.test(reversed[1])) {
        return { kind: "value", label: descriptor(reversed[2]), value: cleanValue(reversed[1], today), page };
      }
    }
    const setter = /^(?:change|update|correct|fix|replace|set|rename|amend|edit|revise|modify|fill|make)$/;
    const should = rest.match(/^(.+?)\s+(?:should (?:say|read|be)|needs? to (?:say|read|be)|should be changed to)\s+(.+)$/i);
    if (should) return { kind: "value", label: descriptor(should[1]), value: cleanValue(should[2], today), page };
    const split = rest.match(assignment);
    if (split && (setter.test(verb ?? "") || (!verb && fieldCategory(descriptor(rest.slice(0, split.index)))))) {
      const label = descriptor(rest.slice(0, split.index));
      const value = cleanValue(rest.slice(split.index! + split[0].length), today).replace(/^this new\s+(?:address|value)\s*[:,]?\s*/i, "");
      if (!label || !value || /^(?:this|that|it|the new value|this new address)$/i.test(value)) throw new Error(`What new value should I use for ${label || "this field"}?`);
      // Existing color and exact point-size controls have their own grammar.
      if (!/^(?:(?:text )?colou?r|(?:font )?size) of\b/i.test(label)) return { kind: "value", label, value, page };
    }
    if (setter.test(verb ?? "") && fieldCategory(descriptor(rest))) {
      throw new Error(`What new value should I use for ${descriptor(rest)}?`);
    }
    const command = sentence.replace(/^(?:number (?:all |the )?pages)$/i, "add page numbers")
      .replace(/^turn\s+/i, "rotate ").replace(/\bpicture\b/gi, "photo");
    return { kind: "command", command: parseInstruction(command, page ?? active, count, today) };
  });
}
