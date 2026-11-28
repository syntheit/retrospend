/**
 * The row holders of a category that move by one column: expenses, recurring
 * templates, shared expenses and your own shares. Each moves every row it
 * holds (MERGE_ROW_POLICY: income, a transfer's fee, a spread parent and its
 * parts too), leaves every other column as it is (the analytics flag
 * included), and holds each row's id and the stamp it stored, so the undo
 * writes back only rows still as the move left them.
 */
import type { ShareCategorySource } from "~prisma";
import { assertOwnExpenseCategory } from "../envelope/splits.service";
import {
	countForeignKeyRows,
	type ForeignKeyHolderId,
	groupByStamp,
	type HolderAdapter,
	heldCount,
	type MergeCtx,
	type Stamped,
	type StampedRow,
	stampedMove,
	swapStamped,
	type Tx,
} from "./holder";

/** The part of a Prisma delegate these holders use. */
interface Table {
	findMany(args: { where: object; select: object }): Promise<{ id: string }[]>;
	updateMany(args: { where: object; data: object }): Promise<{ count: number }>;
	updateManyAndReturn(args: {
		where: object;
		data: object;
		select: { id: true; updatedAt: true };
	}): Promise<StampedRow[]>;
}

const STORED = { id: true, updatedAt: true } as const;

const asTable = (delegate: unknown) => delegate as Table;

const idsOf = async (table: Table, where: object) =>
	(await table.findMany({ where, select: { id: true } })).map((r) => r.id);

function stampedHolder(
	holder: ForeignKeyHolderId,
	table: (tx: Tx) => Table,
	own: (c: MergeCtx) => object,
): HolderAdapter<Stamped> {
	return {
		count: (c) => countForeignKeyRows(c, holder),
		async move(c) {
			const t = table(c.tx);
			const ids = await idsOf(t, { ...own(c), categoryId: c.sourceId });
			const held = await stampedMove(ids, (chunk) =>
				t.updateManyAndReturn({
					where: { ...own(c), id: { in: chunk }, categoryId: c.sourceId },
					data: { categoryId: c.targetId, updatedAt: c.stamp },
					select: STORED,
				}),
			);
			return { held, moved: heldCount(held), dropped: 0 };
		},
		restore: (c, held) =>
			swapStamped(held, (chunk, stamp) =>
				table(c.tx).updateMany({
					where: {
						...own(c),
						id: { in: chunk },
						categoryId: c.targetId,
						updatedAt: stamp,
					},
					data: { categoryId: c.sourceId, updatedAt: c.stamp },
				}),
			),
	};
}

export const expenseHolder = stampedHolder(
	"expense",
	(tx) => asTable(tx.expense),
	(c) => ({ userId: c.userId }),
);

export const templateHolder = stampedHolder(
	"template",
	(tx) => asTable(tx.recurringTemplate),
	(c) => ({ userId: c.userId }),
);

/** What a shared expense the caller cannot write came to: set to no category with the category. */
export interface SharedHeld extends Stamped {
	readonly setToNone: number;
}

/**
 * A shared expense carries its creator's category. Row-level security lets
 * the caller move the ones they may write; one they can read but not write
 * (a project member who lost editing) refuses the update, and goes to no
 * category with the category. Each is tried in a savepoint so one refusal
 * does not abort the rest.
 */
export const sharedTransactionHolder: HolderAdapter<SharedHeld> = {
	count: (c) => countForeignKeyRows(c, "sharedTransaction"),
	async move(c) {
		const t = asTable(c.tx.sharedTransaction);
		const ids = await idsOf(t, { categoryId: c.sourceId });
		const written: StampedRow[] = [];
		for (const id of ids)
			written.push(...((await tryWrite(c, () => writeShared(c, t, id))) ?? []));
		const held = groupByStamp(written);
		const moved = heldCount(held);
		return {
			held: { ...held, setToNone: ids.length - moved },
			moved,
			dropped: ids.length - moved,
		};
	},
	restore: (c, held) =>
		swapStamped(held, (chunk, stamp) =>
			asTable(c.tx.sharedTransaction).updateMany({
				where: { id: { in: chunk }, categoryId: c.targetId, updatedAt: stamp },
				data: { categoryId: c.sourceId, updatedAt: c.stamp },
			}),
		),
};

const writeShared = (c: MergeCtx, t: Table, id: string) =>
	t.updateManyAndReturn({
		where: { id, categoryId: c.sourceId },
		data: { categoryId: c.targetId, updatedAt: c.stamp },
		select: STORED,
	});

/**
 * Only a row-level security refusal (the policy's WITH CHECK, or a guard
 * trigger that says so) means "not yours to write". Any other failure, a
 * missing grant (also 42501) included, must stop the merge: counting it as a
 * refusal would send every shared row to no category.
 */
export const isRefusedByPolicy = (error: unknown) =>
	/row-level security/i.test(
		`${(error as { message?: string })?.message ?? ""} ${JSON.stringify((error as { meta?: unknown })?.meta ?? "")}`,
	);

/** Runs one write in a savepoint; undefined when row-level security refused it. */
async function tryWrite<T>(c: MergeCtx, write: () => Promise<T>) {
	await c.tx.$executeRaw`SAVEPOINT category_merge_row`;
	try {
		const done = await write();
		await c.tx.$executeRaw`RELEASE SAVEPOINT category_merge_row`;
		return done;
	} catch (error) {
		if (!isRefusedByPolicy(error)) throw error;
		await c.tx.$executeRaw`ROLLBACK TO SAVEPOINT category_merge_row`;
		return undefined;
	}
}

export interface ShareHeld {
	readonly groups: readonly {
		readonly source: ShareCategorySource | null;
		readonly held: Stamped;
	}[];
}

/**
 * Your own share of a split in the category. The rule for what a share's
 * category may be is the share-category owner's (splits.service.ts), and the
 * source of the pick stays as it was; a share with no category has no source.
 */
export const shareHolder: HolderAdapter<ShareHeld> = {
	count: (c) => countForeignKeyRows(c, "share"),
	async move(c) {
		const own = { participantType: "user" as const, participantId: c.userId };
		const rows = await c.tx.splitParticipant.findMany({
			where: { ...own, categoryId: c.sourceId },
			select: { id: true, categorySource: true },
		});
		if (rows.length > 0 && c.targetId)
			await assertOwnExpenseCategory(c.tx, c.userId, c.targetId);
		const groups = new Map<ShareCategorySource | null, string[]>();
		for (const r of rows)
			groups.set(r.categorySource, [
				...(groups.get(r.categorySource) ?? []),
				r.id,
			]);
		const held: ShareHeld["groups"][number][] = [];
		for (const [source, ids] of groups) {
			const moved = await stampedMove(ids, (chunk) =>
				c.tx.splitParticipant.updateManyAndReturn({
					where: { ...own, id: { in: chunk }, categoryId: c.sourceId },
					data: {
						categoryId: c.targetId,
						categorySource: c.targetId ? source : null,
						updatedAt: c.stamp,
					},
					select: STORED,
				}),
			);
			held.push({ source, held: moved });
		}
		return {
			held: { groups: held },
			moved: held.reduce((n, g) => n + heldCount(g.held), 0),
			dropped: 0,
		};
	},
	async restore(c, held) {
		for (const group of held.groups)
			await swapStamped(group.held, (chunk, stamp) =>
				c.tx.splitParticipant.updateMany({
					where: {
						id: { in: chunk },
						participantType: "user" as const,
						participantId: c.userId,
						categoryId: c.targetId,
						updatedAt: stamp,
					},
					data: {
						categoryId: c.sourceId,
						categorySource: group.source,
						updatedAt: c.stamp,
					},
				}),
			);
	},
};
