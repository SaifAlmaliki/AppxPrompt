import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  matchLocale,
  type Locale,
} from "./config";
import { formats } from "./formats";

export async function requestLocale(): Promise<Locale> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(stored)) return stored;

  const acceptLanguage = (await headers()).get("accept-language");
  return acceptLanguage ? matchLocale(acceptLanguage) : DEFAULT_LOCALE;
}

/** The locale next-intl asks for, such as `getTranslations({ locale })`, or else the requester's. */
export async function resolveLocale(requested?: string): Promise<Locale> {
  return isLocale(requested) ? requested : await requestLocale();
}

export default getRequestConfig(async ({ locale }) => {
  const resolved = await resolveLocale(locale);

  return {
    locale: resolved,
    messages: (await import(`../messages/${resolved}.json`)).default,
    formats,
  };
});
