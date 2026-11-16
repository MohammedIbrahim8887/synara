import "../index.css";
import { expect, it, vi, afterEach } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { SonaIsland } from "./SonaIsland";
const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  threads: [
    {
      id: "running",
      title: "Build Android",
      session: { status: "running" },
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    },
    {
      id: "question",
      title: "Choose a branch",
      session: { status: "idle" },
      hasPendingUserInput: true,
    },
    { id: "finished", title: "Old work", session: { status: "idle" } },
  ],
}));
vi.mock("../store", () => ({ useStore: () => state.threads }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => state.navigate,
  useParams: () => ({}),
}));
afterEach(() => {
  delete window.sonaDesktop;
});
function installDesktop(island: "compact" | "expanded") {
  const setIsland = vi.fn(async () => {});
  window.sonaDesktop = { island, setIsland, notify: vi.fn() };
  return setIsland;
}
it("shows the pill in the notch while work runs and asks for the panel on click", async () => {
  await page.viewport(340, 33);
  const setIsland = installDesktop("compact");
  const screen = await render(
    <SonaIsland>
      <div>Existing chat</div>
    </SonaIsland>,
  );
  try {
    await expect.poll(() => setIsland.mock.lastCall).toEqual(["compact"]);
    await page.getByRole("button", { name: "2 running sessions" }).click();
    expect(setIsland).toHaveBeenLastCalledWith("expanded");
  } finally {
    await screen.unmount();
  }
});
it("lists live sessions in the panel, opens one, and collapses back", async () => {
  await page.viewport(560, 680);
  const setIsland = installDesktop("expanded");
  const screen = await render(
    <SonaIsland>
      <div>Existing chat</div>
    </SonaIsland>,
  );
  try {
    await expect.element(page.getByRole("button", { name: "Build Android Working" })).toBeVisible();
    await expect.element(page.getByText("Old work")).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Choose a branch Needs your answer" }).click();
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/$threadId",
      params: { threadId: "question" },
    });
    expect(setIsland).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Collapse island" }).click();
    expect(setIsland).toHaveBeenLastCalledWith("compact");
  } finally {
    await screen.unmount();
  }
});
it("stays hidden when nothing is running", async () => {
  const saved = state.threads;
  state.threads = [{ id: "finished", title: "Old work", session: { status: "idle" } }] as never;
  const setIsland = installDesktop("compact");
  const screen = await render(
    <SonaIsland>
      <div />
    </SonaIsland>,
  );
  try {
    await expect.poll(() => setIsland.mock.lastCall).toEqual(["hidden"]);
  } finally {
    state.threads = saved;
    await screen.unmount();
  }
});
