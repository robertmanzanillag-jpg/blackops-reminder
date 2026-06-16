import { storage } from "../server/storage";
import { hashPassword } from "../server/local-auth-core";
import { parseCreateLocalUserArgs, validateCreateLocalUserOptions } from "../server/local-auth-cli";

async function main() {
  const options = parseCreateLocalUserArgs(process.argv.slice(2));
  const errors = validateCreateLocalUserOptions(options);

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    console.error("Usage: npm run auth:create-user -- --username=<username> --password=<password> [--print-user-id]");
    process.exit(1);
  }

  const existing = await storage.getUserByUsername(options.username);
  if (existing) {
    console.log(`User already exists: ${options.username}`);
    if (options.printUserId) console.log(existing.id);
    return;
  }

  const user = await storage.createUser({
    username: options.username,
    password: await hashPassword(options.password),
  });

  console.log(`Created local auth user: ${user.username}`);
  if (options.printUserId) console.log(user.id);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
