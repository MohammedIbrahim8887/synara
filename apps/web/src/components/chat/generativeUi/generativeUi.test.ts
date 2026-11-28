import { describe, expect, it } from "vitest";
import { VISUALIZE_SKILL_MARKDOWN } from "@synara/shared/visualizeSkill";

import { visualFenceKind } from "../VisualFenceBlock";
import { GENERATIVE_UI_COMPONENT_NAMES } from "./catalog";
import { parseGenerativeUiSpec } from "./GenerativeUiPreview";

const exampleSpec = (skill: string) => {
  const match = skill.match(/```json-render\n([\s\S]*?)\n```/);
  if (!match?.[1]) throw new Error("skill has no json-render example");
  return match[1];
};

describe("generative UI previews", () => {
  it("documents every catalog component in the visualize skill", () => {
    for (const name of GENERATIVE_UI_COMPONENT_NAMES) {
      expect(VISUALIZE_SKILL_MARKDOWN).toContain(`\`${name}\``);
    }
  });

  it("accepts the skill's own example", () => {
    expect(parseGenerativeUiSpec(exampleSpec(VISUALIZE_SKILL_MARKDOWN)).status).toBe("ready");
  });

  it("treats partial JSON as incomplete and unknown components as invalid", () => {
    expect(parseGenerativeUiSpec('{"root": "a", "elem').status).toBe("incomplete");
    const result = parseGenerativeUiSpec(
      JSON.stringify({
        root: "a",
        elements: { a: { type: "Script", props: { src: "https://x" }, children: [] } },
      }),
    );
    expect(result.status).toBe("invalid");
  });

  it("recognizes visual fences from the raw info string", () => {
    expect(visualFenceKind("mermaid")).toBe("mermaid");
    expect(visualFenceKind("json-render")).toBe("json-render");
    expect(visualFenceKind("JSON-Render title")).toBe("json-render");
    expect(visualFenceKind("json")).toBeNull();
    expect(visualFenceKind("ts")).toBeNull();
  });
});
