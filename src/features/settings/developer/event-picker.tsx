"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { Segmented } from "~/components/ui/segmented";
import { eventResources } from "./webhooks";

/**
 * Which events a webhook receives: every event, or whole resources
 * (`expense.*`). The names are the API's own, so they stay as they are in
 * every language; the verbs under each say what it covers.
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
	const resources = useMemo(() => eventResources(), []);
	const all = value.length === 0;
	return (
		<div className="flex flex-col gap-3">
			<Segmented<string>
				full
				label={t("label")}
				onChange={(v) => onChange(v === "all" ? [] : [resources[0]?.filter ?? ""])}
				options={[
					{ value: "all", label: t("all") },
					{ value: "some", label: t("some") },
				]}
				value={all ? "all" : "some"}
			/>
			{all ? (
				<p className="text-fg-3 text-small">{t("allHint")}</p>
			) : (
				<fieldset className="flex max-h-56 flex-col gap-3 overflow-y-auto">
					<legend className="sr-only">{t("label")}</legend>
					{resources.map((r) => {
						const id = `wh-event-${r.resource}`;
						const on = value.includes(r.filter);
						return (
							<div className="flex items-start gap-3" key={r.resource}>
								<Checkbox
									checked={on}
									id={id}
									onCheckedChange={(next) => {
										const rest = value.filter((f) => f !== r.filter);
										// The last one stays: no filters would mean every event.
										if (next !== true && rest.length === 0) return;
										onChange(next === true ? [...value, r.filter] : rest);
									}}
								/>
								<Label
									className="flex flex-col items-start gap-0 font-normal"
									htmlFor={id}
								>
									<span className="font-mono">{r.filter}</span>
									<span className="text-fg-3 text-meta">{r.verbs.join(", ")}</span>
								</Label>
							</div>
						);
					})}
				</fieldset>
			)}
		</div>
	);
}
