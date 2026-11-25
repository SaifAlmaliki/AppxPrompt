// With the integrations flag off, nothing may touch the `server_routes` table, so a deploy that
// goes out before its migration can't break workspaces or builds.

import { integrationsEnabled } from "@/lib/services/flags"

export async function ifIntegrations<T>(read: () => Promise<T[]>): Promise<T[]> {
  return integrationsEnabled() ? read() : []
}
