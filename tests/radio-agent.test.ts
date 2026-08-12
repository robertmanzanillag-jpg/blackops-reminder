import assert from "node:assert/strict";
import test from "node:test";
import { buildRadioCalendarFields, detectRadioCity, parseRadioDescription } from "../server/radio-calendar-parser";

test("parseRadioDescription reads the four Calendar lineup rows", () => {
  assert.deepEqual(parseRadioDescription("4pm: Zamurai\n5:00 PM: Lucia Reina\n6pm - N1T0\n7 PM: DANIØ"), {
    4: "Zamurai",
    5: "Lucia Reina",
    6: "N1T0",
    7: "DANIØ",
  });
});

test("parseRadioDescription keeps legacy Miami 7-9 PM rows", () => {
  assert.deepEqual(parseRadioDescription("7: DJ One 8: DJ Two 9: DJ Three"), {
    7: "DJ One",
    8: "DJ Two",
    9: "DJ Three",
  });
});

test("detectRadioCity recognizes the three approved flyers", () => {
  assert.equal(detectRadioCity("BLACK ROOM RADIO MIAMI"), "miami");
  assert.equal(detectRadioCity("BLACK ROOM RADIO BERLIN"), "berlin");
  assert.equal(detectRadioCity("BLACK ROOM RADIO BUENOS AIRES"), "buenos_aires");
});

test("buildRadioCalendarFields derives a fixed city lineup and timezone lines", () => {
  const slot = buildRadioCalendarFields(
    "BLACK ROOM RADIO BUENOS AIRES",
    "4pm: Zamurai\n5pm: TBA\n6pm: N1T0\n7pm:",
    new Date("2026-08-13T20:00:00.000Z"),
  );
  assert.equal(slot.city, "buenos_aires");
  assert.deepEqual(slot.lineup.map(({ hour, djName }) => ({ hour, djName })), [
    { hour: 4, djName: "Zamurai" },
    { hour: 5, djName: null },
    { hour: 6, djName: "N1T0" },
    { hour: 7, djName: null },
  ]);
  assert.deepEqual(slot.emptySlots, [5, 7]);
  assert.deepEqual(slot.timezoneLines, ["5PM ART [BUENOS AIRES]", "4PM EDT [MIAMI]"]);
  assert.equal(slot.ordinalDay, "13TH");
});

test("timezone labels follow daylight-saving time on the event date", () => {
  const summer = buildRadioCalendarFields("Black Room Radio Berlin", null, new Date("2026-08-13T14:00:00.000Z"));
  const winter = buildRadioCalendarFields("Black Room Radio Berlin", null, new Date("2026-12-10T15:00:00.000Z"));
  assert.equal(summer.timezoneLines[0], "4PM CEST [BERLIN]");
  assert.equal(winter.timezoneLines[0], "4PM CET [BERLIN]");
});

test("a partial Berlin description keeps all four fixed flyer rows", () => {
  const slot = buildRadioCalendarFields("Black Room Radio Berlin", "4pm: Zamurai", new Date("2026-08-13T14:00:00.000Z"));
  assert.deepEqual(slot.lineup.map(({ hour, djName }) => ({ hour, djName })), [
    { hour: 4, djName: "Zamurai" },
    { hour: 5, djName: null },
    { hour: 6, djName: null },
    { hour: 7, djName: null },
  ]);
  assert.deepEqual(slot.emptySlots, [5, 6, 7]);
});
