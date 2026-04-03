import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BCA IFC Viewer",
  description: "A local IFC web viewer built with That Open components.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex h-full flex-col overflow-hidden">{children}</body>
    </html>
  );
}
