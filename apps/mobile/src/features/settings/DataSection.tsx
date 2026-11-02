import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { ListGroup, ListRow } from "@/ui/List";
import { LoadingIndicator } from "@/ui/LoadingIndicator";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { Block, SettingsPage } from "./parts";
import { type DataKind, useDataExport } from "./security/useDataExport";

const DATA_KINDS: DataKind[] = ["data", "expenses", "wealth"];

/** Data: each export lands in the share sheet. */
export function DataSection() {
	const t = useTranslations("mobile.settings.data");
	const toast = useToast();
	const { space } = useTheme();
	const exporter = useDataExport();

	async function runExport(kind: DataKind) {
		const ok = await exporter.run(kind);
		if (!ok) toast.show({ message: t("failed") });
	}

	return (
		<SettingsPage>
			<Block>
				<ListGroup>
					{DATA_KINDS.map((kind) => (
						<ListRow
							end={
								exporter.busy === kind ? (
									<View
										style={{
											flexDirection: "row",
											alignItems: "center",
											gap: space[2],
										}}
									>
										<LoadingIndicator size={space[6]} />
										<Text tone="fg2">{t("preparing")}</Text>
									</View>
								) : (
									<Text tone="fg2">{t(`formats.${kind}`)}</Text>
								)
							}
							key={kind}
							onPress={exporter.busy ? undefined : () => void runExport(kind)}
							title={t(`kinds.${kind}`)}
						/>
					))}
				</ListGroup>
			</Block>
		</SettingsPage>
	);
}
