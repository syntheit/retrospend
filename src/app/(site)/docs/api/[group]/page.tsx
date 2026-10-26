import openapi from "@retrospend/api-contract/openapi.json";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GroupView } from "~/features/api-docs/group-view";
import { groupsOf, type OpenApiDocument } from "~/features/api-docs/openapi";

const groups = groupsOf(openapi as unknown as OpenApiDocument);

export function generateStaticParams() {
	return groups.map((g) => ({ group: g.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({
	params,
}: {
	params: Promise<{ group: string }>;
}): Promise<Metadata> {
	const { group } = await params;
	return { title: groups.find((g) => g.slug === group)?.tag };
}

export default async function ApiGroupPage({
	params,
}: {
	params: Promise<{ group: string }>;
}) {
	const { group } = await params;
	const found = groups.find((g) => g.slug === group);
	if (!found) notFound();
	return <GroupView group={found} />;
}
