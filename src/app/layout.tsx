import type { Metadata } from "next";
import { Figtree, Sora } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "WhatsApp Chat Analyzer",
  description:
    "Upload a WhatsApp chat export and explore timelines, activity maps, word clouds, and emoji insights — privately in your browser.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${sora.variable} ${figtree.variable} h-full`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
