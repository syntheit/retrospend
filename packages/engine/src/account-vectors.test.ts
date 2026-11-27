/**
 * The account vectors on the device: each step runs the way a booked entry
 * does (planOf, then LocalDb), and holds the store to the hand-derived values.
 * Around every write that is done: the preview is the write (the same rows),
 * an undo puts every account-family row back exactly, and the redo brings the
 * write back exactly. A refusal changes nothing. The same vectors run on the
 * server in src/server/services/__tests__/account-conformance.pg.test.ts.
 */
import { FigurePass, readFiguresIn } from "@retrospend/domain/figures/registry";
import { MissingRateError } from "@retrospend/domain/money";
import { describe, expect, it } from "vitest";
import { checkState, seededAccountStore, USER } from "./account-conformance";
import { type AccountVector, accountVectors } from "./account-vectors";
import { planOf } from "./device/book";
import { sameValue } from "./equal";
import { LocalDb } from "./local-db";
import type { Store } from "./port";
import { createDevicePreviewRunner, deviceMutation } from "./preview";
import { deviceFigures } from "./registry";

const TABLES = ["accounts", "legs", "snapshots", "rateSwitches"] as const;

/** Every account-family row, in id order. */
const rowsOf = (store: Store) =>
	Object.fromEntries(TABLES.map((t) => [t, store.list(t)]));

async function run(vector: AccountVector) {
	const store = await seededAccountStore(vector);
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
		await checkState(store, want.done, now);
		const redo = await db.undo(undo);
		expect(sameValue(rowsOf(store), before)).toBe(true);
		await db.undo(redo);
		expect(sameValue(rowsOf(store), after)).toBe(true);
	}
}

describe("account vectors on the device", () => {
	for (const vector of accountVectors) it(vector.name, () => run(vector));
});
