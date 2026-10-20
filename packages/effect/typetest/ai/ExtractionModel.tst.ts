import { Context, Effect, type Option, type Result, Schema, SchemaGetter } from "effect"
import { type AiError, Extraction, ExtractionModel } from "effect/ai"
import { describe, expect, it } from "tstyche"

const definition = Extraction.make({
  input: Schema.String,
  fields: {
    face: Extraction.number({ instructions: "Face", integer: true }),
    name: Extraction.span({ instructions: "Name" })
  }
})
const program = ExtractionModel.extract(definition, { input: "Mira rolled twenty" })
type Response = Effect.Success<typeof program>

class Prefix extends Context.Service<Prefix, { readonly prefix: string }>()("Prefix") {}
const codec = Schema.String.pipe(Schema.decodeTo(Schema.String, {
  decode: SchemaGetter.passthrough(),
  encode: SchemaGetter.transformEffect<string, string, Prefix>((text) =>
    Effect.map(Effect.service(Prefix), ({ prefix }) => prefix + text)
  )
}))
const encoded = Extraction.make({ input: codec, fields: definition.fields })

describe("Extraction inference", () => {
  it("infers keyed number and span answers", () => {
    expect<Response["answers"]["face"]["value"]>().type.toBe<Option.Option<number>>()
    expect<Response["answers"]["name"]["value"]>().type.toBe<Option.Option<Extraction.TextSpan>>()
    expect<Response["answers"]["face"]["confidence"]>().type.toBe<number | undefined>()
    expect(program).type.toBe<
      Effect.Effect<
        ExtractionModel.ExtractResponse<typeof definition.fields>,
        AiError.AiError,
        ExtractionModel.ExtractionModel
      >
    >()
  })
  it("requires a text codec and text input", () => {
    expect(Extraction.make).type.not.toBeCallableWith({
      input: Schema.Struct({ text: Schema.String }),
      fields: definition.fields
    })
    expect(Extraction.make).type.not.toBeCallableWith({ input: Schema.NumberFromString, fields: definition.fields })
    expect(ExtractionModel.extract).type.not.toBeCallableWith(definition, { input: 20 })
    expect<Extraction.NumberAnswer>().type.not.toBeAssignableTo<Extraction.SpanAnswer>()
  })
  it("rejects conflicting numeric constraints", () => {
    expect(Extraction.number).type.not.toBeCallableWith({ instructions: "Face", integer: true, decimals: 2 })
    expect<{ _tag: "Number"; instructions: string; options: {}; integer: true; decimals: 2 }>().type.not
      .toBeAssignableTo<Extraction.Number>()
    expect(Extraction.number).type.toBeCallableWith({ instructions: "Face", integer: true })
    expect(Extraction.number).type.toBeCallableWith({ instructions: "Face", integer: false, decimals: 2 })
  })
  it("retains encoding-service requirements", () => {
    expect(ExtractionModel.extract(encoded, { input: "Mira" })).type.toBe<
      Effect.Effect<
        ExtractionModel.ExtractResponse<typeof definition.fields>,
        AiError.AiError,
        ExtractionModel.ExtractionModel | Prefix
      >
    >()
  })
  it("settles each field with its exact answer type", () => {
    const settled = ExtractionModel.extractSettled(definition, { input: "Mira" })
    expect<Effect.Success<typeof settled>["outcomes"]["face"]>().type.toBe<
      Result.Result<Extraction.NumberAnswer, Extraction.Unanswered>
    >()
    expect<Effect.Success<typeof settled>["outcomes"]["name"]>().type.toBe<
      Result.Result<Extraction.SpanAnswer, Extraction.Unanswered>
    >()
  })
})
