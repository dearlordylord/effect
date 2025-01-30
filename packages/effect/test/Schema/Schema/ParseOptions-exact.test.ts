import * as S from "effect/Schema"
import * as Util from "effect/test/Schema/TestUtils"
import { assertFalse, assertTrue } from "effect/test/util"
import { describe, it } from "vitest"

describe("`exact` option", () => {
  describe("decoding", () => {
    it("false (default)", async () => {
      const schema = S.Struct({ a: S.Unknown })
      await Util.assertions.decoding.succeed(schema, {}, { a: undefined })
    })

    it("true", async () => {
      const schema = S.Struct({ a: S.Unknown })
      await Util.assertions.decoding.fail(
        schema,
        {},
        `{ readonly a: unknown }
└─ ["a"]
   └─ is missing`,
        { parseOptions: { exact: true } }
      )
    })
  })

  describe("is", () => {
    it("true (default)", async () => {
      const schema = S.Struct({ a: S.Unknown })
      assertFalse(S.is(schema)({}))
    })

    it("false", async () => {
      const schema = S.Struct({ a: S.Unknown })
      assertTrue(S.is(schema)({}, { exact: false }))
    })
  })

  describe("asserts", () => {
    it("true (default)", async () => {
      const schema = S.Struct({ a: S.Unknown })
      Util.assertions.asserts.fail(
        schema,
        {},
        `{ readonly a: unknown }
└─ ["a"]
   └─ is missing`
      )
    })

    it("false", async () => {
      const schema = S.Struct({ a: S.Unknown })
      Util.assertions.asserts.succeed(schema, {}, { parseOptions: { exact: false } })
    })
  })
})
