/**
 * Cloudflare Clairic extraction over Workers AI REST.
 *
 * @stability unstable
 * @since 4.0.6
 */
import * as AiError from "effect/ai/AiError"
import type * as Extraction from "effect/ai/Extraction"
import * as ExtractionModel from "effect/ai/ExtractionModel"
import * as AiModel from "effect/ai/Model"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Predicate from "effect/Predicate"
import { CloudflareClient } from "./CloudflareClient.ts"
import type * as CloudflareSchema from "./CloudflareSchema.ts"

declare module "effect/ai/Extraction" {
  interface NumberOptions {
    readonly cloudflare?: { readonly unit?: string | null } | null
  }
  interface SpanAnswerMetadata {
    readonly cloudflare?: {
      readonly guess?: string | null
      readonly nullProbability?: number
      readonly span?: readonly [number, number]
    }
  }
  interface NumberAnswerMetadata {
    readonly cloudflare?: { readonly guess?: number | null; readonly nullProbability?: number }
  }
}

declare module "effect/ai/ExtractionModel" {
  interface ExtractResponseMetadata {
    readonly cloudflare?: {
      readonly truncated: boolean
      readonly stateTokens?: number
      readonly imageTokens?: number
      readonly schemaTokens?: number
      readonly passes?: number
    }
  }
}

/**
 * Supported model selectors.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type Model = "clairic" | "@cf/cloudflare/clairic"

/**
 * Selects Clairic with Cloudflare provider metadata.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export const model = (
  model: Model = "clairic"
): AiModel.Model<"cloudflare", ExtractionModel.ExtractionModel, CloudflareClient> =>
  AiModel.make("cloudflare", model, layer({ model }))

const invalid = (description: string): ExtractionModel.ProviderAnswer => ({ _tag: "Invalid", description })
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const probability = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1

// Clairic's live ASCII/Unicode/repeated-text probes report code-point offsets, end exclusive.
// Keep the index map tied to this exact submitted source; never relocate a repeated match by searching.
const offsetMap = (state: string): ReadonlyArray<number> => {
  const offsets = [0]
  for (const character of state) offsets.push(offsets[offsets.length - 1] + character.length)
  return offsets
}
const spanOffsets = (raw: unknown, offsets: ReadonlyArray<number>): readonly [number, number] | undefined => {
  if (!Array.isArray(raw) || raw.length !== 2) return undefined
  const [start, end] = raw
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= offsets.length) {
    return undefined
  }
  return [offsets[start], offsets[end]]
}
const normalize = (
  field: Extraction.Any,
  raw: unknown,
  state: string,
  offsets: ReadonlyArray<number>
): ExtractionModel.ProviderAnswer => {
  if (
    !Predicate.isObject(raw) || !Object.hasOwn(raw, "value") || raw.type !== (field._tag === "Span" ? "text" : "number")
  ) return invalid("Invalid extraction answer kind or missing value")
  if (raw.confidence !== undefined && !probability(raw.confidence)) return invalid("Invalid confidence")
  if (raw.p_null !== undefined && !probability(raw.p_null)) return invalid("Invalid null probability")
  const confidence = raw.confidence as number | undefined
  if (field._tag === "Number") {
    if (raw.value !== null && !finite(raw.value)) return invalid("Invalid numeric value")
    if (raw.guess !== undefined && raw.guess !== null && !finite(raw.guess)) return invalid("Invalid numeric guess")
    return {
      _tag: "Number",
      value: raw.value,
      confidence,
      metadata: {
        cloudflare: {
          ...(raw.guess === undefined ? {} : { guess: raw.guess as number | null }),
          ...(raw.p_null === undefined ? {} : { nullProbability: raw.p_null as number })
        }
      }
    }
  }
  if (raw.value !== null && typeof raw.value !== "string") return invalid("Invalid text value")
  if (raw.guess !== undefined && raw.guess !== null && typeof raw.guess !== "string") {
    return invalid("Invalid text guess")
  }
  const span = raw.span === undefined ? undefined : spanOffsets(raw.span, offsets)
  if (
    raw.span !== undefined &&
    (span === undefined || typeof raw.guess !== "string" || state.slice(span[0], span[1]) !== raw.guess)
  ) return invalid("Invalid candidate source span")
  if (raw.value !== null && (span === undefined || state.slice(span[0], span[1]) !== raw.value)) {
    return invalid("Text value does not match its source span")
  }
  return {
    _tag: "Span",
    value: raw.value === null ? null : { text: raw.value, start: span![0], end: span![1] },
    confidence,
    metadata: {
      cloudflare: {
        ...(raw.guess === undefined ? {} : { guess: raw.guess as string | null }),
        ...(raw.p_null === undefined ? {} : { nullProbability: raw.p_null as number }),
        ...(span === undefined ? {} : { span })
      }
    }
  }
}

/**
 * Builds a text-only extraction service. Unsupported precision fails before HTTP.
 * Candidate and value spans are normalized from code points to UTF-16.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export const make = Effect.fnUntraced(
  function*(
    options: { readonly model: Model }
  ): Effect.fn.Return<ExtractionModel.ExtractionModel, never, CloudflareClient> {
    const client = yield* CloudflareClient
    return yield* ExtractionModel.make({
      extract: Effect.fnUntraced(function*({ state, fields }) {
        const failInput = (description: string) =>
          Effect.fail(
            AiError.make({
              module: "CloudflareExtractionModel",
              method: "extract",
              reason: new AiError.InvalidUserInputError({ description })
            })
          )
        if (state.length === 0) return yield* failInput("Clairic requires nonempty text")
        if (options.model !== "clairic" && options.model !== "@cf/cloudflare/clairic") {
          return yield* failInput("Unsupported extraction model")
        }
        const requestFields: Record<string, typeof CloudflareSchema.ExtractionField.Encoded> = Object.create(null)
        for (const [key, field] of Object.entries(fields)) {
          if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(key)) {
            return yield* failInput("Invalid Clairic field name")
          }
          const instructions = typeof field.instructions === "string"
            ? field.instructions
            : JSON.stringify(field.instructions)
          if (field._tag === "Span") requestFields[key] = { type: "text", instructions }
          else {
            if (field.decimals !== undefined && field.decimals > 6) {
              return yield* failInput("Clairic supports at most six decimal places")
            }
            const unit = field.options.cloudflare?.unit
            if (unit !== undefined && unit !== null && typeof unit !== "string") {
              return yield* failInput("Clairic unit must be a string")
            }
            requestFields[key] = {
              type: "number",
              instructions,
              ...(field.integer === undefined ? {} : { integer: field.integer }),
              ...(field.decimals === undefined ? {} : { decimals: field.decimals }),
              ...(unit == null ? {} : { unit })
            }
          }
        }
        const response = yield* client.createExtractions({ model: "clairic", state, fields: requestFields })
        const offsets = Object.values(fields).some((field) => field._tag === "Span") ? offsetMap(state) : []
        const answers: Record<string, ExtractionModel.ProviderAnswer> = Object.create(null)
        for (const [key, field] of Object.entries(fields)) {
          if (Object.hasOwn(response.answers, key)) {
            answers[key] = normalize(field, response.answers[key], state, offsets)
          }
        }
        return {
          answers,
          modelId: response.model,
          usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
          metadata: {
            cloudflare: {
              truncated: response.truncated,
              ...(response.usage.state_tokens === undefined ? {} : { stateTokens: response.usage.state_tokens }),
              ...(response.usage.image_tokens === undefined ? {} : { imageTokens: response.usage.image_tokens }),
              ...(response.usage.schema_tokens === undefined ? {} : { schemaTokens: response.usage.schema_tokens }),
              ...(response.usage.passes === undefined ? {} : { passes: response.usage.passes })
            }
          }
        }
      })
    })
  }
)

/**
 * Provides Clairic extraction using an existing CloudflareClient.
 *
 * @stability unstable
 * @category layers
 * @since 4.0.6
 */
export const layer = (
  options: { readonly model: Model } = { model: "clairic" }
): Layer.Layer<ExtractionModel.ExtractionModel, never, CloudflareClient> =>
  Layer.effect(ExtractionModel.ExtractionModel, make(options))
