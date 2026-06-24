import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { mkdir, rm, readFile } from "fs/promises";
import { spawn } from "child_process";

function pipInstallEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PIP_USER: "false",
    PYTHONNOUSERSITE: "1",
  };
}

function runCommand(command: string, args: string[], timeoutMs: number, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
    });
    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (didTimeout) {
        reject(new Error(`${command} timed out`));
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${code}`));
    });
  });
}

async function bundleFreshYtDlp() {
  const targetDir = "dist/yt-dlp-python";
  await mkdir(targetDir, { recursive: true });
  try {
    console.log("installing fresh yt-dlp for production...");
    await runCommand("python3", [
      "-m",
      "pip",
      "--isolated",
      "install",
      "--upgrade",
      "--target",
      targetDir,
      "yt-dlp",
    ], 3 * 60 * 1000, pipInstallEnv());
  } catch (error) {
    console.warn("[build] could not bundle fresh yt-dlp:", error instanceof Error ? error.message : error);
  }
}

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
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

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  await bundleFreshYtDlp();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
