import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * Client-side language contract for the Cursor settings panel.
 *
 * The bundle is a browser module: it registers itself through
 * `window.__ModuleLoader__` and touches no other global while it is merely
 * defined, so a Node test can capture its factory, load it once, and drive
 * `apply` against a stand-in context. What the framework then requires is
 * checked here instead of in a browser:
 *
 *  - every locale dictionary carries exactly the English key set, so no lookup
 *    can fall through to another language by accident;
 *  - every template keeps the English placeholder tokens, because the panel
 *    fills them with a local `replace("{key}", value)`;
 *  - every contributed language declares a fallback that exists in the DSH
 *    catalog and terminates at English, which `locale.addLanguage` enforces at
 *    runtime;
 *  - the right-to-left marker the client sets is the attribute the stylesheet
 *    keys on.
 */

/** Attribute the client sets on `<html>` and the stylesheet selects on. */
const RTL_ATTRIBUTE = "data-cursor-subscription-rtl";
const NAMESPACE = "settings.cursorSubscription";
const BUILT_IN = ["zh", "en"];
const CONTRIBUTED = [
	{ id: "zh-Hant", label: "繁體中文", fallback: "zh" },
	{ id: "ja", label: "日本語", fallback: "en" },
	{ id: "ko", label: "한국어", fallback: "en" },
	{ id: "es", label: "Español", fallback: "en" },
	{ id: "fr", label: "Français", fallback: "en" },
	{ id: "de", label: "Deutsch", fallback: "en" },
	{ id: "it", label: "Italiano", fallback: "en" },
	{ id: "pt-BR", label: "Português (Brasil)", fallback: "en" },
	{ id: "ru", label: "Русский", fallback: "en" },
	{ id: "ar", label: "العربية", fallback: "en" },
];

/** Placeholder tokens a template expects, as a sorted list. */
function placeholders(template) {
	return [...template.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]).sort();
}

/** Load the browser bundle once and return its module exports. */
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

/**
 * Drive `apply` against a stand-in client context.
 * @returns the captured registrations, the apply-time effects, and a locale switch helper.
 */
async function boot({ active = "en", locales = [...BUILT_IN] } = {}) {
	const module = await loadClient();
	const applied = { dictionaries: [], languages: [], disposers: [], style: "" };
	const listeners = new Set();
	const style = { dataset: {}, textContent: "", remove: () => {} };
	globalThis.document = {
		documentElement: { dataset: {} },
		createElement: () => style,
		head: { append: () => {} },
	};
	const ctx = {
		effect: (execute) => {
			const dispose = execute();
			if (typeof dispose === "function") applied.disposers.push(dispose);
		},
		locale: {
			register: (ns, dicts) => {
				applied.dictionaries.push({ ns, dicts });
				return () => {};
			},
			addLanguage: (language) => {
				applied.languages.push(language);
				return () => {};
			},
			getLocale: () => ({ active, locales }),
			subscribe: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			bind: () => (key) => key,
		},
		get: () => ({ rpc: { call: async () => ({ ok: true, value: {} }) } }),
		slots: { inject: (_name, register) => register(), register: () => () => {} },
	};
	module.apply(ctx);
	applied.style = style.textContent;
	return {
		module,
		...applied,
		setActive: (id) => {
			active = id;
			for (const listener of listeners) listener();
		},
	};
}

test("the panel registers one dictionary per shipped locale", async () => {
	const { dictionaries } = await boot();
	assert.equal(dictionaries.length, 1, "the panel registers its copy once");
	const [registration] = dictionaries;
	assert.equal(registration.ns, NAMESPACE);
	assert.deepEqual(
		Object.keys(registration.dicts),
		[...BUILT_IN, ...CONTRIBUTED.map((language) => language.id)],
		"built-in and contributed locales are all registered",
	);
});

test("every dictionary carries exactly the English key set", async () => {
	const { dictionaries } = await boot();
	const { dicts } = dictionaries[0];
	const english = Object.keys(dicts.en);
	for (const [locale, dict] of Object.entries(dicts)) {
		assert.deepEqual(Object.keys(dict), english, `${locale} must use the English key order and key set`);
		for (const key of english) {
			assert.equal(typeof dict[key], "string", `${locale}.${key} must be a string`);
			assert.notEqual(dict[key].trim(), "", `${locale}.${key} must not be empty`);
		}
	}
	assert.ok(english.length > 50, `the panel ships a full key set (found ${english.length} keys)`);
});

test("every template keeps the English placeholder tokens", async () => {
	const { dictionaries } = await boot();
	const { dicts } = dictionaries[0];
	for (const [key, english] of Object.entries(dicts.en)) {
		for (const [locale, dict] of Object.entries(dicts)) {
			assert.deepEqual(
				placeholders(dict[key]),
				placeholders(english),
				`${locale}.${key} must keep the placeholders of the English template`,
			);
			const template = dict[key];
			const opens = (template.match(/\{/g) ?? []).length;
			assert.equal((template.match(/\}/g) ?? []).length, opens, `${locale}.${key} has unbalanced braces`);
			assert.equal(placeholders(template).length, opens, `${locale}.${key} has a placeholder the fill step cannot parse`);
		}
	}
});

test("every contributed language joins the catalog with a reachable fallback", async () => {
	const { languages } = await boot();
	assert.deepEqual(languages, CONTRIBUTED, "the contributed languages are registered in display order");
	const known = new Set([...BUILT_IN, ...CONTRIBUTED.map((language) => language.id)]);
	for (const language of languages) {
		assert.notEqual(language.label.trim(), "", `${language.id} needs a label`);
		assert.ok(known.has(language.fallback), `${language.id} falls back to a registered language`);
		assert.notEqual(language.fallback, language.id, `${language.id} must not fall back to itself`);
	}
	// Following the declared fallbacks must reach English, which addLanguage
	// enforces; DSH's own built-in Chinese falls back to English.
	const fallbacks = new Map(CONTRIBUTED.map((language) => [language.id, language.fallback]));
	fallbacks.set("zh", "en");
	for (const language of languages) {
		const seen = new Set([language.id]);
		let current = language.id;
		while (fallbacks.has(current)) {
			const next = fallbacks.get(current);
			assert.ok(!seen.has(next), `${language.id} fallback chain must not cycle`);
			seen.add(next);
			current = next;
		}
		assert.ok(seen.has("en"), `${language.id} fallback chain must end at en`);
	}
});

test("a locale that DSH or another pack owns is left alone", async () => {
	const { languages } = await boot({ locales: [{ id: "zh" }, { id: "en" }, { id: "ja" }] });
	assert.ok(
		!languages.some((language) => language.id === "ja"),
		"an already registered locale is not claimed twice",
	);
	assert.ok(languages.some((language) => language.id === "ar"), "other languages are still contributed");
});

test("the panel mirrors itself while a right-to-left language is active", async () => {
	const panel = await boot();
	assert.equal(globalThis.document.documentElement.dataset.cursorSubscriptionRtl, undefined);
	assert.match(panel.style, new RegExp(`html\\[${RTL_ATTRIBUTE}\\]`), "the stylesheet keys on the marker");
	panel.setActive("ar");
	assert.equal(globalThis.document.documentElement.dataset.cursorSubscriptionRtl, "", "arabic mirrors the panel");
	panel.setActive("en");
	assert.equal(globalThis.document.documentElement.dataset.cursorSubscriptionRtl, undefined, "english clears it");
	for (const dispose of panel.disposers) dispose();
	assert.equal(globalThis.document.documentElement.dataset.cursorSubscriptionRtl, undefined);
});

test("the panel reads every key statically and defines nothing it cannot read", async () => {
	const { dictionaries } = await boot();
	const defined = new Set(Object.keys(dictionaries[0].dicts.en));
	const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
	const used = new Set();
	// `t("key")` — the negative lookbehind skips `ctx.get("service")`.
	for (const match of source.matchAll(/(?<![A-Za-z0-9_$])t\("([A-Za-z][A-Za-z0-9]*)"/g)) used.add(match[1]);
	// field(id, labelKey, hintKey, ...) passes its two keys as data.
	for (const match of source.matchAll(/field\("[A-Za-z]+",\s*"([A-Za-z][A-Za-z0-9]*)",\s*"([A-Za-z][A-Za-z0-9]*)"/g)) {
		used.add(match[1]);
		used.add(match[2]);
	}
	assert.ok(used.size > 50, `the panel must read its copy through t() (found ${used.size} keys)`);
	assert.deepEqual([...used].filter((key) => !defined.has(key)), [], "every read key must be defined");
	assert.deepEqual([...defined].filter((key) => !used.has(key)), [], "every defined key must be read");
});

test("the client plugin injects the locale service", async () => {
	const { module } = await boot();
	assert.ok(module.inject.includes("locale"), "the panel reads copy through ctx.locale");
	assert.ok(module.inject.includes("slots"), "the panel registers a settings section");
});
