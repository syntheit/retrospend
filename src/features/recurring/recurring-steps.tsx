"use client";

import { ConfirmSheet } from "./confirm-sheet";
import { DeleteSheet } from "./delete-sheet";
import { SkipSheet } from "./skip-sheet";
import type { useRecurring } from "./use-recurring";

/**
 * The Confirm, Skip and Delete steps of a recurring item, wired to useRecurring.
 * Skip this time inside Confirm hands over to the skip step.
 */
export function RecurringSteps({
	recurring: r,
	today,
}: {
	recurring: ReturnType<typeof useRecurring>;
	today: string;
}) {
	const { confirming, skipping, deleting } = r;
	return (
		<>
			{confirming && (
				<ConfirmSheet
					item={confirming}
					onConfirm={(paidOn) => r.book(confirming, paidOn)}
					onOpenChange={(open) => {
						if (!open) r.closeConfirm();
					}}
					onSkip={() => {
						r.closeConfirm();
						r.askSkip(confirming);
					}}
					today={today}
				/>
			)}
			{skipping && (
				<SkipSheet
					item={skipping}
					onOpenChange={(open) => {
						if (!open) r.closeSkip();
					}}
					onSkip={() => r.skipItem(skipping)}
					today={today}
				/>
			)}
			{deleting && (
				<DeleteSheet
					item={deleting}
					onDelete={() => r.deleteItem(deleting)}
					onOpenChange={(open) => {
						if (!open) r.closeDelete();
					}}
					today={today}
				/>
			)}
		</>
	);
}
