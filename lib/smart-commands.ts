export const smartPdfLimit = 25 * 1024 * 1024;
export const smartPageLimit = 150;
export const smartPromptLimit = 500;

const ordinals = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const ordered = ["zero", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const pageWord = "(\\d{1,3}|first|last|one|two|three|four|five|six|seven|eight|nine|ten)";
const namedPage = `(${ordered.slice(1).join("|")}|last) page`;
const location = "(top left|top right|top cent(?:er|re)|bottom left|bottom right|bottom cent(?:er|re)|cent(?:er|re))";
const quoted = '["“]([^"”]+)["”]';
const colors = { black: "#000000", red: "#ac182d", blue: "#1b45a0", green: "#176942", purple: "#683091", gold: "#98740f" };
export type Position = { edge: "top" | "bottom" | "center"; align: "left" | "right" | "center" };
export type Style = { bold?: boolean; size?: number; color?: string; replacement?: string };
export type Instruction =
  | { kind: "remove" | "remove_blank"; page: number }
  | { kind: "rotate"; page: number; angle: 90 | -90 | 180 | 270 | -270 }
  | { kind: "reorder"; order: number[] }
  | { kind: "number"; position: Position }
  | { kind: "add"; page: number; text: string; position: Position; belowHeading?: boolean }
  | { kind: "heading"; page: number; style: Style; exact?: string }
  | { kind: "photo"; page: number; position?: Position };

export const smartExamples = [
  "Change the full name to Jordan Lee and the reference number to REF-206",
  "Make the main heading larger",
  'Add "Confidential" at the top right of page one',
  "Add today's date at the top right of page one",
  "Change the document heading to Application Letter",
  "Rotate page two counterclockwise",
  "Delete the last page",
  "Add page numbers",
  "Insert the photo into the photo box on page one",
];

function pageNumber(word: string, count: number) {
  const page = word === "last" ? count : /^\d+$/.test(word) ? Number(word) : Math.max(ordered.indexOf(word), ordinals.indexOf(word));
  if (page < 1 || page > count) throw new Error(`Choose a page from 1 to ${count}.`);
  return page - 1;
}

function position(value = "top left"): Position {
  return {
    edge: value.startsWith("top") ? "top" : value.startsWith("bottom") ? "bottom" : "center",
    align: value.endsWith("left") ? "left" : value.endsWith("right") ? "right" : "center",
  };
}

export function parseInstruction(input: string, active: number, count: number, today: string): Instruction {
  if (input.length > smartPromptLimit || !input.trim()) throw new Error("Enter one instruction of up to 500 characters.");
  const command = input.trim().replace(/\.$/, "");
  const page = (word?: string) => word ? pageNumber(word.toLowerCase(), count) : active;
  const last = count - 1;
  let match: RegExpMatchArray | null;

  match = command.match(new RegExp(`^(?:please )?(?:delete|remove) (?:the )?(?:${namedPage}|page ${pageWord})$`, "i"));
  if (match) return { kind: "remove", page: page(match[1] ?? match[2]) };
  match = command.match(new RegExp(`^(?:please )?(?:delete|remove) (?:the )?(?:extra )?blank page(?: ${pageWord})?$`, "i"));
  if (match) return { kind: "remove_blank", page: match[1] ? page(match[1]) : last };
  match = command.match(new RegExp(`^(?:please )?rotate (?:the )?(?:${namedPage}|page ${pageWord})(?: (?:by )?(90|180|270)(?: degrees?)?)?(?: (counterclockwise|anti-clockwise|clockwise|left|right))?$`, "i"));
  if (match) {
    const angle = Number(match[3] ?? 90) * (/left|counter|anti/i.test(match[4] ?? "") ? -1 : 1);
    return { kind: "rotate", page: page(match[1] ?? match[2]), angle: (angle === -180 ? 180 : angle) as 90 | -90 | 180 | 270 | -270 };
  }
  match = command.match(/^(?:please )?reorder (?:the )?pages(?: (?:to|as|in this order))?\s*:?\s*(\d{1,3}(?:\s*,\s*\d{1,3})*)$/i);
  if (match) {
    const order = match[1].split(",").map((word) => page(word.trim()));
    if (order.length !== count || new Set(order).size !== count) throw new Error("List every page exactly once, separated by commas.");
    if (order.every((index, value) => index === value)) throw new Error("Enter an order that changes the document.");
    return { kind: "reorder", order };
  }
  match = command.match(new RegExp(`^(?:please )?(?:add|insert) page numbers(?: (?:at|on) (?:the )?${location})?$`, "i"));
  if (match) return { kind: "number", position: position(match[1]?.toLowerCase() ?? "bottom center") };

  const placeText = `(?: (?:at|in|on) (?:the )?${location})?(?: (?:of|on|to) page ${pageWord})?`;
  match = command.match(new RegExp(`^(?:please )?(?:add|insert|put) (today['’]s date|the date|${quoted})${placeText}$`, "i"));
  if (match) {
    return { kind: "add", text: (match[2] ?? today).trim(), page: page(match[4]), position: position(match[3]?.toLowerCase()) };
  }

  const heading = "(?:the )?(?:document )?(?:heading|title)";
  match = command.match(new RegExp(`^(?:please )?(?:add|insert|put) ${quoted} (?:below|under) ${heading}(?: on page ${pageWord})?$`, "i"));
  if (match) return { kind: "add", text: match[1].trim(), page: page(match[2]), position: position(), belowHeading: true };
  match = command.match(new RegExp(`^(?:please )?(?:change|rename|replace) ${heading}(?: on page ${pageWord})? (?:to|with) (?:${quoted}|(.+?))(?: on page ${pageWord})?$`, "i"));
  if (match) {
    if (match[1] && match[4] && page(match[1]) !== page(match[4])) throw new Error("Name one page for the heading.");
    return { kind: "heading", page: page(match[1] ?? match[4]), style: { replacement: (match[2] ?? match[3]).trim() } };
  }
  match = command.match(new RegExp(`^(?:please )?replace ${quoted} with ${quoted}(?: on page ${pageWord})?$`, "i"));
  if (match) return { kind: "heading", page: page(match[3]), exact: match[1], style: { replacement: match[2].trim() } };
  match = command.match(new RegExp(`^(?:please )?make ${heading} bold(?: and (?:increase its font size|set (?:its )?(?:size|font size) to (\\d{1,2})(?:\s*pt)?))?(?: on page ${pageWord})?$`, "i"));
  if (match) return { kind: "heading", page: page(match[2]), style: { bold: true, size: match[1] ? Number(match[1]) : /increase its/i.test(command) ? 0 : undefined } };
  match = command.match(new RegExp(`^(?:please )?(?:change|set) (?:the )?(?:text )?colou?r of ${heading} to (#[0-9a-f]{6}|${Object.keys(colors).join("|")})(?: on page ${pageWord})?$`, "i"));
  if (match) return { kind: "heading", page: page(match[2]), style: { color: colors[match[1].toLowerCase() as keyof typeof colors] ?? match[1] } };

  match = command.match(new RegExp(`^(?:please )?(?:insert|add|place|put) (?:(?:my|the|this|an?) )?(?:uploaded )?(?:passport )?(?:photo(?:graph)?|image)(?:(?: (?:into|in) (?:the )?(?:photo (?:box|placeholder)|placeholder))|(?: (?:at|in) (?:the )?${location}(?: corner)?))?(?: (?:on|of) page ${pageWord})?$`, "i"));
  if (match) return { kind: "photo", page: page(match[2]), position: match[1] ? position(match[1].toLowerCase()) : undefined };

  throw new Error("I couldn't identify a supported edit. Describe the field and its new value, or ask to format a heading, arrange pages, or place an uploaded photo.");
}
