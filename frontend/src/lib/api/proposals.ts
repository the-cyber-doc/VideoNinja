// Catalogue entries proposed with "Other" in the technique picker (whoever annotates), and
// their resolution on the Options page (the "options" access; the server checks both).
import { api } from './client';
import type { EntryEdit, ProposalIn, ProposalOut, ProposedEntry, ProposedKind } from './types';

const entry = (kind: ProposedKind, id: string) => `/api/admin/proposals/${kind}/${encodeURIComponent(id)}`;

/** The new steps of a technique's place: created, proposed. */
export const propose = (body: ProposalIn) => api<ProposalOut>('/api/catalog/proposals', body);
export const listProposals = () => api<ProposedEntry[]>('/api/admin/proposals');
/** Corrected (a new name renames it and what is under it, everywhere): the entry as saved. */
export const editProposal = (kind: ProposedKind, id: string, body: EntryEdit) =>
	api<ProposedEntry>(entry(kind, id), body, 'PUT');
export const validateProposal = (kind: ProposedKind, id: string) => api<void>(`${entry(kind, id)}/validate`, {});
export const mergeProposal = (kind: ProposedKind, id: string, into: string) =>
	api<void>(`${entry(kind, id)}/merge`, { into });
export const deleteProposal = (kind: ProposedKind, id: string) => api<void>(entry(kind, id), undefined, 'DELETE');
