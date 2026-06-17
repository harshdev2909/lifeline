/** @lifeline/core — engine abstraction, evidence logging, and sysinfo. */
export type {
  ChatMsg,
  CompletionStats,
  DelegationInfo,
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
  DelegatedEngine,
  MODELS,
  DEFAULT_MODEL,
  type EngineOptions,
} from "./engine";

export { Provider } from "./provider";
export type { FirewallConfig, ProviderOptions } from "./provider";

export { topicToSeedHex, topicToProviderKey, seedHexToProviderKey } from "./p2p";

export { setSdkConsole, setSdkLogLevel } from "./sdklog";
export type { SdkLogLevel } from "./sdklog";

export { RunLogger } from "./logger";
export type {
  BenchEvent,
  BenchRow,
  DelegationEvent,
  EvidenceEvent,
  FallbackEvent,
  InferenceEvent,
  MeasuredInference,
  ModelLoadEvent,
  ModelUnloadEvent,
  SdkProfileEvent,
  SessionEvent,
} from "./logger";

export { collectSysInfo, formatSysInfoTable } from "./sysinfo";
export type { SysInfo } from "./sysinfo";
