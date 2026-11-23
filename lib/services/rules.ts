// Pure rules for the services store, kept apart from the database so they can be tested.

import { refreshTokenName, type ServiceDefinition, type ServiceField } from "@/lib/services/protocol"

type Owned = { name: string; serviceSlug: string }

/** Every credential name a service owns: its fields, and the refresh token of an oauth2 service. */
export function definitionNames(definition: Pick<ServiceDefinition, "slug" | "authKind" | "fields">): string[] {
  const names = definition.fields.map((field) => field.name)
  if (definition.authKind === "oauth2") names.push(refreshTokenName(definition.slug))
  return names
}

/** Why a service can't take these names, or null. A name belongs to one service in a project. */
export function credentialCollision(slug: string, names: string[], owned: Owned[]): string | null {
  for (const name of names) {
    const other = owned.find((row) => row.name === name && row.serviceSlug !== slug)
    if (other) return `The name ${name} is already used by the ${other.serviceSlug} service. Choose a different field name.`
  }
  return null
}

/** Hosts the service may call that the owner hasn't approved yet. */
export function unapprovedHosts(definition: Pick<ServiceDefinition, "allowedHosts">, approvedHosts: readonly string[]): string[] {
  return definition.allowedHosts.filter((host) => !approvedHosts.includes(host))
}

/** Whether a saved credential may be sent to the service: the owner approved every host, and there is a request to make. */
export function canCheck(
  definition: Pick<ServiceDefinition, "allowedHosts" | "authKind" | "check">,
  approvedHosts: readonly string[],
): boolean {
  if (unapprovedHosts(definition, approvedHosts).length > 0) return false
  return definition.authKind === "oauth2" || definition.check !== null
}

/** Stored values whose kind differs from the field's new kind, which must be asked for again. */
export function staleCredentialNames(fields: ServiceField[], stored: { name: string; kind: string }[]): string[] {
  const kinds = new Map(fields.map((field) => [field.name, field.kind as string]))
  return stored.filter((row) => kinds.has(row.name) && kinds.get(row.name) !== row.kind).map((row) => row.name)
}
