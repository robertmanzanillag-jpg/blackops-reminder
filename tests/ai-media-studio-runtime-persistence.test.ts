import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import type { MediaJobRepository } from "../server/ai-media-studio/ports";
import {
  MediaStudioPersistenceUnavailableError,
  selectMediaJobRepository,
} from "../server/ai-media-studio/persistence/runtime";

test("production selects the durable repository factory when DATABASE_URL is configured", async () => {
  const durableRepository = new InMemoryMediaJobRepository();
  let factoryCalls = 0;
  const selection = selectMediaJobRepository({
    runtimeEnvironment: "production",
    databaseUrl: "postgresql://media-studio.invalid/runtime-selection-only",
    createDurableRepository: () => {
      factoryCalls += 1;
      return durableRepository;
    },
  });

  assert.equal(factoryCalls, 1);
  assert.deepEqual(selection.status, {
    mode: "drizzle",
    available: true,
    durable: true,
    reason: "PostgreSQL/Drizzle persistence selected",
  });
  assert.equal(selection.repository, durableRepository);
  assert.deepEqual(await selection.repository.list("runtime-test-user"), []);
});

test("production is deny-default when durable configuration is absent", async () => {
  const selection = selectMediaJobRepository({
    runtimeEnvironment: "production",
    databaseUrl: "",
  });

  assert.equal(selection.status.mode, "unavailable");
  assert.equal(selection.status.available, false);
  assert.equal(selection.status.durable, false);
  await assert.rejects(
    selection.repository.list("runtime-test-user"),
    (error: unknown) => error instanceof MediaStudioPersistenceUnavailableError,
  );
});

test("only development and test environments receive the ephemeral fallback", () => {
  for (const runtimeEnvironment of ["development", "test"]) {
    const selection = selectMediaJobRepository({ runtimeEnvironment, databaseUrl: "" });
    assert.equal(selection.status.mode, "memory");
    assert.equal(selection.status.available, true);
    assert.equal(selection.status.durable, false);
    assert.match(selection.status.reason, new RegExp(runtimeEnvironment));
  }

  for (const runtimeEnvironment of ["production", "staging", "", undefined]) {
    const selection = selectMediaJobRepository({ runtimeEnvironment, databaseUrl: "" });
    assert.equal(selection.status.mode, "unavailable");
    assert.equal(selection.status.available, false);
  }
});

test("an injected repository wins deterministically and avoids the durable factory", () => {
  const repository: MediaJobRepository = new InMemoryMediaJobRepository();
  let factoryCalls = 0;
  const selection = selectMediaJobRepository({
    repository,
    runtimeEnvironment: "production",
    databaseUrl: "postgresql://configured.invalid/database",
    createDurableRepository: () => {
      factoryCalls += 1;
      return new InMemoryMediaJobRepository();
    },
  });

  assert.equal(selection.repository, repository);
  assert.equal(selection.status.mode, "injected");
  assert.equal(factoryCalls, 0);
});

test("a configured database without a working factory remains unavailable", async () => {
  const selection = selectMediaJobRepository({
    runtimeEnvironment: "production",
    databaseUrl: "postgresql://configured.invalid/database",
    createDurableRepository: () => { throw new Error("driver setup failed"); },
  });

  assert.equal(selection.status.mode, "unavailable");
  assert.match(selection.status.reason, /driver setup failed/);
  await assert.rejects(selection.repository.list("runtime-test-user"), MediaStudioPersistenceUnavailableError);
});
