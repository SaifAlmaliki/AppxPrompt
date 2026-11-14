import { describe, expect, it } from "vitest";
import {
  isLocale,
  localeDirection,
  matchLocale,
} from "@/i18n/config";

describe("matchLocale", () => {
  it("prefers Arabic when it ranks first", () => {
    expect(matchLocale("ar-SA,ar;q=0.9,en;q=0.8")).toBe("ar");
  });

  it("prefers English when it ranks first", () => {
    expect(matchLocale("en-US,en;q=0.9,ar;q=0.5")).toBe("en");
  });

  it("falls back to English for unsupported languages", () => {
    expect(matchLocale("de-DE")).toBe("en");
  });

  it("falls back to English without a header", () => {
    expect(matchLocale(null)).toBe("en");
  });

  it("is case-insensitive", () => {
    expect(matchLocale("AR")).toBe("ar");
  });
});

describe("localeDirection", () => {
  it("is rtl for Arabic and ltr for English", () => {
    expect(localeDirection("ar")).toBe("rtl");
    expect(localeDirection("en")).toBe("ltr");
  });
});

describe("isLocale", () => {
  it("rejects unsupported values", () => {
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("accepts supported locales", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ar")).toBe(true);
  });
});
