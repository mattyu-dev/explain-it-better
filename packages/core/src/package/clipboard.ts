import { spawn } from "node:child_process";
import process from "node:process";
import type { PromptPackage } from "../contracts.js";

export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

export class MemoryClipboardWriter implements ClipboardWriter {
  value = "";

  writeText(text: string): Promise<void> {
    this.value = text;
    return Promise.resolve();
  }
}

interface ClipboardCommand {
  readonly command: string;
  readonly args: readonly string[];
}

function systemClipboardCommand(platform: NodeJS.Platform): ClipboardCommand {
  if (platform === "darwin") return { command: "pbcopy", args: [] };
  if (platform === "win32") return { command: "clip.exe", args: [] };
  if (platform === "linux") return { command: "wl-copy", args: [] };
  throw new Error(`No system clipboard adapter is defined for platform ${JSON.stringify(platform)}.`);
}

export class SystemClipboardWriter implements ClipboardWriter {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  writeText(text: string): Promise<void> {
    const selected = systemClipboardCommand(this.platform);
    return new Promise<void>((resolve, reject) => {
      const child = spawn(selected.command, [...selected.args], {
        shell: false,
        stdio: ["pipe", "ignore", "pipe"],
      });
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new Error(
            `${selected.command} exited with code ${String(code)}${stderr.length > 0 ? `: ${stderr.trim()}` : ""}`,
          ),
        );
      });
      child.stdin.end(text, "utf8");
    });
  }
}

export function formatPromptPackageForClipboard(promptPackage: PromptPackage): string {
  const sections = promptPackage.artifacts.map(
    (artifact) =>
      `## ${artifact.targetId}: ${artifact.filename}\n\n${artifact.content}`,
  );
  return [
    `# ${promptPackage.prompt.id}`,
    "",
    `Package: ${promptPackage.id}`,
    `Verification: ${promptPackage.verification}`,
    "",
    ...sections.flatMap((section, index) => (index === 0 ? [section] : ["---", "", section])),
    "",
  ].join("\n");
}
