/**
 * /api/v1/imports on Postgres: upload and read a CSV, review it, preview and
 * finalize it, undo it, and what must stay closed (another user's file is a
 * 404, a replayed key writes once, a file imports once).
 */
import { contract } from "@retrospend/api-contract";
import { beforeAll, describe, expect, it, vi } from "vitest";
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

const i = contract.imports;
const DAY = new Date().toISOString().slice(0, 10);

const CSV = [
	"title,amount,currency,date",
	`Coffee beans,12.50,USD,${DAY}`,
	`Train ticket,40,USD,${DAY}`,
	`Broken row,0,USD,${DAY}`,
].join("\n");

type Job = { id: string; state: string; rowCount: number; warnings: string[] };

function uploadForm(name: string, text: string) {
	const form = new FormData();
	form.set("file", new File([text], name, { type: "text/csv" }));
	form.set("source", "csv");
	return form;
}

describe("/api/v1/imports", () => {
	useApiV1();
	let alice: string;
	let asAlice: Record<string, string>;
	let asBob: Record<string, string>;

	beforeAll(async () => {
		alice = (await createTestUser()).user.id;
		asAlice = await asMobile(alice);
		asBob = await asMobile((await createTestUser()).user.id);
	});

	const upload = (
		headers: Record<string, string>,
		name = "bank.csv",
		text = CSV,
	) =>
		call("/imports/jobs", {
			method: "POST",
			headers,
			form: uploadForm(name, text),
			idempotent: true,
		});

	async function untilReady(id: string, headers = asAlice): Promise<Job> {
		for (let n = 0; n < 50; n++) {
			const job = await expectBody<Job>(
				await call(`/imports/jobs/${id}`, { headers }),
				i.getJob,
			);
			if (job.state === "ready" || job.state === "failed") return job;
			await new Promise((r) => setTimeout(r, 100));
		}
		throw new Error("the file was not read in time");
	}

	let jobId = "";

	it("uploads a file, reads it in the background and lists it", async () => {
		const created = await expectBody<Job>(await upload(asAlice), i.upload, 201);
		jobId = created.id;
		expect(["queued", "reading", "ready"]).toContain(created.state);
		const ready = await untilReady(jobId);
		expect(ready).toMatchObject({ state: "ready", rowCount: 2 });
		expect(ready.warnings.join(" ")).toContain("Row 3");

		const list = await expectBody<{ items: Job[] }>(
			await call("/imports/jobs", { headers: asAlice }),
			i.listJobs,
		);
		expect(list.items.map((j) => j.id)).toEqual([jobId]);
		// The file and its rows never leave through the job.
		expect(JSON.stringify(list)).not.toContain("Coffee beans");
	});

	it("refuses a file that is not a spreadsheet or statement", async () => {
		const res = await call("/imports/jobs", {
			method: "POST",
			headers: asAlice,
			form: uploadForm("notes.txt", "hello"),
			idempotent: true,
		});
		await expectProblem(res, 400, "bad_request");
	});

	it("keeps another user's file out of every route", async () => {
		await expectProblem(
			await call(`/imports/jobs/${jobId}`, { headers: asBob }),
			404,
			"not_found",
		);
		await expectProblem(
			await call(`/imports/jobs/${jobId}/review`, { headers: asBob }),
			404,
			"not_found",
		);
		for (const [method, path] of [
			["POST", `/imports/jobs/${jobId}/finalize`],
			["POST", `/imports/jobs/${jobId}/finalize/preview`],
			["POST", `/imports/jobs/${jobId}/undo`],
			["POST", `/imports/jobs/${jobId}/cancel`],
			["DELETE", `/imports/jobs/${jobId}`],
		] as const) {
			const res = await call(path, {
				method,
				headers: asBob,
				body: path.includes("finalize") ? { rows: [] } : {},
				idempotent: !path.endsWith("/preview"),
			});
			await expectProblem(res, 404, "not_found");
		}
		const bobs = await expectBody<{ items: Job[] }>(
			await call("/imports/jobs", { headers: asBob }),
			i.listJobs,
		);
		expect(bobs.items).toEqual([]);
	});

	it("reviews the rows as the import would save them", async () => {
		const review = await expectBody<{
			rows: { index: number; title: string; amount: { minor: number } }[];
			counts: { fileRows: number };
		}>(
			await call(`/imports/jobs/${jobId}/review`, { headers: asAlice }),
			i.review,
		);
		expect(review.rows.map((r) => [r.title, r.amount.minor])).toEqual([
			["Coffee beans", 1250],
			["Train ticket", 4000],
		]);
	});

	const choices = (keep: boolean[]) =>
		keep.map((k, index) => ({
			index,
			keep: k,
			categoryId: null,
			kind: "expense",
		}));

	it("previews the finalize without writing, then writes what the preview showed", async () => {
		const body = { rows: choices([true, false]) };
		const preview = await expectBody<{
			detail: { result: { created: number } };
		}>(
			await call(`/imports/jobs/${jobId}/finalize/preview`, {
				method: "POST",
				headers: asAlice,
				body,
			}),
			i.previewFinalize,
		);
		expect(preview.detail.result.created).toBe(1);
		await expect(
			adminDb.expense.count({ where: { userId: alice } }),
		).resolves.toBe(0);

		const key = "finalize-once-1";
		const done = await expectBody<{ created: number; unchecked: number }>(
			await call(`/imports/jobs/${jobId}/finalize`, {
				method: "POST",
				headers: asAlice,
				body,
				idempotent: key,
			}),
			i.finalize,
		);
		expect(done).toMatchObject({ created: 1, unchecked: 1 });
		const stored = await adminDb.expense.findMany({ where: { userId: alice } });
		expect(stored.map((e) => e.title)).toEqual(["Coffee beans"]);

		// The same key replays the first answer and writes nothing more.
		const replay = await call(`/imports/jobs/${jobId}/finalize`, {
			method: "POST",
			headers: asAlice,
			body,
			idempotent: key,
		});
		expect(replay.headers.get("idempotent-replayed")).toBe("true");
		expect((await replay.json()).created).toBe(1);
		await expect(
			adminDb.expense.count({ where: { userId: alice } }),
		).resolves.toBe(1);

		// A new key cannot import the same file twice.
		await expectProblem(
			await call(`/imports/jobs/${jobId}/finalize`, {
				method: "POST",
				headers: asAlice,
				body,
				idempotent: true,
			}),
			400,
			"bad_request",
		);
	});

	it("undoes the import and makes the file reviewable again", async () => {
		const preview = await expectBody<{
			detail: { result: { removed: number } };
		}>(
			await call(`/imports/jobs/${jobId}/undo/preview`, {
				method: "POST",
				headers: asAlice,
				body: {},
			}),
			i.previewUndo,
		);
		expect(preview.detail.result.removed).toBe(1);
		await expect(
			adminDb.expense.count({ where: { userId: alice } }),
		).resolves.toBe(1);

		const undone = await expectBody<{ removed: number }>(
			await call(`/imports/jobs/${jobId}/undo`, {
				method: "POST",
				headers: asAlice,
				body: {},
				idempotent: true,
			}),
			i.undo,
		);
		expect(undone.removed).toBe(1);
		await expect(
			adminDb.expense.count({ where: { userId: alice } }),
		).resolves.toBe(0);
		expect((await untilReady(jobId)).state).toBe("ready");
	});

	it("cancels only a queued file and deletes a finished one", async () => {
		// Hold a job in the queue: only a queued file can be cancelled.
		const queued = await adminDb.importJob.create({
			data: {
				userId: alice,
				status: "QUEUED",
				type: "CSV",
				fileName: "later.csv",
				fileSize: 10,
				fileType: "csv",
				fileData: "",
			},
		});
		const cancelled = await expectBody<Job>(
			await call(`/imports/jobs/${queued.id}/cancel`, {
				method: "POST",
				headers: asAlice,
				body: {},
				idempotent: true,
			}),
			i.cancel,
		);
		expect(cancelled.state).toBe("cancelled");
		await expectProblem(
			await call(`/imports/jobs/${jobId}/cancel`, {
				method: "POST",
				headers: asAlice,
				body: {},
				idempotent: true,
			}),
			400,
			"bad_request",
		);

		const gone = await call(`/imports/jobs/${jobId}`, {
			method: "DELETE",
			headers: asAlice,
			idempotent: true,
		});
		expect(gone.status).toBe(200);
		await expectProblem(
			await call(`/imports/jobs/${jobId}`, { headers: asAlice }),
			404,
			"not_found",
		);
	});
});
