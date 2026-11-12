/**
 * The relations between Prisma models, for the field-open walk (E2EE D11
 * PR 3.2, docs/roadmap/e2ee-d11-pr3.md section 3). Prisma 7 has no DMMF at
 * runtime; the generated client's runtime data model (read through
 * `runtimeDataModel()` in db-core.ts) names each model's relation fields and
 * their target model, and nothing more. model-graph.test.ts compares the graph
 * with prisma/schema.prisma, so a Prisma upgrade that moves it fails there.
 */
import { fieldsOfModel, jsonCellsOfModel } from "./fields";

/** The part of Prisma's runtime data model the graph reads. */
export interface RuntimeModels {
	readonly models: Readonly<
		Record<
			string,
			{
				readonly fields: ReadonlyArray<{
					readonly name: string;
					readonly kind: string;
					readonly type: string;
				}>;
			}
		>
	>;
}

export interface ModelGraph {
	/** Relation field name to target model, for one model. */
	relations(model: string): ReadonlyMap<string, string>;
	/** Whether a result of this model can hold a mapped cell, itself or through relations. */
	reaches(model: string): boolean;
}

const NONE: ReadonlyMap<string, string> = new Map();

export function buildModelGraph(data: RuntimeModels): ModelGraph {
	const relations = new Map<string, ReadonlyMap<string, string>>();
	for (const [model, { fields }] of Object.entries(data.models))
		relations.set(
			model,
			new Map(
				fields.filter((f) => f.kind === "object").map((f) => [f.name, f.type]),
			),
		);
	if (relations.size === 0)
		throw new Error("The Prisma runtime data model has no models");

	// A model reaches a mapped cell when it holds one or links to a model that
	// does; grow the set until no model joins.
	const reaching = new Set(
		[...relations.keys()].filter(
			(m) =>
				fieldsOfModel(m) !== undefined || jsonCellsOfModel(m) !== undefined,
		),
	);
	let grew = true;
	while (grew) {
		grew = false;
		for (const [model, links] of relations) {
			if (reaching.has(model)) continue;
			if ([...links.values()].some((target) => reaching.has(target))) {
				reaching.add(model);
				grew = true;
			}
		}
	}

	return {
		relations: (model) => relations.get(model) ?? NONE,
		reaches: (model) => reaching.has(model),
	};
}
