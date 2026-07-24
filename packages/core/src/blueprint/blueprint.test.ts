import { describe, expect, it } from "vitest";

import { analyzeBrief, createFastDraft } from "../intent/index.js";
import { analyzeTaskRequirements, buildBlueprint } from "./index.js";

describe("agent blueprint construction", () => {
  it("refuses unresolved blocking ambiguity", () => {
    const intent = analyzeBrief("Help me with this.");
    expect(() => buildBlueprint(intent)).toThrow(/blocking ambiguity/iu);
  });

  it("requires high-impact and safe defaults to be answered or visibly assumed", () => {
    const intent = analyzeBrief("Build a command-line application.");
    expect(intent.unresolvedAmbiguity.every((item) => item.impact !== "blocking")).toBe(true);
    expect(() => buildBlueprint(intent)).toThrow(/unresolved ambiguity/iu);
  });

  it("builds from frozen intent and adds an approval gate for consequential tools", () => {
    const intent = createFastDraft(
      analyzeBrief("Publish a researched launch report.", {
        deliverables: ["Published report"],
        successCriteria: ["The report is accurate and published"],
      }),
    );
    const blueprint = buildBlueprint(intent, {
      tools: [
        {
          name: "publish_report",
          description: "Publish an approved report to an external destination.",
          inputSchema: { type: "object" },
          sideEffect: "external",
          requiresApproval: true,
        },
      ],
    });

    expect(Object.isFrozen(blueprint.intent)).toBe(true);
    expect(blueprint.permissions.externalActions).toBe("approval_required");
    expect(blueprint.workflow.map((step) => step.id)).toContain("approval-gate");
    expect(blueprint.roles.policy.join(" ")).toMatch(/explicit approval/iu);
    expect(blueprint.workflow.map((step) => step.id)).toEqual([
      "ground-intent",
      "prepare",
      "approval-gate",
      "execute-consequential",
      "verify",
    ]);
    expect(blueprint.workflow.find((step) => step.id === "approval-gate")?.dependsOn).toEqual([
      "prepare",
    ]);
    expect(blueprint.workflow.find((step) => step.id === "execute-consequential")?.dependsOn).toEqual([
      "approval-gate",
    ]);
  });

  it("keeps the simple produce flow when no approval is needed", () => {
    const blueprint = buildBlueprint(
      createFastDraft(
        analyzeBrief("Write a plan.", {
          deliverables: ["Plan"],
          successCriteria: ["The plan is actionable"],
        }),
      ),
    );

    expect(blueprint.workflow.map((step) => step.id)).toEqual([
      "ground-intent",
      "produce",
      "verify",
    ]);
  });

  it("assigns deterministic unique names to colliding typed inputs", () => {
    const blueprint = buildBlueprint(
      createFastDraft(
        analyzeBrief("Write a plan.", {
          deliverables: ["Plan"],
          successCriteria: ["The plan is actionable"],
          inputs: ["Product URL", "Product-URL", "Product_URL"],
        }),
      ),
    );

    expect(blueprint.typedInputs.map((input) => input.name)).toEqual([
      "product_url",
      "product_url_2",
      "product_url_3",
    ]);
  });

  it("detects retrieval, structure, memory, and multimodal requirements", () => {
    const intent = createFastDraft(
      analyzeBrief(
        "Research the latest sources, inspect an image, and remember results across sessions.",
        {
          deliverables: ["JSON report"],
          successCriteria: ["Citations and valid JSON are present"],
          outputFormat: "JSON",
        },
      ),
    );
    const requirements = analyzeTaskRequirements(intent);

    expect(requirements.retrieval).toBe(true);
    expect(requirements.structuredOutput).toBe(true);
    expect(requirements.memory).toBe(true);
    expect(requirements.image).toBe(true);
  });

  it("produces stable IDs for the same frozen intent", () => {
    const intent = createFastDraft(analyzeBrief("Build a complete test plan."));
    expect(buildBlueprint(intent).id).toBe(buildBlueprint(intent).id);
  });

  it("infers filesystem and network permissions without declared tools", () => {
    const local = buildBlueprint(
      createFastDraft(
        analyzeBrief("Inspect this repository and edit the source files.", {
          deliverables: ["Updated source files"],
          successCriteria: ["The requested change passes tests"],
        }),
      ),
    );
    const research = buildBlueprint(
      createFastDraft(
        analyzeBrief("Research the latest official sources online.", {
          deliverables: ["Research report"],
          successCriteria: ["Claims cite official sources"],
        }),
      ),
    );
    const deployment = buildBlueprint(
      createFastDraft(
        analyzeBrief("Deploy the application to production.", {
          deliverables: ["Production deployment"],
          successCriteria: ["The deployment is verified"],
        }),
      ),
    );

    expect(local.permissions.filesystem).toBe("workspace_write");
    expect(local.permissions.network).toBe("none");
    expect(research.permissions.network).toBe("read_only");
    expect(deployment.permissions.network).toBe("full");
    expect(deployment.approvals.requiredFor).toContain("external_action");
  });

  it("detects delegated parallel work and respects an explicit exclusion", () => {
    const delegatedIntent = createFastDraft(
      analyzeBrief("Delegate the research to specialists working in parallel.", {
        deliverables: ["Consolidated findings"],
        successCriteria: ["Independent findings are reconciled"],
      }),
    );
    const delegated = analyzeTaskRequirements(delegatedIntent);
    expect(delegated.subagents).toBe(true);
    expect(buildBlueprint(delegatedIntent).subagents).toHaveLength(2);

    const singleIntent = createFastDraft(
      analyzeBrief("Research this sequentially; do not use subagents.", {
        deliverables: ["Research findings"],
        successCriteria: ["Sources are cited"],
        exclusions: ["Do not use subagents"],
      }),
    );
    expect(analyzeTaskRequirements(singleIntent).subagents).toBe(false);
  });

  it("derives approval requirements from risk and tool side effects", () => {
    const highRisk = buildBlueprint(
      createFastDraft(
        analyzeBrief("Prepare a legal assessment.", {
          deliverables: ["Legal assessment"],
          successCriteria: ["Uncertainty is clearly qualified"],
          risk: "high",
        }),
      ),
    );
    expect(highRisk.approvals.requiredFor).toContain("external_action");

    const toolDriven = buildBlueprint(
      createFastDraft(
        analyzeBrief("Update a local artifact and publish the approved result.", {
          deliverables: ["Published artifact"],
          successCriteria: ["The correct artifact is published"],
        }),
      ),
      {
        tools: [
          {
            name: "write_artifact",
            description: "Write the approved artifact inside the current workspace.",
            inputSchema: { type: "object" },
            sideEffect: "write",
            requiresApproval: true,
          },
          {
            name: "publish_artifact",
            description: "Publish the approved artifact to the external destination.",
            inputSchema: { type: "object" },
            sideEffect: "external",
            requiresApproval: true,
          },
        ],
      },
    );

    expect(toolDriven.approvals.requiredFor).toEqual(
      expect.arrayContaining(["filesystem_write", "network_write", "external_action"]),
    );
    expect(toolDriven.workflow.map((step) => step.id)).toContain("approval-gate");
  });

  it("retains validated MCP declarations as inert blueprint configuration", () => {
    const blueprint = buildBlueprint(
      createFastDraft(analyzeBrief("Draft a plan.", {
        deliverables: ["Plan"],
        successCriteria: ["The plan is actionable"],
      })),
      {
        mcpServers: [{
          name: "docs",
          transport: "http",
          endpoint: "https://mcp.example.test/v1",
          allowedTools: ["search_docs"],
          trust: "trusted",
          requiresApproval: false,
        }],
      },
    );

    expect(blueprint.mcpServers).toEqual([{
      name: "docs",
      transport: "http",
      endpoint: "https://mcp.example.test/v1",
      allowedTools: ["search_docs"],
      trust: "trusted",
      requiresApproval: false,
    }]);
  });

  it("rejects duplicate server names and unapproved untrusted MCP declarations", () => {
    const intent = createFastDraft(analyzeBrief("Draft a plan.", {
      deliverables: ["Plan"],
      successCriteria: ["The plan is actionable"],
    }));
    expect(() => buildBlueprint(intent, {
      mcpServers: [{
        name: "untrusted",
        transport: "stdio",
        endpoint: "catalog-mcp",
        allowedTools: ["find"],
        trust: "untrusted",
        requiresApproval: false,
      }],
    })).toThrow("Untrusted MCP servers must require approval");
    expect(() => buildBlueprint(intent, {
      mcpServers: ["first", "second"].map((name) => ({
        name,
        transport: "stdio" as const,
        endpoint: "catalog-mcp",
        allowedTools: ["find"],
        trust: "trusted" as const,
        requiresApproval: false,
      })).concat([{
        name: "first",
        transport: "stdio" as const,
        endpoint: "other-catalog-mcp",
        allowedTools: ["find"],
        trust: "trusted" as const,
        requiresApproval: false,
      }]),
    })).toThrow("must be unique");
  });
});
