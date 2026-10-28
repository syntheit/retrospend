import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
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
	const { color, space, type } = useTheme();
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
		<View accessibilityLiveRegion="polite" style={{ gap: space[2] }}>
			<Text
				accessibilityRole="header"
				style={{
					color: color.fg,
					fontSize: type.section.size,
					fontWeight: "600",
				}}
			>
				{t("title")}
			</Text>
			{reason ? (
				<Text style={{ color: color.fg2, fontSize: type.body.size }}>
					{reason}
				</Text>
			) : null}
			{plan.lines.map((line) => (
				<View accessible key={line.envelopeId} style={row}>
					<Text
						numberOfLines={1}
						style={{ flex: 1, color: color.fg, fontSize: type.body.size }}
					>
						{names.get(line.envelopeId) ?? t("envelope")}
					</Text>
					<Text
						style={{
							color: color.fg,
							fontSize: type.body.size,
							fontVariant: ["tabular-nums"],
							fontWeight: "500",
							textAlign: "right",
						}}
					>
						{money(line.amount)}
					</Text>
				</View>
			))}
			{plan.rest ? (
				<View accessible style={row}>
					<Text style={{ flex: 1, color: color.fg2, fontSize: type.body.size }}>
						{t("stays")}
					</Text>
					<Text
						style={{
							color: color.fg2,
							fontSize: type.body.size,
							fontVariant: ["tabular-nums"],
							textAlign: "right",
						}}
					>
						{format(plan.rest, { cents: true }) ?? ""}
					</Text>
				</View>
			) : null}
		</View>
	);
}
