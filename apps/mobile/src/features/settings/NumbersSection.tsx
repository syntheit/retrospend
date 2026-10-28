import {
	type NumberFormatOption,
	numberFormatExamples,
} from "@retrospend/domain/format";
import { type ReactElement, useMemo } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useFormatLocale } from "@/lib/intl";
import { FormPickerRow, FormSection } from "@/ui/Form";
import { useToast } from "@/ui/Toast";
import type { GeneralSettings } from "./source";

/**
 * How amounts read: the number format. It is an account setting the web
 * shares, so a change saves at once, from the server's answer, and the
 * profile is read again because the money formatter takes it from there
 * (useMoneyPrefs). Each number format option is shown as
 * the user's own home-currency amount in it.
 *
 * A hook that returns the section's element, not a component: the form's
 * field group reads its sections from its direct children, and a wrapper
 * component would count as an implicit section of its own.
 */
export function useNumbersSection(
	settings: GeneralSettings | null,
	onSaved: () => void,
): ReactElement | null {
	const t = useTranslations("mobile.settings");
	const tn = useTranslations("mobile.settings.numbers");
	const { api, refreshMe } = useSession();
	const toast = useToast();
	const language = useFormatLocale();
	const home = settings?.homeCurrency;
	const examples = useMemo(
		() => (home ? numberFormatExamples(home, language) : null),
		[home, language],
	);
	if (!settings || !examples) return null;

	const options: { value: NumberFormatOption; label: string }[] = [
		{ value: "follow", label: tn("follow") },
		{ value: "comma_dot", label: examples.comma_dot },
		{ value: "dot_comma", label: examples.dot_comma },
		{ value: "space_comma", label: examples.space_comma },
	];

	async function save(patch: { numberFormat: GeneralSettings["numberFormat"] }) {
		if (!api) return;
		try {
			await api.settings.update(patch, {
				context: { idempotencyKey: newClientId() },
			});
			toast.show({ message: t("saved") });
			await refreshMe();
		} catch {
			toast.show({ message: t("saveError") });
		}
		onSaved();
	}

	return (
		<FormSection
			footer={tn("footer", {
				example: examples[settings.numberFormat ?? "follow"],
			})}
			title={tn("title")}
		>
			<FormPickerRow<NumberFormatOption>
				label={tn("format")}
				onChange={(next) =>
					save({ numberFormat: next === "follow" ? null : next })
				}
				options={options}
				value={settings.numberFormat ?? "follow"}
			/>
		</FormSection>
	);
}
