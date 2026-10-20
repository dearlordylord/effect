/**
 * Typed descriptions of scalar extraction operations, independent of providers.
 *
 * @stability unstable
 * @since 4.0.6
 */
import type * as Option from "../Option.ts"
import type * as Result from "../Result.ts"
import type * as Schema from "../Schema.ts"
import type * as Prompt from "./Prompt.ts"
import type * as Response from "./Response.ts"

/**
 * Instructions for extracting a value.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type Description = string | Schema.JsonObject | Schema.JsonArray

/**
 * A text-to-text input codec, retaining its encoding services.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type Input = Schema.ConstraintCodec<string, string, unknown, unknown>

/**
 * Provider-specific span options. Provider packages augment this interface.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface SpanOptions extends Prompt.ProviderOptions {}

/**
 * Provider-specific number options. Provider packages augment this interface.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface NumberOptions extends Prompt.ProviderOptions {}

/**
 * Provider-specific span answer metadata.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface SpanAnswerMetadata extends Response.ProviderMetadata {}

/**
 * Provider-specific number answer metadata.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface NumberAnswerMetadata extends Response.ProviderMetadata {}

/**
 * An exact source fragment with UTF-16 offsets, start inclusive and end exclusive.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface TextSpan {
  readonly text: string
  readonly start: number
  readonly end: number
}

/**
 * An exact-span extraction operation.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface Span {
  readonly _tag: "Span"
  readonly instructions: Description
  readonly options: SpanOptions
}

type NumericConstraints =
  | { readonly integer: true; readonly decimals?: never }
  | { readonly integer?: false | undefined; readonly decimals?: number | undefined }

/**
 * A numeric extraction or computation operation.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type Number = {
  readonly _tag: "Number"
  readonly instructions: Description
  readonly options: NumberOptions
} & NumericConstraints

/**
 * Supported extraction operations.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type Any = Span | Number

/**
 * A scalar answer. None is a valid report of insufficient information.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface ScalarAnswer<A, Metadata extends Response.ProviderMetadata = Response.ProviderMetadata> {
  readonly value: Option.Option<A>
  readonly confidence?: number | undefined
  readonly metadata: Metadata
}

/**
 * Answer to a span operation.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type SpanAnswer = ScalarAnswer<TextSpan, SpanAnswerMetadata>

/**
 * Answer to a number operation.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type NumberAnswer = ScalarAnswer<number, NumberAnswerMetadata>

/**
 * Infers the answer to an operation.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type Answer<F extends Any> = {
  readonly Span: SpanAnswer
  readonly Number: NumberAnswer
}[F["_tag"]]

/**
 * Answers keyed by field name.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type Answers<Fields extends Record<string, Any>> = { readonly [K in keyof Fields]: Answer<Fields[K]> }

/**
 * A per-field failure, distinct from a successful absent value.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface Unanswered {
  readonly _tag: "Unanswered"
  readonly reason: "Missing" | "Refused" | "Invalid"
  readonly description: string
}

/**
 * A validated answer or a per-field failure.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type Outcome<F extends Any> = Result.Result<Answer<F>, Unanswered>

/**
 * Outcomes keyed by field name.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export type Outcomes<Fields extends Record<string, Any>> = { readonly [K in keyof Fields]: Outcome<Fields[K]> }

/**
 * Extraction definition brand.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export const TypeId = "~effect/ai/Extraction" as const

/**
 * An input codec and fields to answer together.
 *
 * @stability unstable
 * @category models
 * @since 4.0.6
 */
export interface Definition<I extends Input, Fields extends Record<string, Any>> {
  readonly [TypeId]: typeof TypeId
  readonly input: I
  readonly fields: Fields
}

/**
 * Describes an exact fragment of the submitted source.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export const span = (options: {
  readonly instructions: Description
  readonly options?: SpanOptions | undefined
}): Span => ({ _tag: "Span", instructions: options.instructions, options: options.options ?? {} })

/**
 * Describes a number. Throws for invalid precision or conflicting constraints.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export const number = (
  options: {
    readonly instructions: Description
    readonly options?: NumberOptions | undefined
  } & NumericConstraints
): Number => {
  if (options.integer !== undefined && typeof options.integer !== "boolean") {
    throw new Error("Extraction.number: integer must be a boolean")
  }
  if (options.decimals !== undefined && (!globalThis.Number.isInteger(options.decimals) || options.decimals < 0)) {
    throw new Error("Extraction.number: decimals must be a nonnegative integer")
  }
  if (options.integer === true && options.decimals !== undefined) {
    throw new Error("Extraction.number: integer and decimals cannot be combined")
  }
  return { ...options, _tag: "Number", options: options.options ?? {} }
}

/**
 * Defines named extractions over a text codec. Throws for an empty field map.
 *
 * @stability unstable
 * @category constructors
 * @since 4.0.6
 */
export const make = <I extends Input, Fields extends Record<string, Any>>(options: {
  readonly input: I
  readonly fields: Fields
}): Definition<I, Fields> => {
  if (Object.keys(options.fields).length === 0) throw new Error("Extraction.make: fields must not be empty")
  return { [TypeId]: TypeId, ...options }
}
