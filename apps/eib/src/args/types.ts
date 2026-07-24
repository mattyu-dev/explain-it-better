import type { AgentBlueprint, IntentContract } from "@eib/core";

export const EIB_VERSION = "0.1.0";

export const ExitCode = {
  success: 0,
  error: 1,
  usage: 2,
  needsInput: 3,
  unavailable: 69,
  cancelled: 130,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export interface GlobalOptions {
  json: boolean;
}

export type EvalMode = "static" | "proxy" | "live";
export type EvalDepth = "quick" | "default" | "deep";
export type ExportFormat = "directory" | "clipboard";
export type CandidateCount = 1 | 2 | 3;

export type CliCommand =
  | { name: "tui"; global: GlobalOptions }
  | {
      name: "new";
      global: GlobalOptions;
      brief?: string;
      fast: boolean;
      targets: string[];
      output?: string;
      outputSchema?: NonNullable<IntentContract["outputContract"]["schema"]>;
      tools?: AgentBlueprint["tools"];
      /** Declarative server configuration; CLI never starts these servers. */
      mcpServers?: AgentBlueprint["mcpServers"];
      clarifications?: ReadonlyArray<{
        field: string;
        answer: string;
        assumed?: boolean;
      }>;
    }
  | {
      name: "improve";
      global: GlobalOptions;
      packagePath: string;
      feedback?: string;
      fast: boolean;
      output?: string;
    }
  | {
      /**
       * Generates intent-preserving prompt candidates and, when evidence is
       * supplied, makes a fail-closed promotion recommendation. It never
       * changes the source package or its verification level.
       */
      name: "optimize";
      global: GlobalOptions;
      packagePath: string;
      maxCandidates: CandidateCount;
      runs?: string;
      comparisons?: string;
      minimumImprovement?: number;
      output?: string;
    }
  | {
      name: "compile";
      global: GlobalOptions;
      packagePath: string;
      targets: string[];
      output?: string;
    }
  | {
      name: "eval";
      global: GlobalOptions;
      packagePath: string;
      mode: EvalMode;
      depth: EvalDepth;
      backend?: "codex" | "claude";
      fixtures?: string;
      allowExecution: boolean;
    }
  | {
      name: "export";
      global: GlobalOptions;
      packagePath: string;
      format: ExportFormat;
      output?: string;
    }
  | {
      name: "install";
      global: GlobalOptions;
      packagePath: string;
      target: string;
      apply: boolean;
    }
  | {
      name: "approve";
      global: GlobalOptions;
      packagePath: string;
      statement: string;
      output?: string;
    }
  | {
      name: "preferences";
      global: GlobalOptions;
      action: "show" | "set" | "unset";
      defaultTarget?: string;
    }
  | { name: "doctor"; global: GlobalOptions }
  | {
      name: "knowledge";
      global: GlobalOptions;
      action: "check" | "stage";
      output?: string;
      sourceIds: string[];
    }
  | { name: "help"; global: GlobalOptions; topic?: string }
  | { name: "version"; global: GlobalOptions };

export class UsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}
