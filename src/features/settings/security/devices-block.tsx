"use client";

import { Laptop, Smartphone, Terminal } from "lucide-react";
import { useTranslations } from "next-intl";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import { IconTile, Row, RowSub } from "~/components/rows/row";
import { useToast } from "~/components/ui/toast";
import { api } from "~/trpc/react";
import { TokenBlock, useTokenWords } from "../developer/token-rows";
import { deviceName, type SignedInDevice } from "./session-name";

/**
 * Signed-in devices: every live session of the account (this browser, the
 * phone app, a command line or desktop client), so you can see where you
 * are signed in and sign the others out. This device cannot sign itself
 * out here.
 */
export function DevicesBlock() {
	const t = useTranslations("settingsV2.security.devices");
	const toast = useToast();
	const utils = api.useUtils();
	const devices = api.deviceSession.list.useQuery();
	const signOut = api.deviceSession.disconnect.useMutation();
	const name = useDeviceNameText();

	const end = async (d: SignedInDevice) => {
		try {
			await signOut.mutateAsync({ id: d.id });
			toast.saved(t("signedOut", { name: name(d) }));
		} catch {
			toast.failed(t("failed"));
		}
		await utils.deviceSession.list.invalidate();
	};

	return (
		<TokenBlock
			empty={{ title: t("none"), hint: "" }}
			state={{
				isLoading: devices.isLoading,
				isError: devices.isError,
				count: devices.data?.length ?? 0,
				retry: () => void devices.refetch(),
			}}
			title={t("title")}
		>
			{devices.data?.map((d) => (
				<DeviceRow device={d} key={d.id} onSignOut={() => void end(d)} />
			))}
		</TokenBlock>
	);
}

function useDeviceNameText() {
	const t = useTranslations("settingsV2.security.devices.name");
	return (d: SignedInDevice) => {
		const n = deviceName(d);
		switch (n.key) {
			case "browser":
				return n.system
					? t("browserOn", { browser: n.browser, system: n.system })
					: n.browser;
			case "app":
				return n.system ? t("appOn", { system: n.system }) : t("app");
			case "web":
				return n.system ? t("webOn", { system: n.system }) : t("web");
			default:
				return t(n.key);
		}
	};
}

function DeviceRow({
	device: d,
	onSignOut,
}: {
	device: SignedInDevice;
	onSignOut: () => void;
}) {
	const t = useTranslations("settingsV2.security.devices");
	const w = useTokenWords();
	const title = useDeviceNameText()(d);
	const Icon =
		d.kind === "mobile" ? Smartphone : d.kind === "device" ? Terminal : Laptop;
	const handlers = d.current ? {} : { disconnect: onSignOut };
	const target = { id: d.id, name: title };
	return (
		<ActionArea entity="device" handlers={handlers} target={target}>
		<Row
			actions={
				d.current ? undefined : (
					<ActionMenu entity="device" handlers={handlers} target={target} />
				)
			}
			lead={<IconTile icon={Icon} />}
			sub={
				<RowSub
					parts={[
						t("lastUsed", { date: w.day(d.lastUsedAt) }),
						t("signedIn", { date: w.day(d.createdAt) }),
					]}
				/>
			}
			title={title}
			titleEnd={
				d.current ? (
					<span className="text-fg-3 text-meta font-normal">{t("current")}</span>
				) : undefined
			}
		/>
		</ActionArea>
	);
}
