import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

type Lookup = (host: string) => Promise<{ address: string }[]>

const lookupAll: Lookup = (host) => lookup(host, { all: true })

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split(".")
  if (parts.length !== 4) return null
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN))
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null
}

function isPublicIpv4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

/** The eight 16-bit groups of an IPv6 address, or null when it isn't one. */
function expandIpv6(ip: string): number[] | null {
  let text = ip.split("%")[0].toLowerCase()
  const lastColon = text.lastIndexOf(":")
  if (text.slice(lastColon + 1).includes(".")) {
    const v4 = parseIpv4(text.slice(lastColon + 1))
    if (!v4) return null
    text = `${text.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`
  }
  const halves = text.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail]
  const numbers = groups.map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN))
  return numbers.length === 8 && numbers.every((n) => !Number.isNaN(n)) ? numbers : null
}

function embeddedIpv4(high: number, low: number): number[] {
  return [high >> 8, high & 255, low >> 8, low & 255]
}

function isPublicIpv6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups
  const firstSixZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0
  // ::, ::1, IPv4-compatible and IPv4-mapped addresses
  if (firstSixZero && g5 === 0xffff) return isPublicIpv4(embeddedIpv4(g6, g7))
  if (firstSixZero && g5 === 0) return false
  // NAT64 64:ff9b::/96 carries an IPv4 address
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isPublicIpv4(embeddedIpv4(g6, g7))
  }
  // Only global unicast 2000::/3 is public
  if ((g0 & 0xe000) !== 0x2000) return false
  // 6to4 carries an IPv4 address
  if (g0 === 0x2002) return isPublicIpv4(embeddedIpv4(g1, g2))
  // Teredo and documentation ranges
  if (g0 === 0x2001 && (g1 === 0 || g1 === 0x0db8)) return false
  return true
}

/** True only for an address on the public internet. Anything that doesn't parse is refused. */
export function isPublicIp(ip: string): boolean {
  const version = isIP(ip)
  if (version === 4) {
    const octets = parseIpv4(ip)
    return octets !== null && isPublicIpv4(octets)
  }
  if (version === 6) {
    const groups = expandIpv6(ip)
    return groups !== null && isPublicIpv6(groups)
  }
  return false
}

/** True when every address the host points to is public. A failed or empty lookup counts as no. */
export async function resolvesToPublicAddress(host: string, lookupImpl: Lookup = lookupAll): Promise<boolean> {
  const name = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host
  if (isIP(name)) return isPublicIp(name)
  try {
    const addresses = await lookupImpl(name)
    return addresses.length > 0 && addresses.every(({ address }) => isPublicIp(address))
  } catch {
    return false
  }
}
