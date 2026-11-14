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

export default getRequestConfig(async () => {
  const locale = await requestLocale();

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    formats,
  };
});
