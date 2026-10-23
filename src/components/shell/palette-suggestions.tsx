"use client";

import { ListChecks, Repeat } from "lucide-react";
import { useTranslations } from "next-intl";
import { CommandGroup } from "~/components/ui/command";
import { useStatusWord } from "~/components/ui/status-dot";
import { api } from "~/trpc/react";
import { PALETTE_GROUP, PaletteItem } from "./palette";

/**
 * Suggestions in the empty palette (kit paletteItems), from the one Needs
 * you read: the imports waiting for review and the next recurring expense
 * due. Nothing waiting: no group.
 */
export function SuggestionsGroup({
	open,
	go,
}: {
	open: boolean;
	go: (href: string) => void;
}) {
	const t = useTranslations("shell.palette");
	const text = useTranslations("needsYou.text");
	const status = useStatusWord();
	const { data } = api.home.needsYou.useQuery(undefined, { enabled: open });
	const items = data?.items ?? [];
	const review = items.find((i) => i.type === "import.review");
	const due = items.find(
		(i) => i.type === "recurring.overdue" || i.type === "recurring.due",
	);
	if (!review && !due) return null;
	return (
		<CommandGroup className={PALETTE_GROUP} heading={t("suggestions")}>
			{review && (
				<PaletteItem
					label={text("review", { count: review.count ?? 0 })}
					lead={<ListChecks aria-hidden="true" />}
					onSelect={() =>
						go(review.entity ? `/import?job=${review.entity.id}` : "/import")
					}
					value={`suggest review ${review.id}`}
				/>
			)}
			{due?.title && (
				<PaletteItem
					label={t("confirmRecurring", { title: due.title })}
					lead={<Repeat aria-hidden="true" />}
					onSelect={() => go("/activity/recurring")}
					small={status(due.type === "recurring.overdue" ? "overdue" : "due")}
					value={`suggest recurring ${due.id}`}
				/>
			)}
		</CommandGroup>
	);
}
