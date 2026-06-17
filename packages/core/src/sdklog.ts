/**
 * sdklog.ts — control QVAC's own console logging (the `[sdk:server]`/`[sdk:client]`
 * lines). Used for the CLI's `--json` mode so stdout stays machine-clean.
 */
import { setGlobalConsoleOutput, setGlobalLogLevel } from "@qvac/sdk/logging";

export type SdkLogLevel = "error" | "warn" | "info" | "debug" | "off";

/** Enable/disable the SDK printing its logs to the console. */
export function setSdkConsole(enabled: boolean): void {
  setGlobalConsoleOutput(enabled);
}

/** Set the SDK's global log level. */
export function setSdkLogLevel(level: SdkLogLevel): void {
  setGlobalLogLevel(level);
}
