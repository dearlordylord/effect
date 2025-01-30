import * as Cause from "effect/Cause"
import * as FiberId from "effect/FiberId"
import * as Pretty from "effect/Pretty"
import * as S from "effect/Schema"
import * as Util from "effect/test/Schema/TestUtils"
import { strictEqual } from "effect/test/util"
import { describe, it } from "vitest"

describe("CauseFromSelf", () => {
  it("arbitrary", () => {
    Util.assertions.arbitrary.validateGeneratedValues(S.CauseFromSelf({ error: S.NumberFromString, defect: S.Unknown }))
  })

  it("test roundtrip consistency", () => {
    Util.assertions.testRoundtripConsistency(S.CauseFromSelf({ error: S.NumberFromString, defect: S.Unknown }))
  })

  it("decoding", async () => {
    const schema = S.CauseFromSelf({ error: S.NumberFromString, defect: S.Unknown })

    await Util.assertions.decoding.succeed(schema, Cause.fail("1"), Cause.fail(1))

    await Util.assertions.decoding.fail(
      schema,
      null,
      `Expected Cause<NumberFromString>, actual null`
    )
    await Util.assertions.decoding.fail(
      schema,
      Cause.fail("a"),
      `Cause<NumberFromString>
└─ CauseEncoded<NumberFromString>
   └─ { readonly _tag: "Fail"; readonly error: NumberFromString }
      └─ ["error"]
         └─ NumberFromString
            └─ Transformation process failure
               └─ Unable to decode "a" into a number`
    )
    await Util.assertions.decoding.fail(
      schema,
      Cause.parallel(Cause.die("error"), Cause.fail("a")),
      `Cause<NumberFromString>
└─ CauseEncoded<NumberFromString>
   └─ { readonly _tag: "Parallel"; readonly left: CauseEncoded<NumberFromString>; readonly right: CauseEncoded<NumberFromString> }
      └─ ["right"]
         └─ CauseEncoded<NumberFromString>
            └─ { readonly _tag: "Fail"; readonly error: NumberFromString }
               └─ ["error"]
                  └─ NumberFromString
                     └─ Transformation process failure
                        └─ Unable to decode "a" into a number`
    )
  })

  it("encoding", async () => {
    const schema = S.CauseFromSelf({ error: S.NumberFromString, defect: S.Unknown })

    await Util.assertions.encoding.succeed(schema, Cause.fail(1), Cause.fail("1"))
  })

  it("pretty", () => {
    const schema = S.CauseFromSelf({ error: S.String, defect: S.Unknown })
    const pretty = Pretty.make(schema)
    strictEqual(pretty(Cause.die("error")), `Cause.die(Error: error)`)
    strictEqual(pretty(Cause.empty), `Cause.empty`)
    strictEqual(pretty(Cause.fail("error")), `Cause.fail("error")`)
    strictEqual(
      pretty(Cause.interrupt(FiberId.composite(FiberId.none, FiberId.none))),
      `Cause.interrupt(FiberId.composite(FiberId.none, FiberId.none))`
    )
    strictEqual(
      pretty(Cause.parallel(Cause.die("error"), Cause.fail("error"))),
      `Cause.parallel(Cause.die(Error: error), Cause.fail("error"))`
    )
    strictEqual(
      pretty(Cause.sequential(Cause.die("error"), Cause.fail("error"))),
      `Cause.sequential(Cause.die(Error: error), Cause.fail("error"))`
    )
  })
})
