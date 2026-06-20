"use client";

import { useRouter } from "next/navigation";
import { RulesScreen } from "@/features/rules/components/rules-screen";

type RulesModalProps = {
  onClose?: () => void;
};

export function RulesModal({ onClose }: RulesModalProps) {
  const router = useRouter();
  const close = onClose ?? (() => router.back());

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[rgba(20,24,21,0.42)] px-4 py-4 backdrop-blur-[2px] sm:px-6"
      onClick={close}
    >
      <div
        className="h-[min(94vh,64rem)] w-[min(96vw,112rem)]"
        onClick={(event) => event.stopPropagation()}
      >
        <RulesScreen mode="modal" onClose={close} />
      </div>
    </div>
  );
}
