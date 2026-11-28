import { cn } from "~/lib/utils";

export function OnboardingAsciiBackdrop(props: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden select-none",
        props.className,
      )}
    >
      <img
        src="/branding/sona-welcome-pixel.png"
        width={1672}
        height={941}
        alt=""
        decoding="async"
        draggable={false}
        className="absolute inset-0 size-full object-cover object-bottom opacity-25 [mask-image:linear-gradient(to_bottom,transparent_10%,#000_65%)] dark:opacity-55"
      />
    </div>
  );
}
