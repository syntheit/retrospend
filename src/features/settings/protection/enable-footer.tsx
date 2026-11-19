"use client";

import { useTranslations } from "next-intl";
import { Button } from "~/components/ui/button";
import type { EnableView } from "./enable-model";

/** Back (or Cancel, or Close) on the left, the step's one verb on the right. */
export function EnableFooter({
	view,
	busy,
	onLeft,
	onPrimary,
}: {
	view: EnableView;
	busy: boolean;
	onLeft: () => void;
	onPrimary: () => void;
}) {
	const t = useTranslations();
	const left = {
		cancel: "overlays.sheet.cancel",
		back: "protection.enable.back",
		close: "overlays.sheet.close",
	};
	return (
		<>
			{view.left ? (
				<Button disabled={busy} kind="secondary" onClick={onLeft}>
					{t(left[view.left])}
				</Button>
			) : null}
			{view.primary ? (
				<Button
					data-sheet-submit=""
					disabled={view.primaryDisabled}
					kind="primary"
					loading={busy}
					onClick={onPrimary}
				>
					{t(view.primary)}
				</Button>
			) : null}
		</>
	);
}
