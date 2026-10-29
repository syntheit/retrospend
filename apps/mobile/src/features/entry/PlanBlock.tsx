import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";
import type { PlanView } from "./preview";

/** Envelope names by id, read once when a plan has lines to name. */
function useEnvelopeNames(enabled: boolean): Map<string, string> {
	const { api } = useSession();
	const [names, setNames] = useState(() => new Map<string, string>());
	useEffect(() => {
		if (!enabled || !api) return;
		let cancelled = false;
		Promise.resolve()
			.then(() => api.budget.month({}))
			.then(
				(month) => {
					if (cancelled || !month) return;
					setNames(
						new Map(
							month.groups.flatMap((g) =>
								g.envelopes.map((e) => [e.id, e.name] as const),
							),
						),
					);
				},
				() => undefined,
			);
		return () => {
			cancelled = true;
		};
	}, [api, enabled]);
	return names;
}

/**
 * "Then your plan assigns": every line Use my plan writes and what stays
 * Not planned yet, from the same dry run as What this changes, so it equals
 * what Add does.
 */
export function PlanBlock({ plan }: { plan: PlanView }) {
	const t = useTranslations("mobile.composer.plan");
	const { color, space } = useTheme();
	const { format } = useFormatMoney();
	const names = useEnvelopeNames(plan.lines.length > 0);
	const money = (value: { minor: number; currency: string }) =>
		format(value, { cents: true, sign: "exceptZero" }) ?? "";
	const reason =
		plan.reason === "no_envelope_budget"
			? t("noBudget")
			: plan.reason === "other_currency"
				? t("otherCurrency", { currency: plan.rest?.currency ?? "" })
				: plan.applied && plan.lines.length === 0
					? t("none")
					: null;
	const row = {
		flexDirection: "row",
		justifyContent: "space-between",
		gap: space[3],
	} as const;
	return (
		<View
			accessibilityLiveRegion="polite"
			style={{
				gap: space[2],
				paddingTop: space[3],
				borderTopWidth: 1,
				borderTopColor: color.line,
			}}
		>
			<Text accessibilityRole="header" weight="semibold">
				{t("title")}
			</Text>
			{reason ? <Text tone="fg2">{reason}</Text> : null}
			{plan.lines.map((line) => (
				<View accessible key={line.envelopeId} style={row}>
					<Text numberOfLines={1} style={{ flex: 1 }}>
						{names.get(line.envelopeId) ?? t("envelope")}
					</Text>
					<Text style={{ textAlign: "right" }} tabular weight="medium">
						{money(line.amount)}
					</Text>
				</View>
			))}
			{plan.rest ? (
				<View accessible style={row}>
					<Text style={{ flex: 1 }} tone="fg2">
						{t("stays")}
					</Text>
					<Text style={{ textAlign: "right" }} tabular tone="fg2">
						{format(plan.rest, { cents: true }) ?? ""}
					</Text>
				</View>
			) : null}
		</View>
	);
}
