import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildDirectRadioDriveVideoCommand, buildDirectRadioYoutubeCommand, directRadioDriveVideoCommandNeedsDriveFolder, directRadioYoutubeCommandNeedsDriveFolder, extractDriveFolderPathFromMessage, formatRadioDriveVideoResult, formatRadioYoutubeResult } from "../server/radio-youtube-command";
import { extractGoogleDriveFileIdFromUrl } from "../server/google-drive-file-url";
import { buildYtDlpCommandSpecs, formatYtDlpFailureMessage } from "../server/youtube-downloader";

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

  assert.deepEqual(
    extractDriveFolderPathFromMessage("https://youtu.be/abc123 sacame un clip y guardalo en Drive en una carpeta llamada Codex QA Replit 2026-06-21."),
    ["Codex QA Replit 2026-06-21"],
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

test("extracts a Google Drive file id without confusing folder urls", () => {
  assert.equal(
    extractGoogleDriveFileIdFromUrl("https://drive.google.com/file/d/1abcDEFghiJKLmnopQRSTuv/view?usp=sharing"),
    "1abcDEFghiJKLmnopQRSTuv",
  );
  assert.equal(
    extractGoogleDriveFileIdFromUrl("https://drive.google.com/open?id=1abcDEFghiJKLmnopQRSTuv"),
    "1abcDEFghiJKLmnopQRSTuv",
  );
  assert.equal(
    extractGoogleDriveFileIdFromUrl("https://drive.google.com/drive/folders/1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW"),
    null,
  );
});

test("builds direct Drive MP4 clip command with source cleanup", () => {
  const command = buildDirectRadioDriveVideoCommand(
    "Toma este MP4 de Drive https://drive.google.com/file/d/1abcDEFghiJKLmnopQRSTuv/view saca 3 videos de IG y TikTok diferentes, guardalos en carpeta Robert A/Lucia Reina del Drive y despues borra el video largo",
  );

  assert.equal(command?.sourceDriveFileId, "1abcDEFghiJKLmnopQRSTuv");
  assert.deepEqual(command?.driveFolderPath, ["Robert A", "Lucia Reina"]);
  assert.equal(command?.instagramClipCount, 3);
  assert.equal(command?.tiktokClipCount, 3);
  assert.equal(command?.deleteSourceAfterSuccess, true);
  assert.match(command?.content || "", /MP4 de Google Drive/);
  assert.match(command?.command || "", /RADIO_DRIVE_VIDEO_CLIPS/);
});

test("uses a Google Drive folder URL as destination for Drive MP4 clips", () => {
  const command = buildDirectRadioDriveVideoCommand(
    "https://drive.google.com/file/d/1abcDEFghiJKLmnopQRSTuv/view sacame clips y guardalos en https://drive.google.com/drive/folders/1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW?usp=drive_link",
  );

  assert.equal(command?.sourceDriveFileId, "1abcDEFghiJKLmnopQRSTuv");
  assert.equal(command?.driveParentFolderId, "1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW");
  assert.deepEqual(command?.driveFolderPath, []);
  assert.equal(command ? directRadioDriveVideoCommandNeedsDriveFolder(command) : true, false);
});

test("asks for Drive destination when only a Drive MP4 source is provided", () => {
  const command = buildDirectRadioDriveVideoCommand(
    "https://drive.google.com/file/d/1abcDEFghiJKLmnopQRSTuv/view sacame clips para tiktok e instagram",
  );

  assert.ok(command);
  assert.equal(command ? directRadioDriveVideoCommandNeedsDriveFolder(command) : false, true);
  assert.match(command?.content || "", /carpeta de Google Drive/i);
  assert.equal(command?.command, "");
});

test("uses a Google Drive folder URL as the parent destination", () => {
  const command = buildDirectRadioYoutubeCommand("https://youtu.be/GcVZvXKz2jU sacame clips y guardalos en https://drive.google.com/drive/folders/1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW?usp=drive_link");
  assert.equal(command?.youtubeUrl, "https://youtu.be/GcVZvXKz2jU");
  assert.equal(command?.driveParentFolderId, "1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW");
  assert.deepEqual(command?.driveFolderPath, []);
  assert.equal(command ? directRadioYoutubeCommandNeedsDriveFolder(command) : true, false);
});

test("extracts a child folder inside a Google Drive folder URL", () => {
  const command = buildDirectRadioYoutubeCommand("https://youtu.be/GcVZvXKz2jU sacame clips y guardalos en https://drive.google.com/drive/folders/1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW dentro de esta carpeta crea una subcarpeta llamada Codex Clips");
  assert.equal(command?.driveParentFolderId, "1DFAJg05WgnKj1rXu0YUrOWWrT15ilVWW");
  assert.deepEqual(command?.driveFolderPath, ["Codex Clips"]);
  assert.match(command?.command || "", /driveParentFolderId/);
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

test("extracts requested Instagram and TikTok clip counts and source cleanup", () => {
  const command = buildDirectRadioYoutubeCommand(
    "https://youtu.be/GcVZvXkz2jU saca 3 videos de IG y de TikTok diferentes, guardalos en carpeta Robert A/Lucia Reina del Drive y despues borra el video largo",
  );

  assert.equal(command?.instagramClipCount, 3);
  assert.equal(command?.tiktokClipCount, 3);
  assert.equal(command?.deleteSourceAfterSuccess, true);
  assert.match(command?.command || "", /"instagramClipCount":3/);
  assert.match(command?.command || "", /"tiktokClipCount":3/);
  assert.match(command?.content || "", /3 clips para Instagram y 3 clips para TikTok/);
  assert.match(command?.content || "", /borr[ao]r? el video largo local/i);
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
    sourceVideoDeleted: true,
    sourceVideoDeletedPath: "/tmp/source.mp4",
  });

  assert.match(summary, /Audio: usé el drop del mismo video fuente/);
  assert.match(summary, /borré el video largo local/);
  assert.match(summary, /Costo estimado por video editado: \$0\.00 USD/);
  assert.match(summary, /Total estimado de esta edición: \$0\.00 USD para 2 videos/);
});

test("includes local source cleanup in completed Drive MP4 summary", () => {
  const summary = formatRadioDriveVideoResult({
    sourceDriveFileId: "1abcDEFghiJKLmnopQRSTuv",
    videoPath: "/tmp/source.mp4",
    status: "completed",
    djName: "LUCIA_REINA",
    driveFolderPath: ["Robert A", "Lucia Reina"],
    clips: [
      {
        kind: "vertical_tiktok",
        path: "/tmp/LUCIA_REINA_30s_vertical_tiktok.mp4",
        durationSeconds: 30,
        width: 1080,
        height: 1920,
        audioSource: "source_drop",
      },
    ],
    sourceVideoDeleted: true,
    sourceVideoDeletedPath: "/tmp/source.mp4",
  });

  assert.match(summary, /LUCIA_REINA/);
  assert.match(summary, /borré el video largo local/);
  assert.match(summary, /Total estimado de esta edición: \$0\.00 USD para 1 video/);
});

test("yt-dlp command specs try 1080p video with and without JS runtime flags", () => {
  const specs = buildYtDlpCommandSpecs({
    url: "https://youtu.be/GcVZvXkz2jU",
    outputTemplate: "/tmp/%(id)s.%(ext)s",
    mode: "video",
    explicitBinary: "/workspace/bin/yt-dlp",
    cookieArgs: ["--cookies", "/tmp/youtube-cookies.txt"],
  });

  assert.ok(specs.some((spec) => spec.command === "/workspace/bin/yt-dlp"));
  assert.ok(specs.some((spec) => spec.args.includes("--js-runtimes") && spec.args.includes("deno")));
  assert.ok(specs.some((spec) => spec.args.includes("--js-runtimes") && spec.args.includes("node")));
  assert.ok(specs.some((spec) => !spec.args.includes("--js-runtimes")));
  assert.ok(specs.every((spec) => spec.args.includes("bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/best")));
  assert.ok(specs.every((spec) => spec.args.includes("--cookies") && spec.args.includes("/tmp/youtube-cookies.txt")));
});

test("yt-dlp command specs materialize chunked base64 YouTube cookies", () => {
  const cookieText = [
    "# Netscape HTTP Cookie File",
    ".youtube.com\tTRUE\t/\tTRUE\t1893456000\tVISITOR_INFO1_LIVE\tfake_value",
    "",
  ].join("\n");
  const encoded = Buffer.from(cookieText, "utf8").toString("base64");
  const midpoint = Math.ceil(encoded.length / 2);
  const previousDirect = process.env.YT_DLP_COOKIES_B64;
  const previousOne = process.env.YT_DLP_COOKIES_B64_1;
  const previousTwo = process.env.YT_DLP_COOKIES_B64_2;

  delete process.env.YT_DLP_COOKIES_B64;
  process.env.YT_DLP_COOKIES_B64_1 = encoded.slice(0, midpoint);
  process.env.YT_DLP_COOKIES_B64_2 = encoded.slice(midpoint);

  try {
    const specs = buildYtDlpCommandSpecs({
      url: "https://youtu.be/GcVZvXkz2jU",
      outputTemplate: "/tmp/%(id)s.%(ext)s",
      mode: "video",
    });
    const cookiesIndex = specs[0].args.indexOf("--cookies");
    assert.ok(cookiesIndex >= 0);
    const cookiePath = specs[0].args[cookiesIndex + 1];
    assert.match(readFileSync(cookiePath, "utf8"), /Netscape HTTP Cookie File/);
    assert.ok(specs.every((spec) => spec.args.includes("--cookies") && spec.args.includes(cookiePath)));
  } finally {
    if (previousDirect === undefined) delete process.env.YT_DLP_COOKIES_B64;
    else process.env.YT_DLP_COOKIES_B64 = previousDirect;
    if (previousOne === undefined) delete process.env.YT_DLP_COOKIES_B64_1;
    else process.env.YT_DLP_COOKIES_B64_1 = previousOne;
    if (previousTwo === undefined) delete process.env.YT_DLP_COOKIES_B64_2;
    else process.env.YT_DLP_COOKIES_B64_2 = previousTwo;
  }
});

test("yt-dlp failure message explains YouTube bot blocks without routing to GitHub", () => {
  const message = formatYtDlpFailureMessage(
    "ERROR: [youtube] GcVZvXkz2jU: Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication.",
    "video",
  );

  assert.match(message, /YouTube bloqueó la descarga desde Replit/);
  assert.match(message, /YT_DLP_COOKIES_B64|MP4 fuente/);
  assert.doesNotMatch(message, /GitHub|handoff|PR/i);
});
