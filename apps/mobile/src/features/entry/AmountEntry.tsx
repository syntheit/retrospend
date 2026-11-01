import { formatMoneyDraft } from "@retrospend/domain/parse";
import type { ReactNode } from "react";
import { useMoneyLocale } from "@/lib/money";
import { AmountBlock } from "./AmountBlock";
import { AmountCard, type MoneyLine } from "./AmountCard";

/**
 * The amount of a composer that has no entry form: the big figure with the
 * keypad, or at the largest text sizes the card with the system decimal
 * keyboard. `onText` gets what the keypad or the keyboard made of the text.
 */
export function AmountEntry({
	line,
	system,
	padOpen,
	typing,
	error,
	below,
	currency,
	text,
	onText,
	onPress,
	onFocusChange,
}: {
	line: MoneyLine;
	system: boolean;
	padOpen: boolean;
	typing: boolean;
	error: boolean;
	below?: ReactNode;
	currency: string;
	text: string;
	onText: (text: string) => void;
	onPress: () => void;
	onFocusChange: (focused: boolean) => void;
}) {
	const locale = useMoneyLocale();
	if (system) {
		return (
			<AmountCard
				foreign={below}
				lines={[line]}
				ring={error ? "error" : "idle"}
				system={{
					autoFocus: padOpen,
					onChangeText: (raw) =>
						onText(formatMoneyDraft(raw, locale, currency, text)),
					onFocusChange,
				}}
			/>
		);
	}
	return (
		<AmountBlock
			below={below}
			error={error}
			folded={!padOpen || typing}
			line={line}
			onPress={onPress}
		/>
	);
}
