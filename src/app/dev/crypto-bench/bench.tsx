"use client";

import {
	type BenchReport,
	benchJson,
	benchRows,
	runCryptoBench,
} from "@retrospend/crypto";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "~/components/ui/button";

// The records run on the main thread here, so the row says so. The
// WebAssembly build loads on the first run, not with the page.
const NOTE = " (main thread)";

async function run(onStep: (label: string) => void): Promise<BenchReport> {
	const { createWebPrimitives } = await import("@retrospend/crypto/web");
	return runCryptoBench(await createWebPrimitives(), {
		now: () => performance.now(),
		// A frame, so the step label paints before the blocking work starts.
		pause: () =>
			new Promise((resolve) =>
				requestAnimationFrame(() => setTimeout(resolve, 0)),
			),
		onStep,
	});
}

export function CryptoBench() {
	const t = useTranslations("cryptoBench");
	const [step, setStep] = useState<string | null>(null);
	const [report, setReport] = useState<BenchReport | null>(null);
	const [failed, setFailed] = useState(false);

	const start = async () => {
		setReport(null);
		setFailed(false);
		try {
			setReport(await run(setStep));
		} catch {
			setFailed(true);
		} finally {
			setStep(null);
		}
	};
	const copy = () => {
		if (!report) return;
		void navigator.clipboard.writeText(
			benchJson({ device: navigator.userAgent, os: "web" }, report),
		);
	};

	return (
		<div className="bg-bg text-fg h-dvh overflow-y-auto">
			<main className="px-gutter mx-auto max-w-160 py-8">
				<header className="mb-6 flex flex-wrap items-center gap-4">
					<h1 className="text-title min-w-0 flex-1">{t("title")}</h1>
					<Button kind="primary" loading={step !== null} onClick={start}>
						{t("run")}
					</Button>
					<Button disabled={!report} kind="secondary" onClick={copy}>
						{t("copy")}
					</Button>
				</header>
				{step && <p className="text-fg-3 text-small mb-4">{step}</p>}
				{failed && <p className="text-danger text-small mb-4">{t("failed")}</p>}
				{report && (
					<div>
						{benchRows(report, NOTE).map((row) => (
							<div
								className="border-line text-body flex min-h-8 items-center justify-between gap-6 border-t"
								key={row.label}
							>
								<span className="text-fg-2">{row.label}</span>
								<span className="tabular-nums">{row.value}</span>
							</div>
						))}
					</div>
				)}
			</main>
		</div>
	);
}
