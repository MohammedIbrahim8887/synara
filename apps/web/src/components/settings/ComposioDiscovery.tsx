import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button } from "~/components/ui/button";
import { SearchInput } from "~/components/ui/search-input";
import { Spinner } from "~/components/ui/spinner";
import { CopyTextButton } from "~/components/ui/copyTextButton";
import { useTranslation } from "~/i18n";
import { ensureNativeApi } from "~/nativeApi";
import { McpConnectorGlyph } from "./McpConnectorGlyph";

const DEVELOPERS = [
  "GitHub",
  "GitLab",
  "Bitbucket",
  "Linear",
  "Sentry",
  "Vercel",
  "Cloudflare",
  "Supabase",
] as const;

/** Live discovery is distinct from filtering the built-in MCP connector presets. */
export function ComposioDiscovery(props: { connectorId: string | null; onConnect: () => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const search = useQuery({
    queryKey: ["server", "composioDiscovery", props.connectorId, submitted],
    queryFn: () =>
      ensureNativeApi().server.searchComposioTools({
        connectorId: props.connectorId!,
        query: submitted,
      }),
    enabled: props.connectorId !== null && submitted.length > 0,
    retry: false,
    staleTime: 60_000,
    gcTime: 0,
  });
  const discover = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setQuery(value);
    setSubmitted(trimmed);
    if (!props.connectorId) props.onConnect();
    else if (trimmed === submitted) void search.refetch();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    discover(query);
  };
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-background/80 p-4"
      aria-label={t("settings:composioDiscoveryTitle")}
    >
      <div className="space-y-1">
        <h2 className="text-ui-lg font-medium">{t("settings:composioDiscoveryTitle")}</h2>
        <p className="text-ui text-muted-foreground">
          {t("settings:composioDiscoveryDescription")}
        </p>
      </div>
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <SearchInput
          nativeInput
          type="search"
          value={query}
          maxLength={1000}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t("settings:composioSearchPlaceholder")}
          placeholder={t("settings:composioSearchPlaceholder")}
        />
        <Button type="submit" disabled={!query.trim() || search.isFetching}>
          {search.isFetching ? <Spinner className="size-4" /> : null}
          {t("settings:composioSearchAction")}
        </Button>
      </form>
      {!props.connectorId ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={props.onConnect}>
            {t("settings:connectAppsAction")}
          </Button>
          <p className="text-ui-sm text-muted-foreground">{t("settings:composioSearchSignIn")}</p>
        </div>
      ) : null}
      <div className="space-y-2">
        <h3 className="text-ui font-medium">{t("settings:composioDeveloperTools")}</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DEVELOPERS.map((name) => (
            <Button
              key={name}
              variant="outline"
              className="justify-start"
              onClick={() => discover(name)}
            >
              <McpConnectorGlyph name={name} className="size-6" iconClassName="size-4" />
              {name}
            </Button>
          ))}
        </div>
      </div>
      <div aria-live="polite" aria-busy={search.isFetching} className="space-y-3">
        {search.isError ? (
          <p role="alert" className="text-ui text-destructive">
            {search.error instanceof Error
              ? search.error.message
              : t("settings:composioSearchFailed")}
          </p>
        ) : null}
        {search.data && props.connectorId ? (
          <>
            <p className="text-ui-sm text-muted-foreground">
              {t("settings:composioSearchResults", {
                query: submitted,
                count: search.data.tools.length,
              })}
            </p>
            {search.data.tools.length === 0 ? (
              <p className="text-ui">{t("settings:composioSearchEmpty")}</p>
            ) : null}
            {search.data.tools.map((tool) => (
              <div key={tool.slug} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-ui font-medium break-words">{tool.name}</h3>
                  <CopyTextButton text={tool.slug} label={t("settings:composioCopyTool")} />
                </div>
                <p className="text-ui-xs text-muted-foreground break-all">{tool.slug}</p>
                {tool.description ? (
                  <p className="mt-1 text-ui text-muted-foreground whitespace-pre-wrap">
                    {tool.description}
                  </p>
                ) : null}
              </div>
            ))}
            <p className="text-ui-sm text-muted-foreground">{t("settings:composioToolUsage")}</p>
          </>
        ) : null}
      </div>
    </section>
  );
}
