import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(
  import.meta.dirname,
  "../../../.github/workflows/knowledge-refresh.yml",
);

async function workflow(): Promise<string> {
  return readFile(workflowPath, "utf8");
}

describe("scheduled knowledge refresh workflow", () => {
  it("collects review evidence on a schedule without an activation path", async () => {
    const source = await workflow();

    expect(source).toContain('name: Knowledge refresh');
    expect(source).toMatch(/schedule:[\s\S]*?- cron: "17 7 \* \* 1"/);
    expect(source).toMatch(/workflow_dispatch:/);

    // A source check may discover drift, but the scheduled job has no
    // credentials or write permission through which it could promote it.
    expect(source).toMatch(/permissions:\s*\n\s+contents: read/);
    expect(source).not.toMatch(/contents:\s*write/);
    expect(source).not.toMatch(/pull-requests:\s*write/);
    expect(source).not.toMatch(/\bGITHUB_TOKEN\b/);
    expect(source).not.toMatch(/\bgh\s+pr\b/);
    expect(source).not.toMatch(/\bgit\s+(commit|push)\b/);
    expect(source).not.toMatch(/create-pull-request/i);

    expect(source).toContain("npm run build");
    expect(source).toContain("knowledge refresh");
    expect(source).toContain("knowledge-refresh.json");
    expect(source).toContain("review evidence only");
    expect(source).toContain("npm run release:check");
    expect(source).toContain("actions/upload-artifact@");
    expect(source).toContain("retention-days: 30");

    // Reviewable drift stays visible without permanently failing the scheduled
    // job; only incomplete official evidence fails after artifact upload.
    expect(source).toMatch(/if: always\(\)/);
    expect(source).toContain(
      'if [[ "$KNOWLEDGE_OUTCOME" == "incomplete" ]]',
    );
    expect(source).toContain('"needs_review"');
    expect(source).toContain("exit 1");
    expect(source).toContain("timeout-minutes: 20");
  });
});
