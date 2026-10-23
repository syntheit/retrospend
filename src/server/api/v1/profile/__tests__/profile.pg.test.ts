/**
 * /api/v1/profile and the extended /me on Postgres: identity changes with
 * their guards (password for email, the username cooldown), avatar upload
 * through multipart, the public page background, replays, and each caller
 * only ever changing themselves.
 */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { contract } from "@retrospend/api-contract";
import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "~/env";
import { auth } from "~/server/better-auth";
import { uploadFile } from "~/server/storage";
import {
	adminDb,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

// Uploads stay in memory: the test checks what is stored, not the disk.
vi.mock("~/server/storage", async (importOriginal) => ({
	...(await importOriginal<typeof import("~/server/storage")>()),
	uploadFile: vi.fn(async (path: string) => path),
	deleteFile: vi.fn(async () => undefined),
}));

const p = contract.profile;
const PASSWORD = "correct horse battery";

async function pngOf(background: string) {
	const png = await sharp({
		create: { width: 8, height: 8, channels: 3, background },
	})
		.png()
		.toBuffer();
	const form = new FormData();
	form.append(
		"file",
		new File([new Uint8Array(png)], "me.png", { type: "image/png" }),
	);
	return form;
}

async function passwordUser() {
	const email = `${randomUUID()}@pg-test.invalid`;
	const { user } = await auth.api.signUpEmail({
		body: {
			email,
			password: PASSWORD,
			name: "Lucía",
			username: `l${randomBytes(6).toString("hex")}`,
		},
	});
	return { id: user.id, email };
}

describe("/api/v1/profile", () => {
	useApiV1();
	let lucia: { id: string; email: string };
	let asLucia: Record<string, string>;

	beforeAll(async () => {
		lucia = await passwordUser();
		asLucia = await asMobile(lucia.id);
	});

	const patch = (
		headers: Record<string, string>,
		body: unknown,
		key?: string,
	) =>
		call("/profile", {
			method: "PATCH",
			headers,
			body,
			idempotent: key ?? true,
		});

	it("reads the caller's profile", async () => {
		const got = await expectBody(
			await call("/profile", { headers: asLucia }),
			p.get,
		);
		expect(got).toMatchObject({
			id: lucia.id,
			email: lucia.email,
			name: "Lucía",
			pendingEmail: null,
		});
	});

	it("renames, and changes the username once per cooldown", async () => {
		const handle = `lucia${randomBytes(3).toString("hex")}`;
		const renamed = await expectBody(
			await patch(asLucia, {
				name: "Lucía Paz",
				username: handle.toUpperCase(),
			}),
			p.update,
		);
		expect(renamed).toMatchObject({
			name: "Lucía Paz",
			username: handle,
			emailChangePending: false,
		});
		await expectProblem(
			await patch(asLucia, { username: `${handle}x` }),
			409,
			"conflict",
		);
	});

	it("needs the current password to change email", async () => {
		const next = `${randomUUID()}@pg-test.invalid`;
		await expectProblem(
			await patch(asLucia, { email: next }),
			400,
			"bad_request",
		);
		await expectProblem(
			await patch(asLucia, { email: next, currentPassword: "wrong password" }),
			400,
			"bad_request",
		);
		// The server sends no email in tests, so the change applies at once.
		const changed = await expectBody(
			await patch(asLucia, {
				email: next.toUpperCase(),
				currentPassword: PASSWORD,
			}),
			p.update,
		);
		expect(changed).toMatchObject({ email: next, emailChangePending: false });
		lucia.email = next;
	});

	it("refuses an email another user has", async () => {
		const other = await createTestUser();
		await expectProblem(
			await patch(asLucia, {
				email: other.user.email,
				currentPassword: PASSWORD,
			}),
			409,
			"conflict",
		);
	});

	it("uploads an avatar as multipart, shows it on /me, and removes it", async () => {
		const png = await sharp({
			create: { width: 8, height: 8, channels: 3, background: "#1e90ff" },
		})
			.png()
			.toBuffer();
		const form = new FormData();
		form.append(
			"file",
			new File([new Uint8Array(png)], "me.png", { type: "image/png" }),
		);
		const key = randomUUID();
		const set = await expectBody<{ avatarUrl: string }>(
			await call("/profile/avatar", {
				method: "PUT",
				headers: asLucia,
				form,
				idempotent: key,
			}),
			p.setAvatar,
		);
		expect(set.avatarUrl).toMatch(/^\/api\/images\/avatars\/.+\.webp$/);
		expect(vi.mocked(uploadFile)).toHaveBeenCalledTimes(1);

		const me = await call("/me", { headers: asLucia });
		expect((await me.json()).avatarUrl).toBe(set.avatarUrl);

		await expectBody(
			await call("/profile/avatar", {
				method: "DELETE",
				headers: asLucia,
				idempotent: true,
			}),
			p.removeAvatar,
		);
		const row = await adminDb.user.findUniqueOrThrow({
			where: { id: lucia.id },
		});
		expect(row.avatarPath).toBeNull();
	});

	it("refuses one key for two different images, and replays the same one", async () => {
		const key = randomUUID();
		const put = async (color: string) =>
			call("/profile/avatar", {
				method: "PUT",
				headers: asLucia,
				form: await pngOf(color),
				idempotent: key,
			});
		const first = await expectBody<{ avatarUrl: string }>(
			await put("#1e90ff"),
			p.setAvatar,
		);
		const calls = vi.mocked(uploadFile).mock.calls.length;
		await expectProblem(await put("#ff4500"), 422, "idempotency_key_reused");
		const replay = await put("#1e90ff");
		expect(replay.headers.get("idempotent-replayed")).toBe("true");
		expect(await expectBody(replay, p.setAvatar)).toEqual(first);
		expect(vi.mocked(uploadFile).mock.calls.length).toBe(calls);
	});

	it("keys the request fingerprint, so a password never sits in a plain hash", async () => {
		const sam = await passwordUser();
		const asSam = await asMobile(sam.id);
		const body = {
			email: `${randomUUID()}@pg-test.invalid`,
			currentPassword: PASSWORD,
		};
		const key = randomUUID();
		await expectBody(await patch(asSam, body, key), p.update);
		const row = await adminDb.idempotencyKey.findFirstOrThrow({
			where: { userId: sam.id, key },
		});
		const message = `PATCH /profile\n${JSON.stringify({
			currentPassword: body.currentPassword,
			email: body.email,
		})}`;
		const plain = createHash("sha256").update(message).digest("hex");
		const subkey = createHmac("sha256", env.BETTER_AUTH_SECRET)
			.update("idempotency-fingerprint")
			.digest();
		expect(row.requestHash).not.toBe(plain);
		expect(row.requestHash).toBe(
			createHmac("sha256", subkey).update(message).digest("hex"),
		);
		const replay = await patch(asSam, body, key);
		expect(replay.headers.get("idempotent-replayed")).toBe("true");
		await expectBody(replay, p.update);
	});

	it("refuses a file that is not an image", async () => {
		const form = new FormData();
		form.append(
			"file",
			new File([new TextEncoder().encode("%PDF-1.7")], "x.pdf"),
		);
		await expectProblem(
			await call("/profile/avatar", {
				method: "PUT",
				headers: asLucia,
				form,
				idempotent: true,
			}),
			400,
			"bad_request",
		);
	});

	it("stores the page background and replays it once", async () => {
		const bg = {
			symbolSets: ["finance"],
			color: "gold",
			density: "dense",
			animation: "static",
			opacity: "bold",
		};
		const key = randomUUID();
		const put = () =>
			call("/profile/background", {
				method: "PUT",
				headers: asLucia,
				body: bg,
				idempotent: key,
			});
		await expectBody(await put(), p.setBackground);
		const replay = await put();
		expect(replay.headers.get("idempotent-replayed")).toBe("true");
		expect(
			await expectBody(
				await call("/profile/background", { headers: asLucia }),
				p.getBackground,
			),
		).toEqual(bg);
	});

	it("only ever changes the caller (RLS)", async () => {
		const bob = await createTestUser();
		const asBob = await asMobile(bob.user.id);
		await expectBody(await patch(asBob, { name: "Bob" }), p.update);
		const luciaRow = await adminDb.user.findUniqueOrThrow({
			where: { id: lucia.id },
		});
		expect(luciaRow.name).toBe("Lucía Paz");
		const bobs = await expectBody(
			await call("/profile/background", { headers: asBob }),
			p.getBackground,
		);
		expect(bobs).toMatchObject({ color: "gray" });
	});
});
