import * as CloudflareExtractionModel from "@effect/ai-cloudflare/CloudflareExtractionModel"
import type { Effect, Option } from "effect"
import { Schema } from "effect"
import { Extraction, ExtractionModel } from "effect/ai"
import { describe, expect, it } from "tstyche"

const definition = Extraction.make({
  input: Schema.String,
  fields: {
    total: Extraction.number({ instructions: "Total", decimals: 2, options: { cloudflare: { unit: "USD" } } }),
    code: Extraction.span({ instructions: "Code" })
  }
})
const program = ExtractionModel.extract(definition, { input: "Total 20 USD; code ALPHA" })
type Response = Effect.Success<typeof program>

describe("Cloudflare extraction augmentation", () => {
  it("types field-specific options and metadata", () => {
    expect<Response["answers"]["total"]["value"]>().type.toBe<Option.Option<number>>()
    expect<Response["answers"]["total"]["metadata"]["cloudflare"]>().type.toBe<
      { readonly guess?: number | null; readonly nullProbability?: number } | undefined
    >()
    expect<Response["answers"]["code"]["metadata"]["cloudflare"]>().type.toBe<
      | { readonly guess?: string | null; readonly nullProbability?: number; readonly span?: readonly [number, number] }
      | undefined
    >()
    expect(Extraction.number).type.not.toBeCallableWith({ instructions: "Total", options: { cloudflare: { unit: 1 } } })
  })
  it("accepts supported aliases and rejects unsupported models", () => {
    expect(CloudflareExtractionModel.model).type.toBeCallableWith("clairic")
    expect(CloudflareExtractionModel.model).type.toBeCallableWith("@cf/cloudflare/clairic")
    expect(CloudflareExtractionModel.model).type.not.toBeCallableWith("clef")
  })
})
