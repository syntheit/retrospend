import {
	type CreateTemplateInput,
	createTemplate,
	TEMPLATE_CREATE_MUTATION,
	TEMPLATE_UPDATE_MUTATION,
	type UpdateTemplateInput,
	updateTemplate,
} from "../template-local";

// A person's template create or edit, as the device books it: the engine's
// template mutations over the same body the server's POST and PATCH take, so
// the device row and the server's meet by the body's id. The booking checks
// no stamp (as recurring-book.ts): which version the server holds is decided
// at send, and a view that has moved on only makes this booking a refusal.

/** The wire says direction and amount mode in lower case; the engine's rows in upper. */
const DIRECTION = { out: "OUT", in: "IN" } as const;
const AMOUNT_MODE = { fixed: "FIXED", ask: "ASK" } as const;

/** The body of POST /recurring: the template's fields under its client-made id. */
export interface TemplateCreateBody
	extends Omit<CreateTemplateInput, "direction" | "amountMode"> {
	direction?: keyof typeof DIRECTION;
	amountMode?: keyof typeof AMOUNT_MODE;
}

/**
 * The body of PATCH /recurring/{id} without its stamp: only the fields the
 * edit names, with `paused` as the wire says it.
 */
export interface TemplateUpdateBody
	extends Omit<
		UpdateTemplateInput,
		"isActive" | "expectedVersion" | "amountMode"
	> {
	amountMode?: keyof typeof AMOUNT_MODE;
	paused?: boolean;
}

/** The mutation of a template create or edit, the figures it moves, and its write. */
export function templatePlanOf(
	op:
		| { kind: "templateCreate"; body: TemplateCreateBody }
		| { kind: "templateUpdate"; body: TemplateUpdateBody },
) {
	if (op.kind === "templateCreate") {
		const { direction, amountMode, ...rest } = op.body;
		return {
			id: TEMPLATE_CREATE_MUTATION.id,
			touches: TEMPLATE_CREATE_MUTATION.touches,
			write: createTemplate({
				...rest,
				...(direction ? { direction: DIRECTION[direction] } : {}),
				...(amountMode ? { amountMode: AMOUNT_MODE[amountMode] } : {}),
			}),
		};
	}
	const { paused, amountMode, ...edit } = op.body;
	return {
		id: TEMPLATE_UPDATE_MUTATION.id,
		touches: TEMPLATE_UPDATE_MUTATION.touches,
		write: updateTemplate({
			...edit,
			...(amountMode ? { amountMode: AMOUNT_MODE[amountMode] } : {}),
			...(paused !== undefined ? { isActive: !paused } : {}),
		}),
	};
}
