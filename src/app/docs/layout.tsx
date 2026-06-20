import type { ReactNode } from "react";
import { RootProvider } from "fumadocs-ui/provider/next";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/docs-layout";
import { source } from "@/lib/docs-source";

export default function DocsRootLayout({ children }: { children: ReactNode }) {
  return (
    // Cancel the global `zoom: 0.75` set on <html> so /docs renders at 100%.
    <div style={{ zoom: "calc(1 / 0.75)" }}>
      <RootProvider theme={{ enabled: false }}>
        <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
          {children}
        </DocsLayout>
      </RootProvider>
    </div>
  );
}
