"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "~/components/ui/button";
import { deviceController } from "~/lib/device-engine/instance";
import { DeviceEngineLifecycle } from "~/lib/device-engine/react";
import { ParityView } from "./view";

function Live() {
	const t = useTranslations("deviceEngine");
	const controller = deviceController();
	const [, refresh] = useState(0);
	const [busy, setBusy] = useState(false);
	useEffect(
		() => controller.subscribe(() => refresh((n) => n + 1)),
		[controller],
	);
	const check = async () => {
		setBusy(true);
		try {
			await controller.checkNow();
		} finally {
			setBusy(false);
			refresh((n) => n + 1);
		}
	};
	const pulled = controller.lastPullAt;
	return (
		<>
			{/* This page is outside the dashboard layout, which normally tells the controller who is signed in. */}
			<DeviceEngineLifecycle />
			<header className="mb-6 flex flex-wrap items-center gap-4">
				<h1 className="text-title min-w-0 flex-1">{t("title")}</h1>
				<Button kind="primary" loading={busy} onClick={check}>
					{t("check")}
				</Button>
			</header>
			<ParityView
				lastPullAt={pulled === null ? null : new Date(pulled).toISOString()}
				report={controller.lastParity}
			/>
		</>
	);
}

/** The dev readout. Without the dev flag the build holds none of the engine, and this says so. */
export function DeviceEngineReadout() {
	const t = useTranslations("deviceEngine");
	return (
		<div className="bg-bg text-fg h-dvh overflow-y-auto">
			<main className="px-gutter mx-auto max-w-160 py-8">
				{process.env.NEXT_PUBLIC_DEV_DEVICE_ENGINE === "1" ? (
					<Live />
				) : (
					<p className="text-fg-2 text-body">{t("off")}</p>
				)}
			</main>
		</div>
	);
}
