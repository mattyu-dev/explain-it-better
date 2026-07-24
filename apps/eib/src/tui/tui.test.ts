import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "ink-testing-library";
import { ExitCode } from "../args/types.js";
import type { CliServices } from "../services.js";
import { App } from "./App.js";
import { TextField } from "./TextField.js";

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

function createServices(
  execute: CliServices["execute"] = () => Promise.resolve({
    status: "ok",
    message: "Package created.",
    data: {},
    exitCode: ExitCode.success,
  }),
): CliServices {
  return {
    listTargets: () => [target],
    execute,
  };
}

afterEach(() => {
  cleanup();
});

describe("TextField", () => {
  it("edits text, preserves Unicode code points, and submits a trimmed value", async () => {
    const onSubmit = vi.fn();
    const ui = render(createElement(TextField, { label: "Brief:", onSubmit }));

    ui.stdin.write("hello🙂 ");
    await waitForRender();
    expect(ui.lastFrame()).toContain("hello🙂");

    ui.stdin.write("\u007f");
    ui.stdin.write("\r");
    await waitForRender();

    expect(onSubmit).toHaveBeenCalledWith("hello🙂");
    expect(ui.lastFrame()).toContain("Brief:");
  });

  it("does not accept input while disabled", async () => {
    const onSubmit = vi.fn();
    const ui = render(createElement(TextField, { label: "Brief:", disabled: true, onSubmit }));

    ui.stdin.write("ignored\r");
    await waitForRender();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(ui.lastFrame()).not.toContain("ignored");
  });

  it("forwards Ctrl+C to the owning workflow before closing", async () => {
    const onCancel = vi.fn();
    const ui = render(createElement(TextField, {
      label: "Brief:",
      onCancel,
      onSubmit: vi.fn(),
    }));

    ui.stdin.write("\u0003");
    await waitForRender();

    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("App", () => {
  it("runs doctor once, renders its result, and returns to the home screen", async () => {
    const execute = vi.fn<CliServices["execute"]>(() => Promise.resolve({
      status: "ok",
      message: "Codex CLI is ready.",
      data: {},
      exitCode: ExitCode.success,
    }));
    const ui = render(createElement(App, {
      services: createServices(execute),
      signal: new AbortController().signal,
      onCancel: vi.fn(),
    }));

    expect(ui.lastFrame()).toContain("Explain It Better");
    ui.stdin.write("d");
    await waitForRender();
    await waitForRender();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ name: "doctor", global: { json: false } }, expect.any(AbortSignal));
    expect(ui.lastFrame()).toContain("Codex CLI is ready.");

    ui.stdin.write("q");
    await waitForRender();
    expect(ui.lastFrame()).toContain("New prompt package");
  });
});
