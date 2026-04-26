import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MENDAN AIロープレ",
  description: "MENDAN AIロープレ",
  icons: {
    icon: "/mendan-favicon.png",
    apple: "/mendan-favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
