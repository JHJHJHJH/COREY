import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Image from "next/image";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <Image
            src="/corey-robot-builder.png"
            alt=""
            width={32}
            height={32}
            aria-hidden="true"
            className="h-8 w-8 shrink-0"
          />
          <span className="mt-1 text-lg font-extrabold tracking-tight text-[color:var(--viewer-brand)] text-shadow-sm sm:text-xl">
            COREY
          </span>
        </>
      ),
      url: "/docs",
    },
    githubUrl: "https://github.com/JHJHJHJH/bca-ifc",
    themeSwitch: {
      enabled: false,
    },
    links: [
      {
        text: "Viewer",
        url: "/",
      },
      {
        text: "Clauses",
        url: "/rules",
      },
    ],
  };
}
