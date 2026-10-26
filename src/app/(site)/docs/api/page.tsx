import openapi from "@retrospend/api-contract/openapi.json";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ApiOverview } from "~/features/api-docs/api-overview";
import { groupsOf, type OpenApiDocument } from "~/features/api-docs/openapi";

export async function generateMetadata(): Promise<Metadata> {
	const t = await getTranslations("apiDocs");
	return { title: t("title"), description: t("intro") };
}

export default function ApiDocsPage() {
	return (
		<ApiOverview groups={groupsOf(openapi as unknown as OpenApiDocument)} />
	);
}
