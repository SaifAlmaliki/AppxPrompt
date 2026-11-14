import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");

const PHYSICAL =
  /(?<![\w-])(-?(ml|mr|pl|pr|left|right)-(?!1\/2)|text-(left|right)(?![\w-])|rounded-(l|r|tl|tr|bl|br)(?![a-z])|border-(l|r)(?![a-z])|space-x-|divide-x|float-(left|right)|origin-(top-|bottom-)?(left|right))/g;

// Allowed exceptions are `file:snippet` pairs. The snippet is removed from the
// line before scanning, so it must be the exact offending token(s).
const ALLOWED: Array<{ entry: string; reason: string }> = [];

function allow(reason: string, file: string, snippets: string[]) {
  for (const snippet of snippets) ALLOWED.push({ entry: `${file}:${snippet}`, reason });
}

allow(
  "Base UI drawer swipeDirection is physical: the translate3d transforms, swipe movement and edge anchoring all use physical x, so the matching radius, border and anchor classes stay physical too.",
  "components/ui/drawer.tsx",
  [
    "data-[swipe-direction=left]:rounded-r-xl",
    "data-[swipe-direction=left]:border-r",
    "data-[swipe-direction=right]:rounded-l-xl",
    "data-[swipe-direction=right]:border-l",
    "data-[swipe-direction=left]:after:right-full",
    "data-[swipe-direction=right]:after:left-full",
    "data-[swipe-direction=left]:left-0",
    "data-[swipe-direction=left]:origin-left",
    "data-[swipe-direction=right]:right-0",
    "data-[swipe-direction=right]:origin-right",
  ],
);

allow(
  "Sheet `side` is a physical left/right prop that drives physical translate-x slide transitions; callers pick the physical edge.",
  "components/ui/sheet.tsx",
  [
    "data-[side=left]:left-0",
    "data-[side=left]:border-r",
    "data-[side=right]:right-0",
    "data-[side=right]:border-l",
  ],
);

allow(
  "Sidebar `side` is a physical left/right prop; offcanvas offsets, rail and borders are keyed on it. The component is currently unused by the app.",
  "components/ui/sidebar.tsx",
  [
    "data-[side=left]:left-0",
    "data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]",
    "data-[side=right]:right-0",
    "data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
    "group-data-[side=left]:border-r",
    "group-data-[side=right]:border-l",
    "group-data-[side=left]:-right-4",
    "group-data-[side=right]:left-0",
    "group-data-[collapsible=offcanvas]:after:left-full",
    "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
    "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
  ],
);

allow(
  "Tooltip arrow is keyed on the physical data-side=left/right Base UI reports; it sits on the physical edge facing the anchor.",
  "components/ui/tooltip.tsx",
  ["data-[side=left]:-right-1", "data-[side=right]:-left-1"],
);

for (const file of ["components/workspace/app-frame.tsx", "components/workspace/canvas-panel.tsx"]) {
  allow(
    "Scaled preview iframe is anchored at its physical top-left corner (transform-origin must match left-0) and is not mirrored inside the LTR device frame.",
    file,
    ["left-0 origin-top-left"],
  );
}
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(full);
    return e.name.endsWith(".tsx") ? [full] : [];
  });
}

function offenders(): string[] {
  const files = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))];
  const found: string[] = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    const allowed = ALLOWED.filter((a) => a.entry.startsWith(`${rel}:`)).map((a) =>
      a.entry.slice(rel.length + 1),
    );
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        let scanned = line;
        for (const snippet of allowed) scanned = scanned.split(snippet).join(" ");
        const hits = [...scanned.matchAll(PHYSICAL)].map((m) => m[0]);
        if (hits.length) found.push(`${rel}:${i + 1}  ${[...new Set(hits)].join(", ")}`);
      });
  }
  return found;
}

describe("logical direction classes", () => {
  it("uses no physical horizontal Tailwind classes outside the ALLOWED list", () => {
    const found = offenders();
    expect(
      found,
      `Physical horizontal classes break RTL. Use logical ones (ms/me/ps/pe/start/end/text-start/rounded-s/border-s…) or add an ALLOWED entry with a reason:\n${found.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps every ALLOWED entry in use", () => {
    const stale = ALLOWED.filter(({ entry }) => {
      const i = entry.indexOf(":");
      const file = path.join(ROOT, entry.slice(0, i));
      return !readFileSync(file, "utf8").includes(entry.slice(i + 1));
    });
    expect(stale.map((s) => s.entry)).toEqual([]);
  });
});
