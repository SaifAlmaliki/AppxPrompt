import type { Formats } from "next-intl";

export const formats = {
  number: {
    integer: { maximumFractionDigits: 0, numberingSystem: "latn" },
    decimal: { maximumFractionDigits: 2, numberingSystem: "latn" },
  },
  dateTime: {
    short: { dateStyle: "medium", numberingSystem: "latn" },
    long: { dateStyle: "long", timeStyle: "short", numberingSystem: "latn" },
    monthDayYear: { year: "numeric", month: "long", day: "numeric", numberingSystem: "latn" },
    monthDay: { month: "long", day: "numeric", numberingSystem: "latn" },
    monthDayShort: { month: "short", day: "numeric", numberingSystem: "latn" },
  },
} satisfies Formats;
