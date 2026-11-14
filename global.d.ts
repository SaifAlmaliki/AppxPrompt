import type { Locale } from "./i18n/config";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof import("./messages/en.json");
  }
}
