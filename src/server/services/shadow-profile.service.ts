import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { signClaimToken } from "~/lib/claim-token";
import { textUnavailableProblem } from "~/server/crypto/field-open";
import { getShadowInviteEmailTemplate } from "~/server/email-templates";
import { emailSubject } from "~/server/email-copy";
import { sendEmail } from "~/server/mailer";
import type { PrismaClient } from "~prisma";
import { consumeRateLimit } from "./api-v1/rate-limit.service";
import { canMintClaimLink } from "./claim.service";
import { contactHashFor } from "./keys/contact-hash";

/**
 * People you add by name ("shadow" profiles): adding, renaming and the claim
 * link. One implementation for tRPC (people.createShadow, people.updateShadow,
 * claim.generateLink) and /api/v1/people. Every read and write goes through
 * the caller's RLS-scoped client.
 */

export type AddShadowInput = {
	name: string;
	email?: string;
	/** A client-made id: a repeated add with it is a conflict, not a second person. */
	id?: string;
};

export type AddShadowResult =
	| { kind: "account"; userId: string; name: string | null }
	| { kind: "shadow"; id: string; name: string; email: string | null };

/**
 * What an email that belongs to an account does.
 * - "reveal": the person is that account (the web's behavior).
 * - "protect": only an account the caller already shares expenses or a
 *   project with is revealed. For any other, a person is added with the typed
 *   email and the result is the same as for an email with no account, so the
 *   call cannot be used to find out who has an account.
 */
export type AccountPolicy = "reveal" | "protect";

/**
 * Whether the caller already shares expenses or a project with this account.
 * Row level security hides other people's split rows (you see your own, and
 * the others only in a project you share), so the expense itself is asked:
 * its payer and creator are on it, and the caller can read every expense they
 * are in.
 */
async function isConnected(
	db: PrismaClient,
	userId: string,
	accountId: string,
) {
	const [shared, project] = await Promise.all([
		db.sharedTransaction.findFirst({
			where: {
				OR: [
					{ paidByType: "user", paidById: accountId },
					{ createdByType: "user", createdById: accountId },
					{
						splitParticipants: {
							some: { participantType: "user", participantId: accountId },
						},
					},
				],
			},
			select: { id: true },
		}),
		db.projectParticipant.findFirst({
			where: {
				participantType: "user",
				participantId: accountId,
				project: {
					participants: {
						some: { participantType: "user", participantId: userId },
					},
				},
			},
			select: { id: true },
		}),
	]);
	return shared !== null || project !== null;
}

/**
 * Adding a person by email asks whether the email has an account, so it is
 * metered per user, on every transport: 20 an hour.
 */
export const EMAIL_CHECKS = { limit: 20, windowMs: 60 * 60_000 } as const;
export const emailCheckKey = (userId: string) => `people-email:${userId}`;

/** The tRPC side of the meter (v1 meters with its own limiter, which sets Retry-After). */
export async function assertEmailCheck(userId: string) {
	const decision = await consumeRateLimit(
		emailCheckKey(userId),
		EMAIL_CHECKS.limit,
		EMAIL_CHECKS.windowMs,
	);
	if (!decision.allowed)
		throw new TRPCError({
			code: "TOO_MANY_REQUESTS",
			message: `Too many email checks. Try again in ${decision.retryAfterSeconds} seconds.`,
		});
}

export async function addShadow(
	db: PrismaClient,
	creator: { id: string; name: string | null },
	input: AddShadowInput,
	policy: AccountPolicy = "reveal",
): Promise<AddShadowResult> {
	let accountExists = false;
	if (input.email) {
		const account = await db.user.findFirst({
			where: { email: { equals: input.email, mode: "insensitive" } },
			select: { id: true, name: true },
		});
		if (account) {
			if (
				policy === "reveal" ||
				(await isConnected(db, creator.id, account.id))
			)
				return { kind: "account", userId: account.id, name: account.name };
			accountExists = true;
		}
	}
	// Before the write: a hash needs keys, and keys load outside a transaction.
	const emailHash = await contactHashFor("shadow_profile", input.email);
	const profile = await db.shadowProfile.create({
		data: {
			...(input.id ? { id: input.id } : {}),
			name: input.name,
			email: input.email ?? null,
			emailHash,
			createdById: creator.id,
		},
		// Not the email: it is the creator's sealed text, and a write that has
		// committed must not fail while the response opens it. It is the address
		// just written, so the caller gets it from the input.
		select: { id: true, name: true },
	});
	// The address of an account holder is not a stranger to invite.
	if (input.email && !accountExists) {
		inviteByEmail(creator.name ?? "Someone", input.name, input.email);
	}
	return { kind: "shadow", ...profile, email: input.email ?? null };
}

/** Fire and forget: a mail failure never fails the add. */
function inviteByEmail(creator: string, name: string, email: string) {
	const appUrl = env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "";
	if (!appUrl) return;
	const signupUrl = `${appUrl}/signup?email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}&invited=true`;
	void sendEmail(
		email,
		emailSubject.shadowInvite(creator),
		getShadowInviteEmailTemplate(creator, signupUrl),
	);
}

/** The shadow as the caller sees it (RLS), refused once it was linked to an account. */
async function openShadow(db: PrismaClient, id: string) {
	const shadow = await db.shadowProfile.findUnique({
		where: { id },
		select: {
			id: true,
			name: true,
			claimedById: true,
			createdById: true,
			updatedAt: true,
		},
	});
	if (!shadow) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Person not found" });
	}
	if (shadow.claimedById) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This person has already been linked to an account",
		});
	}
	return shadow;
}

/**
 * Renames (and optionally re-emails) a person. shadow_profile's write policy
 * is creator-only, so anyone else is refused here with a clear error instead
 * of a Postgres rejection.
 */
export async function renameShadow(
	db: PrismaClient,
	userId: string,
	input: { id: string; name: string; email?: string | null },
) {
	const shadow = await openShadow(db, input.id);
	if (shadow.createdById !== userId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Only the person who added this contact can rename them",
		});
	}
	const emailHash =
		input.email !== undefined
			? await contactHashFor("shadow_profile", input.email)
			: undefined;
	// The write returns no sealed cell: once it has committed, opening the
	// creator's email must not be able to fail it (a lost key would turn a
	// done rename into an error the caller retries).
	const updated = await db.shadowProfile.update({
		where: { id: shadow.id },
		data: {
			name: input.name,
			...(input.email !== undefined ? { email: input.email, emailHash } : {}),
		},
		select: { id: true, name: true },
	});
	return {
		...updated,
		email:
			input.email === undefined
				? await storedEmail(db, shadow.id)
				: input.email,
	};
}

/**
 * The address the creator stored, for a response; null when its key cannot be
 * had, since the rename it follows has already happened.
 */
async function storedEmail(db: PrismaClient, id: string): Promise<string | null> {
	try {
		const row = await db.shadowProfile.findUnique({
			where: { id },
			select: { email: true },
		});
		return row?.email ?? null;
	} catch (error) {
		if (textUnavailableProblem(error)) return null;
		throw error;
	}
}

/**
 * A claim link grants the holder the person's identity and a membership in
 * every project they are in, so the caller must run all of them
 * (canMintClaimLink); the same check runs again when it is claimed.
 */
export async function mintClaimLink(
	db: PrismaClient,
	userId: string,
	shadowId: string,
) {
	const shadow = await openShadow(db, shadowId);
	if (!(await canMintClaimLink(db, userId, shadow))) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message:
				"Only an editor or organizer of every project this person is in can generate a claim link",
		});
	}
	const token = signClaimToken(
		{
			shadowId: shadow.id,
			version: shadow.updatedAt.getTime(),
			issuerId: userId,
		},
		env.BETTER_AUTH_SECRET,
	);
	// An absolute URL the recipient can open from anywhere.
	const baseUrl = env.PUBLIC_URL ?? env.NEXT_PUBLIC_APP_URL;
	return { url: `${baseUrl}/claim/${token}`, token, name: shadow.name };
}
