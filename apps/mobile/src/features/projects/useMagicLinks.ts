import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { activeLink, type LinkRole, type MagicLink } from "./share";

export type LinksStatus = "loading" | "ready" | "error";

/**
 * The invite links of a project, read when the sheet opens, and the three
 * things the sheet does with them: make one for a role, replace it with a new
 * one (the old stops working) and turn it off. A link is a secret the server
 * does not keep for replay, so every request here carries its own key and the
 * list is read again after a failure.
 */
export function useMagicLinks(projectId: string, active: boolean) {
	const { api } = useSession();
	const [links, setLinks] = useState<MagicLink[]>([]);
	const [status, setStatus] = useState<LinksStatus>("loading");
	const [busy, setBusy] = useState<LinkRole | null>(null);
	const [failed, setFailed] = useState(false);

	const read = useCallback(async () => {
		if (!api) return;
		try {
			const out = await api.projects.magicLinks({ id: projectId });
			setLinks(out.items);
			setStatus("ready");
		} catch {
			setStatus("error");
		}
	}, [api, projectId]);

	useEffect(() => {
		if (!active) return;
		setStatus("loading");
		setFailed(false);
		void read();
	}, [active, read]);

	const run = useCallback(
		async (role: LinkRole, work: () => Promise<unknown>): Promise<boolean> => {
			setBusy(role);
			setFailed(false);
			try {
				await work();
				await read();
				return true;
			} catch {
				setFailed(true);
				await read();
				return false;
			} finally {
				setBusy(null);
			}
		},
		[read],
	);

	const options = () => ({ context: { idempotencyKey: newClientId() } });

	return {
		links,
		status,
		busy,
		failed,
		retry: read,
		create: (role: LinkRole) =>
			run(role, async () => {
				if (!api) throw new Error("Signed out");
				await api.projects.createMagicLink(
					{ id: projectId, roleGranted: role },
					options(),
				);
			}),
		replace: (role: LinkRole) =>
			run(role, async () => {
				if (!api) throw new Error("Signed out");
				await api.projects.resetMagicLink({ id: projectId, role }, options());
			}),
		turnOff: (role: LinkRole) =>
			run(role, async () => {
				const link = activeLink(links, role);
				if (!api || !link) throw new Error("No link");
				await api.projects.revokeMagicLink(
					{ id: projectId, linkId: link.id },
					options(),
				);
			}),
	};
}
