"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Section } from "~/components/layout/section";
import { NeedsYouList } from "~/components/needs-you/needs-you-list";
import type { NeedsYouItemVM } from "~/components/needs-you/types";
import { useRowDates } from "~/components/rows/dates";
import { Button } from "~/components/ui/button";
import { SkeletonRows } from "~/components/ui/skeleton";
import { firstName } from "~/features/people/filter";
import { ReviewSheet } from "~/features/people/review-sheet";
import { ConfirmSheet } from "~/features/recurring/confirm-sheet";
import { useIsMobile } from "~/hooks/use-mobile";
import { useSession } from "~/hooks/use-session";
import type { NeedsYouList as NeedsYouListDTO } from "~/server/services/needs-you/types";
import { PartUnavailable } from "./home-states";
import { toNeedsVMs, type Words } from "./needs-vm";
import { useNeedsActions } from "./use-needs-actions";

/** Desktop shows this many before "Show N more"; phones keep it compact (mockup). */
const FIRST = { desktop: 6, phone: 3 };

function useWords(list: NeedsYouListDTO | undefined): Words {
	const t = useTranslations("homePage.needs.context");
	const { short } = useRowDates(list?.today);
	const { data: session } = useSession();
	return useMemo(
		() => ({
			context: (key, values) => t(key, values),
			short,
			name: (key) => firstName(list?.people[key]?.name ?? ""),
			email: session?.user.email ?? null,
		}),
		[t, short, list, session],
	);
}

/**
 * Needs you: the one ordered list from home.needsYou, one sentence and one
 * action per item. Links go to their page; the rest open the sheet the
 * other pages use, and money actions end with an Undo toast.
 */
export function NeedsSection({
	list,
	loading,
	failed,
	onRetry,
}: {
	list: NeedsYouListDTO | undefined;
	loading: boolean;
	failed: boolean;
	onRetry: () => void;
}) {
	const t = useTranslations("homePage.needs");
	const phone = useIsMobile();
	const [more, setMore] = useState(false);
	const words = useWords(list);
	const actions = useNeedsActions(list);
	const entries = useMemo(
		() => (list ? toNeedsVMs(list, words) : []),
		[list, words],
	);
	const byId = useMemo(
		() => new Map(entries.map((e) => [e.vm.id, e.item])),
		[entries],
	);
	const first = phone ? FIRST.phone : FIRST.desktop;
	const shown = more ? entries : entries.slice(0, first);
	const onAction = (vm: NeedsYouItemVM) => {
		const item = byId.get(vm.id);
		if (item) actions.run(item);
	};
	const confirming = actions.recurring.confirming;

	return (
		<Section
			count={list ? entries.length : undefined}
			id="needs-you"
			title={t("title")}
		>
			{loading ? (
				<SkeletonRows count={4} />
			) : failed || !list ? (
				<PartUnavailable onRetry={onRetry} />
			) : (
				<>
					<NeedsYouList
						items={shown.map((e) => e.vm)}
						onAction={onAction}
						variant={phone ? "group" : "flat"}
					/>
					{entries.length > first && (
						<Button
							className="mt-2"
							kind="ghost"
							onClick={() => setMore((m) => !m)}
							size="sm"
						>
							{more ? (
								<ChevronUp aria-hidden="true" />
							) : (
								<ChevronDown aria-hidden="true" />
							)}
							{more
								? t("showFewer")
								: t("showMore", { count: entries.length - first })}
						</Button>
					)}
				</>
			)}
			<ReviewSheet item={actions.review} onClose={actions.closeReview} />
			{confirming && (
				<ConfirmSheet
					item={confirming}
					onConfirm={() => actions.recurring.book(confirming)}
					onOpenChange={(open) => {
						if (!open) actions.recurring.closeConfirm();
					}}
					today={actions.recurring.view.data?.today ?? list?.today ?? ""}
				/>
			)}
		</Section>
	);
}
