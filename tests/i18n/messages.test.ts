import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { formats } from "@/i18n/formats";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import { BUILT_IN_THEME_NAMES } from "@/lib/themes";

function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "object" && value !== null) {
    return Object.entries(value)
      .flatMap(([key, child]) =>
        keyPaths(child, prefix ? `${prefix}.${key}` : key),
      )
      .sort();
  }
  return [prefix];
}

function leaves(value: unknown): unknown[] {
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(leaves);
  }
  return [value];
}

describe("message files", () => {
  it("have identical key sets", () => {
    expect(keyPaths(ar)).toEqual(keyPaths(en));
  });

  it("contain only non-empty strings", () => {
    for (const file of [en, ar]) {
      for (const leaf of leaves(file)) {
        expect(typeof leaf).toBe("string");
        expect((leaf as string).length).toBeGreaterThan(0);
      }
    }
  });
});

describe("escapes", () => {
  it("have no double-encoded \\uXXXX sequences in any value", () => {
    for (const [name, file] of [["en", en], ["ar", ar]] as const) {
      const bad = leaves(file).filter(
        (leaf) => typeof leaf === "string" && /\\u[0-9a-fA-F]{4}/.test(leaf),
      );
      expect(bad, `${name}.json has literal backslash-u escapes`).toEqual([]);
    }
  });
});

describe("Arabic digits", () => {
  it("never uses a bare # plural placeholder", () => {
    const offenders = leaves(ar).filter(
      (leaf) => typeof leaf === "string" && leaf.includes("#"),
    );
    expect(
      offenders,
      "Arabic messages must not use a bare `#`: it follows the browser's ICU default numbering system. Use `{count, number, integer}` so the shared `formats` force Western digits.",
    ).toEqual([]);
  });

  it("controls digits through formats, not the ICU default", () => {
    const latn = createTranslator({ locale: "ar", messages: ar, formats });
    const arab = createTranslator({
      locale: "ar",
      messages: ar,
      formats: {
        ...formats,
        number: {
          ...formats.number,
          integer: { maximumFractionDigits: 0, numberingSystem: "arab" },
        },
      },
    });

    expect(latn("common.credits", { count: 12 })).toContain("12");
    expect(arab("common.credits", { count: 12 })).toContain("١٢");
  });
});

describe("Arabic plurals", () => {
  const t = createTranslator({ locale: "ar", messages: ar, formats });

  it.each([
    [1, "نقطة واحدة"],
    [2, "نقطتان"],
    [3, "3 نقاط"],
    [11, "11 نقطةً"],
    [100, "100 نقطة"],
  ])("count %i", (count, expected) => {
    const result = t("common.credits", { count });
    expect(result).toBe(expected);
    expect(result).not.toMatch(/[٠-٩]/);
  });
});

describe("English plurals", () => {
  const t = createTranslator({ locale: "en", messages: en, formats });

  it("formats singular and grouped plural", () => {
    expect(t("common.credits", { count: 1 })).toBe("1 credit");
    expect(t("common.credits", { count: 1000 })).toBe("1,000 credits");
  });
});

describe("built-in themes", () => {
  const ids = Object.keys(BUILT_IN_THEME_NAMES).sort();

  it("have a display name in every language", () => {
    expect(Object.keys(en.themes).sort()).toEqual(ids);
    expect(Object.keys(ar.themes).sort()).toEqual(ids);
  });

  it("are all named by the docs, which say how many there are", () => {
    expect(ids).toHaveLength(5);
    for (const id of ids) {
      expect(en.docs.themes.p1).toContain(`{${id}}`);
      expect(ar.docs.themes.p1).toContain(`{${id}}`);
    }
  });
});