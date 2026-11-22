import { beforeEach, describe, expect, it } from "vitest"

import { getStack, resetStack, router, setPinned } from "@/preview-runtime/router"

const routes = () => getStack().map((entry) => entry.route)

describe("preview router", () => {
  beforeEach(() => {
    setPinned(false)
    resetStack("/")
  })

  it("follows redirects in the interactive preview", () => {
    router.replace("/explore")
    router.push("/recipe")
    expect(routes()).toEqual(["/explore", "/recipe"])
  })

  it("keeps a canvas frame on the screen it shows, like a sign-in screen that skips ahead for a signed-in user", () => {
    setPinned(true)
    resetStack("/")
    router.replace("/explore")
    router.push("/recipe")
    router.navigate("/meal-plan")
    expect(routes()).toEqual(["/"])
  })
})
