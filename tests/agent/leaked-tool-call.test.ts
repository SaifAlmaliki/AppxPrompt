import { describe, expect, it } from "vitest"

import { createLeakFilter, findLeakedToolCall } from "@/lib/agent/leaked-tool-call"

const LEAK = `سأضيف شاشة دفع.\n\n<update_app>\n<parameter name="appName">null</parameter>\n</update_app>`

describe("findLeakedToolCall", () => {
  it("finds a tool call written out as text, and the words before it", () => {
    expect(findLeakedToolCall(LEAK)).toEqual({ visible: "سأضيف شاشة دفع.", tool: "update_app" })
  })

  it("finds the other ways a call gets written out", () => {
    expect(findLeakedToolCall('Sure.\n<invoke name="propose_plan">').tool).toBe("propose_plan")
    expect(findLeakedToolCall("Sure.\n<function_calls>").tool).toBe("")
    expect(findLeakedToolCall('Sure.\n<parameter name="addScreens">[]').visible).toBe("Sure.")
  })

  it("leaves an ordinary reply alone, including angle brackets in prose", () => {
    expect(findLeakedToolCall("Use a <Button> and 3 < 5.")).toEqual({ visible: "Use a <Button> and 3 < 5.", tool: null })
  })
})

describe("createLeakFilter", () => {
  it("passes ordinary text straight through", () => {
    const filter = createLeakFilter()
    expect(filter.push("Hello ") + filter.push("there.") + filter.flush()).toBe("Hello there.")
    expect(filter.leaked).toBeNull()
  })

  it("never lets a call split across deltas reach the chat", () => {
    const filter = createLeakFilter()
    const shown = ["سأضيف شاشة دفع.\n\n<up", "date_app>\n<param", 'eter name="appName">null'].map((delta) => filter.push(delta)).join("") + filter.flush()
    expect(shown).toBe("سأضيف شاشة دفع.\n\n")
    expect(shown).not.toContain("<")
    expect(filter.leaked).toBe("update_app")
  })

  it("shows nothing after a call, even text in later deltas", () => {
    const filter = createLeakFilter()
    filter.push("Ok.\n<update_app>")
    expect(filter.push(" more text")).toBe("")
    expect(filter.flush()).toBe("")
  })

  it("releases a held-back '<' once it turns out to be prose", () => {
    const filter = createLeakFilter()
    const shown = filter.push("Wrap it in a <") + filter.push("View> please.") + filter.flush()
    expect(shown).toBe("Wrap it in a <View> please.")
    expect(filter.leaked).toBeNull()
  })
})
