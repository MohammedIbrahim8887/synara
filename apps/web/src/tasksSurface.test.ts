import { TASKS_UNAVAILABLE_ERROR_CODE } from "@synara/contracts";
import { describe, expect, it } from "vitest";

import { isTasksRefusal, isTasksSurfaceEnabled, noteTasksRefusal } from "./tasksSurface";

describe("tasksSurface", () => {
  it("keeps Tasks disabled before and after server refusals", () => {
    expect(isTasksSurfaceEnabled()).toBe(false);

    expect(noteTasksRefusal(new Error("Socket closed"))).toBe(false);
    expect(isTasksSurfaceEnabled()).toBe(false);

    const refusal = {
      code: TASKS_UNAVAILABLE_ERROR_CODE,
      message: "Tasks is unavailable on this server.",
    };
    expect(isTasksRefusal(refusal)).toBe(true);
    expect(noteTasksRefusal(refusal)).toBe(true);
    expect(isTasksSurfaceEnabled()).toBe(false);
  });
});
