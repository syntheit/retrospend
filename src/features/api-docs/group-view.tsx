import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { API_DOCS_HREF } from "./hrefs";
import type { Group } from "./openapi";
import { OperationBlock } from "./operation-block";

/** Every route of one group, each a disclosure that opens to its fields. */
export async function GroupView({ group }: { group: Group }) {
	const t = await getTranslations("apiDocs");
	return (
		<div>
			<Link
				className="inline-flex min-h-ctl items-center gap-2 rounded-ctl text-fg-2 text-small outline-none focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2"
				href={API_DOCS_HREF}
			>
				<ArrowLeft aria-hidden="true" className="size-4" />
				{t("back")}
			</Link>
			<h1 className="mt-2 text-fg text-title">{group.tag}</h1>
			<p className="mt-1 mb-4 text-fg-3 text-small">
				{t("routeCount", { count: group.operations.length })}
			</p>
			<div>
				{group.operations.map((op) => (
					<OperationBlock key={op.id} op={op} />
				))}
			</div>
		</div>
	);
}
