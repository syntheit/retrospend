import { getTranslations } from "next-intl/server";
import { FieldTable } from "./field-table";
import type { Operation } from "./openapi";

/**
 * One route: method, path and summary on one line (a native disclosure, so
 * it works without scripts), and inside it the scope it needs, the event it
 * emits, its parameters and the fields of its request and success response.
 */
export async function OperationBlock({ op }: { op: Operation }) {
	const t = await getTranslations("apiDocs");
	return (
		<details
			className="group border-line border-b py-3 first:border-t"
			id={op.id}
		>
			<summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 rounded-ctl outline-none focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
				<span className="w-16 shrink-0 rounded-chip bg-raised px-2 text-center font-mono text-fg-2 text-meta">
					{op.method}
				</span>
				<span className="min-w-0 break-all font-mono text-body text-fg">
					{op.path}
				</span>
				<span className="min-w-0 flex-1 text-fg-3 text-small">{op.summary}</span>
			</summary>
			<div className="mt-3">
				{op.description ? (
					<p className="max-w-prose text-body text-fg-2">{op.description}</p>
				) : null}
				<dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-small">
					{op.scope ? (
						<div className="flex gap-2">
							<dt className="text-fg-3">{t("scope")}</dt>
							<dd className="font-mono text-fg">{op.scope}</dd>
						</div>
					) : null}
					{op.event ? (
						<div className="flex gap-2">
							<dt className="text-fg-3">{t("event")}</dt>
							<dd className="font-mono text-fg">{op.event}</dd>
						</div>
					) : null}
					{op.responseStatus ? (
						<div className="flex gap-2">
							<dt className="text-fg-3">{t("success")}</dt>
							<dd className="font-mono text-fg">{op.responseStatus}</dd>
						</div>
					) : null}
				</dl>
				{op.params.length > 0 ? (
					<FieldTable rows={op.params} title={t("parameters")} />
				) : null}
				{op.request && op.request.length > 0 ? (
					<FieldTable rows={op.request} title={t("requestBody")} />
				) : null}
				{op.response && op.response.length > 0 ? (
					<FieldTable rows={op.response} title={t("responseBody")} />
				) : null}
				{op.hidden > 0 ? (
					<p className="mt-2 text-fg-3 text-small">
						{t("hidden", { count: op.hidden })}
					</p>
				) : null}
			</div>
		</details>
	);
}
