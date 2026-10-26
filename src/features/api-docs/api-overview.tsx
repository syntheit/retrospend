import { SCOPES } from "@retrospend/api-contract/common";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { scopeKey } from "~/features/settings/developer/tokens";
import { API_DOCS_DOWNLOAD_HREF, API_DOCS_HREF } from "./hrefs";
import type { Group } from "./openapi";

function Block({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="mt-8">
			<h2 className="mb-2 text-fg text-section">{title}</h2>
			<div className="flex max-w-prose flex-col gap-3 text-body text-fg-2">
				{children}
			</div>
		</section>
	);
}

function Code({ children }: { children: string }) {
	return (
		<pre className="overflow-x-auto rounded-ctl bg-raised p-3 font-mono text-fg text-small">
			<code>{children}</code>
		</pre>
	);
}

/** The API reference front page: how to call the API, then every route group. */
export async function ApiOverview({ groups }: { groups: Group[] }) {
	const t = await getTranslations("apiDocs");
	const tScope = await getTranslations("device.scopes");
	return (
		<div>
			<h1 className="text-fg text-title">{t("title")}</h1>
			<p className="mt-2 max-w-prose text-body text-fg-2">{t("intro")}</p>
			<p className="mt-2 text-small">
				<a
					className="rounded-ctl text-fg underline underline-offset-4 outline-none focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
					download
					href={API_DOCS_DOWNLOAD_HREF}
				>
					{t("download")}
				</a>
			</p>
			<Block title={t("baseTitle")}>
				<p>{t("baseBody")}</p>
				<Code>{"GET /api/v1/server-info"}</Code>
			</Block>
			<Block title={t("authTitle")}>
				<p>{t("authBody")}</p>
				<Code>{'curl https://your-server/api/v1/me -H "x-api-key: rsk_…"'}</Code>
			</Block>
			<Block title={t("scopesTitle")}>
				<p>{t("scopesBody")}</p>
				<ul className="flex flex-col gap-1 text-small">
					{SCOPES.map((s) => (
						<li className="flex flex-wrap gap-x-3" key={s}>
							<span className="font-mono text-fg">{s}</span>
							<span>{tScope(scopeKey(s))}</span>
						</li>
					))}
				</ul>
			</Block>
			<Block title={t("writesTitle")}>
				<p>{t("writesBody")}</p>
			</Block>
			<Block title={t("errorsTitle")}>
				<p>{t("errorsBody")}</p>
			</Block>
			<Block title={t("listsTitle")}>
				<p>{t("listsBody")}</p>
			</Block>
			<Block title={t("eventsTitle")}>
				<p>{t("eventsBody")}</p>
			</Block>
			<section className="mt-8">
				<h2 className="mb-2 text-fg text-section">{t("routesTitle")}</h2>
				<ul className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
					{groups.map((g) => (
						<li className="border-line border-b" key={g.slug}>
							<Link
								className="flex min-h-row items-center justify-between gap-3 rounded-ctl text-body text-fg outline-none focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
								href={`${API_DOCS_HREF}/${g.slug}`}
							>
								<span>{g.tag}</span>
								<span className="text-fg-3 text-small tabular-nums">
									{t("routeCount", { count: g.operations.length })}
								</span>
							</Link>
						</li>
					))}
				</ul>
			</section>
		</div>
	);
}
