"use client";

import { parseScopeList } from "@retrospend/api-contract/common";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Notice } from "~/components/ui/notice";
import { authClient } from "~/lib/auth-client";

type Request = { userCode: string; clientId: string; scopes: string[] };

type Phase =
	| { step: "enter"; error?: "invalid" | "used" | "generic" }
	| { step: "review"; request: Request; error?: "generic" }
	| { step: "done"; outcome: "approved" | "denied" };

const SCOPE_KEYS = {
	read: "read",
	"write:expenses": "writeExpenses",
	"write:money": "writeMoney",
	"write:settings": "writeSettings",
	admin: "admin",
} as const;

const KNOWN_CLIENTS = new Set([
	"retrospend-cli",
	"retrospend-desktop",
	"retrospend-mcp",
]);

export function DeviceApproval({ initialCode }: { initialCode: string }) {
	const t = useTranslations("device");
	const [code, setCode] = useState(initialCode);
	const [phase, setPhase] = useState<Phase>({ step: "enter" });
	const [busy, setBusy] = useState(false);

	async function lookUp(event: FormEvent) {
		event.preventDefault();
		setBusy(true);
		// Looking the code up also claims it for the signed-in person, so only
		// they can approve it afterwards.
		const { data, error } = await authClient.device({
			query: { user_code: code.trim() },
		});
		setBusy(false);
		if (error || !data) return setPhase({ step: "enter", error: "invalid" });
		if (data.status !== "pending")
			return setPhase({ step: "enter", error: "used" });
		setPhase({
			step: "review",
			request: {
				userCode: data.user_code,
				clientId: data.client_id ?? "",
				scopes: parseScopeList(data.scope).scopes,
			},
		});
	}

	async function decide(request: Request, approve: boolean) {
		setBusy(true);
		const body = { userCode: request.userCode };
		const { error } = approve
			? await authClient.device.approve(body)
			: await authClient.device.deny(body);
		setBusy(false);
		if (error) return setPhase({ step: "review", request, error: "generic" });
		setPhase({ step: "done", outcome: approve ? "approved" : "denied" });
	}

	return (
		<main className="bg-bg flex min-h-screen items-center justify-center px-4">
			<div className="w-full max-w-sm space-y-6">
				<div className="space-y-2">
					<h1 className="text-fg text-title font-semibold">{t("title")}</h1>
					{phase.step === "enter" && (
						<p className="text-body text-fg-2">{t("description")}</p>
					)}
				</div>

				{phase.step === "enter" && (
					<form className="space-y-4" onSubmit={lookUp}>
						<div className="space-y-2">
							<Label htmlFor="user-code">{t("codeLabel")}</Label>
							<Input
								autoComplete="one-time-code"
								autoFocus
								className="font-mono"
								id="user-code"
								onChange={(e) => setCode(e.target.value)}
								value={code}
							/>
						</div>
						{phase.error && (
							<Notice tone="danger">{t(`errors.${phase.error}`)}</Notice>
						)}
						<Button
							className="w-full"
							disabled={busy || !code.trim()}
							type="submit"
						>
							{t("continue")}
						</Button>
					</form>
				)}

				{phase.step === "review" && (
					<ReviewRequest
						busy={busy}
						error={phase.error}
						onDecide={(approve) => decide(phase.request, approve)}
						request={phase.request}
					/>
				)}

				{phase.step === "done" && (
					<p className="text-body text-fg">{t(phase.outcome)}</p>
				)}
			</div>
		</main>
	);
}

function ReviewRequest({
	request,
	busy,
	error,
	onDecide,
}: {
	request: Request;
	busy: boolean;
	error?: "generic";
	onDecide: (approve: boolean) => void;
}) {
	const t = useTranslations("device");
	const client = KNOWN_CLIENTS.has(request.clientId)
		? t(`clients.${request.clientId}` as "clients.retrospend-cli")
		: request.clientId;
	const scopes = request.scopes.length > 0 ? request.scopes : ["read"];

	return (
		<div className="space-y-4">
			<h2 className="text-fg text-section font-semibold">
				{t("reviewTitle", { client })}
			</h2>
			<div className="space-y-2">
				<p className="text-body text-fg-2">{t("scopesIntro")}</p>
				<ul className="text-body text-fg list-disc space-y-1 pl-6">
					{scopes.map((scope) => (
						<li key={scope}>
							{t(`scopes.${SCOPE_KEYS[scope as keyof typeof SCOPE_KEYS]}`)}
						</li>
					))}
				</ul>
			</div>
			{error && <Notice tone="danger">{t(`errors.${error}`)}</Notice>}
			<div className="flex gap-2">
				<Button disabled={busy} onClick={() => onDecide(true)}>
					{t("approve")}
				</Button>
				<Button
					disabled={busy}
					onClick={() => onDecide(false)}
					variant="outline"
				>
					{t("deny")}
				</Button>
			</div>
		</div>
	);
}
