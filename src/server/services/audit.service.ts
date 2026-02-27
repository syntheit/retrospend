import { type EventType, type Prisma } from "~prisma";
import { db } from "~/server/db";

export interface LogEventParams {
  eventType: EventType;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Privacy modes for audit logging
 * - minimal: Don't store IP/user agent (default - best for privacy)
 * - anonymized: Store anonymized IP with last octet removed (recommended for most apps)
 * - full: Store complete IP and user agent (best for security, requires compliance)
 */
type PrivacyMode = "minimal" | "anonymized" | "full";

// Configure via environment variable (default: minimal - privacy-first)
const AUDIT_PRIVACY_MODE = (process.env.AUDIT_PRIVACY_MODE as PrivacyMode) || "minimal";

/**
 * Anonymize IP address by removing last octet
 * Example: 192.168.1.100 → 192.168.1.0
 */
function anonymizeIP(ip: string | null | undefined): string | null {
  if (!ip) return null;

  // IPv4
  const ipv4Parts = ip.split('.');
  if (ipv4Parts.length === 4) {
    ipv4Parts[3] = '0';
    return ipv4Parts.join('.');
  }

  // IPv6 - truncate last segment
  const ipv6Parts = ip.split(':');
  if (ipv6Parts.length > 1) {
    ipv6Parts[ipv6Parts.length - 1] = '0';
    return ipv6Parts.join(':');
  }

  return ip;
}

/**
 * Apply privacy mode to audit log data
 */
function applyPrivacyMode(params: LogEventParams): {
  ipAddress: string | null | undefined;
  userAgent: string | null | undefined;
} {
  switch (AUDIT_PRIVACY_MODE) {
    case "minimal":
      return { ipAddress: null, userAgent: null };

    case "anonymized":
      return {
        ipAddress: anonymizeIP(params.ipAddress),
        userAgent: params.userAgent?.substring(0, 255),
      };

    case "full":
    default:
      return {
        ipAddress: params.ipAddress?.substring(0, 255),
        userAgent: params.userAgent?.substring(0, 255),
      };
  }
}

/**
 * Asynchronously log an event to the audit log.
 * This function does not block and errors are caught silently to avoid disrupting the main flow.
 *
 * Privacy mode can be configured via AUDIT_PRIVACY_MODE environment variable:
 * - "minimal" (default): Don't store IP/user agent - privacy-first
 * - "anonymized" (recommended): Store anonymized IP (last octet removed) - good balance
 * - "full": Store complete IP and user agent - maximum security, requires compliance
 */
export async function logEvent(params: LogEventParams): Promise<void> {
  try {
    const { ipAddress, userAgent } = applyPrivacyMode(params);

    await db.eventLog.create({
      data: {
        eventType: params.eventType,
        userId: params.userId,
        ipAddress,
        userAgent,
        metadata: params.metadata,
      },
    });
  } catch (error) {
    // Log the error but don't throw to avoid disrupting the main flow
    console.error("Failed to log audit event:", error);
  }
}

/**
 * Fire-and-forget version of logEvent that doesn't await the result.
 * Use this when you don't need to wait for the log to be written.
 */
export function logEventAsync(params: LogEventParams): void {
  void logEvent(params);
}
