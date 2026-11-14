import { parse } from "@babel/parser";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

// Files that must take every visible string from the message files. Later
// tasks append their own globs.
export const CHECKED: string[] = [
  "app/page.tsx",
  "app/auth/**/*.tsx",
  "components/home/**/*.tsx",
  "app/docs/**/*.tsx",
  "app/pricing/**/*.tsx",
  "app/billing/**/*.tsx",
  "components/billing/**/*.tsx",
];

// Words that stay in Latin script in both languages, so they may appear as
// literal text. A string passes only when nothing but these words is left.
export const BRAND_WORDS = [
  "AppxPrompt",
  "Expo Go",
  "Expo",
  "GitHub",
  "Google",
  "CloudHike",
  "ZIP",
  "EN",
  "ع",
  ".apk",
  ".aab",
  ".ipa",
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".pdf",
];

// Attributes whose string values reach the user.
const TEXT_ATTRIBUTES = new Set([
  "placeholder",
  "title",
  "aria-label",
  "alt",
  "label",
  "description",
  "reason",
]);

const LETTER = /\p{L}/u;

function globToRegExp(glob: string) {
  const source = glob
    .split("/")
    .map((part) =>
      part === "**"
        ? "(?:.*/)?"
        : `${part.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}/`,
    )
    .join("")
    .replace(/\/$/, "");
  return new RegExp(`^${source}$`);
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : walk(full);
    }
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

function checkedFiles() {
  const patterns = CHECKED.map(globToRegExp);
  return ["app", "components"]
    .flatMap((dir) => walk(path.join(ROOT, dir)))
    .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
    .filter((rel) => patterns.some((pattern) => pattern.test(rel)))
    .sort();
}

function isOnlyBrandWords(text: string) {
  let rest = text;
  for (const word of [...BRAND_WORDS].sort((a, b) => b.length - a.length)) {
    rest = rest.split(word).join(" ");
  }
  return !LETTER.test(rest);
}

function isUserText(text: string) {
  return LETTER.test(text) && !isOnlyBrandWords(text);
}

type Node = {
  type: string;
  loc?: { start: { line: number } };
  [key: string]: unknown;
};

// The string literals an expression can evaluate to directly. It follows
// conditionals, `&&`/`||`/`??` and casts, but not calls: `cn("flex")` is not text.
function literalsIn(node: Node | null | undefined): Node[] {
  if (!node) return [];
  switch (node.type) {
    case "StringLiteral":
      return [node];
    case "TemplateLiteral":
      return [node];
    case "ConditionalExpression":
      return [
        ...literalsIn(node.consequent as Node),
        ...literalsIn(node.alternate as Node),
      ];
    case "LogicalExpression":
      return [
        ...literalsIn(node.left as Node),
        ...literalsIn(node.right as Node),
      ];
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
      return literalsIn(node.expression as Node);
    default:
      return [];
  }
}

function textOf(node: Node) {
  if (node.type === "StringLiteral") return node.value as string;
  return (node.quasis as Array<{ value: { cooked: string | null } }>)
    .map((quasi) => quasi.value.cooked ?? "")
    .join(" ");
}

function visit(node: unknown, onNode: (node: Node) => void) {
  if (Array.isArray(node)) {
    for (const child of node) visit(child, onNode);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const current = node as Node;
  if (typeof current.type === "string") onNode(current);
  for (const [key, value] of Object.entries(current)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments") {
      continue;
    }
    visit(value, onNode);
  }
}

export function literalsInSource(source: string): string[] {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const found: string[] = [];
  const report = (node: Node, text: string) =>
    found.push(`line ${node.loc?.start.line}: ${JSON.stringify(text.trim())}`);

  visit(ast.program, (node) => {
    if (node.type === "JSXText") {
      const text = node.value as string;
      if (isUserText(text)) report(node, text);
    } else if (node.type === "JSXElement" || node.type === "JSXFragment") {
      // `{"text"}` and `{cond ? "a" : "b"}` between tags. Expressions in
      // attribute values are checked below, and only for the text attributes.
      for (const child of node.children as Node[]) {
        if (child.type !== "JSXExpressionContainer") continue;
        for (const literal of literalsIn(child.expression as Node)) {
          const text = textOf(literal);
          if (isUserText(text)) report(literal, text);
        }
      }
    } else if (node.type === "JSXAttribute") {
      const name = (node.name as { name?: string }).name;
      if (!name || !TEXT_ATTRIBUTES.has(name)) return;
      const value = node.value as Node | null;
      if (!value) return;
      const literals =
        value.type === "StringLiteral"
          ? [value]
          : value.type === "JSXExpressionContainer"
            ? literalsIn(value.expression as Node)
            : [];
      for (const literal of literals) {
        const text = textOf(literal);
        if (isUserText(text)) report(literal, `${name}=${text}`);
      }
    }
  });
  return found;
}

describe("literal-text guard", () => {
  it("finds literals in JSX text, attributes and branches", () => {
    const found = literalsInSource(`
      export const A = () => (
        <div title="Hello" aria-label={ok ? "Yes" : \`No\`}>
          Plain words
          {"Quoted"}
          <span className="flex">AppxPrompt</span>
          <b>{count} · ع</b>
          {cn("not text")}
        </div>
      )
    `);
    expect(found).toHaveLength(5);
  });

  it("allows brand words, extensions and non-text", () => {
    const found = literalsInSource(`
      export const A = () => (
        <div title="AppxPrompt" label="GitHub">
          Expo Go · .apk
          <input placeholder="••••••••" className="px-2" />
          <i>{" "}</i>
        </div>
      )
    `);
    expect(found).toEqual([]);
  });

  it("matches the checked globs against real files", () => {
    const files = checkedFiles();
    expect(files).toContain("app/page.tsx");
    expect(files).toContain("app/auth/callback/page.tsx");
    expect(files).toContain("components/home/site-header.tsx");
  });
});

describe("no literal user-facing text", () => {
  it("keeps every visible string in the message files", () => {
    const offenders = checkedFiles().flatMap((file) =>
      literalsInSource(readFileSync(path.join(ROOT, file), "utf8")).map(
        (hit) => `${file} ${hit}`,
      ),
    );
    expect(
      offenders,
      `Move these into messages/en.json and messages/ar.json (getTranslations on the server, useTranslations in client components):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
