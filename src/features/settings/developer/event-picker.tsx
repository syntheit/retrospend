"use client";

import { MAX_WEBHOOK_EVENT_TYPES } from "@retrospend/api-contract";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { Segmented } from "~/components/ui/segmented";
import { areasOfFilters, eventAreas } from "./webhooks";

/** Whether a choice is more filters than a webhook may hold (use All events instead). */
export function tooManyEvents(filters: readonly string[]): boolean {
	return filters.length > MAX_WEBHOOK_EVENT_TYPES;
}

/**
 * Which events a webhook receives: every event, or whole areas (Expenses,
 * Payments). An area is named in words; the `resource.*` filters it stands
 * for are what the server stores.
 */
export function EventPicker({
	value,
	onChange,
}: {
	/** The chosen filters; empty means every event. */
	value: string[];
	onChange: (filters: string[]) => void;
}) {
	const t = useTranslations("settingsV2.developer.events");
	const tArea = useTranslations("settingsV2.developer.areas");
	const areas = useMemo(() => eventAreas(), []);
	const all = value.length === 0;
	return (
		<div className="flex flex-col gap-3">
			<Segmented<string>
				full
				label={t("label")}
				onChange={(v) =>
					onChange(v === "all" ? [] : [...(areas[0]?.filters ?? [])])
				}
				options={[
					{ value: "all", label: t("all") },
					{ value: "some", label: t("some") },
				]}
				value={all ? "all" : "some"}
			/>
			{all ? (
				<p className="text-fg-3 text-small">{t("allHint")}</p>
			) : (
				<>
					<fieldset className="flex max-h-56 flex-col gap-3 overflow-y-auto">
						<legend className="sr-only">{t("label")}</legend>
						{areas.map((a) => {
							const id = `wh-area-${a.id}`;
							// The area a filter falls in, as the row and the summary name it:
							// a webhook made through the API may hold only `expense.created`.
							const on = areasOfFilters(value).includes(a.id);
							return (
								<div className="flex items-center gap-3" key={a.id}>
									<Checkbox
										checked={on}
										id={id}
										onCheckedChange={(next) => {
											const rest = value.filter(
												(f) => !areasOfFilters([f]).includes(a.id),
											);
											// The last one stays: no filters would mean every event.
											if (next !== true && rest.length === 0) return;
											onChange(next === true ? [...rest, ...a.filters] : rest);
										}}
									/>
									<Label className="font-normal" htmlFor={id}>
										{tArea(a.id)}
									</Label>
								</div>
							);
						})}
					</fieldset>
					{tooManyEvents(value) ? (
						<p className="text-danger text-small" role="alert">
							{t("tooMany")}
						</p>
					) : null}
				</>
			)}
		</div>
	);
}
