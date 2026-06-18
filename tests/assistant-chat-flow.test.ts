import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildDirectBlackRoomCommand, buildDirectPromoVideoCommand, userAlreadyApprovedExecution } from "../server/assistant";

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

test("web assistant extracts promo video text and typography from natural requests", () => {
  const direct = buildDirectPromoVideoCommand(
    'hazme 5 videos para TikTok de promo que diga "NEW APP FOR PROMO" cta "JOIN THE GUESTLIST" con typo luxury'
  );

  assert.ok(direct);
  assert.match(direct.command, /"hookText":"NEW APP FOR PROMO"/);
  assert.match(direct.command, /"ctaText":"JOIN THE GUESTLIST"/);
  assert.match(direct.command, /"fontStyle":"luxury"/);
});

test("web assistant extracts promo video source folder from natural requests", () => {
  const direct = buildDirectPromoVideoCommand(
    'hazme 5 videos para TikTok de promo de la carpeta Pool parties que diga "POOL PARTY THIS WEEK"'
  );

  assert.ok(direct);
  assert.match(direct.command, /"sourceHint":"Pool parties"/);
  assert.match(direct.content, /carpeta "Pool parties"/);
});

test("web assistant asks for confirmation when promo source is unclear", () => {
  const source = readFileSync("server/assistant.ts", "utf8");

  assert.match(source, /PromoVideoSourceError/);
  assert.match(source, /promoVideoNeedsSourceConfirmation/);
  assert.match(source, /Confirmame cual carpeta quieres usar/);
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

test("web assistant accepts Black Room link updates that only change the URL", () => {
  const source = readFileSync("server/assistant.ts", "utf8");

  assert.match(source, /typeof linkData\.matchTitle === "string" && linkData\.matchTitle\.trim\(\)/);
  assert.match(source, /Falta title o matchTitle para el link/);
});

test("dashboard assistant chat shows Black Room approval creation errors", () => {
  const source = readFileSync("client/src/components/dashboard-assistant-chat.tsx", "utf8");

  assert.match(source, /data\.blackRoomLinkError/);
  assert.match(source, /No pude completar la accion/);
});

test("web assistant only auto-executes after explicit chat approval", () => {
  assert.equal(userAlreadyApprovedExecution("si, hazlo"), true);
  assert.equal(userAlreadyApprovedExecution("lo apruebo, ejecutalo"), true);
  assert.equal(userAlreadyApprovedExecution("si quiero que empiece la tarea"), true);
  assert.equal(userAlreadyApprovedExecution("quiero que cambies el link de Black Room"), false);
  assert.equal(userAlreadyApprovedExecution("prepara la tarea para aprobar"), false);
});

test("web assistant can execute one pending approval directly from chat", () => {
  const source = readFileSync("server/assistant.ts", "utf8");

  assert.match(source, /executeSinglePendingApprovalFromChat/);
  assert.match(source, /Tengo varias aprobaciones pendientes/);
  assert.match(source, /Aprobado y ejecutado desde el chat/);
});

test("assistant approval prompt explains chat approval shortcut", () => {
  const dashboardChat = readFileSync("client/src/components/dashboard-assistant-chat.tsx", "utf8");
  const assistantPage = readFileSync("client/src/pages/assistant.tsx", "utf8");

  assert.match(dashboardChat, /Puedes decir "si, hazlo"/);
  assert.match(assistantPage, /Puedes decir "si, hazlo"/);
});
