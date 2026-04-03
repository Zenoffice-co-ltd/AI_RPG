import type { Metadata } from "next";
import { M_PLUS_1p } from "next/font/google";
import "./globals.css";

const mPlus = M_PLUS_1p({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "700", "800"],
  variable: "--font-mplus",
});

export const metadata: Metadata = {
  title: "Top Performer Roleplay MVP",
  description: "派遣営業トップパフォーマー基準のオーダーヒアリングAIロープレ"
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className={`${mPlus.variable} bg-app text-slate-900 antialiased`}>
        {children}
      </body>
    </html>
  );
}
