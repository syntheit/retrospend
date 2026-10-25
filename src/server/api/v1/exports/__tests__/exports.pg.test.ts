/**
 * /api/v1/exports on Postgres: a full-data export runs as a job, the job
 * carries a short-lived download link, the link opens only for its owner,
 * and an expired or foreign link, job or file opens nothing.
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { signExportLink } from "~/server/services/api-v1/export-link";
import {
	adminDb,
	asMobile,
	call,
	createTestUser,
	expectBody,
	expectProblem,
	useApiV1,
} from "../../core/__tests__/harness";

// The upload store is a directory; the test keeps it in memory.
const files = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("~/server/storage", async () => {
	const { Readable } = await import("node:stream");
	return {
		uploadFile: vi.fn(async (path: string, buffer: Buffer) => {
			files.set(path, buffer);
			return path;
		}),
		deleteFile: vi.fn(async (path: string) => {
			files.delete(path);
		}),
		getFileStream: vi.fn(async (path: string) => {
			const found = files.get(path);
			if (!found) throw new Error("missing");
			return Readable.from(found);
		}),
		getStorageSize: vi.fn(async () => 0),
		getImageUrl: vi.fn(() => null),
	};
});

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

	const request = (headers: Record<string, string>, body: unknown, key?: string) =>
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
		expect(queued).toMatchObject({ kind: "data", format: "zip", download: null });
		job = await untilDone(queued.id);
		expect(job).toMatchObject({ state: "ready", format: "zip", error: null });
		expect(job.fileName).toMatch(/^user-data-\d{4}-\d{2}-\d{2}\.zip$/);
		expect(job.download?.url).toContain(`/api/v1/exports/jobs/${job.id}/download?token=`);
		expect(Date.parse(job.download?.expiresAt ?? "")).toBeGreaterThan(Date.now());
	});

	const pathOf = (url: string) => url.replace("/api/v1", "");

	it("downloads the file with its link", async () => {
		const res = await call(pathOf(job.download?.url ?? ""), { headers: asAlice });
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/zip");
		expect(res.headers.get("content-disposition")).toContain(job.fileName ?? "");
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
			await call(`${path}?token=${expires}.${"0".repeat(64)}`, { headers: asAlice }),
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
		await expect(adminDb.exportJob.count({ where: { userId: alice } })).resolves.toBe(
			before + 1,
		);
	});

	it("records a failure on the job instead of failing the request", async () => {
		const queued = await expectBody<Job>(
			await request(asAlice, { kind: "project_pdf", projectId: "no-such-project" }),
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
		const row = await adminDb.exportJob.findUniqueOrThrow({ where: { id: job.id } });
		expect(files.has(row.storagePath ?? "")).toBe(true);
		const gone = await call(`/exports/jobs/${job.id}`, {
			method: "DELETE",
			headers: asAlice,
			idempotent: true,
		});
		expect(gone.status).toBe(200);
		expect(files.has(row.storagePath ?? "")).toBe(false);
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
				storagePath: "exports/old",
				expiresAt: new Date(Date.now() - 1000),
			},
		});
		files.set("exports/old", Buffer.from("x"));
		const listed = await expectBody<{ items: Job[] }>(
			await call("/exports/jobs", { headers: asAlice }),
			e.listJobs,
		);
		expect(listed.items.map((j) => j.id)).not.toContain(old.id);
		await request(asAlice, { kind: "data" });
		await expect(
			adminDb.exportJob.findUnique({ where: { id: old.id } }),
		).resolves.toBeNull();
		expect(files.has("exports/old")).toBe(false);
	});
});
