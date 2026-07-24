import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { makePromptPackage } from "../package/test-fixtures.js";
import { applyInstall, formatInstallPlan, planInstall } from "./installer.js";

async function temporaryDirectory(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "eib-install-test-")));
}

describe("guarded installer", () => {
  it("requires an exact non-broad target", async () => {
    await expect(planInstall(makePromptPackage(), "relative/path")).rejects.toThrow(
      "exact absolute path",
    );
    await expect(planInstall(makePromptPackage(), "/")).rejects.toThrow(
      "broad or protected",
    );
    await expect(planInstall(makePromptPackage(), process.cwd())).resolves.toMatchObject({
      target: process.cwd(),
    });
  });

  it("refuses a symlink anywhere in the target ancestry", async () => {
    const root = await temporaryDirectory();
    const realTargetParent = join(root, "real");
    const linkedTargetParent = join(root, "linked");
    await mkdir(realTargetParent);
    await symlink(realTargetParent, linkedTargetParent);
    await expect(
      planInstall(makePromptPackage(), join(linkedTargetParent, "agent")),
    ).rejects.toThrow("Refusing symlink");
  });

  it("reserves installer state paths and portable filenames", async () => {
    const root = await temporaryDirectory();
    const manifestCollision = makePromptPackage();
    manifestCollision.artifacts[0] = {
      ...manifestCollision.artifacts[0]!,
      filename: ".eib-install-manifest.json",
    };
    await expect(planInstall(manifestCollision, join(root, "agent"))).rejects.toThrow("reserved");

    const manifestParentCollision = makePromptPackage();
    manifestParentCollision.artifacts[0] = {
      ...manifestParentCollision.artifacts[0]!,
      filename: ".eib-install-manifest.json/prompt.md",
    };
    await expect(
      planInstall(manifestParentCollision, join(root, "agent")),
    ).rejects.toThrow("reserved");

    const backupCollision = makePromptPackage();
    backupCollision.artifacts[0] = {
      ...backupCollision.artifacts[0]!,
      filename: ".eib-backups/old-prompt.md",
    };
    await expect(planInstall(backupCollision, join(root, "agent"))).rejects.toThrow("reserved");

    const reservedName = makePromptPackage();
    reservedName.artifacts[0] = { ...reservedName.artifacts[0]!, filename: "AUX.txt" };
    await expect(planInstall(reservedName, join(root, "agent"))).rejects.toThrow(
      "Unsafe install filename",
    );

    const caseCollision = makePromptPackage();
    caseCollision.artifacts.push({
      ...caseCollision.artifacts[0]!,
      filename: "PROMPT.MD",
    });
    await expect(planInstall(caseCollision, join(root, "agent"))).rejects.toThrow(
      "Multiple artifacts resolve",
    );
  });

  it("rejects reserved or case-colliding ownership records", async () => {
    const root = await temporaryDirectory();
    const reservedTarget = join(root, "reserved-manifest");
    await mkdir(reservedTarget);
    await writeFile(
      join(reservedTarget, ".eib-install-manifest.json"),
      JSON.stringify({
        version: 1,
        files: {
          ".eib-backups/owned.md": {
            packageId: "example-package",
            targetId: "openai-gpt",
            installedHash: "0".repeat(64),
          },
        },
      }),
    );
    await expect(planInstall(makePromptPackage(), reservedTarget)).rejects.toThrow(
      "Invalid installer ownership record",
    );

    const collidingTarget = join(root, "colliding-manifest");
    await mkdir(collidingTarget);
    await writeFile(
      join(collidingTarget, ".eib-install-manifest.json"),
      JSON.stringify({
        version: 1,
        files: {
          "prompt.md": {
            packageId: "example-package",
            targetId: "openai-gpt",
            installedHash: "0".repeat(64),
          },
          "PROMPT.MD": {
            packageId: "example-package",
            targetId: "openai-gpt",
            installedHash: "1".repeat(64),
          },
        },
      }),
    );
    await expect(planInstall(makePromptPackage(), collidingTarget)).rejects.toThrow(
      "Invalid installer ownership record",
    );
  });

  it("plans without writing, then applies creates and records ownership", async () => {
    const root = await temporaryDirectory();
    const target = join(root, "agent");
    const plan = await planInstall(makePromptPackage(), target);
    expect(plan.actions.map((action) => action.kind)).toEqual(["create"]);
    const review = formatInstallPlan(plan);
    expect(review).toContain(`[CREATE] ${join(target, "prompt.md")}`);
    expect(review).toContain("Observed SHA-256: <missing>");
    expect(review).toContain(`Requested SHA-256: ${plan.actions[0]?.contentHash}`);
    expect(review).toContain("+Answer the request and cite supplied evidence.");
    expect(review).toContain(
      'Exact requested content (utf8 JSON): "Answer the request and cite supplied evidence."',
    );
    await expect(readFile(join(target, "prompt.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });

    const result = await applyInstall(plan);
    expect(result.created).toEqual(["prompt.md"]);
    expect(await readFile(join(target, "prompt.md"), "utf8")).toContain("cite supplied");
    expect(await readFile(join(target, ".eib-install-manifest.json"), "utf8")).toContain(
      "example-package",
    );
  });

  it("backs up managed updates and refuses unowned or edited destinations", async () => {
    const root = await temporaryDirectory();
    const target = join(root, "agent");
    await applyInstall(await planInstall(makePromptPackage(), target));

    const changedPackage = makePromptPackage();
    changedPackage.artifacts[0] = {
      ...changedPackage.artifacts[0]!,
      content: "Updated managed content.",
    };
    const updatePlan = await planInstall(changedPackage, target, {
      now: new Date("2026-07-24T12:00:00.000Z"),
    });
    expect(updatePlan.actions[0]?.kind).toBe("update");
    const updateReview = formatInstallPlan(updatePlan);
    expect(updateReview).toContain("-Answer the request and cite supplied evidence.");
    expect(updateReview).toContain("+Updated managed content.");
    expect(updateReview).toContain("Managed, unmodified destination");
    const update = await applyInstall(updatePlan);
    expect(update.backups).toHaveLength(1);
    expect(await readFile(update.backups[0]!, "utf8")).toContain("cite supplied");

    await writeFile(join(target, "prompt.md"), "user edit");
    const conflict = await planInstall(makePromptPackage(), target);
    expect(conflict.actions[0]?.kind).toBe("conflict");
    const conflictReview = formatInstallPlan(conflict);
    expect(conflictReview).toContain(`[CONFLICT] ${join(target, "prompt.md")}`);
    expect(conflictReview).toContain("-user edit");
    expect(conflictReview).toContain("+Answer the request and cite supplied evidence.");
    await expect(applyInstall(conflict)).rejects.toThrow("has conflicts");

    const unownedTarget = join(root, "unowned");
    await mkdir(unownedTarget);
    await writeFile(join(unownedTarget, "prompt.md"), "mine");
    const unowned = await planInstall(makePromptPackage(), unownedTarget);
    expect(unowned.actions[0]?.reason).toContain("unowned");
  });

  it("never overwrites a pre-existing scoped backup", async () => {
    const root = await temporaryDirectory();
    const target = join(root, "agent");
    await applyInstall(await planInstall(makePromptPackage(), target));
    const changedPackage = makePromptPackage();
    changedPackage.artifacts[0] = {
      ...changedPackage.artifacts[0]!,
      content: "Updated managed content.",
    };
    const plan = await planInstall(changedPackage, target, {
      now: new Date("2026-07-24T12:00:00.000Z"),
    });
    const priorBackup = join(plan.backupDirectory, "prompt.md");
    await mkdir(plan.backupDirectory, { recursive: true });
    await writeFile(priorBackup, "do not overwrite");

    await expect(applyInstall(plan)).rejects.toMatchObject({ code: "EEXIST" });
    await expect(readFile(priorBackup, "utf8")).resolves.toBe("do not overwrite");
    await expect(readFile(join(target, "prompt.md"), "utf8")).resolves.toContain("cite supplied");
  });

  it("uses a bounded portable digest in backup directory names", async () => {
    const root = await temporaryDirectory();
    const promptPackage = makePromptPackage();
    promptPackage.id = `${"x".repeat(1_000)}.`;
    const plan = await planInstall(promptPackage, join(root, "agent"), {
      now: new Date("2026-07-24T12:00:00.000Z"),
    });

    expect(basename(plan.backupDirectory)).toMatch(
      /^2026-07-24T12-00-00-000Z-[a-f0-9]{16}$/u,
    );
  });

  it("detects stale plans before making any changes", async () => {
    const root = await temporaryDirectory();
    const target = join(root, "agent");
    await mkdir(target);
    const plan = await planInstall(makePromptPackage(), target);
    await writeFile(join(target, "prompt.md"), "appeared after planning");
    await expect(applyInstall(plan)).rejects.toThrow("changed after planning");
    await expect(readFile(join(target, ".eib-install-manifest.json"), "utf8")).rejects.toMatchObject(
      { code: "ENOENT" },
    );
  });

  it("rejects a forged plan before writing", async () => {
    const root = await temporaryDirectory();
    const target = join(root, "agent");
    const plan = await planInstall(makePromptPackage(), target);
    const forged = {
      ...plan,
      actions: plan.actions.map((action) => ({ ...action, content: "forged content" })),
    };
    await expect(applyInstall(forged)).rejects.toThrow("content hash is invalid");
    await expect(readFile(join(target, "prompt.md"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("escapes terminal control sequences while preserving exact reviewed content", async () => {
    const root = await temporaryDirectory();
    const promptPackage = makePromptPackage();
    promptPackage.artifacts[0] = {
      ...promptPackage.artifacts[0]!,
      content: "safe\u001b[31mred\u202espoof",
    };
    const review = formatInstallPlan(await planInstall(promptPackage, join(root, "agent")));
    expect(review).not.toContain("\u001b");
    expect(review).not.toContain("\u202e");
    expect(review).toContain("\\u001b[31m");
    expect(review).toContain("\\u202e");
  });
});
