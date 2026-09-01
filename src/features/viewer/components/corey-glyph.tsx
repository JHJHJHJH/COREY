import Image from "next/image";

export function CoreyGlyph({
  size = 18,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src="/corey-robot-builder.svg"
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      unoptimized
      className={`object-contain ${className}`}
    />
  );
}
