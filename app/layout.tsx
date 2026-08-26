import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { SelectSearch } from "./dashboard/select-search";
import { SidebarScript } from "./dashboard/sidebar-script";
import { RouteToasts, ToastProvider } from "./dashboard/toast";
import { ThemeProvider } from "./theme/theme-provider";
import { ThemeScript } from "./theme/theme-script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "SISPL CA Solution — Practice, in command.";
const description = "Practice command centre for Indian chartered accountants, with client health, compliance deadlines, and priority work in one secure view.";

export async function generateMetadata(): Promise<Metadata> {
  const configuredPublicUrl = process.env.SISPL_PUBLIC_URL;
  const metadataBase = configuredPublicUrl && /^https?:\/\//i.test(configuredPublicUrl)
    ? new URL(configuredPublicUrl)
    : new URL("http://localhost:3000");
  const socialImage = new URL("/og.png", metadataBase);

  return {
    metadataBase,
    title,
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      title,
      description,
      images: [{ url: socialImage, width: 1200, height: 630, alt: "SISPL CA Solution practice command centre" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><ThemeScript /><SidebarScript /></head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <ThemeProvider>
          <ToastProvider>
            {/* Reading the query string suspends; the page must not wait on a confirmation. */}
            <Suspense fallback={null}><RouteToasts /></Suspense>
            {children}
            {/* Makes every long dropdown searchable, existing and future alike. */}
            <SelectSearch />
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
