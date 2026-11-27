import type { RetrospendClient } from "@retrospend/api-client";
import { newClientId } from "@/data/ids";
import type { NamedCreateBody, NamedUpdateBody } from "./accountBody";
import {
	createAccountOnDevice,
	type SeenAccount,
	type WealthDevice,
	writeAccountOnDevice,
} from "./deviceWealth";
import {
	PREVIEW_LEG_ID,
	PREVIEW_SWITCH_ID,
	previewWealth,
} from "./wealthPreview";

// The dry run and the write of the account sheets (Add, Edit and Update
// balance), each in its two ways: online as ever, or booked on the device and
// queued under the dev flag (`device` set). The sheets pass the bodies they
// built; nothing here converts or sums money.

type Options = { signal: AbortSignal };
type Accounts = RetrospendClient["accounts"];

/** The dry run of Add or Edit: the server's, with the device's held against it when there is one. `track` notes whether it could be reached. */
export function previewAccountForm(input: {
	api: RetrospendClient;
	device: WealthDevice | null;
	editing: boolean;
	body: NamedCreateBody | NamedUpdateBody;
	track: <T>(run: Promise<T>) => Promise<T>;
}) {
	const { api, device, editing, track } = input;
	const run = (options?: Options) =>
		editing
			? api.accounts.previewUpdate(input.body as NamedUpdateBody, options)
			: api.accounts.previewCreate(input.body as NamedCreateBody, options);
	if (!device) return run();
	const op = editing
		? ({
				kind: "accountUpdate",
				body: {
					...(input.body as NamedUpdateBody),
					legId: PREVIEW_LEG_ID,
					rateTypeId: PREVIEW_SWITCH_ID,
				},
			} as const)
		: ({
				kind: "accountCreate",
				body: input.body as NamedCreateBody,
			} as const);
	return track(previewWealth(device, op, run));
}

/** Add or Edit: queued on the device when it books it, else the online write under `key`. */
export async function writeAccountForm(input: {
	api: RetrospendClient;
	device: WealthDevice | null;
	editing: boolean;
	body: NamedCreateBody | NamedUpdateBody;
	key: string;
	opened: SeenAccount | null;
	name: string;
}): Promise<object> {
	const { api, device, editing, key, opened, name } = input;
	if (device) {
		const queued = editing
			? await writeAccountOnDevice({
					device,
					op: {
						kind: "accountUpdate",
						body: {
							...(input.body as NamedUpdateBody),
							legId: newClientId(),
							rateTypeId: newClientId(),
						},
					},
					opened,
					title: name,
				})
			: await createAccountOnDevice(device, input.body as NamedCreateBody);
		if (queued.settled !== "online") return queued;
	}
	const options = { context: { idempotencyKey: key } };
	return editing
		? api.accounts.update(input.body as NamedUpdateBody, options)
		: api.accounts.create(input.body as NamedCreateBody, options);
}

type BalanceBody = Parameters<Accounts["updateBalance"]>[0];

/** The dry run of Update balance, as `previewAccountForm`. */
export function previewBalance(input: {
	api: RetrospendClient;
	device: WealthDevice | null;
	body: BalanceBody;
	track: <T>(run: Promise<T>) => Promise<T>;
}) {
	const { api, device, body, track } = input;
	if (!device) return api.accounts.previewUpdateBalance(body);
	return track(
		previewWealth(
			device,
			{
				kind: "accountBalance",
				body: { ...body, legId: PREVIEW_LEG_ID, rateTypeId: PREVIEW_SWITCH_ID },
			},
			(options) => api.accounts.previewUpdateBalance(body, options),
		),
	);
}

/** Update balance: queued on the device with what the sheet showed, else the online write under `key`. */
export async function writeBalance(input: {
	api: RetrospendClient;
	device: WealthDevice | null;
	body: BalanceBody;
	key: string;
	opened: SeenAccount;
	name: string;
}) {
	const { api, device, body, key, opened, name } = input;
	if (device) {
		const queued = await writeAccountOnDevice({
			device,
			op: {
				kind: "accountBalance",
				body: { ...body, legId: newClientId(), rateTypeId: newClientId() },
			},
			opened,
			title: name,
		});
		if (queued.settled !== "online") return queued;
	}
	return api.accounts.updateBalance(body, { context: { idempotencyKey: key } });
}
