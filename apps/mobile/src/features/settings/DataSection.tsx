import { useTranslations } from "use-intl";
import { useServerConnection } from "@/auth/server-connection";
import { ListGroup, ListRow } from "@/ui/List";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { Block, GroupNote, NavEnd, SettingsPage } from "./parts";
import { type DataKind, useDataExport } from "./security/useDataExport";
import { openWebPage, WEB_PAGES } from "./webPages";

const DATA_KINDS: DataKind[] = ["data", "expenses", "wealth"];

/**
 * Data: each export lands in the share sheet, then the pages that stay on
 * the web (import, insights, API tokens), which open in the browser here.
 */
export function DataSection() {
	const t = useTranslations("mobile.settings.data");
	const tw = useTranslations("mobile.settings.web");
	const { connection } = useServerConnection();
	const toast = useToast();
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
								<Text tone="fg2">
									{exporter.busy === kind
										? t("preparing")
										: t(`formats.${kind}`)}
								</Text>
							}
							key={kind}
							onPress={exporter.busy ? undefined : () => void runExport(kind)}
							title={t(`kinds.${kind}`)}
						/>
					))}
				</ListGroup>
				<GroupNote>{t("footer")}</GroupNote>
			</Block>
			{connection.status === "connected" ? (
				<Block title={tw("title")}>
					<ListGroup>
						{WEB_PAGES.map((page) => (
							<ListRow
								end={<NavEnd />}
								key={page.id}
								onPress={() => void openWebPage(connection.baseUrl, page.path)}
								title={tw(page.id)}
							/>
						))}
					</ListGroup>
					<GroupNote>{tw("footer")}</GroupNote>
				</Block>
			) : null}
		</SettingsPage>
	);
}
