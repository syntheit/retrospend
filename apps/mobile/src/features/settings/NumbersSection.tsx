import {
	type NumberFormatOption,
	numberFormatExamples,
} from "@retrospend/domain/format";
import { useMemo } from "react";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { useFormatLocale } from "@/lib/intl";
import { FormPickerRow, FormSection } from "@/ui/Form";
import { useToast } from "@/ui/Toast";
import type { GeneralSettings } from "./source";

/**
 * How amounts read: the number format and the currency symbol style. Both
 * are account settings the web shares, so a change saves at once, from the
 * server's answer, and the profile is read again because the money formatter
 * takes them from it (useMoneyPrefs). Each number format option is shown as
 * the user's own home-currency amount in it.
 */
export function NumbersSection({
	settings,
	onSaved,
}: {
	settings: GeneralSettings;
	onSaved(): void;
}) {
	const t = useTranslations("mobile.settings");
	const tn = useTranslations("mobile.settings.numbers");
	const { api, refreshMe } = useSession();
	const toast = useToast();
	const language = useFormatLocale();
	const examples = useMemo(
		() => numberFormatExamples(settings.homeCurrency, language),
		[settings.homeCurrency, language],
	);
	const options: { value: NumberFormatOption; label: string }[] = [
		{ value: "follow", label: tn("follow", { example: examples.follow }) },
		{ value: "comma_dot", label: examples.comma_dot },
		{ value: "dot_comma", label: examples.dot_comma },
		{ value: "space_comma", label: examples.space_comma },
	];

	async function save(patch: {
		numberFormat?: GeneralSettings["numberFormat"];
		currencySymbolStyle?: GeneralSettings["currencySymbolStyle"];
	}) {
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
		<FormSection footer={tn("footer")} title={tn("title")}>
			<FormPickerRow<NumberFormatOption>
				label={tn("format")}
				onChange={(next) =>
					save({ numberFormat: next === "follow" ? null : next })
				}
				options={options}
				value={settings.numberFormat ?? "follow"}
			/>
			<FormPickerRow
				label={tn("symbol")}
				onChange={(currencySymbolStyle) => save({ currencySymbolStyle })}
				options={[
					{ value: "standard", label: tn("symbolStandard") },
					{ value: "native", label: tn("symbolNative") },
				]}
				value={settings.currencySymbolStyle}
			/>
		</FormSection>
	);
}
