import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "~/i18n";
import { useEffect, useState } from "react";
import type { LocalConnectionStatus, LocalDeviceInvitation } from "@synara/contracts";
import { resolveWsHttpUrl } from "~/lib/wsHttpUrl";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { SettingsListRow, SettingsSection } from "./SettingsPanelPrimitives";
import { PairingQrCode } from "./PairingQrCode";

async function request<T>(route: string, body?: object): Promise<T> {
  const response = await fetch(resolveWsHttpUrl(route), {
    credentials: "include",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Connection request failed. Try again.");
  return payload as T;
}
const statusKey = ["sona-local-connections"];
export function LocalConnectionsPanel({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [invitation, setInvitation] = useState<LocalDeviceInvitation | null>(null);
  const [expired, setExpired] = useState(false);
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () => request<LocalConnectionStatus>("/api/local-connections/status"),
    enabled: active,
    retry: false,
  });
  const devices = useQuery({
    queryKey: [...statusKey, "devices"],
    queryFn: () =>
      request<
        Array<{
          sessionId: string;
          client: { label?: string; deviceType: string };
          current: boolean;
        }>
      >("/api/auth/clients"),
    enabled: active && status.isSuccess,
    refetchInterval: active ? 5000 : false,
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      request<LocalConnectionStatus>(
        `/api/local-connections/${enabled ? "enable" : "disable"}`,
        {},
      ),
    onSuccess: (data) => {
      setInvitation(null);
      queryClient.setQueryData(statusKey, data);
    },
  });
  const invite = useMutation({
    mutationFn: () => request<LocalDeviceInvitation>("/api/local-connections/invite", {}),
    onSuccess: (data) => {
      setInvitation(data);
      setExpired(false);
    },
  });
  const revoke = useMutation({
    mutationFn: (sessionId: string) => request("/api/auth/clients/revoke", { sessionId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...statusKey, "devices"] }),
  });
  useEffect(() => {
    if (!invitation) return;
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, Date.parse(invitation.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [invitation]);
  if (!active) return null;
  const error = status.error ?? toggle.error ?? invite.error ?? revoke.error ?? devices.error;
  return (
    <div className="space-y-6">
      <SettingsSection title={t("settings:localConnectionsTitle")}>
        <SettingsListRow
          title={t("settings:localConnectionsAllow")}
          description={t("settings:localConnectionsDescription")}
          actions={
            <Switch
              checked={status.data?.enabled ?? false}
              disabled={status.isPending || status.isError || toggle.isPending}
              onCheckedChange={(checked) => toggle.mutate(Boolean(checked))}
              aria-label={t("settings:localConnectionsSwitch")}
            />
          }
        />
        {error && (
          <p role="alert" className="px-4 py-3 text-ui text-destructive">
            {error.message}
          </p>
        )}
        {status.data?.enabled && (
          <div className="space-y-4 px-4 py-4">
            <p className="text-ui text-muted-foreground">
              {t("settings:localConnectionsInstructions")}
            </p>
            {invitation && !expired ? (
              <PairingQrCode
                pixelSize={256}
                value={JSON.stringify(invitation)}
                label={t("settings:localConnectionsScan")}
              />
            ) : null}
            {expired && (
              <p className="text-ui text-muted-foreground">
                {t("settings:localConnectionsExpired")}
              </p>
            )}
            <Button disabled={invite.isPending} onClick={() => invite.mutate()}>
              {invite.isPending
                ? t("settings:localConnectionsCreating")
                : invitation
                  ? t("settings:localConnectionsNewCode")
                  : t("settings:localConnectionsCreateCode")}
            </Button>
          </div>
        )}
      </SettingsSection>
      {status.isSuccess && (
        <SettingsSection title={t("settings:localConnectionsDevices")}>
          {(devices.data ?? [])
            .filter((device) => !device.current)
            .map((device) => (
              <SettingsListRow
                key={device.sessionId}
                title={device.client.label ?? t("settings:localConnectionsDevice")}
                description={device.client.deviceType}
                actions={
                  <Button
                    size="xs"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(device.sessionId)}
                  >
                    {t("settings:localConnectionsRevoke")}
                  </Button>
                }
              />
            ))}
          {!devices.isPending &&
            !devices.isError &&
            !(devices.data ?? []).some((device) => !device.current) && (
              <p className="px-4 py-3 text-ui text-muted-foreground">
                {t("settings:localConnectionsEmpty")}
              </p>
            )}
        </SettingsSection>
      )}
    </div>
  );
}
