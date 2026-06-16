import assert from "node:assert/strict";
import test from "node:test";
import { parseCreateLocalUserArgs, validateCreateLocalUserOptions } from "../server/local-auth-cli";

test("parses create local user CLI options", () => {
  const options = parseCreateLocalUserArgs([
    "--username= Robert@Example.COM ",
    "--password=correct horse",
    "--print-user-id",
  ]);

  assert.deepEqual(options, {
    username: "robert@example.com",
    password: "correct horse",
    printUserId: true,
  });
});

test("validates create local user CLI options", () => {
  assert.deepEqual(validateCreateLocalUserOptions({
    username: "",
    password: "short",
    printUserId: false,
  }), [
    "--username is required and must be at least 2 characters.",
    "--password is required and must be at least 8 characters.",
  ]);

  assert.deepEqual(validateCreateLocalUserOptions({
    username: "robert",
    password: "long-enough",
    printUserId: false,
  }), []);
});
