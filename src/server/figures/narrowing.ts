// The class lives in @retrospend/domain so the device registry throws and
// catches the same one; a second definition would break `instanceof`.
export { FigureNarrowingError } from "@retrospend/domain/figures/narrowing";
