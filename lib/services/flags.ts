export function integrationsEnabled(): boolean {
  return process.env.APP_INTEGRATIONS === "1"
}
