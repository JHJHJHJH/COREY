import { RulesScreen } from "@/features/rules/components/rules-screen";

export default function ClausePage() {
  return (
    <main className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.55),transparent_24%),linear-gradient(180deg,#efe5d6_0%,#e1d2bc_100%)] px-4 py-4 sm:px-6 sm:py-6">
      <RulesScreen mode="page" />
    </main>
  );
}
