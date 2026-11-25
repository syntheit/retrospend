/**
 * The row holders of a category that move by one column: expenses, recurring
 * templates, shared expenses and your own shares. Each moves every row it
 * holds (MERGE_ROW_POLICY: income, a transfer's fee, a spread parent and its
 * parts too), leaves every other column as it is (the analytics flag
 * included), and holds the ids and the stamp so the undo writes back only
 * rows still as the move left them.
 */
import type { ShareCategorySource } from "~prisma";
import { assertOwnExpenseCategory } from "../envelope/splits.service";
import {
	type HolderAdapter,
	type MergeCtx,
	type Stamped,
	stampedMove,
	swapAll,
	type Tx,
} from "./holder";

/** The part of a Prisma delegate these holders use. */
interface Table {
	findMany(args: { where: object; select: object }): Promise<{ id: string }[]>;
	updateMany(args: { where: object; data: object }): Promise<{ count: number }>;
}

const asTable = (delegate: unknown) => delegate as Table;

const idsOf = async (table: Table, where: object) =>
	(await table.findMany({ where, select: { id: true } })).map((r) => r.id);

function stampedHolder(
	table: (tx: Tx) => Table,
	own: (c: MergeCtx) => object,
): HolderAdapter<Stamped> {
	return {
		async move(c) {
			const t = table(c.tx);
			const ids = await idsOf(t, { ...own(c), categoryId: c.sourceId });
			const moved = await stampedMove(
				ids,
				(chunk) =>
					t.updateMany({
						where: { ...own(c), id: { in: chunk }, categoryId: c.sourceId },
						data: { categoryId: c.targetId, updatedAt: c.stamp },
					}),
				(chunk) =>
					idsOf(t, { ...own(c), id: { in: chunk }, updatedAt: c.stamp }),
			);
			return {
				held: { ids: moved, stamp: c.stamp.toISOString() },
				moved: moved.length,
				dropped: 0,
			};
		},
		restore: (c, held) =>
			swapAll(held.ids, (chunk) =>
				table(c.tx).updateMany({
					where: {
						...own(c),
						id: { in: chunk },
						categoryId: c.targetId,
						updatedAt: new Date(held.stamp),
					},
					data: { categoryId: c.sourceId, updatedAt: c.stamp },
				}),
			),
	};
}

export const expenseHolder = stampedHolder(
	(tx) => asTable(tx.expense),
	(c) => ({ userId: c.userId }),
);

export const templateHolder = stampedHolder(
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
	async move(c) {
		const t = asTable(c.tx.sharedTransaction);
		const ids = await idsOf(t, { categoryId: c.sourceId });
		const written: string[] = [];
		for (const id of ids) {
			if (await tryWrite(c, () => writeShared(c, t, id))) written.push(id);
		}
		const moved = await idsOf(t, { id: { in: written }, updatedAt: c.stamp });
		return {
			held: {
				ids: moved,
				stamp: c.stamp.toISOString(),
				setToNone: ids.length - moved.length,
			},
			moved: moved.length,
			dropped: ids.length - moved.length,
		};
	},
	restore: (c, held) =>
		swapAll(held.ids, (chunk) =>
			asTable(c.tx.sharedTransaction).updateMany({
				where: {
					id: { in: chunk },
					categoryId: c.targetId,
					updatedAt: new Date(held.stamp),
				},
				data: { categoryId: c.sourceId, updatedAt: c.stamp },
			}),
		),
};

const writeShared = (c: MergeCtx, t: Table, id: string) =>
	t.updateMany({
		where: { id, categoryId: c.sourceId },
		data: { categoryId: c.targetId, updatedAt: c.stamp },
	});

const isRefusedByPolicy = (error: unknown) =>
	/row-level security|42501/.test(
		`${(error as { message?: string })?.message ?? ""} ${JSON.stringify((error as { meta?: unknown })?.meta ?? "")}`,
	);

/** Runs one write in a savepoint; false when row-level security refused it. */
async function tryWrite(c: MergeCtx, write: () => Promise<unknown>) {
	await c.tx.$executeRaw`SAVEPOINT category_merge_row`;
	try {
		await write();
		await c.tx.$executeRaw`RELEASE SAVEPOINT category_merge_row`;
		return true;
	} catch (error) {
		if (!isRefusedByPolicy(error)) throw error;
		await c.tx.$executeRaw`ROLLBACK TO SAVEPOINT category_merge_row`;
		return false;
	}
}

export interface ShareHeld {
	readonly groups: readonly {
		readonly source: ShareCategorySource | null;
		readonly ids: readonly string[];
	}[];
	readonly stamp: string;
}

/**
 * Your own share of a split in the category. The rule for what a share's
 * category may be is the share-category owner's (splits.service.ts), and the
 * source of the pick stays as it was; a share with no category has no source.
 */
export const shareHolder: HolderAdapter<ShareHeld> = {
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
			const moved = await stampedMove(
				ids,
				(chunk) =>
					c.tx.splitParticipant.updateMany({
						where: { ...own, id: { in: chunk }, categoryId: c.sourceId },
						data: {
							categoryId: c.targetId,
							categorySource: c.targetId ? source : null,
							updatedAt: c.stamp,
						},
					}),
				async (chunk) =>
					(
						await c.tx.splitParticipant.findMany({
							where: { ...own, id: { in: chunk }, updatedAt: c.stamp },
							select: { id: true },
						})
					).map((r) => r.id),
			);
			held.push({ source, ids: moved });
		}
		return {
			held: { groups: held, stamp: c.stamp.toISOString() },
			moved: held.reduce((n, g) => n + g.ids.length, 0),
			dropped: 0,
		};
	},
	async restore(c, held) {
		for (const group of held.groups)
			await swapAll(group.ids, (chunk) =>
				c.tx.splitParticipant.updateMany({
					where: {
						id: { in: chunk },
						participantType: "user" as const,
						participantId: c.userId,
						categoryId: c.targetId,
						updatedAt: new Date(held.stamp),
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
