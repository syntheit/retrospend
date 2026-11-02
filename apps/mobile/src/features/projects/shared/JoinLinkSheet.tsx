import { router } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";
import { SheetBody } from "@/features/write/parts";
import { WriteFrame } from "@/features/write/WriteFrame";
import { Sheet } from "@/ui/Sheet";
import { FieldError, TextField } from "@/ui/TextField";
import { parseProjectLink } from "./sharedAccess";

/**
 * Join with a link: paste the address someone sent (an invite, a viewer link
 * or a public page) and it opens the same page the link would, with the join
 * step when it carries an invite. Nothing moves money, so there is no preview.
 */
export function JoinLinkSheet({
	visible,
	onClose,
}: {
	visible: boolean;
	onClose: () => void;
}) {
	const t = useTranslations("mobile.projects.shared");
	const [text, setText] = useState("");
	const [tried, setTried] = useState(false);

	useEffect(() => {
		if (!visible) return;
		setText("");
		setTried(false);
	}, [visible]);

	const link = parseProjectLink(text);

	function open() {
		setTried(true);
		if (!link) return;
		onClose();
		router.push({
			pathname: "/shared/[id]",
			params: {
				id: link.id,
				...(link.invite ? { invite: link.invite } : {}),
				...(link.resume ? { guestResume: link.resume } : {}),
				...(link.server ? { server: link.server } : {}),
			},
		});
	}

	return (
		<Sheet
			detents={["medium"]}
			onClose={onClose}
			title={t("linkTitle")}
			visible={visible}
		>
			<SheetBody>
				<WriteFrame
					busy={false}
					changes={null}
					failed={false}
					onSubmit={open}
					ready={text.trim().length > 0}
					submitLabel={t("linkOpen")}
				>
					<TextField
						autoComplete="off"
						invalid={tried && !link}
						keyboardType="url"
						label={t("linkLabel")}
						onChangeText={(value) => {
							setText(value);
							setTried(false);
						}}
						onSubmitEditing={open}
						placeholder="https://"
						returnKeyType="go"
						value={text}
					/>
					{tried && !link ? <FieldError>{t("linkInvalid")}</FieldError> : null}
				</WriteFrame>
			</SheetBody>
		</Sheet>
	);
}
