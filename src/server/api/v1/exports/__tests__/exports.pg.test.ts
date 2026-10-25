/**
 * /api/v1/exports on Postgres: a full-data export runs as a job, the job
 * carries a short-lived download link, the link opens only for its owner,
 * and an expired or foreign link, job or file opens nothing.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { GET as serveImage } from "~/app/api/images/[...path]/route";
import { env } from "~/env";
import { signExportLink } from "~/server/services/api-v1/export-link";
import { sweepExpiredExports } from "~/server/services/api-v1/export-sweep";
import { anonymizeAndDeleteUser } from "~/server/services/user-deletion.service";
import {
	adminDb,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";

// A real directory, outside the upload store, for this file's exports.
const exportDir = await vi.hoisted(async () => {
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(tmpdir(), "g5a-exports-"));
	process.env.EXPORT_DIR = dir;
	return dir;
});

const onDisk = (path: string) => existsSync(join(exportDir, path));
const putOnDisk = (path: string) => {
	mkdirSync(dirname(join(exportDir, path)), { recursive: true });
	writeFileSync(join(exportDir, path), "x");
};

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const e = contract.exports;

type Job = {
	id: string;
	kind: string;
	format: string;
	state: string;
	fileName: string | null;
	download: { url: string; expiresAt: string } | null;
	error: string | null;
};

describe("/api/v1/exports", () => {
	useApiV1();
	let alice: string;
	let asAlice: Record<string, string>;
	let asBob: Record<string, string>;

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		asAlice = await asMobile(alice);
		asBob = await asMobile((await createTestUser()).user.id);
	});

	const request = (
		headers: Record<string, string>,
		body: unknown,
		key?: string,
	) =>
		call("/exports/jobs", {
			method: "POST",
			headers,
			body,
			idempotent: key ?? true,
		});

	async function untilDone(id: string, headers = asAlice): Promise<Job> {
		for (let n = 0; n < 100; n++) {
			const job = await expectBody<Job>(
				await call(`/exports/jobs/${id}`, { headers }),
				e.getJob,
			);
			if (job.state === "ready" || job.state === "failed") return job;
			await new Promise((r) => setTimeout(r, 100));
		}
		throw new Error("the export did not finish in time");
	}

	let job: Job;

	it("builds the full-data zip in the background and links it", async () => {
		const queued = await expectBody<Job>(
			await request(asAlice, { kind: "data" }),
			e.request,
			202,
		);
		expect(queued).toMatchObject({
			kind: "data",
			format: "zip",
			download: null,
		});
		job = await untilDone(queued.id);
		expect(job).toMatchObject({ state: "ready", format: "zip", error: null });
		expect(job.fileName).toMatch(/^user-data-\d{4}-\d{2}-\d{2}\.zip$/);
		expect(job.download?.url).toContain(
			`/api/v1/exports/jobs/${job.id}/download?token=`,
		);
		expect(Date.parse(job.download?.expiresAt ?? "")).toBeGreaterThan(
			Date.now(),
		);
	});

	const pathOf = (url: string) => url.replace("/api/v1", "");

	it("exports expenses as a CSV, all or only the ones named", async () => {
		const make = (title: string) =>
			adminDb.expense.create({
				data: {
					userId: alice,
					title,
					amount: 7,
					currency: "USD",
					date: new Date(),
					amountInUSD: 7,
					exchangeRate: 1,
					pricingSource: "MANUAL",
				},
			});
		const keep = await make("Sourdough loaf");
		await make("Left out");
		const queued = await expectBody<Job>(
			await request(asAlice, { kind: "expenses", expenseIds: [keep.id] }),
			e.request,
			202,
		);
		expect(queued.format).toBe("csv");
		const done = await untilDone(queued.id);
		expect(done.fileName).toMatch(/^expenses-\d{4}-\d{2}-\d{2}\.csv$/);
		const res = await call((done.download?.url ?? "").replace("/api/v1", ""), {
			headers: asAlice,
		});
		expect(res.headers.get("content-type")).toContain("text/csv");
		const text = await res.text();
		expect(text).toContain("Sourdough loaf");
		expect(text).not.toContain("Left out");
		await adminDb.expense.deleteMany({ where: { userId: alice } });
		await call(`/exports/jobs/${queued.id}`, {
			method: "DELETE",
			headers: asAlice,
			idempotent: true,
		});
	});

	it("downloads the file with its link", async () => {
		const res = await call(pathOf(job.download?.url ?? ""), {
			headers: asAlice,
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/zip");
		expect(res.headers.get("content-disposition")).toContain(
			job.fileName ?? "",
		);
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.subarray(0, 2).toString()).toBe("PK");
	});

	it("lists the job and keeps another user's jobs out of sight", async () => {
		const mine = await expectBody<{ items: Job[] }>(
			await call("/exports/jobs", { headers: asAlice }),
			e.listJobs,
		);
		expect(mine.items.map((j) => j.id)).toEqual([job.id]);
		const theirs = await expectBody<{ items: Job[] }>(
			await call("/exports/jobs", { headers: asBob }),
			e.listJobs,
		);
		expect(theirs.items).toEqual([]);
	});

	it("answers 404 to another user's job, status, link and delete", async () => {
		await expectProblem(
			await call(`/exports/jobs/${job.id}`, { headers: asBob }),
			404,
			"not_found",
		);
		// Their credentials with the owner's valid link still open nothing.
		await expectProblem(
			await call(pathOf(job.download?.url ?? ""), { headers: asBob }),
			404,
			"not_found",
		);
		await expectProblem(
			await call(`/exports/jobs/${job.id}`, {
				method: "DELETE",
				headers: asBob,
				idempotent: true,
			}),
			404,
			"not_found",
		);
	});

	it("refuses an expired, forged or foreign-job link", async () => {
		const path = `/exports/jobs/${job.id}/download`;
		const hourAgo = signExportLink(job.id, alice, Date.now() - 3_600_000).token;
		await expectProblem(
			await call(`${path}?token=${hourAgo}`, { headers: asAlice }),
			403,
			"forbidden",
		);
		const live = signExportLink(job.id, alice).token;
		const [expires] = live.split(".");
		await expectProblem(
			await call(`${path}?token=${expires}.${"0".repeat(64)}`, {
				headers: asAlice,
			}),
			403,
			"forbidden",
		);
		await expectProblem(
			await call(`${path}?token=garbage`, { headers: asAlice }),
			403,
			"forbidden",
		);
		// A link signed for one job does not open another.
		const other = await expectBody<Job>(
			await request(asAlice, { kind: "data" }),
			e.request,
			202,
		);
		await untilDone(other.id);
		await expectProblem(
			await call(`/exports/jobs/${other.id}/download?token=${live}`, {
				headers: asAlice,
			}),
			403,
			"forbidden",
		);
		// A link without credentials opens nothing.
		await expectProblem(
			await call(`${path}?token=${live}`),
			401,
			"unauthenticated",
		);
		// And the fresh link still works for the owner.
		const ok = await call(`${path}?token=${live}`, { headers: asAlice });
		expect(ok.status).toBe(200);
	});

	it("replays a repeated request key without starting a second job", async () => {
		const before = await adminDb.exportJob.count({ where: { userId: alice } });
		const first = await request(asAlice, { kind: "data" }, "export-key-1");
		const again = await request(asAlice, { kind: "data" }, "export-key-1");
		expect(again.headers.get("idempotent-replayed")).toBe("true");
		expect((await again.json()).id).toBe((await first.json()).id);
		await expect(
			adminDb.exportJob.count({ where: { userId: alice } }),
		).resolves.toBe(before + 1);
	});

	it("records a failure on the job instead of failing the request", async () => {
		const queued = await expectBody<Job>(
			await request(asAlice, {
				kind: "project_pdf",
				projectId: "no-such-project",
			}),
			e.request,
			202,
		);
		const done = await untilDone(queued.id);
		expect(done.state).toBe("failed");
		expect(done.error).toBeTruthy();
		expect(done.download).toBeNull();
	});

	it("limits how many exports wait at once", async () => {
		const bob = (await createTestUser()).user.id;
		const asB = await asMobile(bob);
		await adminDb.exportJob.createMany({
			data: Array.from({ length: 3 }, () => ({
				userId: bob,
				kind: "data",
				params: {},
				timeZone: "UTC",
				expiresAt: new Date(Date.now() + 3_600_000),
			})),
		});
		await expectProblem(await request(asB, { kind: "data" }), 409, "conflict");
	});

	it("deletes the job and its file, and purges expired ones", async () => {
		const row = await adminDb.exportJob.findUniqueOrThrow({
			where: { id: job.id },
		});
		expect(onDisk(row.storagePath ?? "")).toBe(true);
		const gone = await call(`/exports/jobs/${job.id}`, {
			method: "DELETE",
			headers: asAlice,
			idempotent: true,
		});
		expect(gone.status).toBe(200);
		expect(onDisk(row.storagePath ?? "")).toBe(false);
		await expectProblem(
			await call(`/exports/jobs/${job.id}`, { headers: asAlice }),
			404,
			"not_found",
		);

		// An expired job is hidden at once and removed by the next request.
		const old = await adminDb.exportJob.create({
			data: {
				userId: alice,
				kind: "data",
				params: {},
				timeZone: "UTC",
				status: "READY",
				fileName: "old.zip",
				storagePath: `${alice}/oldrandom/old`,
				expiresAt: new Date(Date.now() - 1000),
			},
		});
		putOnDisk(`${alice}/oldrandom/old`);
		const listed = await expectBody<{ items: Job[] }>(
			await call("/exports/jobs", { headers: asAlice }),
			e.listJobs,
		);
		expect(listed.items.map((j) => j.id)).not.toContain(old.id);
		await request(asAlice, { kind: "data" });
		await expect(
			adminDb.exportJob.findUnique({ where: { id: old.id } }),
		).resolves.toBeNull();
		expect(onDisk(`${alice}/oldrandom/old`)).toBe(false);
	});

	it("keeps files out of the public image store and behind a random path", async () => {
		const queued = await expectBody<Job>(
			await request(asAlice, { kind: "data" }),
			e.request,
			202,
		);
		await untilDone(queued.id);
		const row = await adminDb.exportJob.findUniqueOrThrow({
			where: { id: queued.id },
		});
		expect(row.storagePath).toMatch(
			new RegExp(`^${alice}/[0-9a-f]{32}/${queued.id}$`),
		);
		expect(onDisk(row.storagePath ?? "")).toBe(true);
		// Not under UPLOAD_DIR, so /api/images could never reach it.
		expect(relative(resolve(env.UPLOAD_DIR), exportDir).startsWith("..")).toBe(
			true,
		);
		const res = await serveImage(new Request("http://localhost/api/images/x"), {
			params: Promise.resolve({
				path: ["exports", ...(row.storagePath ?? "").split("/")],
			}),
		});
		expect(res.status).toBe(404);
	});

	it("sweeps every user's expired exports, not only the next requester's", async () => {
		const bob = (await createTestUser()).user.id;
		const make = async (userId: string, expiresAt: Date, tag: string) => {
			const path = `${userId}/${tag}/job`;
			putOnDisk(path);
			return adminDb.exportJob.create({
				data: {
					userId,
					kind: "data",
					params: {},
					timeZone: "UTC",
					status: "READY",
					fileName: "x.zip",
					storagePath: path,
					expiresAt,
				},
			});
		};
		const past = new Date(Date.now() - 60_000);
		const future = new Date(Date.now() + 3_600_000);
		const oldA = await make(alice, past, "sweepa");
		const oldB = await make(bob, past, "sweepb");
		const keep = await make(bob, future, "sweepkeep");
		expect(await sweepExpiredExports()).toBeGreaterThanOrEqual(2);
		for (const gone of [oldA, oldB]) {
			await expect(
				adminDb.exportJob.findUnique({ where: { id: gone.id } }),
			).resolves.toBeNull();
			expect(onDisk(gone.storagePath ?? "")).toBe(false);
		}
		await expect(
			adminDb.exportJob.findUnique({ where: { id: keep.id } }),
		).resolves.not.toBeNull();
		expect(onDisk(keep.storagePath ?? "")).toBe(true);
	});

	it("removes a deleted user's export folder", async () => {
		const gone = await createTestUser();
		putOnDisk(`${gone.user.id}/rand/job`);
		expect(onDisk(`${gone.user.id}/rand/job`)).toBe(true);
		await anonymizeAndDeleteUser(adminDb, gone.user.id, gone.user.email, null);
		expect(onDisk(gone.user.id)).toBe(false);
	});
});
