import { normalizeUsername } from "./local-auth-core";

export type LocalAuthCreateUserOptions = {
  username: string;
  password: string;
  printUserId: boolean;
};

export function parseCreateLocalUserArgs(argv: string[]): LocalAuthCreateUserOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };

  return {
    username: normalizeUsername(getValue("--username")),
    password: getValue("--password"),
    printUserId: argv.includes("--print-user-id"),
  };
}

export function validateCreateLocalUserOptions(options: LocalAuthCreateUserOptions): string[] {
  const errors: string[] = [];
  if (!options.username || options.username.length < 2) {
    errors.push("--username is required and must be at least 2 characters.");
  }
  if (!options.password || options.password.length < 8) {
    errors.push("--password is required and must be at least 8 characters.");
  }
  return errors;
}
