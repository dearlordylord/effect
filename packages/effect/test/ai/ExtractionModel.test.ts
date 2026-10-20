import { assert, describe, it } from "@effect/vitest"
import { Context, Effect, Layer, Option, Result, Schema, SchemaGetter } from "effect"
import { Extraction, ExtractionModel } from "effect/ai"
import * as AiError from "effect/ai/AiError"

const fields = {
  face: Extraction.number({ instructions: "Reported face", integer: true }),
  name: Extraction.span({ instructions: "Name" })
}
const definition = Extraction.make({ input: Schema.String, fields })
const answers: ExtractionModel.ProviderResponse["answers"] = {
  face: { _tag: "Number", value: 20, confidence: 0.9 },
  name: { _tag: "Span", value: { text: "Mira", start: 3, end: 7 } }
}
const layer = (answers: ExtractionModel.ProviderResponse["answers"]) =>
  Layer.effect(
    ExtractionModel.ExtractionModel,
    ExtractionModel.make({ extract: () => Effect.succeed({ answers, usage: { inputTokens: 8, outputTokens: 0 } }) })
  )
const input = "😀 Mira rolled twenty."
const reason = (outcome: Extraction.Outcome<Extraction.Any>) => {
  assert.isTrue(Result.isFailure(outcome))
  return Result.isFailure(outcome) ? outcome.failure.reason : undefined
}

describe("Extraction", () => {
  it("rejects invalid definitions and conflicting precision", () => {
    assert.throws(() => Extraction.make({ input: Schema.String, fields: {} }))
    for (const decimals of [-1, 0.5, NaN, Infinity]) {
      assert.throws(() => Extraction.number({ instructions: "n", decimals }))
    }
    assert.throws(() => Extraction.number({ instructions: "n", integer: true, decimals: 0 }))
    assert.deepStrictEqual(Extraction.number({ instructions: "n", integer: false, decimals: 2 }).options, {})
  })

  it.effect("returns typed values, optional confidence, usage and default metadata", () =>
    Effect.gen(function*() {
      const result = yield* ExtractionModel.extract(definition, { input })
      assert.deepStrictEqual(result.answers.face.value, Option.some(20))
      assert.deepStrictEqual(result.answers.name.value, Option.some({ text: "Mira", start: 3, end: 7 }))
      assert.strictEqual(result.answers.face.confidence, 0.9)
      assert.strictEqual(result.answers.name.confidence, undefined)
      assert.deepStrictEqual(result.answers.name.metadata, {})
      assert.strictEqual(result.usage.inputTokens, 8)
      assert.strictEqual(Object.getPrototypeOf(result.answers), null)
    }).pipe(Effect.provide(layer(answers))))

  it.effect("None succeeds without being confused with a missing field", () =>
    Effect.gen(function*() {
      const result = yield* ExtractionModel.extract(definition, { input })
      assert.deepStrictEqual(result.answers.face.value, Option.none())
      assert.deepStrictEqual(result.answers.name.value, Option.none())
    }).pipe(Effect.provide(layer({ face: { _tag: "Number", value: null }, name: { _tag: "Span", value: null } }))))

  it.effect("settles missing, refused and invalid fields independently", () =>
    Effect.gen(function*() {
      const def = Extraction.make({
        input: Schema.String,
        fields: { ...fields, refused: fields.face, missing: fields.face }
      })
      const { outcomes } = yield* ExtractionModel.extractSettled(def, { input })
      assert.isTrue(Result.isSuccess(outcomes.name))
      assert.strictEqual(reason(outcomes.face), "Invalid")
      assert.strictEqual(reason(outcomes.refused), "Refused")
      assert.strictEqual(reason(outcomes.missing), "Missing")
    }).pipe(Effect.provide(layer({ ...answers, face: { _tag: "Number", value: 1.5 }, refused: { _tag: "Refusal" } }))))

  it.effect("strict refusals take precedence over invalid output", () =>
    Effect.gen(function*() {
      const result = yield* Effect.result(ExtractionModel.extract(definition, { input }))
      assert.isTrue(Result.isFailure(result))
      if (Result.isFailure(result)) assert.strictEqual(result.failure.reason._tag, "ContentPolicyError")
    }).pipe(Effect.provide(layer({ face: { _tag: "Number", value: Infinity }, name: { _tag: "Refusal" } }))))

  it.effect("strict missing fields fail with InvalidOutputError", () =>
    Effect.gen(function*() {
      const result = yield* Effect.result(ExtractionModel.extract(definition, { input }))
      if (Result.isFailure(result)) assert.strictEqual(result.failure.reason._tag, "InvalidOutputError")
      else assert.fail("Expected missing field failure")
    }).pipe(Effect.provide(layer({ name: answers.name }))))

  for (const value of [NaN, Infinity, 1.5]) {
    it.effect(`rejects invalid integral value ${value}`, () =>
      Effect.gen(function*() {
        const { outcomes } = yield* ExtractionModel.extractSettled(definition, { input })
        assert.strictEqual(reason(outcomes.face), "Invalid")
      }).pipe(Effect.provide(layer({ ...answers, face: { _tag: "Number", value } }))))
  }

  for (
    const [value, valid] of [[0.29, true], [1.23, true], [1080, true], [1.234, false], [1e-3, false], [
      0.30000000000000004,
      false
    ]] as const
  ) {
    it.effect(`validates decimal precision for ${value}`, () =>
      Effect.gen(function*() {
        const d = Extraction.make({
          input: Schema.String,
          fields: { amount: Extraction.number({ instructions: "amount", decimals: 2 }) }
        })
        const { outcomes } = yield* ExtractionModel.extractSettled(d, { input: "amount" })
        assert.strictEqual(Result.isSuccess(outcomes.amount), valid)
      }).pipe(Effect.provide(layer({ amount: { _tag: "Number", value } }))))
  }

  for (
    const value of [{ text: "Mira", start: 2, end: 6 }, { text: "Mira", start: 3, end: 99 }, {
      text: "Mira",
      start: 7,
      end: 3
    }, { text: "Other", start: 3, end: 7 }]
  ) {
    it.effect(`rejects inconsistent span ${JSON.stringify(value)}`, () =>
      Effect.gen(function*() {
        const { outcomes } = yield* ExtractionModel.extractSettled(definition, { input })
        assert.strictEqual(reason(outcomes.name), "Invalid")
      }).pipe(Effect.provide(layer({ ...answers, name: { _tag: "Span", value } }))))
  }

  for (const confidence of [-0.1, 1.1, NaN]) {
    it.effect(`rejects confidence ${confidence}`, () =>
      Effect.gen(function*() {
        const { outcomes } = yield* ExtractionModel.extractSettled(definition, { input })
        assert.strictEqual(reason(outcomes.face), "Invalid")
      }).pipe(Effect.provide(layer({ ...answers, face: { _tag: "Number", value: 20, confidence } }))))
  }

  it.effect("uses the encoded string as the span source and retains encoding services", () => {
    class Prefix extends Context.Service<Prefix, { readonly prefix: string }>()("Prefix") {}
    const codec = Schema.String.pipe(Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.passthrough(),
      encode: SchemaGetter.transformEffect<string, string, Prefix>((value) =>
        Effect.map(Effect.service(Prefix), ({ prefix }) => prefix + value)
      )
    }))
    const d = Extraction.make({ input: codec, fields: { name: fields.name } })
    return Effect.gen(function*() {
      const { answers } = yield* ExtractionModel.extract(d, { input: "Mira" })
      assert.deepStrictEqual(answers.name.value, Option.some({ text: "Mira", start: 3, end: 7 }))
    }).pipe(Effect.provideService(Prefix, { prefix: "😀 " }), Effect.provide(layer(answers)))
  })

  it.effect("input encoding failure prevents provider invocation", () => {
    const d = Extraction.make({ input: Schema.String.check(Schema.isMinLength(2)), fields })
    return Effect.gen(function*() {
      const result = yield* Effect.result(ExtractionModel.extract(d, { input: "x" }))
      if (Result.isFailure(result)) assert.strictEqual(result.failure.reason._tag, "InvalidUserInputError")
      else assert.fail("Expected input failure")
    }).pipe(
      Effect.provide(Layer.effect(
        ExtractionModel.ExtractionModel,
        ExtractionModel.make({ extract: () => Effect.die("Provider must not be called") })
      ))
    )
  })

  it.effect("present malformed payloads are Invalid, not Missing", () =>
    Effect.gen(function*() {
      const model = yield* ExtractionModel.make({
        extract: () =>
          Effect.succeed({
            answers: JSON.parse("{\"face\":null,\"name\":\"Mira\"}"),
            usage: { inputTokens: undefined, outputTokens: undefined }
          })
      })
      const { outcomes } = yield* model.extractSettled(definition, { input })
      assert.strictEqual(reason(outcomes.face), "Invalid")
      assert.strictEqual(reason(outcomes.name), "Invalid")
    }))

  it.effect("provider failure fails settled execution rather than creating field absence", () => {
    const failure = AiError.make({
      module: "test",
      method: "extract",
      reason: new AiError.InvalidResponseError({ description: "bad envelope" })
    })
    return Effect.gen(function*() {
      const result = yield* Effect.result(ExtractionModel.extractSettled(definition, { input }))
      assert.deepStrictEqual(result, Result.fail(failure))
    }).pipe(
      Effect.provide(Layer.effect(
        ExtractionModel.ExtractionModel,
        ExtractionModel.make({ extract: () => Effect.fail(failure) })
      ))
    )
  })
})
