import * as P from "effect/ParseResult"
import * as Pretty from "effect/Pretty"
import * as S from "effect/Schema"
import * as Util from "effect/test/Schema/TestUtils"
import { assertFalse, assertTrue, strictEqual } from "effect/test/util"
import { describe, it } from "vitest"

describe("NonNaN", () => {
  const schema = S.NonNaN

  it("test roundtrip consistency", () => {
    Util.assertions.testRoundtripConsistency(schema)
  })

  it("is", () => {
    const is = P.is(schema)
    assertTrue(is(1))
    assertFalse(is(NaN))
  })

  it("decoding", async () => {
    await Util.assertions.decoding.succeed(schema, 1)
    await Util.assertions.decoding.fail(
      schema,
      NaN,
      `NonNaN
└─ Predicate refinement failure
   └─ Expected a number excluding NaN, actual NaN`
    )
  })

  it("pretty", () => {
    const pretty = Pretty.make(schema)
    strictEqual(pretty(1), "1")
    strictEqual(pretty(NaN), "NaN")
  })
})
