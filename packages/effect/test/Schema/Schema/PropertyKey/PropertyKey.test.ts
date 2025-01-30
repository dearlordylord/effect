import * as Schema from "effect/Schema"
import { strictEqual } from "effect/test/util"
import { describe, it } from "vitest"

describe("PropertyKey", () => {
  it("should handle symbol, string, and number", () => {
    const encodeSync = Schema.encodeSync(Schema.PropertyKey)
    const decodeSync = Schema.decodeSync(Schema.PropertyKey)
    const expectRoundtrip = (pk: PropertyKey) => {
      strictEqual(decodeSync(encodeSync(pk)), pk)
    }

    expectRoundtrip("path")
    expectRoundtrip(1)
    expectRoundtrip(Symbol.for("symbol"))
  })
})
