import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "ink-testing-library";
import { ExitCode } from "../args/types.js";
import type { CliServices } from "../services.js";

const textField = vi.hoisted(() => ({
  onSubmit: undefined as undefined | ((value: string) => void),
}));

vi.mock("./TextField.js", () => ({
  TextField({ onSubmit }: { onSubmit: (value: string) => void }) {
    textField.onSubmit = onSubmit;
    return null;
  },
}));

import { NewWizard } from "./NewWizard.js";

const target = {
  id: "openai:gpt-5.4:responses",
  provider: "openai",
  model: "gpt-5.4",
  surface: "responses",
  availability: "available" as const,
};

function waitForRender(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function waitForInput(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

async function waitForFrame(
  ui: { lastFrame: () => string | undefined },
  text: string,
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (ui.lastFrame()?.includes(text)) return;
    await waitForRender();
  }
  throw new Error(`Timed out waiting for ${JSON.stringify(text)}.`);
}

function createServices(execute: CliServices["execute"]): CliServices {
  return { listTargets: () => [target], execute };
}

function submitField(value: string): void {
  expect(textField.onSubmit).toBeTypeOf("function");
  textField.onSubmit?.(value);
}

afterEach(() => {
  textField.onSubmit = undefined;
  cleanup();
});

describe("NewWizard", () => {
  it("creates a package after brief and target selection", async () => {
    const execute = vi.fn<CliServices["execute"]>(() => Promise.resolve({
      status: "ok",
      message: "Package created.",
      data: {},
      exitCode: ExitCode.success,
    }));
    const ui = render(createElement(NewWizard, {
      services: createServices(execute),
      signal: new AbortController().signal,
      onCancel: vi.fn(),
      onBack: vi.fn(),
    }));

    submitField("Review support tickets");
    await waitForRender();
    expect(ui.lastFrame()).toContain("Select the model you will use this prompt with");

    await waitForInput();
    ui.stdin.write("\r");
    await waitForRender();
    await waitForRender();

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      name: "new",
      brief: "Review support tickets",
      targets: [target.id],
      clarifications: [],
      fast: false,
    }), expect.any(AbortSignal));
    expect(ui.lastFrame()).toContain("Package created.");
  });

  it("accepts a recommended clarification and resubmits it as an assumption", async () => {
    const execute = vi.fn<CliServices["execute"]>()
      .mockResolvedValueOnce({
        status: "needs_input",
        message: "More detail required.",
        data: {
          question: {
            field: "audience",
            question: "Who is the audience?",
            recommendedAssumption: "Internal support team",
          },
        },
        exitCode: ExitCode.usage,
      })
      .mockResolvedValueOnce({
        status: "ok",
        message: "Package created.",
        data: {},
        exitCode: ExitCode.success,
      });
    const ui = render(createElement(NewWizard, {
      services: createServices(execute),
      signal: new AbortController().signal,
      onCancel: vi.fn(),
      onBack: vi.fn(),
    }));

    submitField("Handle refunds");
    await waitForRender();
    await waitForInput();
    ui.stdin.write("\r");
    await waitForRender();
    await waitForRender();
    expect(ui.lastFrame()).toContain("Clarification needed");

    submitField(":assume");
    await waitForFrame(ui, "Package created.");

    expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({
      clarifications: [{
        field: "audience",
        answer: "Internal support team",
        assumed: true,
      }],
    }), expect.any(AbortSignal));
    expect(ui.lastFrame()).toContain("Package created.");
  });

  it("surfaces compilation failures and returns to the caller", async () => {
    const onBack = vi.fn();
    const ui = render(createElement(NewWizard, {
      services: createServices(() => Promise.reject(new Error("disk full"))),
      signal: new AbortController().signal,
      onCancel: vi.fn(),
      onBack,
    }));

    submitField("Write a guide");
    await waitForRender();
    await waitForInput();
    ui.stdin.write("\r");
    await waitForRender();
    await waitForRender();
    expect(ui.lastFrame()).toContain("Could not create the prompt package: disk full");

    await waitForInput();
    ui.stdin.write("q");
    await waitForRender();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
