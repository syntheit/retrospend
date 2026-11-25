/**
 * A password reset link for one account, written straight to Postgres. The
 * e2e app has no mail, so the email that carries the link cannot be read; this
 * stores what the app stores (the SHA-256 of the token, the user, the origin
 * "email", an hour to live) and hands back the raw token for the page's URL.
 */
import { createHash, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "~prisma";
import { E2E_DATABASE_URL } from "../constants";
import { assertE2eDatabase } from "../db-guard";

export async function issueResetLink(email: string): Promise<string> {
	assertE2eDatabase(E2E_DATABASE_URL);
	const token = randomBytes(32).toString("hex");
	const db = new PrismaClient({
		adapter: new PrismaPg({ connectionString: E2E_DATABASE_URL }),
	});
	try {
		const user = await db.user.findUniqueOrThrow({
			where: { email },
			select: { id: true },
		});
		await db.passwordResetToken.create({
			data: {
				token: createHash("sha256").update(token).digest("hex"),
				userId: user.id,
				origin: "email",
				expires: new Date(Date.now() + 60 * 60 * 1000),
			},
		});
	} finally {
		await db.$disconnect();
	}
	return token;
}
