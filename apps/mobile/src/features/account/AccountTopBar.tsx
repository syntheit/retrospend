import { Button } from "@expo/ui";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { useTheme } from "@/theme";
import { NativeHost } from "@/ui/NativeHost";
import { Sheet } from "@/ui/Sheet";
import { TopBar } from "@/ui/TopBar";

function initialsOf(name: string): string {
	const letters = name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((part) => Array.from(part)[0] ?? "");
	return letters.join("").toUpperCase();
}

/**
 * The top bar with the account button; the button opens the account sheet
 * (name, email, Sign out). Settings, Currencies and the rest join it with the
 * settings screens.
 */
export function AccountTopBar({ title }: { title: string }) {
	const t = useTranslations("mobile.account");
	const { state, signOut } = useSession();
	const { color, space, type } = useTheme();
	const [open, setOpen] = useState(false);
	const me = state.status === "signedIn" ? state.me : null;

	return (
		<>
			<TopBar
				accountInitials={me ? initialsOf(me.name) : undefined}
				accountLabel={t("open")}
				onAccountPress={() => setOpen(true)}
				title={title}
			/>
			<Sheet
				detents={["medium"]}
				onClose={() => setOpen(false)}
				title={me?.name}
				visible={open}
			>
				<View style={{ gap: space[1] }}>
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{me?.email}
					</Text>
				</View>
				<NativeHost>
					<Button
						label={t("signOut")}
						onPress={() => {
							setOpen(false);
							signOut();
						}}
						variant="outlined"
					/>
				</NativeHost>
			</Sheet>
		</>
	);
}
