import { useState } from "react";
import { useTranslations } from "use-intl";
import { ListGroup, ListRow } from "@/ui/List";
import { Text } from "@/ui/Text";
import { DeleteAccountSheet } from "./DeleteAccountSheet";
import { SettingsPage } from "./parts";

/**
 * Danger zone: Delete account, the one thing here that cannot be undone. It
 * opens the sheet that says what changes for other people and asks for the
 * password.
 */
export function DangerSection() {
	const t = useTranslations("mobile.settings");
	const [deleting, setDeleting] = useState(false);
	return (
		<>
			<SettingsPage>
				<ListGroup>
					<ListRow
						chevron
						onPress={() => setDeleting(true)}
						sub={t("danger.meta")}
						title={
							<Text numberOfLines={1} tone="danger" weight="medium">
								{t("account.delete")}
							</Text>
						}
					/>
				</ListGroup>
			</SettingsPage>
			<DeleteAccountSheet
				onClose={() => setDeleting(false)}
				visible={deleting}
			/>
		</>
	);
}
