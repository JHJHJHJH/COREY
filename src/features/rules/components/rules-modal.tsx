"use client";

import { useRouter } from "next/navigation";
import { RulesScreen } from "@/features/rules/components/rules-screen";

export function RulesModal() {
  const router = useRouter();

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(20,24,21,0.42)] px-4 py-4 backdrop-blur-[2px] sm:px-6"
      onClick={() => router.back()}
    >
      <div
        className="h-[min(90vh,56rem)] w-[min(80rem,100%)]"
        onClick={(event) => event.stopPropagation()}
      >
        <RulesScreen mode="modal" onClose={() => router.back()} />
      </div>
    </div>
  );
}
