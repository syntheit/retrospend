import {
	type NumberFormatOption,
	numberFormatExamples,
} from "@retrospend/domain/format";
import { useMemo } from "react";
import { useTranslations } from "use-intl";
import { useFormatLocale } from "@/lib/intl";
import { ListGroup } from "@/ui/List";
import { PickerRow } from "./parts";
import type { GeneralSettings } from "./source";
import { useSaveSettings } from "./useSaveSettings";

/**
 * How amounts read: the number format. It is an account setting the web
 * shares, so a change saves at once, from the server's answer, and the
 * profile is read again because the money formatter takes it from there
 * (useMoneyPrefs). Each number format option is shown as
 * the user's own home-currency amount in it.
 */
export function NumbersGroup({
	settings,
	onSaved,
}: {
	settings: GeneralSettings;
	onSaved: () => void;
}) {
	const tn = useTranslations("mobile.settings.numbers");
	const language = useFormatLocale();
	const save = useSaveSettings(onSaved);
	const home = settings.homeCurrency;
	const examples = useMemo(
		() => (home ? numberFormatExamples(home, language) : null),
		[home, language],
	);
	if (!examples) return null;

	const options: { value: NumberFormatOption; label: string }[] = [
		{ value: "follow", label: tn("follow") },
		{ value: "comma_dot", label: examples.comma_dot },
		{ value: "dot_comma", label: examples.dot_comma },
		{ value: "space_comma", label: examples.space_comma },
	];

	return (
		<ListGroup form>
			<PickerRow<NumberFormatOption>
				label={tn("format")}
				onChange={(next) =>
					save({ numberFormat: next === "follow" ? null : next })
				}
				options={options}
				value={settings.numberFormat ?? "follow"}
			/>
		</ListGroup>
	);
}
