import type { Metadata } from "next";
import { ViewerRulesProvider } from "@/features/rules/rules-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "COREY",
  description: "COREY is a local IFC web viewer built with That Open components.",
};

export default function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  modal: React.ReactNode;
}>) {
  return (
    <html lang="en" className="min-h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <ViewerRulesProvider>
          {children}
          {modal}
        </ViewerRulesProvider>
      </body>
    </html>
  );
}
