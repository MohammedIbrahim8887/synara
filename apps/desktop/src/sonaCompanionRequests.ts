export function createCompanionRequestHandler(
  origin: string,
  token: string,
  isStopped: () => boolean,
  actions: {
    notify: (input: { title: string; body: string; silent: boolean }) => void;
    island: (mode: "hidden" | "compact" | "expanded", viewId: number) => void;
    ready: (viewId: number) => void;
    /** The browser-pane socket, once the owned browser host is up; null if unavailable. */
    browserPane?: () => Promise<{ url: string; token: string } | null>;
  },
) {
  let notifications: number[] = [];
  return async (request: Request): Promise<Response> => {
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      Vary: "Origin",
    };
    if (isStopped() || request.headers.get("origin") !== origin)
      return new Response(null, { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST" || request.headers.get("authorization") !== `Bearer ${token}`)
      return new Response(null, { status: 403, headers });
    try {
      const input = await request.json();
      switch (new URL(request.url).pathname) {
        case "/ready":
          if (!Number.isSafeInteger(input?.viewId))
            return new Response(null, { status: 400, headers });
          actions.ready(input.viewId);
          break;
        case "/notify": {
          if (
            typeof input?.title !== "string" ||
            !input.title.trim() ||
            input.title.length > 160 ||
            typeof input.body !== "string" ||
            input.body.length > 1000
          )
            return new Response(null, { status: 400, headers });
          const now = Date.now();
          notifications = notifications.filter((time) => now - time < 60_000);
          if (notifications.length >= 30) return new Response(null, { status: 429, headers });
          notifications.push(now);
          actions.notify({ title: input.title, body: input.body, silent: false });
          break;
        }
        case "/island":
          if (
            (input?.mode !== "hidden" && input?.mode !== "compact" && input?.mode !== "expanded") ||
            !Number.isSafeInteger(input.viewId)
          )
            return new Response(null, { status: 400, headers });
          actions.island(input.mode, input.viewId);
          break;
        case "/browser-pane": {
          const pane = actions.browserPane ? await actions.browserPane() : null;
          return Response.json(pane, { headers: { ...headers, "Cache-Control": "no-store" } });
        }
        default:
          return new Response(null, { status: 404, headers });
      }
      return new Response(null, { status: 204, headers });
    } catch {
      return new Response(null, { status: 400, headers });
    }
  };
}
