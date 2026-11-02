import { router } from "expo-router";
import type { ReactElement } from "react";
import { useTranslations } from "use-intl";
import { useServerBaseUrl } from "@/auth/server-connection";
import { useSession } from "@/auth/session";
import { absoluteImage } from "@/features/read/faces";
import type { Face } from "@/ui/Avatar";
import { TopBar } from "@/ui/TopBar";
import type { MenuItem, TopBarAction } from "@/ui/types";

/** The signed-in person as a face: the uploaded picture, else the sign-in provider's. */
export function useMyFace(): Face | null {
	const { state } = useSession();
	const baseUrl = useServerBaseUrl();
	const me = state.status === "signedIn" ? state.me : null;
	if (!me) return null;
	return {
		key: `user:${me.id}`,
		name: me.name,
		imageUri: absoluteImage(me.avatarUrl ?? me.image, baseUrl),
	};
}

/**
 * The top bar with the account button. The button opens the account sheet
 * (AccountScreen, route `/account`): a native form sheet with its own stack,
 * so the places it lists open inside it and Back returns to its first page.
 */
export function AccountTopBar({
	title,
	actions,
	overflow,
	overflowLabel,
	footer,
}: {
	title: string;
	/** Icon-only page actions (Add person), before the overflow and the account button. */
	actions?: TopBarAction[];
	/** The page's overflow menu (the three dots), before the account button. */
	overflow?: MenuItem[];
	overflowLabel?: string;
	/** Android's collapsing bar: a row pinned under it (People's tabs). */
	footer?: ReactElement;
}) {
	const t = useTranslations("mobile.account");
	const face = useMyFace();
	return (
		<TopBar
			account={face ?? undefined}
			accountLabel={t("open")}
			actions={actions}
			footer={footer}
			onAccountPress={() => router.push("/account")}
			overflow={overflow}
			overflowLabel={overflowLabel}
			title={title}
		/>
	);
}
