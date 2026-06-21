import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDirectRadioYoutubeCommand, directRadioYoutubeCommandNeedsDriveFolder, extractDriveFolderPathFromMessage, formatRadioYoutubeResult } from "../server/radio-youtube-command";

test("extracts Drive folder path from radio YouTube request", () => {
  assert.deepEqual(
    extractDriveFolderPathFromMessage("sacame clips de radio de https://youtu.be/abc123 y guardalos en la carpeta Radio Junio del Drive"),
    ["Radio Junio"],
  );

  assert.deepEqual(
    extractDriveFolderPathFromMessage("haz videos radio https://youtube.com/watch?v=abc en carpeta \"Robert A/Videos de Black Room/Junio\""),
    ["Robert A", "Videos de Black Room", "Junio"],
  );

  assert.deepEqual(
    extractDriveFolderPathFromMessage("sacalos de radio y guardalos en Radio Junio del Drive"),
    ["Radio Junio"],
  );

  assert.deepEqual(
    extractDriveFolderPathFromMessage("saca clips de radio de https://youtu.be/abc y en la carpeta de radio crea una carpeta con los videos que creaste"),
    ["radio", "Videos creados"],
  );
});

test("builds direct radio YouTube command only for radio clip requests", () => {
  const command = buildDirectRadioYoutubeCommand("hazme los clips de radio de https://youtu.be/abc123 y guardalos en carpeta Radio Junio del Drive");
  assert.equal(command?.youtubeUrl, "https://youtu.be/abc123");
  assert.deepEqual(command?.driveFolderPath, ["Radio Junio"]);

  assert.equal(buildDirectRadioYoutubeCommand("mira este link https://youtu.be/abc123"), null);
});

test("builds direct YouTube clip command when Drive destination is requested without saying radio", () => {
  const command = buildDirectRadioYoutubeCommand("https://youtu.be/GcVZvXKz2jU quiero que me saques los clips de este video y me lo agregues en la carpeta Robert A/Videos de Lucia Reina del Drive");
  assert.equal(command?.youtubeUrl, "https://youtu.be/GcVZvXKz2jU");
  assert.deepEqual(command?.driveFolderPath, ["Robert A", "Videos de Lucia Reina"]);
  assert.match(command?.command || "", /RADIO_YOUTUBE_CLIPS/);
});

test("uses YouTube title as Drive folder when requested", () => {
  const command = buildDirectRadioYoutubeCommand("https://youtu.be/GcVZvXKz2jU quiero que me saques los clips de este video y me lo agregues en la carpeta de drive con el titulo");
  assert.equal(command?.youtubeUrl, "https://youtu.be/GcVZvXKz2jU");
  assert.equal(command?.driveFolderPathFromYoutubeTitle, true);
  assert.equal(command?.createFolderIfMissing, true);
  assert.deepEqual(command?.driveFolderPath, []);
  assert.match(command?.command || "", /driveFolderPathFromYoutubeTitle/);
  assert.equal(command ? directRadioYoutubeCommandNeedsDriveFolder(command) : true, false);
});

test("extracts music URL for drop-based radio edits", () => {
  const command = buildDirectRadioYoutubeCommand("haz clips de radio de https://youtu.be/video123 con drop de esta cancion https://youtu.be/song456 y guardalos en carpeta Radio Junio del Drive");
  assert.equal(command?.youtubeUrl, "https://youtu.be/video123");
  assert.equal(command?.musicUrl, "https://youtu.be/song456");
  assert.match(command?.content || "", /drop de la canción/i);
});

test("uses source video drop when a drop is requested without a song link", () => {
  const command = buildDirectRadioYoutubeCommand("haz clips de radio de https://youtu.be/video123 con un drop de una cancion y guardalos en carpeta Radio Junio del Drive");
  assert.equal(command?.needsMusicUrl, undefined);
  assert.equal(command?.musicUrl, undefined);
  assert.match(command?.content || "", /drop del mismo video/i);
});

test("extracts explicit DJ name when provided", () => {
  const command = buildDirectRadioYoutubeCommand("haz clips de radio de https://youtu.be/video123 DJ Lucía Reina y guardalos en carpeta Radio Junio del Drive");
  assert.equal(command?.djName, "Lucía Reina");
  assert.match(command?.command || "", /Lucía Reina/);
});

test("marks Drive folder creation as approved when user asks for a subfolder", () => {
  const command = buildDirectRadioYoutubeCommand("https://youtu.be/video123 saca clips de radio y en la carpeta Robert A crea una subcarpeta LUCIA REINA del Drive");
  assert.equal(command?.createFolderIfMissing, true);
  assert.match(command?.command || "", /createFolderIfMissing/);
});

test("asks for Drive folder when missing", () => {
  const command = buildDirectRadioYoutubeCommand("saca clips de radio de https://youtu.be/abc123");
  assert.equal(command?.driveFolderPath.length, 0);
  assert.match(command?.content || "", /carpeta de Google Drive/i);
});

test("includes estimated cost in completed radio YouTube summary", () => {
  const summary = formatRadioYoutubeResult({
    youtubeUrl: "https://youtu.be/abc123",
    videoPath: "/tmp/source.mp4",
    status: "completed",
    djName: "MYNA",
    driveFolderPath: ["Radio Junio"],
    clips: [
      {
        kind: "horizontal_ig",
        path: "/tmp/MYNA_60s_horizontal_ig.mp4",
        durationSeconds: 60,
        width: 1080,
        height: 1350,
        audioSource: "source_drop",
        musicDropSecond: 42,
      },
      {
        kind: "vertical_tiktok",
        path: "/tmp/MYNA_30s_vertical_tiktok.mp4",
        durationSeconds: 30,
        width: 1080,
        height: 1920,
        audioSource: "source_drop",
        musicDropSecond: 42,
      },
    ],
  });

  assert.match(summary, /Audio: usé el drop del mismo video fuente/);
  assert.match(summary, /Costo estimado por video editado: \$0\.00 USD/);
  assert.match(summary, /Total estimado de esta edición: \$0\.00 USD para 2 videos/);
});
