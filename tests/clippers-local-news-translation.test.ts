import assert from "node:assert/strict";
import test from "node:test";
import {
  LocalNewsTranslator,
  detectLocalNewsLanguage,
  type LocalNewsTranslationAdapter,
  type LocalNewsTranslationDirection,
} from "../server/clippers-local-news-translation";

class FakeTranslationAdapter implements LocalNewsTranslationAdapter {
  calls = 0;
  private readonly handler: (input: string, direction: LocalNewsTranslationDirection) => string | Promise<string>;

  constructor(handler: (input: string, direction: LocalNewsTranslationDirection) => string | Promise<string>) {
    this.handler = handler;
  }

  async translate(input: string, direction: LocalNewsTranslationDirection): Promise<string> {
    this.calls += 1;
    return this.handler(input, direction);
  }
}

test("detects common English and Spanish public-safety copy", () => {
  assert.equal(detectLocalNewsLanguage("The road is closed from 8 AM to 10 AM."), "en");
  assert.equal(detectLocalNewsLanguage("La carretera está cerrada de 8 AM a 10 AM."), "es");
  assert.equal(detectLocalNewsLanguage("Crash closes I-95"), "en");
  assert.equal(detectLocalNewsLanguage("Choque cierra I-95"), "es");
});

test("ambiguous target-language output fails closed", async () => {
  const adapter = new FakeTranslationAdapter(() => "Crash closes I-95!");
  const result = await new LocalNewsTranslator({ enabled: true, adapter }).translate("Crash closes I-95", "en-es");
  assert.equal(result.safe, false);
  assert.ok(result.issues.includes("unexpected_output_language:en"));
});

test("performs a substantive local translation and retains the exact original", async () => {
  const adapter = new FakeTranslationAdapter(() => "La carretera está cerrada por una investigación policial.");
  const translator = new LocalNewsTranslator({ enabled: true, adapter });
  const original = "The road is closed for a police investigation.";
  const result = await translator.translate(original, "en-es");

  assert.equal(result.status, "translated");
  assert.equal(result.safe, true);
  assert.equal(result.original, original);
  assert.equal(result.translated, "La carretera está cerrada por una investigación policial.");
  assert.equal(result.fromCache, false);
});

test("caches successful translations by exact input and direction", async () => {
  const adapter = new FakeTranslationAdapter(() => "La carretera está cerrada.");
  const translator = new LocalNewsTranslator({ enabled: true, adapter });

  const first = await translator.translate("The road is closed.", "en-es");
  const second = await translator.translate("The road is closed.", "en-es");

  assert.equal(first.fromCache, false);
  assert.equal(second.fromCache, true);
  assert.equal(second.translated, first.translated);
  assert.equal(adapter.calls, 1);
});

test("fails closed when numbers, URLs, or route identifiers change", async () => {
  const original = "The I-95 ramp closes at 8:30 near https://511.example/alert/42 for 2 hours.";
  const adapter = new FakeTranslationAdapter(() => "La rampa I-75 cierra a las 9:30 cerca de https://511.example/alert/41 por 3 horas.");
  const translator = new LocalNewsTranslator({ enabled: true, adapter });
  const result = await translator.translate(original, "en-es");

  assert.equal(result.status, "unsafe");
  assert.equal(result.safe, false);
  assert.equal(result.translated, null);
  assert.equal(result.original, original);
  assert.ok(result.issues.some((issue) => issue === "protected_token_missing:I-95"));
  assert.ok(result.issues.some((issue) => issue === "protected_token_missing:8:30"));
  assert.ok(result.issues.some((issue) => issue === "protected_token_missing:https://511.example/alert/42"));
});

test("fails closed when a translation adds numbers, URLs, or routes", async () => {
  const original = "The I-95 ramp closes at 8:30 near https://511.example/alert/42 for 2 hours.";
  const adapter = new FakeTranslationAdapter(() => "La rampa I-95 cierra a las 8:30 cerca de https://511.example/alert/42 durante 2 horas; I-75 a las 9:30 según https://evil.example/43.");
  const result = await new LocalNewsTranslator({ enabled: true, adapter }).translate(original, "en-es");

  assert.equal(result.status, "unsafe");
  assert.equal(result.safe, false);
  assert.ok(result.issues.includes("protected_token_unexpected:I-75"));
  assert.ok(result.issues.includes("protected_token_unexpected:9:30"));
  assert.ok(result.issues.includes("protected_token_unexpected:https://evil.example/43."));
});

test("accepts translations that preserve numbers, URLs, and routes exactly", async () => {
  const original = "The I-95 ramp closes at 8:30 near https://511.example/alert/42 for 2 hours.";
  const adapter = new FakeTranslationAdapter(
    () => "La rampa I-95 cierra a las 8:30 cerca de https://511.example/alert/42 durante 2 horas.",
  );
  const result = await new LocalNewsTranslator({ enabled: true, adapter }).translate(original, "en-es");

  assert.equal(result.status, "translated");
  assert.equal(result.safe, true);
});

test("fails closed on missing, unchanged, or rejected adapter output", async () => {
  for (const handler of [
    () => "",
    (input: string) => input,
    () => {
      throw new Error("model_not_installed");
    },
  ]) {
    const result = await new LocalNewsTranslator({
      enabled: true,
      adapter: new FakeTranslationAdapter(handler),
    }).translate("The road is closed.", "en-es");
    assert.equal(result.safe, false);
    assert.equal(result.translated, null);
    assert.ok(result.status === "unsafe" || result.status === "unavailable");
  }
});

test("is enabled by default in production without loading a model until called", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const adapter = new FakeTranslationAdapter(() => "La carretera está cerrada.");
    const result = await new LocalNewsTranslator({ adapter }).translate("The road is closed.", "en-es");
    assert.equal(result.safe, true);
    assert.equal(adapter.calls, 1);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
