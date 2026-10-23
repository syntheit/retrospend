import { dayKey, normalizeTimeZone } from "~/lib/time-zone";
import type { Prisma, PrismaClient } from "~prisma";

/** The zone when a user has none stored and DEFAULT_TIME_ZONE is unset. */
export const FALLBACK_TIME_ZONE = "America/Argentina/Buenos_Aires";

const SUPPORTED = new Set(Intl.supportedValuesOf("timeZone"));

/**
 * `value` as a zone the runtime lists (Intl.supportedValuesOf), in its
 * canonical spelling, or undefined. Aliases resolve first: the list names
 * Buenos Aires "America/Buenos_Aires" while browsers may send
 * "America/Argentina/Buenos_Aires". The list leaves out UTC, so it is
 * allowed by name.
 */
export function supportedTimeZone(value: unknown): string | undefined {
	const zone = normalizeTimeZone(value);
	if (!zone) return undefined;
	const canonical = new Intl.DateTimeFormat("en-US", {
		timeZone: zone,
	}).resolvedOptions().timeZone;
	return canonical === "UTC" || SUPPORTED.has(canonical)
		? canonical
		: undefined;
}

export function defaultTimeZone(): string {
	return normalizeTimeZone(process.env.DEFAULT_TIME_ZONE) ?? FALLBACK_TIME_ZONE;
}

/**
 * The one rule for which zone a user's calendar days are read in: the zone
 * of the device making the request (the web client renders days in it, so
 * the server must bucket in it too), else the user's stored zone, else the
 * server default.
 */
export function resolveTimeZone(
	stored: string | null | undefined,
	requestZone?: string,
): string {
	return requestZone ?? supportedTimeZone(stored) ?? defaultTimeZone();
}

type ZoneDb = Pick<PrismaClient | Prisma.TransactionClient, "user">;

/** resolveTimeZone for callers that hold a user id rather than a session. */
export async function userTimeZone(
	db: ZoneDb,
	userId: string | null,
	requestZone?: string,
): Promise<string> {
	if (requestZone || !userId) return resolveTimeZone(null, requestZone);
	const row = await (db as PrismaClient).user.findUnique({
		where: { id: userId },
		select: { timeZone: true },
	});
	return resolveTimeZone(row?.timeZone);
}

/**
 * The first signed-in browser request stores its zone when the user has
 * none yet. The WHERE keeps a zone the user picked meanwhile.
 */
export async function claimTimeZone(
	db: ZoneDb,
	userId: string,
	stored: string | null | undefined,
	requestZone: string | undefined,
): Promise<void> {
	if (stored != null) return;
	const zone = supportedTimeZone(requestZone);
	if (!zone) return;
	await (db as PrismaClient).user.updateMany({
		where: { id: userId, timeZone: null },
		data: { timeZone: zone },
	});
}

/**
 * Today in `timeZone` as a recurring template due date (UTC midnight of that
 * day): a template is due once its day has come where the user is, not when
 * UTC reaches it.
 */
export function todayAsDueDate(timeZone: string, now = new Date()): Date {
	return new Date(`${dayKey(now, timeZone)}T00:00:00.000Z`);
}
