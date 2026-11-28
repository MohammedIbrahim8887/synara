import { LocalConnectionsPanel } from "./LocalConnectionsPanel";

/** Sona connections are owned locally, without the hosted account control plane. */
export function ConnectionsSettingsPanel({ active }: { active: boolean; billingEnabled: boolean }) {
  return <LocalConnectionsPanel active={active} />;
}
