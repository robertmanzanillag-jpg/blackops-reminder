import fs from "node:fs";
import {
  reviewRevenuePublicLeadCandidates,
  revenuePublicCandidateBatchSchema,
} from "../server/revenue-engine";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: npm run revenue:public-candidates:review -- <batch.json>");
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const result = reviewRevenuePublicLeadCandidates(revenuePublicCandidateBatchSchema.parse(payload));

console.log(JSON.stringify(result, null, 2));
