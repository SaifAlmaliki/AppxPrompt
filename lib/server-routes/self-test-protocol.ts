// The plain reasons a server function wasn't tried. Shared by the server (which stores them) and the Code tab
// (which words the known ones in the person's language), so it holds no server-only code.

export const SELF_TEST_REASONS = {
  sendsOrSpends: "it sends or spends something, so it wasn't tried",
  serviceNotConnected: "a service isn't connected",
  notEnoughTime: "not enough time",
  noSampleRequest: "no sample request was given",
  serverNotRunning: "the test server isn't running",
  paused: "testing is paused until tomorrow",
  stillStarting: "the test server was still starting",
  couldNotStart: "the test server couldn't start",
  couldNotReach: "the test server couldn't be reached",
  couldNotRun: "the test couldn't run",
  agent: "agents aren't tried on their own",
} as const

export type SelfTestReasonKey = keyof typeof SELF_TEST_REASONS

/** The key of a stored reason, or null for any other text. */
export function selfTestReasonKey(reason: string | null): SelfTestReasonKey | null {
  return (Object.keys(SELF_TEST_REASONS) as SelfTestReasonKey[]).find((key) => SELF_TEST_REASONS[key] === reason) ?? null
}
