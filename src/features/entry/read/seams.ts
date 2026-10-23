/**
 * Named seams for what the server does not do yet (docs/ui/GAPS.md, 2C.2):
 *
 * - Ask to fix: a Needs you item for the person who added a shared expense,
 *   with your message. Needs the ask state on SharedTransaction.
 * - Correct: a correction entry for a locked (settled) split, holding only
 *   the per-person difference (MONEY-MOVES §1.11). Needs
 *   SharedTransaction.correctsId and its money mutation with a preview.
 *
 * The read view shows both actions where they apply, disabled with "Not
 * available yet" (R14), until the server lands; then these become the
 * mutations' availability and the sheets call them.
 */
export const ENTRY_SEAMS = {
	askToFix: { available: false },
	correct: { available: false },
} as const;
