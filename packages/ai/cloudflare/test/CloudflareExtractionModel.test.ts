import * as CloudflareClient from "@effect/ai-cloudflare/CloudflareClient"
import * as CloudflareExtractionModel from "@effect/ai-cloudflare/CloudflareExtractionModel"
import * as CloudflareSchema from "@effect/ai-cloudflare/CloudflareSchema"
import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Option, Redacted, Result, Schema } from "effect"
import { Extraction, ExtractionModel, Model } from "effect/ai"
import * as HttpClient from "effect/http/HttpClient"
import type * as HttpClientError from "effect/http/HttpClientError"
import type * as HttpClientRequest from "effect/http/HttpClientRequest"
import * as HttpClientResponse from "effect/http/HttpClientResponse"

const state = "😀 First code: ALPHA. Second code: ALPHA."
const definition = Extraction.make({
  input: Schema.String,
  fields: {
    code: Extraction.span({ instructions: "Second code" }),
    face: Extraction.number({
      instructions: { extract: "Natural die face" },
      integer: true,
      options: { cloudflare: { unit: "points" } }
    })
  }
})
const answers = {
  code: { type: "text", value: "ALPHA", guess: "ALPHA", span: [34, 39], confidence: 0.9, p_null: 0.1 },
  face: { type: "number", value: 20, guess: 20, confidence: 0.8, p_null: 0.2 }
}
const http = (
  payload: unknown,
  onRequest: (request: HttpClientRequest.HttpClientRequest) => void = () => {},
  status = 200
) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.makeWith(
      Effect.map((request) => {
        onRequest(request)
        return HttpClientResponse.fromWeb(request, Response.json(payload, { status }))
      }),
      Effect.succeed as HttpClient.HttpClient.Preprocess<HttpClientError.HttpClientError, never>
    )
  )
const envelope = (fields: unknown = answers) => ({
  success: true,
  result: {
    model: "clairic",
    answers: fields,
    truncated: false,
    usage: { input_tokens: 135, output_tokens: 0, passes: 1 }
  }
})
const client = (
  payload: unknown = envelope(),
  onRequest?: (request: HttpClientRequest.HttpClientRequest) => void,
  status?: number
) =>
  CloudflareClient.layer({ accountId: "test-account", apiKey: Redacted.make("test-token"), gatewayId: "gateway" }).pipe(
    Layer.provide(http(payload, onRequest, status))
  )
const provide = (fields: unknown = answers) =>
  CloudflareExtractionModel.layer().pipe(Layer.provide(client(envelope(fields))))

describe("CloudflareExtractionModel", () => {
  it.effect("maps all fields in one call, preserves metadata, and normalizes code-point offsets", () =>
    Effect.gen(function*() {
      const result = yield* ExtractionModel.extract(definition, { input: state })
      assert.strictEqual(yield* Model.ProviderName, "cloudflare")
      assert.strictEqual(yield* Model.ModelName, "@cf/cloudflare/clairic")
      assert.deepStrictEqual(result.answers.code.value, Option.some({ text: "ALPHA", start: 35, end: 40 }))
      assert.deepStrictEqual(result.answers.code.metadata.cloudflare?.span, [35, 40])
      assert.deepStrictEqual(result.answers.face.value, Option.some(20))
      assert.strictEqual(result.answers.face.confidence, 0.8)
      assert.strictEqual(result.answers.face.metadata.cloudflare?.nullProbability, 0.2)
      assert.strictEqual(result.answers.face.metadata.cloudflare?.guess, 20)
      assert.strictEqual(result.metadata.cloudflare?.passes, 1)
      assert.strictEqual(result.metadata.cloudflare?.truncated, false)
      assert.strictEqual(result.modelId, "clairic")
      assert.strictEqual(result.usage.inputTokens, 135)
    }).pipe(
      Effect.provide(CloudflareExtractionModel.model("@cf/cloudflare/clairic")),
      Effect.provide(client(envelope(), (request) => {
        assert.strictEqual(
          request.url,
          "https://api.cloudflare.com/client/v4/accounts/test-account/ai/run/@cf/cloudflare/clairic"
        )
        assert.strictEqual(request.headers.authorization, "Bearer test-token")
        assert.strictEqual(request.headers["cf-aig-gateway-id"], "gateway")
        assert.strictEqual(request.body._tag, "Uint8Array")
        if (request.body._tag === "Uint8Array") {
          assert.deepStrictEqual(JSON.parse(new TextDecoder().decode(request.body.body)), {
            model: "clairic",
            state,
            fields: {
              code: { type: "text", instructions: "Second code" },
              face: {
                type: "number",
                instructions: "{\"extract\":\"Natural die face\"}",
                integer: true,
                unit: "points"
              }
            }
          })
        }
      }))
    ))

  for (
    const testCase of [
      { source: "The code is ALPHA.", raw: [12, 17], expected: [12, 17] },
      { source: "😀 café: ALPHA. Then Ω.", raw: [8, 13], expected: [9, 14] }
    ]
  ) {
    it.effect(`normalizes the live-probed coordinate fixture ${JSON.stringify(testCase.raw)}`, () =>
      Effect.gen(function*() {
        const { answers } = yield* ExtractionModel.extract(definition, { input: testCase.source })
        assert.deepStrictEqual(
          answers.code.value,
          Option.some({ text: "ALPHA", start: testCase.expected[0], end: testCase.expected[1] })
        )
      }).pipe(Effect.provide(provide({ ...answers, code: { ...answers.code, span: testCase.raw } }))))
  }

  it.effect("keeps null value separate from a candidate span and high confidence", () =>
    Effect.gen(function*() {
      const { answers } = yield* ExtractionModel.extract(definition, { input: state })
      assert.deepStrictEqual(answers.code.value, Option.none())
      assert.strictEqual(answers.code.metadata.cloudflare?.guess, "ALPHA")
      assert.deepStrictEqual(answers.code.metadata.cloudflare?.span, [35, 40])
      assert.strictEqual(answers.code.confidence, 0.99)
    }).pipe(
      Effect.provide(provide({ ...answers, code: { ...answers.code, value: null, confidence: 0.99, p_null: 1 } }))
    ))

  for (const guess of [undefined, null]) {
    it.effect(`rejects candidate coordinates without text: ${guess}`, () =>
      Effect.gen(function*() {
        const { outcomes } = yield* ExtractionModel.extractSettled(definition, { input: state })
        assert.isTrue(Result.isFailure(outcomes.code))
        assert.isTrue(Result.isSuccess(outcomes.face))
      }).pipe(Effect.provide(provide({ ...answers, code: { ...answers.code, value: null, guess } }))))
  }

  it.effect("preserves candidate text without coordinates", () =>
    Effect.gen(function*() {
      const { answers } = yield* ExtractionModel.extract(definition, { input: state })
      assert.deepStrictEqual(answers.code.value, Option.none())
      assert.strictEqual(answers.code.metadata.cloudflare?.guess, "ALPHA")
      assert.isUndefined(answers.code.metadata.cloudflare?.span)
    }).pipe(Effect.provide(provide({ ...answers, code: { type: "text", value: null, guess: "ALPHA" } }))))

  it.effect("preserves truncation without changing strict success", () =>
    Effect.gen(function*() {
      const { metadata } = yield* ExtractionModel.extract(definition, { input: state })
      assert.strictEqual(metadata.cloudflare?.truncated, true)
    }).pipe(
      Effect.provide(CloudflareExtractionModel.layer()),
      Effect.provide(client({ success: true, result: { ...envelope().result, truncated: true } }))
    ))

  for (
    const invalid of [
      { ...answers.face, p_null: 2 },
      { ...answers.face, guess: "20" },
      { ...answers.face, value: "20" },
      { ...answers.face, confidence: -1 },
      { type: "number" },
      null
    ]
  ) {
    it.effect(`settles malformed field payload ${JSON.stringify(invalid)}`, () =>
      Effect.gen(function*() {
        const { outcomes } = yield* ExtractionModel.extractSettled(definition, { input: state })
        assert.isTrue(Result.isSuccess(outcomes.code))
        assert.isTrue(Result.isFailure(outcomes.face))
        if (Result.isFailure(outcomes.face)) assert.strictEqual(outcomes.face.failure.reason, "Invalid")
      }).pipe(Effect.provide(provide({ ...answers, face: invalid }))))
  }

  for (
    const malformed of [
      { type: "text", guess: "ALPHA" },
      { type: "text", value: "ALPHA", guess: "ALPHA" },
      { type: "text", value: null, span: null },
      { type: "text", value: null, guess: "ALPHA", span: [34, 39, 40] },
      { ...answers.code, confidence: NaN },
      { ...answers.code, p_null: Infinity }
    ]
  ) {
    it.effect(`decodes malformed text fields independently: ${JSON.stringify(malformed)}`, () =>
      Effect.gen(function*() {
        const { outcomes } = yield* ExtractionModel.extractSettled(definition, { input: state })
        assert.isTrue(Result.isFailure(outcomes.code))
        assert.isTrue(Result.isSuccess(outcomes.face))
      }).pipe(Effect.provide(provide({ ...answers, code: malformed }))))
  }

  it.effect("does not include wire values in schema failure descriptions", () =>
    Effect.gen(function*() {
      const { outcomes } = yield* ExtractionModel.extractSettled(definition, { input: state })
      if (Result.isFailure(outcomes.face)) {
        assert.strictEqual(outcomes.face.failure.description.includes("private-wire-value"), false)
      } else assert.fail("Expected invalid field")
    }).pipe(Effect.provide(provide({ ...answers, face: { ...answers.face, guess: "private-wire-value" } }))))

  it.effect("reports absent fields as Missing without discarding good answers", () =>
    Effect.gen(function*() {
      const { outcomes } = yield* ExtractionModel.extractSettled(definition, { input: state })
      assert.isTrue(Result.isSuccess(outcomes.code))
      if (Result.isFailure(outcomes.face)) assert.strictEqual(outcomes.face.failure.reason, "Missing")
      else assert.fail("Expected missing field")
    }).pipe(Effect.provide(provide({ code: answers.code }))))

  for (const span of [[34, 38], [35, 40], [-1, 4], [34.5, 39], [34, 90]]) {
    it.effect(`rejects inconsistent provider span ${JSON.stringify(span)}`, () =>
      Effect.gen(function*() {
        const { outcomes } = yield* ExtractionModel.extractSettled(definition, { input: state })
        assert.isTrue(Result.isFailure(outcomes.code))
        assert.isTrue(Result.isSuccess(outcomes.face))
      }).pipe(Effect.provide(provide({ ...answers, code: { ...answers.code, span } }))))
  }

  it.effect("does not impose final integer constraints on the provider guess", () =>
    Effect.gen(function*() {
      const { answers } = yield* ExtractionModel.extract(definition, { input: state })
      assert.deepStrictEqual(answers.face.value, Option.none())
      assert.strictEqual(answers.face.metadata.cloudflare?.guess, 1.5)
    }).pipe(Effect.provide(provide({ ...answers, face: { type: "number", value: null, guess: 1.5 } }))))

  for (const { input, decimals } of [{ input: "", decimals: 2 }, { input: "valid", decimals: 7 }]) {
    it.effect(`rejects unsupported input/options before HTTP: ${input || "empty"}`, () =>
      Effect.gen(function*() {
        const d = Extraction.make({
          input: Schema.String,
          fields: { amount: Extraction.number({ instructions: "amount", decimals }) }
        })
        const result = yield* Effect.result(ExtractionModel.extract(d, { input }))
        if (Result.isFailure(result)) assert.strictEqual(result.failure.reason._tag, "InvalidUserInputError")
        else assert.fail("Expected invalid input")
      }).pipe(
        Effect.provide(CloudflareExtractionModel.layer()),
        Effect.provide(client(envelope(), () => assert.fail("HTTP must not be called")))
      ))
  }

  for (const mode of ["strict", "settled"] as const) {
    it.effect(`rejects cyclic instructions before HTTP in ${mode} mode`, () =>
      Effect.gen(function*() {
        const instructions: { [key: string]: Schema.Json } = {}
        instructions.self = instructions
        const d = Extraction.make({
          input: Schema.String,
          fields: { amount: Extraction.number({ instructions }) }
        })
        const result = yield* Effect.result(
          mode === "strict"
            ? ExtractionModel.extract(d, { input: "amount 20" }).pipe(Effect.asVoid)
            : ExtractionModel.extractSettled(d, { input: "amount 20" }).pipe(Effect.asVoid)
        )
        if (Result.isFailure(result)) {
          assert.strictEqual(result.failure.reason._tag, "InvalidUserInputError")
        } else assert.fail("Expected invalid instructions")
      }).pipe(
        Effect.provide(CloudflareExtractionModel.layer()),
        Effect.provide(client(envelope(), () => assert.fail("HTTP must not be called")))
      ))
  }

  it.effect("serializes array instructions without modifying the source", () =>
    Effect.gen(function*() {
      const d = Extraction.make({
        input: Schema.String,
        fields: { face: Extraction.number({ instructions: ["Natural face", { exclude: "total" }] }) }
      })
      yield* ExtractionModel.extract(d, { input: state })
    }).pipe(
      Effect.provide(CloudflareExtractionModel.layer()),
      Effect.provide(client(envelope(), (request) => {
        if (request.body._tag !== "Uint8Array") return assert.fail("Expected JSON body")
        const body = JSON.parse(new TextDecoder().decode(request.body.body))
        assert.strictEqual(body.state, state)
        assert.strictEqual(body.fields.face.instructions, "[\"Natural face\",{\"exclude\":\"total\"}]")
      }))
    ))

  it("rejects invalid request property names rather than dropping them", () => {
    const decoded = Schema.decodeUnknownResult(CloudflareSchema.ExtractionsRequest)({
      model: "clairic",
      state: "Face 20",
      fields: { "bad key": { type: "number", instructions: "Face" } }
    })
    assert.isTrue(Result.isFailure(decoded))
  })

  for (const key of ["", "1face", "face space", "é", "a".repeat(65)]) {
    it.effect(`rejects invalid field name before HTTP: ${JSON.stringify(key)}`, () =>
      Effect.gen(function*() {
        const d = Extraction.make({
          input: Schema.String,
          fields: { [key]: Extraction.number({ instructions: "Face" }) }
        })
        const result = yield* Effect.result(ExtractionModel.extract(d, { input: "Face 20" }))
        if (Result.isFailure(result)) assert.strictEqual(result.failure.reason._tag, "InvalidUserInputError")
        else assert.fail("Expected invalid field name")
      }).pipe(
        Effect.provide(CloudflareExtractionModel.layer()),
        Effect.provide(client(envelope(), () => assert.fail("HTTP must not be called")))
      ))
  }

  for (const key of ["a".repeat(64), "_face.1-", "__proto__"]) {
    it.effect(`preserves valid field name: ${key}`, () =>
      Effect.gen(function*() {
        const d = Extraction.make({
          input: Schema.String,
          fields: { [key]: Extraction.number({ instructions: "Face" }) }
        })
        const { answers } = yield* ExtractionModel.extract(d, { input: "Face 20" })
        assert.deepStrictEqual(answers[key].value, Option.some(20))
      }).pipe(
        Effect.provide(CloudflareExtractionModel.layer()),
        Effect.provide(client(envelope({ [key]: answers.face }), (request) => {
          if (request.body._tag !== "Uint8Array") return assert.fail("Expected JSON body")
          const body = JSON.parse(new TextDecoder().decode(request.body.body))
          assert.deepStrictEqual(Object.keys(body.fields), [key])
        }))
      ))
  }

  it.effect("sends decimal precision in the field request", () =>
    Effect.gen(function*() {
      const d = Extraction.make({
        input: Schema.String,
        fields: { amount: Extraction.number({ instructions: "amount", decimals: 2 }) }
      })
      const { answers } = yield* ExtractionModel.extract(d, { input: "0.29 USD" })
      assert.deepStrictEqual(answers.amount.value, Option.some(0.29))
    }).pipe(
      Effect.provide(CloudflareExtractionModel.layer()),
      Effect.provide(client(envelope({ amount: { type: "number", value: 0.29 } }), (request) => {
        if (request.body._tag === "Uint8Array") {
          assert.strictEqual(JSON.parse(new TextDecoder().decode(request.body.body)).fields.amount.decimals, 2)
        }
      }))
    ))

  for (
    const payload of [{ success: true, result: { answers } }, {
      success: false,
      errors: [{ code: 10000, message: "Authentication error" }]
    }]
  ) {
    it.effect("fails the whole settled call for an invalid envelope", () =>
      Effect.gen(function*() {
        const result = yield* Effect.result(ExtractionModel.extractSettled(definition, { input: state }))
        assert.isTrue(Result.isFailure(result))
      }).pipe(Effect.provide(CloudflareExtractionModel.layer()), Effect.provide(client(payload))))
  }

  it.effect("maps HTTP failures without retrying", () => {
    let calls = 0
    return Effect.gen(function*() {
      const result = yield* Effect.result(ExtractionModel.extractSettled(definition, { input: state }))
      assert.isTrue(Result.isFailure(result))
      assert.strictEqual(calls, 1)
      if (Result.isFailure(result)) assert.strictEqual(result.failure.method, "createExtractions")
    }).pipe(
      Effect.provide(CloudflareExtractionModel.layer()),
      Effect.provide(client({ errors: [] }, () => {
        calls++
      }, 503))
    )
  })
})
