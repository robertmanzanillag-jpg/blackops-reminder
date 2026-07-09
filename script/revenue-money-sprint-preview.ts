import fs from "node:fs";
import {
  buildRevenueMoneySprintPreview,
  revenueMoneySprintRunPacketReviewSchema,
} from "../server/revenue-engine";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: npm run revenue:money-sprint:preview -- <review-packet.json>");
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const result = buildRevenueMoneySprintPreview(revenueMoneySprintRunPacketReviewSchema.parse(payload));

console.log(JSON.stringify(result, null, 2));
if (result.status === "blocked") process.exit(2);
