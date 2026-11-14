import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { MotionProvider } from "@/components/motion-provider";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"], display: "swap" });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], display: "swap" });
const brand = localFont({ src: "../public/fonts/Manrope-Variable.ttf", variable: "--font-brand", weight: "200 800", display: "swap" });
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
});

const description =
  "Metabolic AI is an AI service that runs itself as a business: it earns from every request, pays for its own models from a NEAR treasury, and changes which model it uses when money gets tight. Every decision is logged, explained and committed on chain.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_WEB_URL || "http://localhost:3000"),
  title: "Metabolic AI — intelligence that earns, adapts, survives",
  description,
  openGraph: { title: "Metabolic AI", description, siteName: "Metabolic AI", type: "website", locale: "en_US" },
  twitter: { card: "summary", title: "Metabolic AI", description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geist.variable} ${geistMono.variable} ${newsreader.variable} ${brand.variable}`}
    >
      <body className="min-h-screen antialiased selection:bg-g-200 selection:text-g-900">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
