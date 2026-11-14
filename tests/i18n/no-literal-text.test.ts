import { parse } from "@babel/parser";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

// Every component and page takes its visible strings from the message files.
// `components/ui` is the shared primitive set: it has almost no text of its own,
// so only its screen-reader labels are checked, in the separate scan below.
export const CHECKED: string[] = ["app/**/*.tsx", "components/**/*.tsx"];
export const EXCLUDED: string[] = ["components/ui/**/*.tsx"];
export const PRIMITIVES: string[] = ["components/ui/**/*.tsx"];

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
  "aria-roledescription",
  "aria-description",
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

function filesMatching(include: string[], exclude: string[] = []) {
  const included = include.map(globToRegExp);
  const excluded = exclude.map(globToRegExp);
  return ["app", "components"]
    .flatMap((dir) => walk(path.join(ROOT, dir)))
    .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
    .filter((rel) => included.some((pattern) => pattern.test(rel)))
    .filter((rel) => !excluded.some((pattern) => pattern.test(rel)))
    .sort();
}

function checkedFiles() {
  return filesMatching(CHECKED, EXCLUDED);
}

function primitiveFiles() {
  return filesMatching(PRIMITIVES);
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

// The shared primitives hold almost no text, but what they do hold is read out
// by screen readers: `sr-only` text and `aria-label` literals.
export function primitiveLiteralsInSource(source: string): string[] {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const found: string[] = [];
  const report = (node: Node, text: string) =>
    found.push(`line ${node.loc?.start.line}: ${JSON.stringify(text.trim())}`);

  visit(ast.program, (node) => {
    if (node.type === "JSXAttribute") {
      const name = (node.name as { name?: string }).name;
      if (name !== "aria-label") return;
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
        if (isUserText(text)) report(literal, `aria-label=${text}`);
      }
    } else if (node.type === "JSXElement") {
      const opening = node.openingElement as { attributes: Node[] };
      const className = opening.attributes.find(
        (attribute) =>
          attribute.type === "JSXAttribute" &&
          (attribute.name as { name?: string }).name === "className",
      )?.value as Node | null | undefined;
      const classes =
        className?.type === "StringLiteral"
          ? (className.value as string).split(/\s+/)
          : [];
      if (!classes.includes("sr-only")) return;
      // Everything nested inside is hidden from sight but read out loud.
      visit(node.children, (child) => {
        if (child.type === "JSXText") {
          const text = child.value as string;
          if (isUserText(text)) report(child, text);
        } else if (child.type === "JSXExpressionContainer") {
          for (const literal of literalsIn(child.expression as Node)) {
            const text = textOf(literal);
            if (isUserText(text)) report(literal, text);
          }
        }
      });
    }
  });
  return found;
}

// People type Arabic and English into the same boxes, so a free-text field must
// pick its direction from what is typed: every `<textarea>` and `<input type="text">`
// needs a `dir`.
export function fieldsWithoutDir(source: string): string[] {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const found: string[] = [];
  visit(ast.program, (node) => {
    if (node.type !== "JSXOpeningElement") return;
    const tag = (node.name as { name?: string }).name;
    if (tag !== "textarea" && tag !== "input") return;
    const attributes = (node.attributes as Node[]).filter(
      (attribute) => attribute.type === "JSXAttribute",
    );
    const named = (name: string) =>
      attributes.find((attribute) => (attribute.name as { name?: string }).name === name);
    if (tag === "input") {
      const type = named("type")?.value as { type?: string; value?: string } | undefined;
      if (type?.type !== "StringLiteral" || type.value !== "text") return;
    }
    if (!named("dir")) found.push(`line ${node.loc?.start.line}: <${tag}> has no dir`);
  });
  return found;
}

describe("direction guard", () => {
  it("flags text fields without dir", () => {
    const found = fieldsWithoutDir(`
      export const A = () => (
        <form>
          <textarea />
          <textarea dir="auto" />
          <input type="text" />
          <input type="text" dir="auto" />
          <input type="email" />
          <input type="password" />
        </form>
      )
    `);
    expect(found).toHaveLength(2);
  });
});

describe("literal-text guard", () => {
  it("finds sr-only text and aria-label literals in primitives", () => {
    const found = primitiveLiteralsInSource(`
      export const A = () => (
        <div className="relative">
          <span className="sr-only">Close</span>
          <span className="sr-only">{"More"}</span>
          <span className="flex">Visible</span>
          <button aria-label="Next" title="Ignored" className="sr-only" />
          <i aria-label={cn("x")} />
          <header className="sr-only">
            <h2>Sidebar</h2>
          </header>
        </div>
      )
    `);
    expect(found).toHaveLength(4);
  });

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

  it("keeps the screen-reader text of components/ui in the message files", () => {
    const offenders = primitiveFiles().flatMap((file) =>
      primitiveLiteralsInSource(readFileSync(path.join(ROOT, file), "utf8")).map(
        (hit) => `${file} ${hit}`,
      ),
    );
    expect(
      offenders,
      `Move these sr-only and aria-label strings into messages/en.json and messages/ar.json:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("gives every text field a direction", () => {
    const offenders = checkedFiles().flatMap((file) =>
      fieldsWithoutDir(readFileSync(path.join(ROOT, file), "utf8")).map(
        (hit) => `${file} ${hit}`,
      ),
    );
    expect(
      offenders,
      `Add dir="auto" to these text fields (dir="ltr" for emails and other fixed Latin values):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
