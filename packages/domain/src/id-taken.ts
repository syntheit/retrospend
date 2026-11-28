/**
 * What a write that names an id already in use says, on the server (409
 * id_taken) and on the device (a booking over a row that holds the id): one
 * sentence, so a person reads the same words wherever the refusal came from.
 */
export const ID_TAKEN_MESSAGE = "That id is already used";

/**
 * A write that names an id its own account already holds. Thrown where the
 * check is made before the database's unique key could answer (a retry of a
 * create must read as taken, not as the name being used); a taken id the
 * database finds first leaves as a unique violation and is answered the same.
 */
export class IdTakenError extends Error {
	override readonly name = "IdTakenError";
	constructor() {
		super(ID_TAKEN_MESSAGE);
	}
}
