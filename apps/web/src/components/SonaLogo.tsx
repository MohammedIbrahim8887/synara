import type { SVGProps } from "react";

import { cn } from "~/lib/utils";

/** Preserve the shared mark's SVG sizing and accessibility contract. */
export function SynaraLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={props["aria-label"] ? undefined : true}
      {...props}
      className={cn("shrink-0", className)}
    >
      <image href="/branding/sona-logo.png" width="512" height="512" />
    </svg>
  );
}
