import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Syntax preflight only. Runtime schemas still validate grants, budgets and permissions.
 * Never report parser/OS errors: either may contain private configuration bytes or paths.
 */
export function validateFactoryPrivateConfig(argv, report = console.error) {
  if (argv.length !== 2) {
    report("FACTORY_PRIVATE_CONFIG_ARGUMENTS_INVALID");
    return false;
  }
  for (const [index, label] of ["SHARED_CREDIT", "OPERATOR"].entries()) {
    try {
      const stat = statSync(argv[index]);
      if (!stat.isFile() || stat.size < 2 || stat.size > 1048576) throw Error();
      const value = JSON.parse(readFileSync(argv[index], "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    } catch {
      report(`FACTORY_${label}_CONFIG_INVALID`);
      return false;
    }
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!validateFactoryPrivateConfig(process.argv.slice(2))) process.exitCode = 1;
}
