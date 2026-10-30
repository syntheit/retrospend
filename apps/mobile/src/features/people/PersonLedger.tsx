import { useMemo, useState } from "react";
import { ScrollView, View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Chip } from "@/ui/Chip";
import { ListGroup, SectionHeader } from "@/ui/List";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import {
	filterLedger,
	groupByMonth,
	LEDGER_CHIPS,
	type LedgerChip,
	mergeLedger,
} from "./ledger";
import { PaymentRow, SharedRow } from "./PersonSections";
import type { PersonPage } from "./source";

/**
 * "Between you": the shared expenses and the payments as one list, grouped by
 * month, under a search field and the chips that narrow it (Outstanding, To
 * review, Payments, Paid by you, Paid by them).
 */
export function PersonLedger({
	rows,
	payments,
	complete,
	firstName,
}: {
	rows: PersonPage["rows"];
	payments: PersonPage["payments"];
	/** Every expense is loaded, so every payment belongs in the list. */
	complete: boolean;
	firstName: string;
}) {
	const t = useTranslations("mobile.person");
	const format = useFormatter();
	const { space } = useTheme();
	const [query, setQuery] = useState("");
	const [chips, setChips] = useState<ReadonlySet<LedgerChip>>(new Set());
	const all = useMemo(
		() => mergeLedger(rows, payments, complete),
		[rows, payments, complete],
	);
	const months = useMemo(
		() => groupByMonth(filterLedger(all, chips, query)),
		[all, chips, query],
	);
	const label = (chip: LedgerChip) => {
		switch (chip) {
			case "outstanding":
				return t("ledgerOutstanding");
			case "review":
				return t("state.review");
			case "payments":
				return t("payments");
			case "paidByMe":
				return t("ledgerPaidByMe");
			case "paidByThem":
				return t("ledgerPaidByThem", { name: firstName });
		}
	};
	function toggle(chip: LedgerChip) {
		const next = new Set(chips);
		if (next.has(chip)) next.delete(chip);
		else next.add(chip);
		setChips(next);
	}
	return (
		<View>
			<SectionHeader title={t("between")} />
			{all.length === 0 ? (
				<Text style={{ paddingHorizontal: space[4] }} tone="fg2" variant="body">
					{t("betweenEmpty")}
				</Text>
			) : (
				<View style={{ gap: space[3] }}>
					<View style={{ paddingHorizontal: space[4] }}>
						<TextField
							hideLabel
							label={t("ledgerSearch")}
							onChangeText={setQuery}
							placeholder={t("ledgerSearch")}
							value={query}
						/>
					</View>
					<ScrollView
						contentContainerStyle={{
							alignItems: "center",
							gap: space[2],
							paddingHorizontal: space[4],
						}}
						horizontal
						keyboardShouldPersistTaps="handled"
						showsHorizontalScrollIndicator={false}
					>
						{LEDGER_CHIPS.map((chip) => (
							<Chip
								key={chip}
								label={label(chip)}
								onPress={() => toggle(chip)}
								selected={chips.has(chip)}
							/>
						))}
					</ScrollView>
					{months.length === 0 ? (
						<Text
							style={{ paddingHorizontal: space[4] }}
							tone="fg2"
							variant="body"
						>
							{t("ledgerNoMatch")}
						</Text>
					) : null}
				</View>
			)}
			{months.map((group) => (
				<View key={group.month}>
					<SectionHeader
						title={format.dateTime(new Date(`${group.month}-15T12:00:00`), {
							month: "long",
							year: "numeric",
						})}
					/>
					<ListGroup>
						{group.items.map((item) =>
							item.kind === "payment" ? (
								<PaymentRow key={`pay:${item.id}`} payment={item.payment} />
							) : (
								<SharedRow key={item.id} row={item.row} />
							),
						)}
					</ListGroup>
				</View>
			))}
		</View>
	);
}
