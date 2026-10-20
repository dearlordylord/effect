/**
 * Provider-neutral scalar extraction with validated strict and settled results.
 *
 * @stability unstable
 * @since 4.0.6
 */
import * as Context from "../Context.ts"
import * as Effect from "../Effect.ts"
import { absurd } from "../Function.ts"
import * as Option from "../Option.ts"
import * as Result from "../Result.ts"
import * as Schema from "../Schema.ts"
import * as AiError from "./AiError.ts"
import type * as Extraction from "./Extraction.ts"
import * as Response from "./Response.ts"

/**
 * Extraction service key.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export const ExtractionModel: Context.Service<ExtractionModel, ExtractionModel> = Context.Service(
  "effect/ai/ExtractionModel"
)

/**
 * Reported extraction token usage; unreported counts remain undefined.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export class ExtractionUsage extends Schema.Class<ExtractionUsage>("effect/ai/ExtractionModel/ExtractionUsage")({
  inputTokens: Schema.optional(Schema.Finite),
  outputTokens: Schema.optional(Schema.Finite)
}) {}

/**
 * Provider-specific request-wide metadata.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface ExtractResponseMetadata extends Response.ProviderMetadata {}

/**
 * Input to an extraction call.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface ExtractOptions<I extends Extraction.Input> {
  readonly input: I["Type"]
}

/**
 * A response with all requested answers.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface ExtractResponse<Fields extends Record<string, Extraction.Any>> {
  readonly answers: Extraction.Answers<Fields>
  readonly usage: ExtractionUsage
  readonly id?: string | undefined
  readonly modelId?: string | undefined
  readonly metadata: ExtractResponseMetadata
}

/**
 * A response retaining each field outcome.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface ExtractSettledResponse<Fields extends Record<string, Extraction.Any>>
  extends Omit<ExtractResponse<Fields>, "answers">
{
  readonly outcomes: Extraction.Outcomes<Fields>
}

/**
 * Encoded source and fields supplied to an adapter.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface ProviderOptions {
  readonly state: string
  readonly fields: Record<string, Extraction.Any>
}

/**
 * Provider number answer, before validation.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface ProviderNumberAnswer {
  readonly _tag: "Number"
  readonly value: number | null
  readonly confidence?: number | undefined
  readonly metadata?: Extraction.NumberAnswerMetadata | undefined
}

/**
 * Provider span answer in public UTF-16 coordinates, before validation.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface ProviderSpanAnswer {
  readonly _tag: "Span"
  readonly value: Extraction.TextSpan | null
  readonly confidence?: number | undefined
  readonly metadata?: Extraction.SpanAnswerMetadata | undefined
}

/**
 * Provider refusal or a field that could not be normalized.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type ProviderAnswer = ProviderNumberAnswer | ProviderSpanAnswer | { readonly _tag: "Refusal" } | {
  readonly _tag: "Invalid"
  readonly description: string
}

/**
 * Provider response; omitted answer keys become Missing outcomes.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface ProviderResponse {
  readonly answers: Readonly<Record<string, ProviderAnswer>>
  readonly usage: { readonly inputTokens: number | undefined; readonly outputTokens: number | undefined }
  readonly id?: string | undefined
  readonly modelId?: string | undefined
  readonly metadata?: ExtractResponseMetadata | undefined
}

/**
 * Extraction operations over a definition.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface ExtractionModel {
  readonly extract: <I extends Extraction.Input, Fields extends Record<string, Extraction.Any>>(
    definition: Extraction.Definition<I, Fields>,
    options: ExtractOptions<I>
  ) => Effect.Effect<ExtractResponse<Fields>, AiError.AiError, I["EncodingServices"]>
  readonly extractSettled: <I extends Extraction.Input, Fields extends Record<string, Extraction.Any>>(
    definition: Extraction.Definition<I, Fields>,
    options: ExtractOptions<I>
  ) => Effect.Effect<ExtractSettledResponse<Fields>, AiError.AiError, I["EncodingServices"]>
}

const supportedKinds = { Span: true, Number: true } satisfies Record<Extraction.Any["_tag"], true>

const failure = (reason: Extraction.Unanswered["reason"], description: string): Extraction.Outcome<Extraction.Any> =>
  Result.fail({ _tag: "Unanswered", reason, description })
const Probability = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const answerEvidence = {
  confidence: Schema.optional(Probability),
  metadata: Schema.optional(Response.ProviderMetadata)
}
const decodeProviderAnswer = Schema.decodeUnknownResult(Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Refusal") }),
  Schema.Struct({ _tag: Schema.Literal("Invalid"), description: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal("Number"), value: Schema.NullOr(Schema.Finite), ...answerEvidence }),
  Schema.Struct({
    _tag: Schema.Literal("Span"),
    value: Schema.NullOr(Schema.Struct({ text: Schema.String, start: Schema.Int, end: Schema.Int })),
    ...answerEvidence
  })
]))
type Method = "extract" | "extractSettled"

const error = (method: Method, reason: AiError.AiErrorReason) =>
  AiError.make({ module: "ExtractionModel", method, reason })

const validate = (state: string, field: Extraction.Any, raw: unknown): Extraction.Outcome<Extraction.Any> => {
  const decoded = decodeProviderAnswer(raw)
  if (Result.isFailure(decoded)) return failure("Invalid", "Provider returned a malformed answer")
  const answer = decoded.success
  if (answer._tag === "Refusal") return failure("Refused", "Provider refused to answer")
  if (answer._tag === "Invalid") return failure("Invalid", answer.description)
  switch (field._tag) {
    case "Number": {
      if (answer._tag !== "Number") return failure("Invalid", "Provider returned an invalid answer kind")
      const value = answer.value
      if (value !== null) {
        if (field.integer === true && !Number.isInteger(value)) {
          return failure("Invalid", "Expected a number satisfying integer constraints")
        }
        // All finite numbers have shortest-decimal representations within 324 places; use Effect's decimal-aware check below that.
        if (
          field.decimals !== undefined && field.decimals < 324 &&
          !Schema.is(Schema.Number.check(Schema.isMultipleOf(10 ** -field.decimals)))(value)
        ) {
          return failure("Invalid", "Number exceeds requested decimal precision")
        }
      }
      return Result.succeed({
        value: value === null ? Option.none<number>() : Option.some(value),
        ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }),
        metadata: answer.metadata ?? {}
      })
    }
    case "Span": {
      if (answer._tag !== "Span") return failure("Invalid", "Provider returned an invalid answer kind")
      const value = answer.value
      if (
        value !== null &&
        (value.start < 0 || value.end < value.start || value.end > state.length ||
          state.slice(value.start, value.end) !== value.text)
      ) {
        return failure("Invalid", "Span must match the submitted source in UTF-16 coordinates")
      }
      return Result.succeed({
        value: value === null ? Option.none<Extraction.TextSpan>() : Option.some(value),
        ...(answer.confidence === undefined ? {} : { confidence: answer.confidence }),
        metadata: answer.metadata ?? {}
      })
    }
    default:
      return absurd(field)
  }
}

const requireAnswers = <Fields extends Record<string, Extraction.Any>>(
  outcomes: Extraction.Outcomes<Fields>
): Effect.Effect<Extraction.Answers<Fields>, AiError.AiError> => {
  const answers: Record<string, Extraction.Answer<Extraction.Any>> = Object.create(null)
  const refused: Array<string> = []
  let first: string | undefined
  for (const [key, outcome] of Object.entries(outcomes) as Array<[string, Extraction.Outcome<Extraction.Any>]>) {
    if (Result.isSuccess(outcome)) answers[key] = outcome.success
    else if (outcome.failure.reason === "Refused") refused.push(key)
    else first ??= `${key}: ${outcome.failure.description}`
  }
  if (refused.length) {
    return Effect.fail(
      error(
        "extract",
        new AiError.ContentPolicyError({ description: `Provider refused fields: ${refused.join(", ")}` })
      )
    )
  }
  if (first !== undefined) return Effect.fail(error("extract", new AiError.InvalidOutputError({ description: first })))
  return Effect.succeed(answers as Extraction.Answers<Fields>)
}

/**
 * Creates a service that encodes text and validates answers. None is successful in both modes.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export const make = (params: {
  readonly extract: (options: ProviderOptions) => Effect.Effect<ProviderResponse, AiError.AiError>
}): Effect.Effect<ExtractionModel> =>
  Effect.sync(() => {
    const settle = <I extends Extraction.Input, Fields extends Record<string, Extraction.Any>>(
      method: Method,
      definition: Extraction.Definition<I, Fields>,
      options: ExtractOptions<I>
    ): Effect.Effect<ExtractSettledResponse<Fields>, AiError.AiError, I["EncodingServices"]> =>
      Schema.encodeEffect(definition.input)(options.input).pipe(
        Effect.mapError((cause) => error(method, new AiError.InvalidUserInputError({ description: cause.message }))),
        Effect.flatMap((state) => {
          if (
            typeof state !== "string" ||
            Object.values(definition.fields).some((field) => !Object.hasOwn(supportedKinds, field._tag))
          ) {
            return Effect.fail(
              error(
                method,
                new AiError.InvalidUserInputError({
                  description: "Expected encoded text and supported extraction fields"
                })
              )
            )
          }
          return params.extract({ state, fields: definition.fields }).pipe(Effect.map((response) => {
            const outcomes: Record<string, Extraction.Outcome<Extraction.Any>> = Object.create(null)
            for (const key of Object.keys(definition.fields)) {
              outcomes[key] = Object.hasOwn(response.answers, key)
                ? validate(state, definition.fields[key], response.answers[key])
                : failure("Missing", "Provider returned no answer")
            }
            return {
              outcomes: outcomes as Extraction.Outcomes<Fields>,
              usage: new ExtractionUsage(response.usage),
              ...(response.id === undefined ? {} : { id: response.id }),
              ...(response.modelId === undefined ? {} : { modelId: response.modelId }),
              metadata: response.metadata ?? {}
            }
          }))
        })
      )
    return ExtractionModel.of({
      extract: (definition, options) =>
        settle("extract", definition, options).pipe(
          Effect.flatMap(({ outcomes, ...response }) =>
            Effect.map(requireAnswers(outcomes), (answers) => ({ answers, ...response }))
          ),
          (effect) => Effect.withSpan(effect, "ExtractionModel.extract", { captureStackTrace: false })
        ),
      extractSettled: (definition, options) =>
        settle("extractSettled", definition, options).pipe((effect) =>
          Effect.withSpan(effect, "ExtractionModel.extractSettled", { captureStackTrace: false })
        )
    })
  })

/**
 * Answers all fields or fails, following DecisionModel strict error precedence.
 *
 * @stability unstable
 * @category extraction
 * @since 4.0.6
 */
export const extract = <I extends Extraction.Input, Fields extends Record<string, Extraction.Any>>(
  definition: Extraction.Definition<I, Fields>,
  options: ExtractOptions<I>
): Effect.Effect<ExtractResponse<Fields>, AiError.AiError, ExtractionModel | I["EncodingServices"]> =>
  ExtractionModel.use((model) => model.extract(definition, options))

/**
 * Retains valid fields as Results; encoding and provider failures still fail the Effect.
 *
 * @stability unstable
 * @category extraction
 * @since 4.0.6
 */
export const extractSettled = <I extends Extraction.Input, Fields extends Record<string, Extraction.Any>>(
  definition: Extraction.Definition<I, Fields>,
  options: ExtractOptions<I>
): Effect.Effect<ExtractSettledResponse<Fields>, AiError.AiError, ExtractionModel | I["EncodingServices"]> =>
  ExtractionModel.use((model) => model.extractSettled(definition, options))
