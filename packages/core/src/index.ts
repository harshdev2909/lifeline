/** @lifeline/core — engine abstraction, evidence logging, and sysinfo. */
export type {
  ChatMsg,
  CompletionStats,
  DelegationInfo,
  EngineKind,
  InferenceEngine,
  ModelRef,
  ModelSrc,
  PeerProbe,
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

export { probePeer, probePeers, closeSdkWorker } from "./mesh";
export type { ProbeOptions } from "./mesh";

export { setSdkConsole, setSdkLogLevel } from "./sdklog";
export type { SdkLogLevel } from "./sdklog";

export { transcribeAudio } from "./voice";
export type { TranscribeResult, TranscribeOptions } from "./voice";

export { synthesizeToWav, wavBuffer } from "./tts";
export type { TtsResult, TtsOptions } from "./tts";

export { translateToEnglish, translateFromEnglish, isSupportedLang, supportedLangs, TRANSLATION_PAIRS } from "./translate";
export type { TranslateResult } from "./translate";

export { extractText } from "./ocr";
export type { OcrResult, OcrOptions, OcrBlock } from "./ocr";

export { KnowledgeBase } from "./rag";
export type {
  KnowledgeBaseOptions,
  RetrievedPassage,
  IngestStats,
  SearchStats,
} from "./rag";

export {
  assessSafety,
  detectRedFlags,
  detectInjection,
  extractCitations,
  buildGroundedSystemPrompt,
  buildVisionSystemPrompt,
  ungroundedRefusal,
  MEDICAL_DISCLAIMER,
  EMERGENCY_NOTICE,
} from "./safety";
export type { SafetyAction, SafetyResult } from "./safety";

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
  RoutingEvent,
  SdkProfileEvent,
  SessionEvent,
} from "./logger";

export { collectSysInfo, formatSysInfoTable } from "./sysinfo";
export type { SysInfo } from "./sysinfo";
