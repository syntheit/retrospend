/**
 * The transfer vectors on the device: each step runs the way a booked entry
 * does (planOf, then LocalDb), and holds the store to the hand-derived values.
 * Around every write that is done: the preview is the write (the same rows),
 * the preview runner shows what the write makes, an undo puts every row back
 * exactly (transfers, legs, accounts, snapshots and the fee expense) and the
 * redo brings the write back exactly. A refusal, a missing rate and a move the
 * server books change nothing. The same vectors run on the server in
 * src/server/services/__tests__/transfer-conformance.pg.test.ts.
 */
import { FigurePass, readFiguresIn } from "@retrospend/domain/figures/registry";
import { MissingRateError } from "@retrospend/domain/money";
import { describe, expect, it } from "vitest";
import { USER } from "./account-conformance";
import { planOf } from "./device/book";
import { sameValue } from "./equal";
import { LocalDb } from "./local-db";
import { type Store, TABLE_NAMES } from "./port";
import { createDevicePreviewRunner, deviceMutation } from "./preview";
import { deviceFigures } from "./registry";
import {
	checkTransferState,
	seededTransferStore,
} from "./transfer-conformance";
import { TransferOnlineError } from "./transfer-kit";
import { type TransferVector, transferVectors } from "./transfer-vectors";

/** Every row of every table, in id order. */
const rowsOf = (store: Store) =>
	Object.fromEntries(TABLE_NAMES.map((t) => [t, store.list(t)]));

async function run(vector: TransferVector) {
	const store = await seededTransferStore(vector);
	const db = new LocalDb(store);
	for (const step of vector.steps) {
		const now = new Date(step.now);
		const { id, touches, write } = planOf(step.op, store.snapshot(), {}, now);
		const before = rowsOf(store);
		const { expect: want } = step;
		if ("refused" in want) {
			await expect(db.write(id, write)).rejects.toThrow(want.refused);
			expect(sameValue(rowsOf(store), before)).toBe(true);
			continue;
		}
		if ("missingRate" in want) {
			const error = await db.write(id, write).catch((e: unknown) => e);
			expect(error).toBeInstanceOf(MissingRateError);
			expect((error as MissingRateError).currencies).toEqual(want.missingRate);
			expect(sameValue(rowsOf(store), before)).toBe(true);
			continue;
		}
		if ("online" in want) {
			const error = await db.write(id, write).catch((e: unknown) => e);
			expect(error).toBeInstanceOf(TransferOnlineError);
			expect((error as TransferOnlineError).reason).toBe(want.online);
			expect(sameValue(rowsOf(store), before)).toBe(true);
			continue;
		}
		const preview = await db.preview(write);
		expect(sameValue(rowsOf(store), before)).toBe(true);
		// The preview runner: what it shows is what the write makes.
		const figures = deviceFigures({ clock: () => now });
		const runner = createDevicePreviewRunner({
			store,
			figures,
			actor: { userId: USER },
		});
		const mutation = deviceMutation({ id, touches, write: () => write });
		const shown = await runner.preview(mutation, undefined);
		expect(sameValue(rowsOf(store), before)).toBe(true);
		const { undo, ...applied } = await runner.apply(mutation, undefined);
		expect(applied).toEqual(shown);
		const after = rowsOf(store);
		const read = await readFiguresIn(
			store,
			touches.map((t) => figures.get(t)),
			{ userId: USER },
			new FigurePass(),
		);
		for (const c of shown.changes)
			expect(read.get(c.id), c.id).toEqual(c.figureAfter);
		for (const u of shown.unchanged)
			expect(read.get(u.id), u.id).toEqual(u.value);
		// The preview names exactly the rows the write changed.
		expect(undo.kind === "revert" ? undo.changes : []).toEqual(preview.changes);
		await checkTransferState(store, want.done, now);
		const redo = await db.undo(undo);
		expect(sameValue(rowsOf(store), before)).toBe(true);
		await db.undo(redo);
		expect(sameValue(rowsOf(store), after)).toBe(true);
	}
}

describe("transfer vectors on the device", () => {
	for (const vector of transferVectors) it(vector.name, () => run(vector));
});
