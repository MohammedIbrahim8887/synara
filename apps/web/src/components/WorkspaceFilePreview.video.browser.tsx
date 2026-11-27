import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import recording from "./__fixtures__/preview.webm?url";
import { WorkspaceFilePreview } from "./WorkspaceFilePreview";
import { buildLocalImageUrl } from "~/lib/localImageUrls";

vi.mock("~/lib/localImageUrls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/localImageUrls")>()),
  buildLocalImageUrl: vi.fn(() => recording),
}));

it("opens a linked recording paused and lets the reviewer play and seek", async () => {
  const client = new QueryClient();
  const preview = (isVisible: boolean) => (
    <QueryClientProvider client={client}>
      <WorkspaceFilePreview
        workspaceRoot="/project"
        filePath="reviews/walkthrough.WEBM"
        isVisible={isVisible}
      />
    </QueryClientProvider>
  );
  const screen = await render(preview(true));
  const video = screen.container.querySelector("video")!;
  expect(buildLocalImageUrl).toHaveBeenCalledWith(
    expect.objectContaining({
      canonicalPath: "reviews/walkthrough.WEBM",
      cwd: "/project",
    }),
  );
  expect(video.controls).toBe(true);
  expect(video.paused).toBe(true);
  await vi.waitFor(() => expect(video.duration).toBeGreaterThan(1));
  await userEvent.click(video);
  await video.play();
  await vi.waitFor(() => expect(video.currentTime).toBeGreaterThan(0));
  await screen.rerender(preview(false));
  await vi.waitFor(() => expect(video.paused).toBe(true));
  await screen.rerender(preview(true));
  video.currentTime = 1;
  await vi.waitFor(() => expect(video.seeking).toBe(false));
  expect(video.currentTime).toBeCloseTo(1);
});
