import {
  LocalBackendError,
  type BackendFactoryOptions,
  type StructuredRunResult,
  type TargetOnlyBackend,
} from "./types.js";

export const TARGET_ONLY_SAFETY_REASONS = {
  hermes:
    "Hermes is export-only: its one-shot mode can bypass approvals and no verified zero-tool isolated invocation is available.",
  kimi:
    "Kimi Code is export-only until an installed and authenticated CLI passes a reviewed no-tools, no-persistence isolation conformance test.",
} as const;

export function createHermesBackend(
  options: BackendFactoryOptions = {},
): TargetOnlyBackend {
  return createTargetOnlyBackend("hermes", options.executable ?? "hermes");
}

export function createKimiBackend(
  options: BackendFactoryOptions = {},
): TargetOnlyBackend {
  return createTargetOnlyBackend("kimi", options.executable ?? "kimi");
}

export function getTargetOnlyBackend(
  id: "hermes" | "kimi",
  options: BackendFactoryOptions = {},
): TargetOnlyBackend {
  return id === "hermes"
    ? createHermesBackend(options)
    : createKimiBackend(options);
}

function createTargetOnlyBackend(
  id: "hermes" | "kimi",
  executable: string,
): TargetOnlyBackend {
  return {
    id,
    role: "target_only",
    executable,
    compilerReady: false,
    safetyReason: TARGET_ONLY_SAFETY_REASONS[id],
    runStructured<T>(): Promise<StructuredRunResult<T>> {
      return Promise.reject(
        new LocalBackendError("target_only", TARGET_ONLY_SAFETY_REASONS[id], {
          backend: id,
        }),
      );
    },
  };
}
