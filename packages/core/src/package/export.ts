import type { PromptPackage } from "../contracts.js";
import {
  formatPromptPackageForClipboard,
  type ClipboardWriter,
} from "./clipboard.js";
import {
  writePromptPackage,
  type WritePromptPackageOptions,
  type WrittenPromptPackage,
} from "./storage.js";

export interface DirectoryExportOptions extends WritePromptPackageOptions {
  readonly format: "directory";
  readonly destination: string;
}
export interface ClipboardExportOptions {
  readonly format: "clipboard";
  readonly clipboard: ClipboardWriter;
}

export type PackageExportOptions = DirectoryExportOptions | ClipboardExportOptions;

export type PackageExportResult =
  | {
      readonly format: "directory";
      readonly written: WrittenPromptPackage;
    }
  | {
      readonly format: "clipboard";
      readonly characters: number;
    };

export async function exportPromptPackage(
  promptPackage: PromptPackage,
  options: PackageExportOptions,
): Promise<PackageExportResult> {
  if (options.format === "directory") {
    const written = await writePromptPackage(promptPackage, options.destination, options);
    return { format: "directory", written };
  }

  const text = formatPromptPackageForClipboard(promptPackage);
  await options.clipboard.writeText(text);
  return { format: "clipboard", characters: text.length };
}
