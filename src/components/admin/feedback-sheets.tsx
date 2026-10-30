"use client";

import type { FeedbackDiagnostics } from "@retrospend/api-contract";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { Button } from "~/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { Label } from "~/components/ui/label";
import { Sheet } from "~/components/ui/sheet";
import { Textarea } from "~/components/ui/textarea";
import type { RouterOutputs } from "~/trpc/react";
import {
	diagnosticsOf,
	pageName,
	platformOf,
	screenshotUrl,
} from "./feedback-parts";

export type FeedbackItem = RouterOutputs["feedback"]["list"]["items"][number];
export type ErrorReportItem =
	RouterOutputs["feedback"]["errorReports"]["items"][number];
const categoryOf = (c: string) =>
	c === "bug" || c === "idea" ? c : ("other" as const);
export type FeedbackStatus = "unread" | "read" | "archived";

/** Label and value pairs; a pair without a value is left out. */
function Facts({ rows }: { rows: [string, ReactNode][] }) {
	return (
		<dl className="divide-line text-body divide-y">
			{rows
				.filter(([, value]) => value != null && value !== "")
				.map(([label, value]) => (
					<div
						className="flex items-baseline justify-between gap-3 py-2"
						key={label}
					>
						<dt className="text-fg-2 shrink-0">{label}</dt>
						<dd className="text-fg min-w-0 text-right break-words">{value}</dd>
					</div>
				))}
		</dl>
	);
}

function Stack({ children }: { children: string }) {
	return (
		<pre className="bg-raised text-fg-2 text-meta rounded-ctl overflow-x-auto p-3 font-mono whitespace-pre-wrap break-words">
			{children}
		</pre>
	);
}

function Screenshot({ id }: { id: string }) {
	const t = useTranslations("feedbackInbox");
	const [broken, setBroken] = useState(false);
	return (
		<section className="flex flex-col gap-2">
			<h3 className="text-fg text-body font-semibold">{t("screenshot")}</h3>
			{broken ? (
				<p className="text-fg-2 text-small">{t("screenshotMissing")}</p>
			) : (
				<a
					className="rounded-ctl focus-visible:outline-brand w-fit focus-visible:outline-2 focus-visible:outline-offset-2"
					href={screenshotUrl(id)}
					rel="noreferrer"
					target="_blank"
				>
					{/* biome-ignore lint/performance/noImgElement: an authorized route, not a static asset */}
					<img
						alt={t("screenshotAlt")}
						className="border-line rounded-ctl h-auto w-full max-w-xs border"
						loading="lazy"
						onError={() => setBroken(true)}
						src={screenshotUrl(id)}
					/>
				</a>
			)}
		</section>
	);
}

function RecentErrors({ errors }: { errors: NonNullable<FeedbackDiagnostics["recentErrors"]> }) {
	const t = useTranslations("feedbackInbox");
	const format = useFormatter();
	if (errors.length === 0) return null;
	return (
		<section className="flex flex-col gap-2">
			<h3 className="text-fg text-body font-semibold">{t("recentErrors")}</h3>
			<ul className="divide-line flex flex-col divide-y">
				{errors.map((e, i) => (
					<li
						className="flex flex-col gap-1 py-2"
						// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
						key={i}
					>
						<p className="text-fg text-body break-words">{e.message}</p>
						<p className="text-fg-3 text-meta">
							{[
								t(`kind.${e.kind}`),
								e.screen,
								format.dateTime(new Date(e.occurredAt), {
									dateStyle: "medium",
									timeStyle: "short",
								}),
							]
								.filter(Boolean)
								.join(" · ")}
						</p>
						{e.stack ? (
							<Collapsible>
								<CollapsibleTrigger className="text-fg-2 text-small rounded-ctl focus-visible:outline-brand cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2">
									{t("stack")}
								</CollapsibleTrigger>
								<CollapsibleContent className="pt-2">
									<Stack>{e.stack}</Stack>
								</CollapsibleContent>
							</Collapsible>
						) : null}
					</li>
				))}
			</ul>
		</section>
	);
}

/**
 * One piece of feedback: what was written, who and where it came from, the
 * screenshot, the errors the person attached, a private note, and what to do
 * with it (read, archive, delete).
 */
export function FeedbackSheet({
	item,
	onOpenChange,
	onStatus,
	onDelete,
	onSaveNote,
}: {
	item: FeedbackItem;
	onOpenChange: (open: boolean) => void;
	onStatus: (status: FeedbackStatus) => void;
	onDelete: () => void;
	onSaveNote: (note: string) => Promise<void>;
}) {
	const t = useTranslations("feedbackInbox");
	const format = useFormatter();
	const [note, setNote] = useState(item.adminNote ?? "");
	const [saving, setSaving] = useState(false);
	const diagnostics = diagnosticsOf(item.diagnostics);
	const platform = platformOf({ userAgent: item.userAgent, diagnostics });
	const version = item.appVersion
		? diagnostics?.build
			? t("versionBuild", { version: item.appVersion, build: diagnostics.build })
			: item.appVersion
		: null;
	const noteChanged = note.trim() !== (item.adminNote ?? "");

	return (
		<Sheet
			footer={
				<>
					<Button className="mr-auto" kind="ghost" onClick={onDelete}>
						{t("delete")}
					</Button>
					<Button
						kind="secondary"
						onClick={() =>
							onStatus(item.status === "archived" ? "read" : "archived")
						}
					>
						{item.status === "archived" ? t("unarchive") : t("archive")}
					</Button>
					{item.status === "unread" ? (
						<Button kind="primary" onClick={() => onStatus("read")}>
							{t("markRead")}
						</Button>
					) : item.status === "read" ? (
						<Button kind="secondary" onClick={() => onStatus("unread")}>
							{t("markUnread")}
						</Button>
					) : null}
				</>
			}
			onOpenChange={onOpenChange}
			open
			title={t("sheet")}
		>
			<div className="flex flex-col gap-6 pb-4">
				<p className="text-fg text-body break-words whitespace-pre-wrap">
					{item.message}
				</p>
				<Facts
					rows={[
						[t("from"), item.user.name],
						[t("email"), item.user.email],
						[
							t("sent"),
							format.dateTime(item.createdAt, {
								dateStyle: "medium",
								timeStyle: "short",
							}),
						],
						[t("categoryLabel"), t(`category.${categoryOf(item.category)}`)],
						[t("page"), pageName(item.pageUrl)],
						[t("version"), version],
						[
							t("platform"),
							platform === "web"
								? t("web")
								: platform
									? platform.os
									: null,
						],
						[t("device"), diagnostics?.device],
						[t("locale"), diagnostics?.locale],
						[t("serverVersion"), diagnostics?.serverVersion],
						[t("viewport"), item.viewportSize],
						[t("userAgent"), item.userAgent],
					]}
				/>
				{item.screenshotPath ? <Screenshot id={item.id} /> : null}
				{diagnostics?.recentErrors ? (
					<RecentErrors errors={diagnostics.recentErrors} />
				) : null}
				<section className="flex flex-col gap-2">
					<Label htmlFor={`feedback-note-${item.id}`}>{t("note")}</Label>
					<Textarea
						id={`feedback-note-${item.id}`}
						maxLength={2000}
						onChange={(e) => setNote(e.target.value)}
						rows={3}
						value={note}
					/>
					<div className="flex items-center justify-between gap-3">
						<p className="text-fg-3 text-meta">{t("noteHint")}</p>
						<Button
							disabled={!noteChanged}
							kind="secondary"
							loading={saving}
							onClick={async () => {
								setSaving(true);
								try {
									await onSaveNote(note);
								} finally {
									setSaving(false);
								}
							}}
							size="sm"
						>
							{t("saveNote")}
						</Button>
					</div>
				</section>
			</div>
		</Sheet>
	);
}

/** One error report: where and when it happened, on which build, and its stack. */
export function ErrorReportSheet({
	item,
	onOpenChange,
	onDelete,
}: {
	item: ErrorReportItem;
	onOpenChange: (open: boolean) => void;
	onDelete: () => void;
}) {
	const t = useTranslations("feedbackInbox");
	const format = useFormatter();
	const kinds = ["crash", "rejection", "render"] as const;
	const kind = kinds.find((k) => k === item.kind);
	const version = item.appVersion
		? item.build
			? t("versionBuild", { version: item.appVersion, build: item.build })
			: item.appVersion
		: null;
	return (
		<Sheet
			footer={
				<Button kind="ghost" onClick={onDelete}>
					{t("delete")}
				</Button>
			}
			onOpenChange={onOpenChange}
			open
			title={t("reportSheet")}
		>
			<div className="flex flex-col gap-6 pb-4">
				<p className="text-fg text-body break-words whitespace-pre-wrap">
					{item.message}
				</p>
				<Facts
					rows={[
						[t("kindLabel"), kind ? t(`kind.${kind}`) : item.kind],
						[t("from"), item.user.name],
						[
							t("occurred"),
							format.dateTime(item.occurredAt, {
								dateStyle: "medium",
								timeStyle: "short",
							}),
						],
						[
							t("sent"),
							format.dateTime(item.createdAt, {
								dateStyle: "medium",
								timeStyle: "short",
							}),
						],
						[t("screen"), item.screen],
						[t("version"), version],
						[t("platform"), item.os],
						[t("device"), item.device],
					]}
				/>
				{item.stack ? (
					<section className="flex flex-col gap-2">
						<h3 className="text-fg text-body font-semibold">{t("stack")}</h3>
						<Stack>{item.stack}</Stack>
					</section>
				) : null}
			</div>
		</Sheet>
	);
}
