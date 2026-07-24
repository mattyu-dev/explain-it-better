import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  PromptPackageSchema,
  type ExternalEvaluationInvocation,
} from "@eib/core";

import {
  createOpenAIBackend,
  createOpenAIResponsesEvaluationBackend,
  type OpenAIFetch,
} from "./openai.js";

const evalCase = {
  id: "case-1",
  category: "nominal" as const,
  input: "Summarize this evidence.",
  expectedProperties: ["States the conclusion."],
  deterministicChecks: ["non_empty"],
  rubric: ["Accurate and concise."],
};

const promptPackage = PromptPackageSchema.parse({
  version: "1.0.0",
  id: "eib-test",
  createdAt: "2026-07-24T00:00:00.000Z",
  originalBrief: "Summarize evidence.",
  clarificationLineage: [],
  prompt: {
    version: "1.0.0",
    id: "spec-1",
    demand: {
      version: "1.0.0",
      objective: "Summarize evidence.",
      audience: ["Reader"],
      deliverables: ["Summary"],
      successCriteria: ["Accurate"],
      outputContract: { format: "markdown", language: "English", verbosity: "concise" },
      risk: "low",
      unresolvedAmbiguity: [],
    },
    guidance: { role: "Writer", principles: ["Be accurate."], method: ["Read then write."] },
    evaluation: { criteria: ["Accurate"], evidencePolicy: "State uncertainty.", candidateDimensions: ["baseline"] },
  },
  artifacts: [{
    targetId: "openai-gpt-5.6-api",
    filename: "request.json",
    content: "Return a concise evidence summary.",
    mimeType: "application/json",
    warnings: [],
  }],
  warnings: [],
  evals: [evalCase],
  results: [],
  knowledge: { packVersion: "test", ruleIds: [] },
  verification: "statically_validated",
});

const invocation: ExternalEvaluationInvocation = {
  mode: "live",
  focus: "prompt_quality",
  evaluationContract: ["Judge the answer only."],
  promptPackage,
  evalCases: [evalCase],
  repetition: 0,
};

function completedResponse(id: string, text: string, usage = { input_tokens: 4, output_tokens: 2 }): Response {
  return new Response(JSON.stringify({
    id,
    status: "completed",
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
    usage,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function body(init: RequestInit): Record<string, unknown> {
  expect(typeof init.body).toBe("string");
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("OpenAI Responses target evaluation backend", () => {
  it("is inert without explicit execution consent or an explicit API key", async () => {
    const fetcher = vi.fn<OpenAIFetch>();
    await expect(
      createOpenAIResponsesEvaluationBackend({
        env: { OPENAI_API_KEY: "sk-test-do-not-use" },
        fetch: fetcher,
      }).evaluate(invocation),
    ).rejects.toMatchObject({ code: "execution_not_authorized" });
    await expect(
      createOpenAIResponsesEvaluationBackend({ allowExecution: true, env: {}, fetch: fetcher }).evaluate(invocation),
    ).rejects.toMatchObject({ code: "missing_api_key" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("executes the reviewed target and a separately schema-constrained judge with bound, redacted evidence", async () => {
    const apiKey = "sk-test-super-secret-token";
    const fetcher = vi.fn<OpenAIFetch>((_url, init) => {
      const request = body(init);
      if (request.text === undefined) return Promise.resolve(completedResponse("resp_target", "The conclusion is supported."));
      const judgeInput = JSON.parse(request.input as string) as { binding: Record<string, string> };
      return Promise.resolve(completedResponse("resp_judge", JSON.stringify({
        binding: judgeInput.binding,
        passed: true,
        score: 0.9,
        evidence: [`The answer meets the rubric; ${apiKey} must not escape.`],
      })));
    });

    const results = await createOpenAIResponsesEvaluationBackend({
      allowExecution: true,
      env: { OPENAI_API_KEY: apiKey },
      fetch: fetcher,
    }).evaluate(invocation);

    expect(fetcher).toHaveBeenCalledTimes(2);
    const [targetUrl, targetInit] = fetcher.mock.calls[0]!;
    expect(targetUrl).toBe("https://api.openai.com/v1/responses");
    expect(targetInit.headers).toMatchObject({ authorization: `Bearer ${apiKey}` });
    const targetRequest = body(targetInit);
    expect(targetRequest).toMatchObject({
      model: "gpt-5.6",
      tools: [],
      tool_choice: "none",
      store: false,
    });
    expect(JSON.stringify(targetRequest.metadata)).toMatch(/^[^{]*\{"eib_binding_sha256":"[a-f0-9]{64}"\}[^}]*$/u);
    expect(JSON.stringify(targetRequest)).not.toContain(apiKey);
    const [, judgeInit] = fetcher.mock.calls[1]!;
    const judgeRequest = body(judgeInit);
    expect(judgeRequest).toMatchObject({
      tools: [],
      tool_choice: "none",
      store: false,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(results).toMatchObject([{
      caseId: "case-1",
      targetId: "openai-gpt-5.6-api",
      mode: "live",
      passed: true,
      score: 0.9,
      metrics: { inputTokens: 8, outputTokens: 4 },
    }]);
    const evidence = (results[0] as { evidence: string[] }).evidence.join(" ");
    expect(evidence).toContain("prompt_sha256=");
    expect(evidence).toContain("case_sha256=");
    expect(evidence).not.toContain(apiKey);
  });

  it("fails closed for non-Responses targets and redacts server diagnostics", async () => {
    const unsupported = PromptPackageSchema.parse({
      ...promptPackage,
      artifacts: [{ ...promptPackage.artifacts[0]!, targetId: "openai-gpt-5.6-chatgpt" }],
    });
    const fetcher = vi.fn<OpenAIFetch>();
    await expect(createOpenAIResponsesEvaluationBackend({
      allowExecution: true,
      env: { OPENAI_API_KEY: "sk-test-super-secret-token" },
      fetch: fetcher,
    }).evaluate({ ...invocation, promptPackage: unsupported })).rejects.toMatchObject({ code: "target_unsupported" });
    expect(fetcher).not.toHaveBeenCalled();

    const failingFetch: OpenAIFetch = () => Promise.resolve(new Response(
      JSON.stringify({ error: "Bearer sk-test-super-secret-token rejected" }),
      { status: 401 },
    ));
    await expect(createOpenAIResponsesEvaluationBackend({
      allowExecution: true,
      env: { OPENAI_API_KEY: "sk-test-super-secret-token" },
      fetch: failingFetch,
    }).evaluate(invocation)).rejects.toMatchObject({ code: "remote_failed" });
    await createOpenAIResponsesEvaluationBackend({
      allowExecution: true,
      env: { OPENAI_API_KEY: "sk-test-super-secret-token" },
      fetch: failingFetch,
    }).evaluate(invocation).catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("sk-test-super-secret-token");
    });
  });

  it("exposes a structured adapter without permitting tools or implicit execution", async () => {
    const fetcher = vi.fn<OpenAIFetch>(() => Promise.resolve(completedResponse("resp_structured", '{"answer":42}')));
    const backend = createOpenAIBackend({
      allowExecution: true,
      env: { OPENAI_API_KEY: "sk-test-super-secret-token" },
      fetch: fetcher,
    });
    const result = await backend.runStructured({
      prompt: "Return the answer.",
      schema: z.object({ answer: z.number() }).strict(),
    });
    expect(result).toMatchObject({ backend: "openai", data: { answer: 42 } });
    expect(body(fetcher.mock.calls[0]![1])).toMatchObject({ tools: [], tool_choice: "none", store: false });
  });
});
