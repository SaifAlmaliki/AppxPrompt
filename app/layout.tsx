import "./globals.css";
import type { Metadata } from "next";
import { Geist, Tajawal } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { UpgradeDialogProvider } from "@/components/billing/upgrade-dialog";
import { DirectionProvider } from "@/components/ui/direction";
import { localeDirection } from "@/i18n/config";
import { formats } from "@/i18n/formats";
import { requestLocale } from "@/i18n/request";
import { AuthProvider } from "@/lib/auth-client";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const tajawal = Tajawal({
  subsets: ["arabic"],
  weight: ["400", "500", "700"],
  variable: "--font-tajawal",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta.home");
  return {
    title: t("title"),
    description: t("description"),
    other: {
      google: "notranslate",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await requestLocale();
  const dir = localeDirection(locale);
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      dir={dir}
      translate="no"
      className={`${geist.variable} ${tajawal.variable}`}
    >
      <body className="antialiased">
        <NextIntlClientProvider
          locale={locale}
          messages={messages}
          formats={formats}
        >
          <DirectionProvider direction={dir}>
            <AuthProvider>
              <UpgradeDialogProvider>{children}</UpgradeDialogProvider>
            </AuthProvider>
          </DirectionProvider>
        </NextIntlClientProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
