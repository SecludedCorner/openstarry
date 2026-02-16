/**
 * Inference provider types — extends IProvider for non-LLM models (CNN/DNN).
 *
 * CNN/DNN plugins implement IInferenceProvider to provide structured inference
 * while remaining compatible with the standard ProviderRegistry (想蘊).
 */

import type { IProvider } from "./provider.js";

// ─── Input Types ────────────────────────────────────────

/** Discriminated union of inference input formats. */
export type InferenceInput =
  | { type: "image"; data: Uint8Array; mimeType: string }
  | { type: "tensor"; shape: number[]; data: number[] }
  | { type: "text"; text: string }
  | { type: "raw"; data: unknown };

/** A request to an inference provider. */
export interface InferenceRequest {
  /** Model ID to use for inference. */
  model: string;

  /** Structured input data. */
  input: InferenceInput;

  /** Provider-specific options (e.g., confidence threshold). */
  options?: Record<string, unknown>;

  /** Optional abort signal. */
  signal?: AbortSignal;
}

// ─── Output Types ───────────────────────────────────────

/** A single classification label with confidence score. */
export interface ClassificationLabel {
  label: string;
  score: number;
}

/** A detected object with bounding box. */
export interface DetectedObject {
  label: string;
  score: number;
  /** [x, y, width, height] normalized to [0, 1]. */
  bbox: [number, number, number, number];
}

/** Discriminated union of inference output formats. */
export type InferenceOutput =
  | { type: "classification"; labels: ClassificationLabel[] }
  | { type: "features"; vector: number[] }
  | { type: "detection"; objects: DetectedObject[] }
  | { type: "text"; text: string }
  | { type: "raw"; data: unknown };

/** The result of an inference invocation. */
export interface InferenceResult {
  /** Model ID that produced the result. */
  model: string;

  /** Structured output data. */
  output: InferenceOutput;

  /** Provider-specific metadata (e.g., latency, confidence). */
  metadata?: Record<string, unknown>;
}

// ─── Interface ──────────────────────────────────────────

/**
 * Inference provider interface — extends IProvider for non-LLM models.
 *
 * CNN/DNN plugins implement this interface to provide structured inference
 * while remaining compatible with the standard ProviderRegistry (想蘊).
 *
 * The inherited `chat()` method serves as an adapter: converts the last
 * user message to text InferenceInput, runs inference, yields result as
 * text_delta. This allows inference providers to be used in LLM steps
 * as a fallback, though `inference` steps are preferred.
 */
export interface IInferenceProvider extends IProvider {
  /** Perform structured inference on the given input. */
  infer(request: InferenceRequest): Promise<InferenceResult>;
}

// ─── Type Guard ─────────────────────────────────────────

/**
 * Runtime type guard to check if a provider supports inference.
 *
 * Usage:
 * ```typescript
 * const provider = ctx.providers?.get("my-cnn");
 * if (isInferenceProvider(provider)) {
 *   const result = await provider.infer(request);
 * }
 * ```
 */
export function isInferenceProvider(
  provider: IProvider | undefined
): provider is IInferenceProvider {
  return provider !== undefined && typeof (provider as IInferenceProvider).infer === "function";
}
