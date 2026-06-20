import { ViewerShell } from "@/features/viewer/components/viewer-shell";

export default function Home() {
  return (
    <main className="h-[calc(100vh/0.75)] overflow-hidden">
      <ViewerShell />
    </main>
  );
}
