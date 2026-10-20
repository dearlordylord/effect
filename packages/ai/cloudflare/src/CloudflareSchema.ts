/**
 * Codecs for Cloudflare decision and extraction requests and responses.
 *
 * @stability unstable
 * @since 4.0.0
 */
import * as Schema from "effect/Schema"

const Entry = Schema.Union([Schema.String, Schema.JsonObject, Schema.Array(Schema.Json)])

/**
 * A classification question.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.0
 */
export const ChoiceQuestion = Schema.Struct({
  type: Schema.Literal("choice"),
  instructions: Entry,
  criteria: Schema.Record(Schema.String, Schema.NullOr(Entry))
})

/**
 * An ordered rating question.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.0
 */
export const ScoreQuestion = Schema.Struct({
  type: Schema.Literal("score"),
  instructions: Entry,
  criteria: Schema.Array(Schema.Json)
})

/**
 * A probability question.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.0
 */
export const NoulQuestion = Schema.Struct({
  type: Schema.Literal("noul"),
  instructions: Entry,
  criteria: Schema.optional(Schema.Struct({ false: Schema.Json, true: Schema.Json }))
})

/**
 * A Clef question with string, JSON object, or JSON array instructions.
 * Choice descriptions also accept `null`; Score and Noul descriptions accept any JSON value.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.0
 */
export const Question = Schema.Union([ChoiceQuestion, ScoreQuestion, NoulQuestion])

/**
 * An image as a `data:` URL or as base64 data with its media type. Clef
 * rejects remote URLs.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.5
 */
export const Image = Schema.Union([
  Schema.String,
  Schema.Struct({
    content_type: Schema.Union([
      Schema.Literals(["image/png", "image/jpeg", "image/webp"]),
      Schema.StringForLiteralAutocomplete
    ]),
    base64: Schema.String
  })
])

/**
 * A batch of questions about text or JSON state, with optional images shown
 * to the model before the state.
 *
 * **Details**
 *
 * Clef accepts up to 4 images of at most 4 MiB and 16 megapixels each, 8 MiB
 * of decoded images in total, and 13 MiB per request body.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.0
 */
export const DecisionsRequest = Schema.Struct({
  model: Schema.Union([Schema.Literals(["clef", "clef-flash"]), Schema.StringForLiteralAutocomplete]),
  state: Schema.Json,
  questions: Schema.Record(Schema.String, Question),
  images: Schema.optional(Schema.Array(Image))
})

/**
 * A classification distribution.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.0
 */
export const ChoiceAnswer = Schema.Struct({
  type: Schema.Literal("choice"),
  choice: Schema.String,
  probabilities: Schema.Record(Schema.String, Schema.Number),
  confidence: Schema.Number
})

/**
 * A zero-based rating and index-keyed distribution. `legend` maps indices to descriptions.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.0
 */
export const ScoreAnswer = Schema.Struct({
  type: Schema.Literal("score"),
  score: Schema.Number,
  probabilities: Schema.Record(Schema.String, Schema.Number),
  confidence: Schema.Number,
  legend: Schema.Record(Schema.String, Schema.Json)
})

/**
 * A Bernoulli probability.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.0
 */
export const NoulAnswer = Schema.Struct({ type: Schema.Literal("noul"), noul: Schema.Number })

/**
 * A Clef classification, rating, or probability answer.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.0
 */
export const Answer = Schema.Union([ChoiceAnswer, ScoreAnswer, NoulAnswer])

/**
 * Answers and token usage for a batch.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.0
 */
export const DecisionsResponse = Schema.Struct({
  model: Schema.String,
  answers: Schema.Record(Schema.String, Answer),
  usage: Schema.Struct({
    input_tokens: Schema.Int,
    output_tokens: Schema.Int
  })
})

/**
 * Minimal Clairic extraction fields. Other field kinds are not yet supported.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.6
 */
export const ExtractionField = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), instructions: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("number"),
    instructions: Schema.String,
    integer: Schema.optional(Schema.Boolean),
    decimals: Schema.optional(Schema.Int),
    unit: Schema.optional(Schema.String)
  })
])

/**
 * A text-only Clairic extraction request.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.6
 */
export const ExtractionsRequest = Schema.Struct({
  model: Schema.Literal("clairic"),
  state: Schema.String,
  fields: Schema.Record(Schema.String, ExtractionField)
})

const Probability = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const evidence = {
  confidence: Schema.optional(Probability),
  p_null: Schema.optional(Probability)
}
/**
 * A supported numeric extraction answer from Cloudflare.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.6
 */
export const ExtractionNumberAnswer = Schema.Struct({
  type: Schema.Literal("number"),
  value: Schema.NullOr(Schema.Finite),
  guess: Schema.optional(Schema.NullOr(Schema.Finite)),
  ...evidence
})
const UnlocatedSpanCandidate = Schema.Struct({
  guess: Schema.optionalKey(Schema.NullOr(Schema.String)),
  span: Schema.optionalKey(Schema.Never)
})
const LocatedSpanCandidate = Schema.Struct({
  guess: Schema.String,
  span: Schema.Tuple([Schema.Int, Schema.Int])
})
/**
 * Candidate text with optional coordinates. Coordinates require a string guess.
 * The enclosing contract defines the coordinate units.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.6
 */
export const ExtractionTextCandidate = Schema.Union([UnlocatedSpanCandidate, LocatedSpanCandidate])
/**
 * A supported text extraction answer with code-point coordinates into the source.
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.6
 */
export const ExtractionTextAnswer = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    value: Schema.Null,
    ...UnlocatedSpanCandidate.fields,
    ...evidence
  }),
  Schema.Struct({
    type: Schema.Literal("text"),
    value: Schema.NullOr(Schema.String),
    ...LocatedSpanCandidate.fields,
    ...evidence
  })
])

/**
 * An extraction response envelope. The extraction service decodes field answers
 * independently using the supported scalar answer schemas.
 *
 * @see https://developers.cloudflare.com/ai/models/@cf/cloudflare/clairic/schema-output.json
 *
 * @stability unstable
 * @category schemas
 * @since 4.0.6
 */
export const ExtractionsResponse = Schema.Struct({
  model: Schema.String,
  answers: Schema.Record(Schema.String, Schema.Unknown),
  truncated: Schema.Boolean,
  usage: Schema.Struct({
    input_tokens: Schema.Int,
    output_tokens: Schema.Int,
    state_tokens: Schema.optional(Schema.Int),
    image_tokens: Schema.optional(Schema.Int),
    schema_tokens: Schema.optional(Schema.Int),
    passes: Schema.optional(Schema.Int)
  })
})
