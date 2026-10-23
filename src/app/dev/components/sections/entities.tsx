"use client";

import type { ReactNode } from "react";
import { ActionArea, ActionMenu } from "~/components/actions/action-menu";
import type { Entity, EntityTargets } from "~/components/actions/registry";
import { AllocationBar } from "~/components/charts/allocation-bar";
import { AccountRow } from "~/components/rows/account-row";
import { EnvelopeRow } from "~/components/rows/envelope-row";
import { PersonRow } from "~/components/rows/person-row";
import { ProjectRow } from "~/components/rows/project-row";
import { RecurringRow } from "~/components/rows/recurring-row";
import { RowList, type RowVariant } from "~/components/rows/row";
import { useToast } from "~/components/ui/toast";
import { ALLOCATION } from "../fixtures/home";
import {
	ACCOUNTS,
	ENVELOPES,
	PEOPLE,
	PROJECTS,
	RECURRING,
} from "../fixtures/rows";
import { CAP } from "../sections";
import { Cap, Pair, Spec } from "../spec";
import { ACTION_IDS, useDemoHandlers } from "./demo";

/** A row with its registry menu: ⋯ button, right-click and long press. */
function WithActions<E extends Entity>({
	entity,
	target,
	row,
}: {
	entity: E;
	target: EntityTargets[E];
	row: (actions: ReactNode) => React.ReactElement;
}) {
	const handlers = useDemoHandlers<EntityTargets[E]>(ACTION_IDS[entity]);
	return (
		<ActionArea entity={entity} handlers={handlers} target={target}>
			{row(<ActionMenu entity={entity} handlers={handlers} target={target} />)}
		</ActionArea>
	);
}

function People({ variant }: { variant: RowVariant }) {
	const toast = useToast();
	return (
		<RowList variant={variant}>
			{PEOPLE.map((p) => (
				<WithActions
					entity="person"
					key={p.id}
					row={(a) => (
						<PersonRow
							actions={a}
							onSettle={() => toast.info(`settle: ${p.name}`)}
							person={p}
						/>
					)}
					target={{ id: p.id, name: p.name }}
				/>
			))}
		</RowList>
	);
}

function Projects({ variant }: { variant: RowVariant }) {
	return (
		<RowList variant={variant}>
			{PROJECTS.map((p) => (
				<WithActions
					entity="project"
					key={p.id}
					row={(a) => <ProjectRow actions={a} project={p} />}
					target={{ id: p.id, name: p.name, solo: p.solo }}
				/>
			))}
		</RowList>
	);
}

function Accounts({ variant }: { variant: RowVariant }) {
	return (
		<RowList variant={variant}>
			{ACCOUNTS.map((a) => (
				<WithActions
					entity="account"
					key={a.id}
					row={(x) => <AccountRow account={a} actions={x} />}
					target={{ id: a.id, name: a.name }}
				/>
			))}
		</RowList>
	);
}

function Recurring({ variant }: { variant: RowVariant }) {
	const toast = useToast();
	return (
		<RowList variant={variant}>
			{RECURRING.map((r) => (
				<WithActions
					entity="recurring"
					key={r.id}
					row={(a) => (
						<RecurringRow
							actions={a}
							item={r}
							onConfirm={() => toast.info(`confirm: ${r.title}`)}
							onSkip={() => toast.info(`skip: ${r.title}`)}
						/>
					)}
					target={{ id: r.id, name: r.title, paused: false }}
				/>
			))}
		</RowList>
	);
}

export function EntitySections() {
	const toast = useToast();
	const envelopes = (variant: RowVariant) => (
		<RowList variant={variant}>
			{ENVELOPES.map((n) => (
				<EnvelopeRow
					envelope={n}
					key={n.id}
					onOpen={() => toast.info(`open: ${n.name}`)}
				/>
			))}
		</RowList>
	);
	return (
		<>
			<Spec id="person">
				<Pair
					desktop={<People variant="flat" />}
					phone={<People variant="group" />}
				/>
			</Spec>
			<Spec id="project">
				<Cap>{CAP.coverCard}</Cap>
				<Pair
					desktop={<Projects variant="flat" />}
					phone={<Projects variant="group" />}
				/>
			</Spec>
			<Spec id="account">
				<Pair
					desktop={
						<>
							<Accounts variant="flat" />
							<Cap className="mt-6">{CAP.allocation}</Cap>
							<AllocationBar items={ALLOCATION} />
						</>
					}
					phone={
						<>
							<Accounts variant="group" />
							<div className="mt-4">
								<AllocationBar items={ALLOCATION} />
							</div>
						</>
					}
				/>
			</Spec>
			<Spec id="envelope">
				<Pair desktop={envelopes("flat")} phone={envelopes("group")} />
			</Spec>
			<Spec id="recurring">
				<Pair
					desktop={<Recurring variant="flat" />}
					phone={<Recurring variant="group" />}
				/>
			</Spec>
		</>
	);
}
