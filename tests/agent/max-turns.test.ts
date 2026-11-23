import { Agent, run, tool, type Model, type ModelRequest } from "@openai/agents"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { endRunAtMaxTurns } from "@/lib/agent/max-turns"

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
const callTool = {
  type: "function_call" as const,
  callId: "call_1",
  name: "ping",
  arguments: "{}",
  status: "completed" as const,
}

const loopingModel: Model = {
  async getResponse(_request: ModelRequest) {
    return { usage: usage as never, output: [callTool], responseId: "r" }
  },
  async *getStreamedResponse(_request: ModelRequest) {
    yield { type: "response_done", response: { id: "r", usage, output: [callTool] } } as never
  },
}

describe("endRunAtMaxTurns", () => {
  const ran = { count: 0 }
  const ping = tool({
    name: "ping",
    description: "ping",
    parameters: z.object({}),
    execute: async () => {
      ran.count++
      return "pong"
    },
  })
  const agent = new Agent({ name: "looper", model: loopingModel, tools: [ping] })

  it("is needed: without it the run throws when it runs out of turns", async () => {
    const result = await run(agent, "go", { stream: true, maxTurns: 2 })
    await expect((async () => {
      for await (const _event of result) void _event
      await result.completed
    })()).rejects.toThrow(/max turns/i)
  })

  it("lets a streamed run finish without throwing, keeping what the tools did", async () => {
    ran.count = 0
    const result = await run(agent, "go", { stream: true, maxTurns: 2, errorHandlers: endRunAtMaxTurns })
    for await (const _event of result) void _event
    await result.completed
    expect(ran.count).toBeGreaterThan(0)
  })
})