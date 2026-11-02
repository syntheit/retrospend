"use client";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { Tip } from "~/components/ui/tooltip";

export type PaneProps = { onClose: () => void; phone: boolean };

/** The body of the pane while a query is on its way, or when it failed. */
export function Waiting({ failed }: { failed: boolean }) {
	const t = useTranslations("entry.read");
	return failed ? (
		<p className="text-danger text-small" role="alert">
			{t("notAvailable")}
		</p>
	) : (
		<Skeleton className="h-40 w-full" />
	);
}

/** Pencil (the existing edit composer) and the overflow with the row menu's items. */
export function PaneActions({
	edit,
	menu,
	editLabel,
}: {
	edit: (() => void) | null;
	menu: ReactNode;
	editLabel: string;
}) {
	return (
		<>
			{edit ? (
				<Tip content={editLabel}>
					<Button aria-label={editLabel} icon kind="ghost" onClick={edit}>
						<Pencil aria-hidden="true" />
					</Button>
				</Tip>
			) : null}
			{menu}
		</>
	);
}
