import assert from "node:assert/strict";
import test from "node:test";
import {
  createIssue,
  deleteFile,
  updateFile,
  validateGitHubCommitMessage,
  validateGitHubFilePath,
  validateGitHubIssueBody,
  validateGitHubIssueTitle,
  validateGitHubFileWriteInput,
  validateGitHubRepoNamePart,
} from "../server/github-client";

test("GitHub repo identifiers reject traversal and shell-like input", () => {
  assert.equal(validateGitHubRepoNamePart("robert", "Owner"), null);
  assert.equal(validateGitHubRepoNamePart("asistente.repo-1", "Repo"), null);
  assert.match(validateGitHubRepoNamePart("../owner", "Owner") || "", /Owner invalido/);
  assert.match(validateGitHubRepoNamePart("repo/name", "Repo") || "", /Repo invalido/);
  assert.match(validateGitHubRepoNamePart("repo;rm", "Repo") || "", /Repo invalido/);
});

test("GitHub file paths reject absolute, traversal, and sensitive locations", () => {
  assert.equal(validateGitHubFilePath("server/routes.ts"), null);
  assert.equal(validateGitHubFilePath("client/src/pages/home.tsx"), null);

  for (const filePath of [
    "/etc/passwd",
    "C:/Users/admin/.ssh/id_rsa",
    "../outside.ts",
    "server/../secrets.ts",
    ".git/config",
    "credentials/oauth.json",
    "secrets/api.env",
    ".env",
    "node_modules/pkg/index.js",
  ]) {
    assert.notEqual(validateGitHubFilePath(filePath), null, filePath);
  }
});

test("GitHub commit messages are bounded and single-line", () => {
  assert.equal(validateGitHubCommitMessage("Update assistant guardrails"), null);
  assert.match(validateGitHubCommitMessage("tiny") || "", /corto/);
  assert.match(validateGitHubCommitMessage("Update file\n\nCo-authored-by: bad") || "", /multilinea/);
  assert.match(validateGitHubCommitMessage("x".repeat(201)) || "", /largo/);
});

test("GitHub issue titles and bodies are bounded before connector access", () => {
  assert.equal(validateGitHubIssueTitle("Create Codex PR-first handoff"), null);
  assert.match(validateGitHubIssueTitle("tiny") || "", /corto/);
  assert.match(validateGitHubIssueTitle("Bad\nTitle") || "", /multilinea/);
  assert.match(validateGitHubIssueTitle("x".repeat(201)) || "", /largo/);

  assert.equal(validateGitHubIssueBody("This issue body has enough detail for a safe handoff."), null);
  assert.match(validateGitHubIssueBody("too short") || "", /corto/);
  assert.match(validateGitHubIssueBody("x".repeat(64 * 1024 + 1)) || "", /grande/);
});

test("GitHub write input rejects oversized or unsafe writes before Octokit", () => {
  assert.equal(validateGitHubFileWriteInput({
    owner: "robert",
    repo: "asistente",
    path: "server/safe.ts",
    content: "export const ok = true;",
    message: "Update safe file",
  }), null);

  assert.match(validateGitHubFileWriteInput({
    owner: "robert",
    repo: "asistente",
    path: ".env",
    content: "SECRET=value",
    message: "Update env file",
  }) || "", /sensible|bloqueado/);

  assert.match(validateGitHubFileWriteInput({
    owner: "robert",
    repo: "asistente",
    path: "server/large.ts",
    content: "x".repeat(1024 * 1024 + 1),
    message: "Update large file",
  }) || "", /demasiado grande/);
});

test("GitHub mutations reject unsafe input with 400 before connector access", async () => {
  await assert.rejects(
    () => updateFile("robert", "asistente", ".env", "SECRET=value", "Update env file"),
    (error: any) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /sensible|bloqueado/);
      return true;
    },
  );

  await assert.rejects(
    () => deleteFile("robert", "asistente", "../outside.ts", "Delete outside", "abc123"),
    (error: any) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /traversal/);
      return true;
    },
  );

  await assert.rejects(
    () => createIssue("robert", "repo/name", "Create Codex PR-first handoff", "This body has enough detail for validation."),
    (error: any) => {
      assert.equal(error.statusCode, 400);
      assert.match(error.message, /Repo invalido/);
      return true;
    },
  );
});
