import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GENERIC } from '../cards/emblems';
import { categoryEmblems } from '../categories/emblems';
import { weaponEmblems } from '../weapons/emblems';
import { sectionEmblems } from './emblems';

// The seed's catalogue (db_v1_init.sql is generated from it): every category,
// weapon and section has an emblem of its own, never the generic one.
interface Catalog {
	categories: { id: string }[];
	weapons: { id: string }[];
	schools: { sections: { id: string }[] }[];
}
const catalog: Catalog = JSON.parse(
	readFileSync(new URL('../../../../server/database/catalog/techniques.json', import.meta.url), 'utf-8')
);
const sectionNames = [...new Set(catalog.schools.flatMap((s) => s.sections.map((section) => section.id)))];

describe.each([
	['category', categoryEmblems, catalog.categories.map((c) => c.id)],
	['weapon', weaponEmblems, catalog.weapons.map((w) => w.id)],
	['section', sectionEmblems, sectionNames]
])('%s emblems', (_, emblems, ids) => {
	it.each(ids)('%s has its own emblem', (id) => {
		expect(emblems.has(id)).toBe(true);
		expect(emblems.url(id)).not.toBe(emblems.url(GENERIC));
	});

	it('falls back to the generic emblem', () => {
		expect(emblems.has('something_new')).toBe(false);
		expect(emblems.url('something_new')).toBe(emblems.url(GENERIC));
	});
});

it('sections of the same kind share an emblem', () => {
	expect(sectionEmblems.url('shoden_omote')).toBe(sectionEmblems.url('shoden'));
	expect(sectionEmblems.url('hekito')).toBe(sectionEmblems.url('muto_dori'));
});
