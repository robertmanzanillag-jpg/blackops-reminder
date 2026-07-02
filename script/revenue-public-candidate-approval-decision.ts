import "../server/env-loader";

async function main() {
  console.error(
    "Direct public candidate approval is disabled. Queue and approve the Revenue Engine Trust Center action instead.",
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
