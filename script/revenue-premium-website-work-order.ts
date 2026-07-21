import fs from "node:fs";
import {
  buildRevenueWebsiteCreationPacket,
  revenuePremiumWebsiteWorkOrderSchema,
} from "../server/revenue-engine";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: npm run revenue:premium-website:work-order -- <work-order.json>");
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const result = buildRevenueWebsiteCreationPacket(revenuePremiumWebsiteWorkOrderSchema.parse(payload));

console.log(JSON.stringify(result, null, 2));
if (result.status === "blocked") process.exit(2);
