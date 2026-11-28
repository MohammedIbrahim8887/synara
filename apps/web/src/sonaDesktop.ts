import { useSyncExternalStore } from "react";
import type { SonaDesktop } from "@synara/contracts/sonaDesktop";

declare global {
  interface Window {
    sonaDesktop?: SonaDesktop;
  }
}
const subscribe = (notify: () => void) => {
  window.addEventListener("sona-desktop-ready", notify);
  return () => window.removeEventListener("sona-desktop-ready", notify);
};
export function useSonaDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => window.sonaDesktop,
    () => undefined,
  );
}
