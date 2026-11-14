import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { formats } from "@/i18n/formats";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";

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

describe("Arabic plurals", () => {
  const t = createTranslator({ locale: "ar", messages: ar, formats });

  it.each([
    [1, "رصيد واحد"],
    [2, "رصيدان"],
    [3, "3 أرصدة"],
    [11, "11 رصيدًا"],
    [100, "100 رصيد"],
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
