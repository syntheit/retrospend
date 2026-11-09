import type { Prisma } from "~prisma";
import type { RejectedImportRow } from "../csv.service";

/** The most row numbers one warning lists; the count always covers all of them. */
const ROWS_LISTED = 10;

/**
 * One warning for the rows an import refused (text that starts with the
 * marker of an encrypted value): how many, why, and which rows by their place
 * in the selection. No text from the rows is ever repeated.
 */
export function rejectedRowWarnings(
	rejected: readonly RejectedImportRow[],
): string[] {
	const first = rejected[0];
	if (!first) return [];
	const listed = rejected
		.slice(0, ROWS_LISTED)
		.map((r) => r.row + 1)
		.join(", ");
	const more =
		rejected.length > ROWS_LISTED
			? ` and ${rejected.length - ROWS_LISTED} more`
			: "";
	const noun = rejected.length === 1 ? "row was" : "rows were";
	return [
		`${rejected.length} ${noun} not imported: ${first.reason} (selected rows ${listed}${more})`,
	];
}

/**
 * What a finalized import writes on its job: completed, the counts, and the
 * job's warnings with one more for the rows the import refused. The warnings
 * are left out when no row was refused, so they stay as they are.
 */
export function completedJobData(
	job: { warnings: Prisma.JsonValue | null },
	result: {
		count: number;
		skippedDuplicates: number;
		rejected: readonly RejectedImportRow[];
	},
): Prisma.ImportJobUpdateInput {
	const added = rejectedRowWarnings(result.rejected);
	return {
		status: "COMPLETED",
		completedAt: new Date(),
		importedCount: result.count,
		skippedDuplicates: result.skippedDuplicates,
		...(added.length > 0
			? {
					warnings: [
						...(Array.isArray(job.warnings) ? job.warnings : []),
						...added,
					] as Prisma.InputJsonValue,
				}
			: {}),
	};
}
