/**
 * Cloudflare extraction over Workers AI REST.
 *
 * @stability unstable
 * @since 4.0.6
 */
import * as AiError from "effect/ai/AiError"
import type * as Extraction from "effect/ai/Extraction"
import * as ExtractionModel from "effect/ai/ExtractionModel"
import * as AiModel from "effect/ai/Model"
import * as Effect from "effect/Effect"
import { absurd } from "effect/Function"
import * as Layer from "effect/Layer"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"
import { CloudflareClient } from "./CloudflareClient.ts"
import * as CloudflareSchema from "./CloudflareSchema.ts"

declare module "effect/ai/Extraction" {
  interface NumberOptions {
    readonly cloudflare?: { readonly unit?: string } | null
  }
  interface SpanAnswerMetadata {
    /** Candidate span coordinates are UTF-16 offsets into the submitted source. */
    readonly cloudflare?: typeof CloudflareSchema.ExtractionTextCandidate.Type & { readonly nullProbability?: number }
  }
  interface NumberAnswerMetadata {
    readonly cloudflare?: { readonly guess?: number | null; readonly nullProbability?: number }
  }
}

declare module "effect/ai/ExtractionModel" {
  interface ExtractResponseMetadata {
    /**
     * Provider-reported truncation and usage details.
     *
     * @see https://developers.cloudflare.com/ai/models/@cf/cloudflare/clairic/schema-output.json
     */
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
const decodeNumberAnswer = Schema.decodeUnknownResult(CloudflareSchema.ExtractionNumberAnswer)
const decodeTextAnswer = Schema.decodeUnknownResult(CloudflareSchema.ExtractionTextAnswer)

// Converts code-point offsets to UTF-16: offsetMap("A😀B") → [0, 1, 3, 4].
const offsetMap = (state: string): ReadonlyArray<number> => {
  const offsets = [0]
  for (const character of state) offsets.push(offsets[offsets.length - 1] + character.length)
  return offsets
}
const codePointSpanToUtf16 = (
  [start, end]: readonly [number, number],
  offsets: ReadonlyArray<number>
): readonly [number, number] | undefined => {
  if (start < 0 || end < start || end >= offsets.length) return undefined
  return [offsets[start], offsets[end]]
}
const normalizeNumber = (raw: unknown): ExtractionModel.ProviderAnswer => {
  const decoded = decodeNumberAnswer(raw)
  if (Result.isFailure(decoded)) return invalid("Invalid extraction answer")
  const answer = decoded.success
  return {
    _tag: "Number",
    value: answer.value,
    confidence: answer.confidence,
    metadata: {
      cloudflare: {
        ...(answer.guess === undefined ? {} : { guess: answer.guess }),
        ...(answer.p_null === undefined ? {} : { nullProbability: answer.p_null })
      }
    }
  }
}
const normalizeSpan = (
  raw: unknown,
  state: string,
  offsets: ReadonlyArray<number>
): ExtractionModel.ProviderAnswer => {
  const decoded = decodeTextAnswer(raw)
  if (Result.isFailure(decoded)) return invalid("Invalid extraction answer")
  const answer = decoded.success
  const evidence = answer.p_null === undefined ? {} : { nullProbability: answer.p_null }
  if (answer.span === undefined) {
    return {
      _tag: "Span",
      value: null,
      confidence: answer.confidence,
      metadata: {
        cloudflare: { ...evidence, ...(answer.guess === undefined ? {} : { guess: answer.guess }) }
      }
    }
  }
  const span = codePointSpanToUtf16(answer.span, offsets)
  if (span === undefined || state.slice(span[0], span[1]) !== answer.guess) {
    return invalid("Invalid candidate source span")
  }
  if (answer.value !== null && state.slice(span[0], span[1]) !== answer.value) {
    return invalid("Text value does not match its source span")
  }
  return {
    _tag: "Span",
    value: answer.value === null ? null : { text: answer.value, start: span[0], end: span[1] },
    confidence: answer.confidence,
    metadata: { cloudflare: { ...evidence, guess: answer.guess, span } }
  }
}

const normalize = (
  field: Extraction.Any,
  raw: unknown,
  state: string,
  offsets: ReadonlyArray<number>
): ExtractionModel.ProviderAnswer => {
  switch (field._tag) {
    case "Number":
      return normalizeNumber(raw)
    case "Span":
      return normalizeSpan(raw, state, offsets)
    default:
      return absurd(field)
  }
}

const failInput = (description: string) =>
  Effect.fail(AiError.make({
    module: "CloudflareExtractionModel",
    method: "extract",
    reason: new AiError.InvalidUserInputError({ description })
  }))

const encodeField = Effect.fnUntraced(function*(
  field: Extraction.Any,
  instructions: string
): Effect.fn.Return<typeof CloudflareSchema.ExtractionField.Encoded, AiError.AiError> {
  switch (field._tag) {
    case "Span":
      return { type: "text", instructions }
    case "Number": {
      if (field.decimals !== undefined && field.decimals > 6) {
        return yield* failInput("Clairic supports at most six decimal places")
      }
      const unit = field.options.cloudflare?.unit
      if (unit !== undefined && typeof unit !== "string") return yield* failInput("Clairic unit must be a string")
      return {
        type: "number",
        instructions,
        ...(field.integer === undefined ? {} : { integer: field.integer }),
        ...(field.decimals === undefined ? {} : { decimals: field.decimals }),
        ...(unit === undefined ? {} : { unit })
      }
    }
    default:
      return absurd(field)
  }
})

const encodeInstructions = (instructions: Extraction.Description): Effect.Effect<string, AiError.AiError> =>
  typeof instructions === "string" ? Effect.succeed(instructions) : Effect.try({
    try: () => {
      const encoded = JSON.stringify(instructions)
      if (encoded === undefined) throw new Error("Instructions did not encode to JSON")
      return encoded
    },
    catch: () =>
      AiError.make({
        module: "CloudflareExtractionModel",
        method: "extract",
        reason: new AiError.InvalidUserInputError({ description: "Instructions must be JSON-serializable" })
      })
  })

const encodeRequest = Effect.fnUntraced(function*(
  model: Model,
  { state, fields }: ExtractionModel.ProviderOptions
): Effect.fn.Return<typeof CloudflareSchema.ExtractionsRequest.Encoded, AiError.AiError> {
  if (state.length === 0) return yield* failInput("Clairic requires nonempty text")
  if (model !== "clairic" && model !== "@cf/cloudflare/clairic") {
    return yield* failInput("Unsupported extraction model")
  }
  const requestFields: Record<string, typeof CloudflareSchema.ExtractionField.Encoded> = Object.create(null)
  for (const [key, field] of Object.entries(fields)) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(key)) return yield* failInput("Invalid Clairic field name")
    const instructions = yield* encodeInstructions(field.instructions)
    requestFields[key] = yield* encodeField(field, instructions)
  }
  return { model: "clairic", state, fields: requestFields }
})

const normalizeResponse = (
  response: typeof CloudflareSchema.ExtractionsResponse.Type,
  { state, fields }: ExtractionModel.ProviderOptions
): ExtractionModel.ProviderResponse => {
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
}

/**
 * Builds a Cloudflare extraction service for text input.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export const make = Effect.fnUntraced(function*(
  options: { readonly model: Model }
): Effect.fn.Return<ExtractionModel.ExtractionModel, never, CloudflareClient> {
  const client = yield* CloudflareClient
  return yield* ExtractionModel.make({
    extract: Effect.fnUntraced(function*(request) {
      const payload = yield* encodeRequest(options.model, request)
      const response = yield* client.createExtractions(payload)
      return normalizeResponse(response, request)
    })
  })
})

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
