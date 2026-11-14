/**
 * The device preview runner against every expense.create vector. The vectors'
 * expected money is derived by hand in expense-create-vectors.ts; the checks
 * here are about the runner: a preview is the write rolled back, apply makes
 * exactly what the preview said, and nothing leaks into the store.
 */
import { createPreviewRunnerCore } from "@retrospend/domain/figures/preview";
import { FigurePass, readFiguresIn } from "@retrospend/domain/figures/registry";
import { MissingRateError } from "@retrospend/domain/money";
import { describe, expect, it } from "vitest";
import { createExpense, EXPENSE_CREATE } from "./expense-create";
import { vectors } from "./expense-create-vectors";
import { LocalDb } from "./local-db";
import { seededStore } from "./local-expense-create";
import { dump } from "./local-fixtures";
import type { Tx } from "./port";
import {
	createDevicePreviewRunner,
	deviceUndoMutation,
	EXPENSE_CREATE_MUTATION,
} from "./preview";
import { deviceFigures } from "./registry";
import type { UndoToken } from "./undo";

const actor = { userId: "u1" };
const scope = { ...actor };
const IDS = EXPENSE_CREATE_MUTATION.touches;

const first = vectors[0] as (typeof vectors)[number];
// The second vector: ARS 1000.50 into an ARS home, booked as entered.
const arsExpense = vectors[1] as (typeof vectors)[number];

/** A registry reading at the instant the vector's expense happened, so it lands in the current month. */
const figuresAt = (date: Date) =>
	deviceFigures({
		clock: () => date,
		owed: () => ({ owedToYou: 0, youOwe: 0 }),
	});

async function open(v: (typeof vectors)[number]) {
	const store = await seededStore(v.seed);
	const figures = figuresAt(v.input.date);
	const runner = createDevicePreviewRunner({ store, figures, actor });
	const readings = () =>
		readFiguresIn(
			store,
			IDS.map((id) => figures.get(id)),
			scope,
			new FigurePass(),
		);
	return { store, figures, runner, readings };
}

describe("device preview runner, every expense.create vector", () => {
	for (const v of vectors)
		it(v.name, async () => {
			const { store, runner, readings } = await open(v);
			const before = dump(store);
			const readBefore = await readings();

			if ("missingRate" in v.expect) {
				// A missing rate blocks the save: nothing written, the queue is free.
				for (const run of [
					() => runner.preview(EXPENSE_CREATE_MUTATION, v.input),
					() => runner.apply(EXPENSE_CREATE_MUTATION, v.input),
				]) {
					const error = await run().catch((e) => e);
					expect(error).toBeInstanceOf(MissingRateError);
					expect((error as MissingRateError).currencies).toEqual(
						v.expect.missingRate,
					);
					expect(dump(store)).toEqual(before);
				}
				await expect(store.transaction(() => "free")).resolves.toBe("free");
				return;
			}

			const preview = await runner.preview(EXPENSE_CREATE_MUTATION, v.input);
			expect(dump(store)).toEqual(before);

			const { undo, ...applied } = await runner.apply(
				EXPENSE_CREATE_MUTATION,
				v.input,
			);
			// Apply makes exactly what the preview said.
			expect(applied).toEqual(preview);

			// What was read inside the transaction is what a re-read of the store gives.
			const after = await readings();
			for (const c of preview.changes)
				expect(after.get(c.id)).toEqual(c.figureAfter);
			for (const u of preview.unchanged)
				expect(after.get(u.id)).toEqual(u.value);
			for (const u of preview.unavailable) expect(after.get(u.id)).toBeNull();

			// The token is the one LocalDb.write makes for the same write.
			const other = await seededStore(v.seed);
			const written = await new LocalDb(other).write(
				EXPENSE_CREATE,
				createExpense(v.input),
			);
			expect(undo).toEqual(written.undo);

			// Undoing it puts the figures back as they were.
			await new LocalDb(store).undo(undo);
			expect(await readings()).toEqual(readBefore);
			expect(dump(store)).toEqual(before);
		});
});

describe("device preview runner", () => {
	// USD 100 into an ARS home at blue 1,545 on 2026-03-05, booked at
	// 154,500.00 ARS. Spent gains USD 100.00 (10,000 minor), listed by its
	// own currency. Glance.spent totals in ARS: the row is booked at home, so
	// it counts as entered, 154,500.00 = 15,450,000 minor, from 0 before.
	// A runner reading the store instead of the transaction would see no change.
	it("shows the change the write makes, read through the transaction", async () => {
		const { runner } = await open(first);
		const preview = await runner.preview(EXPENSE_CREATE_MUTATION, first.input);
		expect(preview.changes).toEqual([
			{
				id: "spent",
				currency: "USD",
				before: null,
				after: { minor: 10_000, currency: "USD" },
				delta: { minor: 10_000, currency: "USD" },
				figureAfter: [{ minor: 10_000, currency: "USD" }],
			},
			{
				id: "glance.spent",
				currency: "ARS",
				before: { minor: 0, currency: "ARS" },
				after: { minor: 15_450_000, currency: "ARS" },
				delta: { minor: 15_450_000, currency: "ARS" },
				figureAfter: [{ minor: 15_450_000, currency: "ARS" }],
			},
		]);
		expect(preview.unchanged).toEqual([]);
		expect(preview.unavailable).toEqual([]);
		expect(preview.approx).toEqual([]);
	});

	// ARS 1,000.50 booked as entered: spent and glance.spent both gain
	// 100,050 minor. Undoing it moves both back by exactly that, and previewing
	// the undo writes nothing: the expense is still there.
	it("previews an undo as the equal and opposite change, and writes nothing", async () => {
		const { store, runner } = await open(arsExpense);
		const applied = await runner.apply(
			EXPENSE_CREATE_MUTATION,
			arsExpense.input,
		);
		expect(applied.changes.map((c) => c.delta.minor)).toEqual([
			100_050, 100_050,
		]);

		const kept = dump(store);
		const undoPreview = await runner.preview(
			deviceUndoMutation(applied.undo, EXPENSE_CREATE_MUTATION.touches),
			undefined,
		);
		expect(dump(store)).toEqual(kept);
		expect(undoPreview.changes.map((c) => [c.id, c.delta])).toEqual([
			["spent", { minor: -100_050, currency: "ARS" }],
			["glance.spent", { minor: -100_050, currency: "ARS" }],
		]);

		await runner.apply(
			deviceUndoMutation(applied.undo, EXPENSE_CREATE_MUTATION.touches),
			undefined,
		);
		expect(store.list("expenses")).toEqual([]);
	});

	it("stops a stale undo with a conflict and writes nothing", async () => {
		const { store, runner } = await open(arsExpense);
		const applied = await runner.apply(
			EXPENSE_CREATE_MUTATION,
			arsExpense.input,
		);
		await store.transaction((tx) => {
			const row = tx.get("expenses", arsExpense.input.id);
			if (row) tx.put("expenses", { ...row, amount: "9" });
		});
		const kept = dump(store);
		await expect(
			runner.apply(
				deviceUndoMutation(applied.undo, EXPENSE_CREATE_MUTATION.touches),
				undefined,
			),
		).rejects.toThrow(/no longer safe/);
		expect(dump(store)).toEqual(kept);
	});

	it("trips when a transaction runner swallows the rollback", async () => {
		const { store, figures } = await open(first);
		// A broken runner: it catches whatever the work throws, rollback included.
		async function swallowing<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
			const tx = await store.begin();
			try {
				return await work(tx);
			} catch {
				return undefined as T;
			} finally {
				tx.rollback();
			}
		}
		const runner = createPreviewRunnerCore<Tx, UndoToken>({
			figures,
			actor,
			transaction: swallowing,
			markPreview: (work) => work(),
		});
		await expect(
			runner.preview(EXPENSE_CREATE_MUTATION, first.input),
		).rejects.toThrow("finished without rolling back its transaction");
	});

	it("runs the mark around every preview and never around an apply", async () => {
		const { store, figures } = await open(first);
		let marked = 0;
		const runner = createPreviewRunnerCore<Tx, UndoToken>({
			figures,
			actor,
			transaction: (work) => store.transaction(work),
			markPreview: (work) => {
				marked += 1;
				return work();
			},
		});
		await runner.preview(EXPENSE_CREATE_MUTATION, first.input);
		expect(marked).toBe(1);
		await runner.apply(EXPENSE_CREATE_MUTATION, first.input);
		expect(marked).toBe(1);
	});
});
