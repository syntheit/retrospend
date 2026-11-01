import type { ReactNode } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { AccountDot } from "@/features/wealth/AccountDot";
import { useFormatMoney } from "@/lib/money";
import { useTheme } from "@/theme";
import { Glyph } from "@/ui/Glyph";
import { ProjectRow } from "@/ui/ProjectRow";
import { FieldError } from "@/ui/TextField";
import type { EntryPlace } from "./types";

/**
 * Your accounts as rows in a panel: the group dot, the name on one line and
 * what the account holds now, as the server states it. The picked row has the
 * brand border, fill and a check. Income can also pick no account (the money
 * goes to the budget only); a transfer cannot.
 */
export function AccountPanel({
	places,
	value,
	onPick,
	none,
	error,
}: {
	places: EntryPlace[];
	value: string | null;
	onPick: (place: EntryPlace | null) => void;
	/** Offers a first row that picks no account. */
	none?: { name: string; meta: string };
	/** Shown once Add was pressed. */
	error?: string;
}) {
	const { color, radius, size, space } = useTheme();
	const { format } = useFormatMoney();
	const t = useTranslations("mobile.composer");
	const cover = (inner: ReactNode) => (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				width: size.avatar.md,
				height: size.avatar.md,
				borderRadius: radius.ctl,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: color.raised,
			}}
		>
			{inner}
		</View>
	);
	return (
		<View accessibilityLabel={t("accounts")} style={{ gap: space[2] }}>
			{none ? (
				<ProjectRow
					cover={cover(
						<Glyph color={color.fg2} name="Wallet" size={size.icon.phone} />,
					)}
					faces={[]}
					meta={none.meta}
					name={none.name}
					onPress={() => onPick(null)}
					selected={value === null}
				/>
			) : null}
			{places.map((place) => (
				<ProjectRow
					cover={cover(<AccountDot type={place.type} />)}
					faces={[]}
					key={place.id}
					meta={
						(place.balance
							? format(place.balance, { cents: true })
							: undefined) ?? place.currency
					}
					name={place.name}
					onPress={() => onPick(place)}
					selected={value === place.id}
				/>
			))}
			{error ? <FieldError>{error}</FieldError> : null}
		</View>
	);
}
