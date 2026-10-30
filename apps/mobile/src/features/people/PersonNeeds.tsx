import { NeedsCard } from "./NeedsCard";
import type { ReviewNeed } from "./ReviewSheet";
import type { NeedsItem, PersonPage } from "./source";

/**
 * What waits for you on this person, as the one NeedsCard. A payment they
 * say they made opens its Confirm sheet and a split somebody added you to
 * opens its Review sheet, each with the details before anything is written.
 * It opens the first; the next one is there once that is answered.
 */
export function PersonNeeds({
	page,
	onConfirm,
	onReview,
}: {
	page: PersonPage;
	onConfirm: (need: Extract<NeedsItem, { kind: "confirmPayment" }>) => void;
	onReview: (need: ReviewNeed) => void;
}) {
	const first = page.needs[0];
	if (!first) return null;
	return (
		<NeedsCard
			inline
			needs={page.needs}
			onPress={() =>
				first.kind === "confirmPayment" ? onConfirm(first) : onReview(first)
			}
		/>
	);
}
