import { build } from "esbuild";
import { readFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];
const allDeps = [
  ...Object.keys(pkg.dependencies || {}),
  ...Object.keys(pkg.devDependencies || {}),
];
const externals = allDeps.filter((dep) => !allowlist.includes(dep));

async function main() {
  await build({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: { "process.env.NODE_ENV": '"production"' },
    minify: true,
    external: externals,
    logLevel: "info",
  });
  console.log("Server build OK");

  const binDir = path.join(rootDir, "bin");
  const ytdlpPath = path.join(binDir, "yt-dlp");
  if (existsSync(ytdlpPath)) {
    console.log("yt-dlp already present:", ytdlpPath);
  } else {
    console.log("Attempting to download yt-dlp binary...");
    try {
      mkdirSync(binDir, { recursive: true });
      execSync(
        `curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp" -o "${ytdlpPath}"`,
        { stdio: "inherit", timeout: 60000 }
      );
      chmodSync(ytdlpPath, 0o755);
      console.log("yt-dlp downloaded:", ytdlpPath);
    } catch (err) {
      console.warn("Warning: could not download yt-dlp during build:", err.message);
      console.warn("The server will fall back to system yt-dlp or python3 -m yt_dlp at runtime.");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
