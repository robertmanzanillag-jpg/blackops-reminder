import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDirectBlackRoomCommand, buildDirectPromoVideoCommand } from "../server/assistant";

test("web assistant saves streamed responses and failures into shared CEO history", () => {
  const source = readFileSync("server/assistant.ts", "utf8");

  assert.match(source, /let requestUserId: string \| null = null/);
  assert.match(source, /requestUserId = userId/);
  assert.match(source, /saveCeoConversationMessage\(userId, "assistant", fullResponse\)/);
  assert.match(source, /saveCeoConversationMessage\(requestUserId, "assistant", userFacingError\)/);
});

test("web assistant never completes with an empty shared response", () => {
  const source = readFileSync("server/assistant.ts", "utf8");

  assert.match(source, /if \(!fullResponse\.trim\(\)\)/);
  assert.match(source, /No pude generar una respuesta útil esta vez/);
  assert.match(source, /res\.write\(`data: \$\{JSON\.stringify\(\{ content: fullResponse \}\)\}\\n\\n`\)/);
});

test("web assistant routes Black Room website link deactivation away from calendar", () => {
  const direct = buildDirectBlackRoomCommand(
    "QUIERO QUE ME DESACTIVES EL EVENTO DE BLACK ROOM & FRIENDS DE LOS LINSK DE BLACK ROOM"
  );

  assert.ok(direct);
  assert.match(direct.command, /BLACKROOM_LINK_DEACTIVATE/);
  assert.match(direct.command, /BLACK ROOM & FRIENDS/);
  assert.doesNotMatch(direct.command, /EDITAR_EVENTO_GOOGLE|MODIFICAR_RADIO/);
});

test("web assistant routes natural promo video requests to the local video agent", () => {
  const source = readFileSync("server/assistant.ts", "utf8");
  const direct = buildDirectPromoVideoCommand("creame 5 videos para TikTok de promo");

  assert.ok(direct);
  assert.match(source, /PROMO_VIDEO_GENERATE/);
  assert.match(direct.command, /PROMO_VIDEO_GENERATE/);
  assert.match(direct.command, /"count":5/);
  assert.match(direct.command, /"platform":"tiktok"/);
});

test("web assistant routes Black Room website link add when URL is present", () => {
  const direct = buildDirectBlackRoomCommand(
    "AGREGA BLACK ROOM & FRIENDS A LOS LINKS DE BLACK ROOM https://kongnightlife.com/p/bio-friends"
  );

  assert.ok(direct);
  assert.match(direct.command, /BLACKROOM_LINK_ADD/);
  assert.match(direct.command, /BLACK ROOM & FRIENDS/);
  assert.match(direct.command, /https:\/\/kongnightlife\.com\/p\/bio-friends/);
  assert.doesNotMatch(direct.command, /CREAR_EVENTO_GOOGLE|EDITAR_EVENTO_GOOGLE|MODIFICAR_RADIO/);
});

test("web assistant does not add vague Black Room event link without URL", () => {
  const direct = buildDirectBlackRoomCommand(
    "AGG ESTE EVENTO A L LINK DE BLACK ROOM"
  );

  assert.equal(direct, null);
});
