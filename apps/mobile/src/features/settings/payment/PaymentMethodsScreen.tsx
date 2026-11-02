import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { EmptyState } from "@/ui/EmptyState";
import type { GlyphName } from "@/ui/Glyph";
import { IconTile } from "@/ui/IconTile";
import { ListGroup, ListRow, StaleNote } from "@/ui/List";
import { RowMenu } from "@/ui/RowMenu";
import { Screen } from "@/ui/Screen";
import { SkeletonRows } from "@/ui/Skeleton";
import { Text } from "@/ui/Text";
import { GroupNote, SettingsPage } from "../parts";
import { usePaymentMethods } from "../useSettings";
import { methodMenu, useMethodWrites } from "./methodActions";
import { MethodSheet } from "./MethodSheet";
import type { PaymentMethod } from "./source";

/** The tile for a kind of method: a bank, crypto, cash, or a card for the rest. */
export function methodGlyph(type: string): GlyphName {
	const kind = type.toLowerCase();
	if (/bank|transfer|cbu|cvu|wire/.test(kind)) return "Landmark";
	if (/crypto|bitcoin|usdt|usdc|eth/.test(kind)) return "Coins";
	if (/cash/.test(kind)) return "Banknote";
	return "CreditCard";
}

/**
 * How you like to be paid: each method with its tile, its label (Primary on
 * the one you prefer), and its number or handle with who can see it. Tap one
 * to edit, make primary or remove it. New methods are picked from the web's
 * list of providers, so adding is on the web.
 */
export function PaymentMethodsScreen() {
	const t = useTranslations("mobile.settings.payment");
	const tc = useTranslations("mobile.common");
	const { space } = useTheme();
	const { state, reload } = usePaymentMethods();
	const [editing, setEditing] = useState<PaymentMethod | null>(null);
	const [open, setOpen] = useState(false);
	const writes = useMethodWrites(
		state.status === "ready" ? state.data : [],
		() => void reload(),
	);
	function edit(method: PaymentMethod) {
		setEditing(method);
		setOpen(true);
	}

	if (state.status !== "ready") {
		return (
			<Screen>
				{state.status === "error" ? (
					<EmptyState
						actionLabel={tc("retry")}
						detail={t("errorDetail")}
						onAction={() => void reload()}
						title={t("error")}
					/>
				) : (
					<SkeletonRows />
				)}
			</Screen>
		);
	}
	const all = state.data;
	return (
		<>
			<SettingsPage>
				<StaleNote since={state.staleSince} />
				{all.length === 0 ? (
					<EmptyState detail={t("emptyDetail")} title={t("empty")} />
				) : (
					<ListGroup>
						{all.map((method) => (
							<RowMenu
								items={methodMenu(
									method,
									{
										edit: tc("edit"),
										prefer: t("prefer"),
										remove: t("remove"),
									},
									{
										edit: () => edit(method),
										prefer: () => void writes.prefer(method),
										remove: () => writes.remove(method),
									},
								)}
								key={method.id}
								onPress={() => edit(method)}
							>
							<ListRow
								lead={<IconTile name={methodGlyph(method.type)} />}
								sub={[method.identifier, t(`visibility.${method.visibility}`)]
									.filter(Boolean)
									.join(" · ")}
								title={
									<View
										style={{
											flexDirection: "row",
											alignItems: "center",
											gap: space[2],
										}}
									>
										<Text
											numberOfLines={1}
											style={{ flexShrink: 1 }}
											weight="medium"
										>
											{method.label || method.type}
										</Text>
										{method.rank === 1 ? (
											<Text tone="fg2" variant="meta">
												{t("preferred")}
											</Text>
										) : null}
									</View>
								}
							/>
							</RowMenu>
						))}
					</ListGroup>
				)}
				<GroupNote>{t("addOnWeb")}</GroupNote>
			</SettingsPage>
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
