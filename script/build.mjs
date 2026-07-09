import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import * as esbuild from "esbuild";

const buildTimeoutMs = Number(process.env.BUILD_TIMEOUT_MS || 120000);

function run(label, command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${label} timed out after ${buildTimeoutMs}ms`));
    }, buildTimeoutMs);
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${label} failed with exit code ${code}`));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

await rm("dist", { recursive: true, force: true });

await run("vite build", "npx", ["vite", "build"]);

await esbuild.build({
  entryPoints: ["server/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/index.cjs",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  external: [
    "@vitejs/*",
    "vite",
    "../vite.config",
    "../vite.config.ts",
  ],
  sourcemap: false,
  minify: true,
});

console.log("[build] done");
