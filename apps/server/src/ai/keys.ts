import { execFileSync } from "node:child_process";

/** The Keychain item that holds the OpenAI key on macOS. */
export const OPENAI_KEYCHAIN_SERVICE = "clearcare-openai";

/** How to add the key: a script that asks for the API key by name and refuses anything that isn't one. */
export const OPENAI_KEY_COMMAND = "scripts/set-openai-key.sh (in a Terminal window, from the clearcare folder)";

/**
 * The OpenAI API key: OPENAI_API_KEY when set, otherwise the macOS Keychain item. The key is never written to a file
 * by ClearCare, and never logged.
 */
export function openAiKey(): string | null {
  const fromEnv = (process.env["OPENAI_API_KEY"] ?? "").trim();
  if (fromEnv !== "") return fromEnv;
  if (process.platform !== "darwin") return null;
  try {
    const key = execFileSync("/usr/bin/security", ["find-generic-password", "-s", OPENAI_KEYCHAIN_SERVICE, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    return key === "" ? null : key;
  } catch {
    return null;
  }
}
