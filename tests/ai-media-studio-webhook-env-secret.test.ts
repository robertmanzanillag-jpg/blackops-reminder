import assert from "node:assert/strict";
import test from "node:test";
import { createEnvironmentSecretReferenceResolver } from "../server/ai-media-studio/provider-webhooks";

test("environment secret resolver permits only the AI Media Studio namespace", async () => {
  const resolver = createEnvironmentSecretReferenceResolver({
    env: {
      AI_MEDIA_STUDIO_SECRET_HEYGEN_PRIMARY: "  strong-secret  ",
      DATABASE_URL: "must-not-leak",
    },
  });

  assert.equal(await resolver("env://AI_MEDIA_STUDIO_SECRET_HEYGEN_PRIMARY"), "strong-secret");
  assert.equal(await resolver("env://DATABASE_URL"), undefined);
  assert.equal(await resolver("AI_MEDIA_STUDIO_SECRET_HEYGEN_PRIMARY"), undefined);
  assert.equal(await resolver("env://AI_MEDIA_STUDIO_SECRET_MISSING"), undefined);
});

test("environment secret resolver supports a bounded custom namespace", async () => {
  const resolver = createEnvironmentSecretReferenceResolver({
    env: { CUSTOM_SECRET_WEBHOOK: "secret" },
    allowedPrefix: "CUSTOM_SECRET_",
  });
  assert.equal(await resolver("env://CUSTOM_SECRET_WEBHOOK"), "secret");
  assert.throws(
    () => createEnvironmentSecretReferenceResolver({ allowedPrefix: "unsafe-prefix" }),
    /prefix is invalid/,
  );
});
