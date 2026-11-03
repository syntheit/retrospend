import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { showAlert } from "@/ui/alert";
import { ListGroup, ListRow } from "@/ui/List";
import { Sheet, useSheetBodySize } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { detailOf } from "./useAdminRead";

export type Fact = { label: string; value: string | null | undefined };

/**
 * A read-only record: its facts as rows, and, when it can go, one quiet
 * Delete at the end that asks first. `onDelete` runs the delete and throws
 * when the server says no; the sheet then says why and stays.
 */
export function FactsSheet({
	title,
	facts,
	body,
	remove,
	onClose,
}: {
	title: string | null;
	facts: Fact[];
	/** Long text under the facts (a stack trace). */
	body?: string | null;
	remove?: {
		label: string;
		confirm: string;
		done: string;
		run: () => Promise<void>;
	};
	onClose: () => void;
}) {
	const tc = useTranslations("mobile.common");
	const t = useTranslations("mobile.admin");
	const toast = useToast();
	const { space } = useTheme();
	const size = useSheetBodySize();
	const [busy, setBusy] = useState(false);

	if (title === null) {
		return (
			<Sheet detents={["large"]} onClose={onClose} visible={false}>
				{null}
			</Sheet>
		);
	}

	function askDelete() {
		if (!remove) return;
		showAlert(remove.confirm, undefined, [
			{ text: tc("cancel"), style: "cancel" },
			{
				text: remove.label,
				style: "destructive",
				onPress: () => {
					void (async () => {
						if (busy) return;
						setBusy(true);
						try {
							await remove.run();
							onClose();
							toast.show({ message: remove.done });
						} catch (error) {
							toast.show({ message: detailOf(error) ?? t("actionError") });
						} finally {
							setBusy(false);
						}
					})();
				},
			},
		]);
	}

	return (
		<Sheet detents={["large"]} onClose={onClose} title={title} visible>
			<ScrollView
				contentContainerStyle={{ gap: space[4], paddingBottom: space[4] }}
				style={{ height: size.height }}
			>
				<ListGroup>
					{facts
						.filter((fact) => fact.value)
						.map((fact) => (
							<ListRow
								end={
									<Text
										numberOfLines={2}
										selectable
										style={{ flexShrink: 1 }}
										tone="fg2"
									>
										{fact.value}
									</Text>
								}
								key={fact.label}
								title={fact.label}
							/>
						))}
				</ListGroup>
				{body ? (
					<Text selectable tone="fg2" variant="small">
						{body}
					</Text>
				) : null}
				{remove ? (
					<ListGroup>
						<ListRow
							onPress={busy ? undefined : askDelete}
							title={
								<Text numberOfLines={1} tone="danger" weight="medium">
									{remove.label}
								</Text>
							}
						/>
					</ListGroup>
				) : null}
				<View style={{ height: space[2] }} />
			</ScrollView>
		</Sheet>
	);
}
