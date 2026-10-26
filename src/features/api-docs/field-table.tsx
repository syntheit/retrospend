import { getTranslations } from "next-intl/server";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "~/components/ui/table";
import type { FieldRow, ParamRow } from "./openapi";

/** Fields of a body or the parameters of a route: name, type, required, what it is. */
export async function FieldTable({
	title,
	rows,
}: {
	title: string;
	rows: readonly (FieldRow | ParamRow)[];
}) {
	const t = await getTranslations("apiDocs");
	return (
		<section className="mt-4">
			<h4 className="mb-2 font-semibold text-fg-2 text-small">{title}</h4>
			<Table look="panel">
				<TableHeader>
					<TableRow>
						<TableHead>{t("field")}</TableHead>
						<TableHead>{t("type")}</TableHead>
						<TableHead>{t("requiredColumn")}</TableHead>
						<TableHead>{t("description")}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((r) => (
						<TableRow key={`${"where" in r ? r.where : "body"}:${r.path}`}>
							<TableCell className="whitespace-normal break-words align-top font-mono text-small">
								{r.path}
								{"where" in r ? (
									<span className="ml-2 font-sans text-fg-3 text-meta">
										{t(`where.${r.where}`)}
									</span>
								) : null}
							</TableCell>
							<TableCell className="whitespace-normal break-words align-top font-mono text-fg-2 text-small">
								{r.type}
							</TableCell>
							<TableCell className="align-top text-small">
								{r.required ? t("required") : t("optional")}
							</TableCell>
							<TableCell className="min-w-48 whitespace-normal break-words align-top text-fg-2 text-small">
								{r.description}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</section>
	);
}
