import type { PromptSpec, TargetProfile } from "../contracts.js";
import type { CompatibilityIssue } from "./lint.js";
import type { PromptCandidate } from "./candidates.js";

export interface RenderedTarget {
  targetId: string;
  filename: string;
  content: string;
  mimeType: string;
  warnings: string[];
  appliedRuleIds: string[];
}
export interface TargetRenderContext {
  prompt: PromptSpec;
  candidate: PromptCandidate;
  profile: TargetProfile;
  compatibilityIssues: CompatibilityIssue[];
  requestedReasoningMode?: string;
}

export interface TargetRenderer {
  id: string;
  supports(profile: TargetProfile): boolean;
  render(context: TargetRenderContext): RenderedTarget;
}

export class RendererNotFoundError extends Error {
  constructor(targetId: string) {
    super(`No target renderer is registered for "${targetId}".`);
    this.name = "RendererNotFoundError";
  }
}

export class RendererRegistry {
  readonly #renderers: TargetRenderer[] = [];

  constructor(renderers: readonly TargetRenderer[] = []) {
    for (const renderer of renderers) {
      this.register(renderer);
    }
  }

  register(renderer: TargetRenderer): void {
    if (this.#renderers.some((existing) => existing.id === renderer.id)) {
      throw new Error(`Target renderer "${renderer.id}" is already registered.`);
    }
    this.#renderers.push(renderer);
  }

  resolve(profile: TargetProfile): TargetRenderer {
    const matches = this.#renderers.filter((renderer) => renderer.supports(profile));
    if (matches.length === 0) {
      throw new RendererNotFoundError(profile.id);
    }
    if (matches.length > 1) {
      throw new Error(
        `Multiple target renderers match "${profile.id}": ${matches.map((item) => item.id).join(", ")}.`,
      );
    }
    const renderer = matches[0];
    if (!renderer) {
      throw new RendererNotFoundError(profile.id);
    }
    return renderer;
  }
}
