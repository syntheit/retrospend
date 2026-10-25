/**
 * /api/v1/me/deletion on Postgres: the preview, the password every time, who
 * may delete (the app's own sessions, never a token), the last-admin refusal, the
 * try limit, and what the deletion leaves behind for other people.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { contract, SCOPES } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { auth } from "~/server/better-auth";
import { ONLY_ADMIN_MESSAGE } from "~/server/services/account-deletion.service";
import { deleteFile } from "~/server/storage";
import { arsUser, ref, seedProject, seedShare } from "../../__tests__/g3-fixtures";
import {
	adminDb,
	apiKeyFor,
	asMobile,
	call,
	expectBody,
	expectProblem,
	sessionFor,
	webCookieFor,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

vi.mock("~/server/storage", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/storage")>()),
	deleteFile: vi.fn(async () => undefined),
}));

const a = contract.account;
const PASSWORD = "correct horse battery";

async function passwordUser(role: "USER" | "ADMIN" = "USER") {
	const { user } = await auth.api.signUpEmail({
		body: {
			email: `${randomUUID()}@pg-test.invalid`,
			password: PASSWORD,
			name: "Lucía",
			username: `l${randomBytes(6).toString("hex")}`,
		},
	});
	if (role === "ADMIN")
		await adminDb.user.update({ where: { id: user.id }, data: { role } });
	return user.id;
}

/** Runs with no other active admin on the shared test database, then restores them. */
async function withNoOtherActiveAdmin(run: () => Promise<void>) {
	const active = await adminDb.user.findMany({
		where: { role: "ADMIN", isActive: true },
		select: { id: true },
	});
	await adminDb.user.updateMany({
		where: { id: { in: active.map((u) => u.id) } },
		data: { isActive: false },
	});
	try {
		await run();
	} finally {
		await adminDb.user.updateMany({
			where: { id: { in: active.map((u) => u.id) } },
			data: { isActive: true },
		});
	}
}

const exists = async (id: string) =>
	(await adminDb.user.findUnique({ where: { id } })) !== null;

const del = (headers: Record<string, string>, body: unknown, key?: string) =>
	call("/me/deletion", {
		method: "POST",
		headers,
		body,
		idempotent: key ?? true,
	});

describe("/api/v1/me/deletion", () => {
	// Each caller has its own address, so the per-IP limit of other files never matters.
	let n = 0;
	const ip = () => ({ "x-forwarded-for": `198.51.100.${200 + n++}` });

	it("previews what deleting would change, with the read scope only", async () => {
		const owner = await passwordUser();
		const other = await arsUser();
		const solo = await adminDb.project.create({
			data: { name: "Solo", createdById: owner, primaryCurrency: "ARS" },
		});
		await adminDb.projectParticipant.create({
			data: {
				projectId: solo.id,
				participantType: "user",
				participantId: owner,
				role: "ORGANIZER",
			},
		});
		const shared = await seedProject(
			{ user: { id: owner } } as never,
			[{ user: other, role: "EDITOR" }],
			"ARS",
		);
		await seedShare(
			{ participantType: "user", participantId: owner },
			ref(other),
			"100",
			"ARS",
		);

		const keyHeaders = {
			...ip(),
			"x-api-key": await apiKeyFor(owner, ["read"]),
		};
		const preview = await expectBody<{
			projectsToDelete: { id: string }[];
			projectsToTransfer: { id: string; newOrganizerName: string }[];
			sharedTransactionsToAnonymize: number;
		}>(await call("/me/deletion", { headers: keyHeaders }), a.deletionPreview);
		expect(preview.projectsToDelete.map((p) => p.id)).toEqual([solo.id]);
		expect(preview.projectsToTransfer.map((p) => p.id)).toEqual([shared]);
		expect(preview.projectsToTransfer[0]?.newOrganizerName).toBe(
			other.user.name,
		);
		expect(preview.sharedTransactionsToAnonymize).toBe(1);
		expect(await exists(owner)).toBe(true);
	});

	it("refuses a missing or wrong password and deletes nothing", async () => {
		const id = await passwordUser();
		const headers = { ...ip(), ...(await asMobile(id)) };
		const missing = await del(headers, {});
		expect(missing.status).toBe(400);
		await expectProblem(
			await del(headers, { password: "not my password" }),
			400,
			"bad_request",
		);
		expect(await exists(id)).toBe(true);
	});

	it("refuses an account with no password to confirm with", async () => {
		const social = await arsUser();
		await expectProblem(
			await del({ ...ip(), ...(await asMobile(social.user.id)) }, { password: PASSWORD }),
			400,
			"bad_request",
		);
		expect(await exists(social.user.id)).toBe(true);
	});

	it("refuses every credential that is not the app's own session", async () => {
		const id = await passwordUser();
		const body = { password: PASSWORD };
		const every = [...SCOPES.filter((s) => s !== "admin")];
		const keyHeaders = {
			...ip(),
			"x-api-key": await apiKeyFor(id, [...every, "account:delete"]),
		};
		await expectProblem(await del(keyHeaders, body), 403, "missing_scope");
		const device = await sessionFor(id, {
			scopes: [...every, "account:delete"].join(" "),
			clientId: "retrospend-cli",
		});
		await expectProblem(
			await del({ ...ip(), authorization: `Bearer ${device}` }, body),
			403,
			"missing_scope",
		);
		const narrowed = await sessionFor(id, {
			scopes: "read write:money",
			clientId: "retrospend-mobile",
		});
		await expectProblem(
			await del({ ...ip(), authorization: `Bearer ${narrowed}` }, body),
			403,
			"missing_scope",
		);
		await expectProblem(await del(ip(), body), 401, "unauthenticated");
		expect(await exists(id)).toBe(true);
	});

	it("needs an Idempotency-Key", async () => {
		const id = await passwordUser();
		const res = await call("/me/deletion", {
			method: "POST",
			headers: { ...ip(), ...(await asMobile(id)) },
			body: { password: PASSWORD },
		});
		expect(res.status).toBe(400);
		expect((await res.json()).code).toBe("idempotency_key_required");
		expect(await exists(id)).toBe(true);
	});

	it("lets an admin delete their own account while another admin remains", async () => {
		const admin = await passwordUser("ADMIN");
		const other = await passwordUser("ADMIN");
		const headers = { ...ip(), ...(await asMobile(admin)) };
		await expectBody(
			await del(headers, { password: PASSWORD }),
			a.delete,
		);
		expect(await exists(admin)).toBe(false);
		expect(await exists(other)).toBe(true);
	});

	it("refuses the last admin and says what to do", async () => {
		await withNoOtherActiveAdmin(async () => {
			const admin = await passwordUser("ADMIN");
			const headers = { ...ip(), ...(await asMobile(admin)) };
			const res = await del(headers, { password: PASSWORD });
			expect(res.status).toBe(403);
			expect(await res.json()).toMatchObject({
				code: "forbidden",
				detail: ONLY_ADMIN_MESSAGE,
			});
			expect(await exists(admin)).toBe(true);
		});
	});

	it("keeps refusing the last admin when a disabled admin exists", async () => {
		await withNoOtherActiveAdmin(async () => {
			const admin = await passwordUser("ADMIN");
			const disabled = await passwordUser("ADMIN");
			await adminDb.user.update({
				where: { id: disabled },
				data: { isActive: false },
			});
			await expectProblem(
				await del(
					{ ...ip(), ...(await asMobile(admin)) },
					{ password: PASSWORD },
				),
				403,
				"forbidden",
			);
			expect(await exists(admin)).toBe(true);
		});
	});

	it("limits tries per user, right or wrong", async () => {
		const id = await passwordUser();
		const headers = { ...ip(), ...(await asMobile(id)) };
		for (let i = 0; i < 5; i++)
			await expectProblem(
				await del(headers, { password: `wrong ${i}` }),
				400,
				"bad_request",
			);
		const limited = await del(headers, { password: PASSWORD });
		await expectProblem(limited, 429, "rate_limited");
		expect(limited.headers.get("retry-after")).toBeTruthy();
		expect(await exists(id)).toBe(true);
	});

	it("deletes the account from the app's session, keeps others' shares and removes files", async () => {
		const id = await passwordUser();
		const other = await arsUser();
		await adminDb.user.update({
			where: { id },
			data: { avatarPath: `avatars/${id}.webp` },
		});
		const project = await seedProject(
			{ user: { id } } as never,
			[{ user: other, role: "EDITOR" }],
			"ARS",
		);
		const share = await seedShare(
			{ participantType: "user", participantId: id },
			ref(other),
			"100",
			"ARS",
			{ projectId: project },
		);

		const headers = { ...ip(), ...(await asMobile(id)) };
		await expectBody(
			await del(headers, { password: PASSWORD }),
			a.delete,
		);

		expect(await exists(id)).toBe(false);
		expect(vi.mocked(deleteFile)).toHaveBeenCalledWith(`avatars/${id}.webp`);
		// The other member keeps the expense (paid by the sentinel) and takes the project over.
		const kept = await adminDb.sharedTransaction.findUniqueOrThrow({
			where: { id: share.id },
		});
		expect(kept.paidById).toBe("DELETED_USER");
		const role = await adminDb.projectParticipant.findFirstOrThrow({
			where: { projectId: project, participantId: other.user.id },
		});
		expect(role.role).toBe("ORGANIZER");
		// Signed out everywhere.
		await expectProblem(
			await call("/me", { headers: { ...ip(), ...headers } }),
			401,
			"unauthenticated",
		);
	});

	it("also works from the web app's own cookie session", async () => {
		const id = await passwordUser();
		const web = await webCookieFor(id);
		await expectBody(
			await del({ ...ip(), ...web }, { password: PASSWORD }),
			a.delete,
		);
		expect(await exists(id)).toBe(false);
	});

	beforeAll(() => {
		vi.mocked(deleteFile).mockClear();
	});
});
