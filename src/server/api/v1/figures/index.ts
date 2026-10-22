import { MAX_FIGURE_IDS, parseFigureIds } from "@retrospend/api-contract";
import { readFigures } from "~/server/figures/read";
import { FigureRegistryError } from "~/server/figures/registry";
import { problem } from "../errors";
import { signedIn, v1 } from "../middleware";

export const figuresRouter = {
	read: v1.figures.read.handler(async ({ context, input }) => {
		const user = signedIn(context);
		const ids = parseFigureIds(input.ids);
		if (ids.length > MAX_FIGURE_IDS)
			throw problem("bad_request", `At most ${MAX_FIGURE_IDS} figure ids`);

		const { projectId, personId, accountId } = input;
		let readings: Awaited<ReturnType<typeof readFigures>>;
		try {
			readings = await readFigures(user.principal.userId, ids, {
				projectId,
				personId,
				accountId,
			});
		} catch (error) {
			if (error instanceof FigureRegistryError)
				throw problem("not_found", error.message);
			throw error;
		}
		return {
			figures: ids.map((id) => ({
				id,
				lines: readings.get(id)?.map((m) => ({ ...m })) ?? null,
			})),
		};
	}),
};
