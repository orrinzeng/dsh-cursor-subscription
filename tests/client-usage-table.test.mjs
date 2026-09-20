import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * The Usage card's included-usage table.
 *
 * The panel lays its rows out the way Cursor's own dashboard does: one row per
 * included-usage pool, then the models that drew on that pool. The row builder
 * is a pure function of the Host's usage projection, so it is pinned here
 * rather than through a browser render.
 */

let client;
async function loadClient() {
	if (client !== undefined) return client;
	let factory;
	globalThis.window = { __ModuleLoader__: { load: (entry) => { factory = entry.factory; } } };
	await import("../lib/client.js");
	assert.ok(factory !== undefined, "the bundle must register itself through window.__ModuleLoader__");
	const stub = () => undefined;
	client = factory(() => new Proxy({}, { get: () => stub }));
	return client;
}

/** English copy, read from the dictionary the panel registers. */
async function english() {
	const module = await loadClient();
	const dictionaries = [];
	globalThis.document = {
		documentElement: { dataset: {} },
		createElement: () => ({ dataset: {}, textContent: "", remove: () => {} }),
		head: { append: () => {} },
	};
	module.apply({
		effect: (execute) => { execute(); },
		locale: {
			register: (namespace, dicts) => dictionaries.push({ namespace, dicts }),
			getLocale: () => ({ locales: [], active: "en" }),
			addLanguage: () => () => {},
			subscribe: () => () => {},
			bind: (namespace) => (key) => dictionaries[0].dicts.en[key],
		},
		get: () => undefined,
		slots: { inject: () => {}, register: () => {} },
	});
	return { module, t: (key) => dictionaries[0].dicts.en[key], dicts: dictionaries[0].dicts };
}

test("the included-usage table groups each pool with the models that drew on it", async () => {
	const { module, t } = await english();
	// The live projection for an account whose whole cycle went to one Other
	// Models model (dashboard: Cursor Models 0.0%, Other Models 15.6%).
	const rows = module.includedUsageRows(
		t,
		{
			pools: { auto: { pct: 0, tokens: 0 }, api: { pct: 15.604999999999999, tokens: 26986544 } },
			models: [{ id: "claude-opus-5-high", pool: "api", spentDollars: 31.21, tokens: 26986544, pct: 15.6 }],
		},
		[{ id: "claude-opus-5-high", pool: "api", spentDollars: 31.21, tokens: 26986544, pct: 15.6 }],
	);
	assert.deepEqual(rows, [
		{ key: "auto", pool: true, label: "Plan Cursor model usage", pct: 0, tokens: 0 },
		{ key: "api", pool: true, label: "Plan other model usage", pct: 15.604999999999999, tokens: 26986544 },
		{
			key: "api:claude-opus-5-high",
			pool: false,
			label: "claude-opus-5-high",
			pct: 15.6,
			tokens: 26986544,
			title: "$31.21",
		},
	]);
});

test("the included-usage table keeps pool percentages when the model read failed", async () => {
	const { module, t } = await english();
	const rows = module.includedUsageRows(t, { pools: { auto: { pct: 0 }, api: { pct: 15.6 } }, models: [] }, []);
	assert.deepEqual(rows, [
		{ key: "auto", pool: true, label: "Plan Cursor model usage", pct: 0, tokens: undefined },
		{ key: "api", pool: true, label: "Plan other model usage", pct: 15.6, tokens: undefined },
	]);
	assert.deepEqual(module.includedUsageRows(t, {}, []), [], "nothing known renders no table at all");
});

test("an Auto row billed to the Other Models pool is labelled as overflow", async () => {
	const { module, t } = await english();
	const rows = module.includedUsageRows(
		t,
		{ pools: { api: { pct: 10, tokens: 2500 } } },
		[{ id: "default", pool: "api", overflow: true, spentDollars: 50, tokens: 2000, pct: 5 }],
	);
	assert.deepEqual(rows.at(-1), { key: "api:default", pool: false, label: "auto (overflow)", pct: 5, tokens: 2000, title: "$50.00" });
});

test("the usage cells keep one decimal and compact the token count", async () => {
	const { module } = await english();
	assert.equal(module.percent1(0), "0.0");
	assert.equal(module.percent1(15.604999999999999), "15.6");
	assert.equal(module.percent1(143), "143.0", "an over-quota pool still reads as a percentage");
	const tokens = module.compactTokens(26986544);
	assert.ok(/\p{Nd}/u.test(tokens), `compact tokens carry a digit (got ${tokens})`);
	assert.ok(tokens.length <= 10, `compact tokens stay short (got ${tokens})`);
	assert.equal(module.compactTokens(0).length, 1, "zero stays a single character");
});
