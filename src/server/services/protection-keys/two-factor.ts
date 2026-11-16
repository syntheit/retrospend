/**
 * Checks a two-factor code for a signed-in user without going through
 * better-auth's /two-factor/verify-totp. That route refuses the mobile app's
 * scoped sessions (better-auth/scoped-sessions.ts), and calling it records a
 * failed sign-in. The stored secret is better-auth's own (encrypted under the
 * auth secret), the code is RFC 6238 (SHA-1, 6 digits, 30 seconds) with one
 * step of clock drift either way, as the plugin accepts. The tests check it
 * against the plugin's own code generator.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { symmetricDecrypt } from "better-auth/crypto";
import { auth } from "~/server/better-auth";
import { db } from "~/server/db";

const PERIOD_MS = 30_000;
const DIGITS = 6;

/** RFC 4226: the code for one counter. The key is the secret's UTF-8 bytes, as the plugin does. */
function hotp(secret: string, counter: number): string {
	const message = Buffer.alloc(8);
	message.writeBigUInt64BE(BigInt(counter));
	const mac = createHmac("sha1", Buffer.from(secret, "utf8"))
		.update(message)
		.digest();
	const offset = (mac[mac.length - 1] ?? 0) & 15;
	const value = mac.readUInt32BE(offset) & 0x7fffffff;
	return String(value % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** Whether `code` is the user's current two-factor code (or the step before or after). */
export async function verifyTwoFactorCode(
	userId: string,
	code: string,
	now = Date.now(),
): Promise<boolean> {
	const row = await db.twoFactor.findFirst({
		where: { userId, NOT: { verified: false } },
		select: { secret: true },
	});
	if (!row) return false;
	const secret = await symmetricDecrypt({
		key: (await auth.$context).secretConfig,
		data: row.secret,
	});
	const counter = Math.floor(now / PERIOD_MS);
	const given = Buffer.from(code, "utf8");
	let matched = false;
	for (const step of [-1, 0, 1]) {
		const expected = Buffer.from(hotp(secret, counter + step), "utf8");
		matched =
			(given.length === expected.length && timingSafeEqual(given, expected)) ||
			matched;
	}
	return matched;
}
