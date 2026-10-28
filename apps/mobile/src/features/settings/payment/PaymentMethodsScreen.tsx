import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { ListRow, StaleNote } from "@/features/read/parts";
import { useCachedRead } from "@/features/read/useCachedRead";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import { Screen } from "@/ui/Screen";
import { MethodSheet } from "./MethodSheet";
import {
	fetchPaymentMethods,
	PAYMENT_CACHE,
	type PaymentMethod,
} from "./source";

/**
 * How you like to be paid: each method with its label, number or handle and
 * who can see it. Tap one to edit, prefer or remove it. New methods are
 * picked from the web's list of providers, so adding is on the web.
 */
export function PaymentMethodsScreen() {
	const t = useTranslations("mobile.settings.payment");
	const loading = useTranslations("mobile.activity")("loading");
	const { api } = useSession();
	const { color, space, type } = useTheme();
	const fetch = useMemo(() => (api ? fetchPaymentMethods(api) : null), [api]);
	const { state, reload } = useCachedRead(PAYMENT_CACHE, fetch);
	const [editing, setEditing] = useState<PaymentMethod | null>(null);
	const [open, setOpen] = useState(false);

	if (state.status !== "ready") {
		return (
			<Screen>
				<EmptyState
					detail={state.status === "error" ? t("errorDetail") : undefined}
					title={state.status === "error" ? t("error") : loading}
				/>
			</Screen>
		);
	}
	const all = state.data;
	return (
		<>
			<Screen flush>
				<StaleNote since={state.staleSince} />
				{all.length === 0 ? (
					<EmptyState detail={t("emptyDetail")} title={t("empty")} />
				) : (
					all.map((method) => (
						<ListRow
							key={method.id}
							onPress={() => {
								setEditing(method);
								setOpen(true);
							}}
						>
							<View style={{ flex: 1, gap: space[1] }}>
								<Text
									numberOfLines={1}
									style={{ color: color.fg, fontSize: type.body.size }}
								>
									{method.label || method.type}
								</Text>
								<Text
									numberOfLines={1}
									style={{ color: color.fg2, fontSize: type.small.size }}
								>
									{[
										method.identifier,
										t(`visibility.${method.visibility}`),
										method.rank === 1 ? t("preferred") : null,
									]
										.filter(Boolean)
										.join(" · ")}
								</Text>
							</View>
						</ListRow>
					))
				)}
				<Text
					style={{
						color: color.fg2,
						fontSize: type.small.size,
						padding: space[4],
					}}
				>
					{t("addOnWeb")}
				</Text>
			</Screen>
			{editing ? (
				<MethodSheet
					all={all}
					method={editing}
					onClose={() => setOpen(false)}
					onDone={() => void reload()}
					visible={open}
				/>
			) : null}
		</>
	);
}
