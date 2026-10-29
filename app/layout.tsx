import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Noto_Sans_Mono } from "next/font/google";
import { PwaRegistration } from "@/components/PwaRegistration";
import { DesktopNativeBridge } from "@/components/DesktopNativeBridge";
import { DesktopMenus } from "@/components/DesktopMenus";
import { ThemeAwareFavicon } from "@/components/ThemeAwareFavicon";
import "katex/dist/katex.min.css";
import "./globals.css";
import { I18nProvider } from "@/hooks/useI18n";
import { NotificationProvider } from "@/components/Notifications";
import { FontSizePreference } from "@/components/FontSizePreference";
import { FONT_SIZE_BOOTSTRAP_SCRIPT } from "@/lib/font-size-preference";

const notoSansMono = Noto_Sans_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-noto-mono",
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Eureka",
  description: "Eureka interface for the pi coding agent",
  applicationName: "Eureka",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icons/logo-black-transparent.png",
        type: "image/png",
      },
    ],
    apple: [
      {
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Eureka",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F7F5" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a1a" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" translate="no" className={`${notoSansMono.variable} ${jetBrainsMono.variable} notranslate`} suppressHydrationWarning>
      <head>
        <meta name="google" content="notranslate" />
        <script dangerouslySetInnerHTML={{ __html: FONT_SIZE_BOOTSTRAP_SCRIPT }} />
        <script
          dangerouslySetInnerHTML={{
            __html: "if(window.__EUREKA_NATIVE_TITLEBAR__){document.documentElement.classList.add('eureka-desktop','eureka-native-titlebar');}",
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("pi-theme");var dark=t==="dark"||((t==null||t===""||t==="auto")&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark)document.documentElement.classList.add("dark")}catch(e){}})();`,
          }}
        />
      </head>
      <body translate="no" className="notranslate" suppressHydrationWarning>
        <FontSizePreference />
        <ThemeAwareFavicon />
        <DesktopNativeBridge />
        <I18nProvider><NotificationProvider><DesktopMenus /><div className="eureka-desktop-content">{children}</div></NotificationProvider></I18nProvider>
        <PwaRegistration />
      </body>
    </html>
  );
}
