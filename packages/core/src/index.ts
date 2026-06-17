/** @lifeline/core — engine abstraction, evidence logging, and sysinfo. */
export type {
  ChatMsg,
  CompletionStats,
  EngineKind,
  InferenceEngine,
  ModelRef,
  ModelSrc,
  ProgressUpdate,
  Role,
} from "./types";

export {
  createEngine,
  LocalEngine,
  MODELS,
  DEFAULT_MODEL,
  type EngineOptions,
} from "./engine";

export { RunLogger } from "./logger";
export type {
  EvidenceEvent,
  InferenceEvent,
  MeasuredInference,
  ModelLoadEvent,
  ModelUnloadEvent,
  SdkProfileEvent,
  SessionEvent,
} from "./logger";

export { collectSysInfo, formatSysInfoTable } from "./sysinfo";
export type { SysInfo } from "./sysinfo";
