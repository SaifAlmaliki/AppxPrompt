import { describe, expect, it } from "vitest";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import { LocalizedError, errorText, translatorFor } from "@/lib/i18n/server";

describe("translatorFor", () => {
  it("answers in Arabic with no Latin letters", () => {
    const text = translatorFor("ar", "errors")("signInRequired");
    expect(text).toMatch(/\p{Script=Arabic}/u);
    expect(text).not.toMatch(/[A-Za-z]/);
  });

  it("answers in English word for word", () => {
    expect(translatorFor("en", "errors")("signInRequired")).toBe(
      "Please sign in to continue.",
    );
  });

  it("fills in values", () => {
    expect(
      translatorFor("en", "errors")("messageTooLong", { max: 5000 }),
    ).toBe("Keep your message under 5000 characters.");
    expect(
      translatorFor("ar", "errors")("messageTooLong", { max: 5000 }),
    ).toContain("5,000");
  });

  it("keeps the plan limit sentences the model and the person read in English", () => {
    const t = translatorFor("en", "errors");
    expect(t("screenLimit", { plan: "free", max: 3 })).toBe(
      "The Free plan allows 3 screens per project.",
    );
    expect(t("creditsShort", { needed: 5 })).toBe(
      "This needs 5 credits, and you don't have enough left.",
    );
    expect(t("pushUploading", { done: 2, total: 9 })).toBe(
      "Uploading files (2 of 9)…",
    );
  });

  it("works for any top-level namespace", () => {
    expect(translatorFor("en", "common")("credits", { count: 1 })).toBe(
      "1 credit",
    );
  });

  it("uses Arabic plural forms and Western digits", () => {
    const t = translatorFor("ar", "errors");
    expect(t("creditsShort", { needed: 2 })).toContain("رصيدان");
    expect(t("projectLimit", { max: 3 })).toContain("3 مشاريع");
  });
});

describe("LocalizedError", () => {
  it("keeps an English message and translates on demand", () => {
    const error = new LocalizedError("repoNameTaken", { name: "my-app" });
    expect(error.message).toBe(
      "You already have a repository called my-app, or GitHub doesn't accept that name. Try another.",
    );
    const text = errorText(translatorFor("ar", "errors"), error.key, error.values);
    expect(text).toMatch(/\p{Script=Arabic}/u);
    expect(text).toContain("my-app");
  });
});

describe("errors messages", () => {
  const keys = Object.keys(en.errors);

  it("exist in both languages", () => {
    expect(Object.keys(ar.errors).sort()).toEqual([...keys].sort());
  });

  it("render in both languages when given sample values", () => {
    const values = {
      max: 3,
      needed: 2,
      name: "x",
      repo: "a/b",
      branch: "main",
      detail: "d",
      status: 500,
      done: 1,
      total: 2,
      problem: "p",
      limit: "l",
      plan: "pro",
      platform: "ios",
      message: "m",
      service: "api",
      services: "api",
      state: "paused",
    };
    for (const locale of ["en", "ar"] as const) {
      const t = translatorFor(locale, "errors");
      for (const key of keys) {
        const text = errorText(t, key as keyof typeof en.errors, values);
        expect(text, `${locale}:${key}`).not.toBe(`errors.${key}`);
        expect(text, `${locale}:${key}`).toBeTruthy();
      }
    }
  });
});
