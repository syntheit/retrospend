"use client";

import { useTranslations } from "next-intl";
import type { MoneyValue } from "~/components/money/format";
import { Money } from "~/components/money/money";

/** The R30 preview as the server returns it (src/server/services/preview/types.ts). */
export type Preview = {
	changes: readonly {
		id: string;
		currency: string;
		before: MoneyValue | null;
		after: MoneyValue | null;
	}[];
	unchanged: readonly { id: string; value: readonly MoneyValue[] }[];
	unavailable: readonly { id: string }[];
};

/**
 * What a money action changes and what it does not (R30), as flat label and
 * value lines: a change reads "before → after", an unchanged figure its
 * value and "no change". The kit has no preview block yet (reported), so
 * the project sheets share this one. `label` names a figure id.
 */
export function PreviewLines({
	preview,
	label,
	loading,
}: {
	preview: Preview | undefined;
	label: (id: string) => string;
	loading?: boolean;
}) {
	const t = useTranslations("projectV2.preview");
	if (loading || !preview)
		return <p className="text-fg-3 text-small">{t("checking")}</p>;
	const row = "flex items-baseline justify-between gap-3 text-small";
	return (
		<div className="flex flex-col gap-4">
			<div>
				<h3 className="text-fg text-body mb-1 font-medium">{t("changes")}</h3>
				{preview.changes.length === 0 ? (
					<p className="text-fg-2 text-small">{t("nothing")}</p>
				) : (
					<ul className="flex flex-col gap-1">
						{preview.changes.map((c) => (
							<li className={row} key={`${c.id}-${c.currency}`}>
								<span className="text-fg-2">{label(c.id)}</span>
								<span className="whitespace-nowrap">
									<Money missing="none" value={c.before} />
									{" → "}
									<Money
										className="font-semibold"
										missing="none"
										value={c.after}
									/>
								</span>
							</li>
						))}
					</ul>
				)}
			</div>
			<div>
				<h3 className="text-fg text-body mb-1 font-medium">{t("stays")}</h3>
				<ul className="flex flex-col gap-1">
					{preview.unchanged.map((u) => (
						<li className={row} key={u.id}>
							<span className="text-fg-2">{label(u.id)}</span>
							<span className="text-fg-3">{t("noChange")}</span>
						</li>
					))}
					{preview.unavailable.map((u) => (
						<li className={row} key={u.id}>
							<span className="text-fg-2">{label(u.id)}</span>
							<span className="text-attention-text">{t("unavailable")}</span>
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}
