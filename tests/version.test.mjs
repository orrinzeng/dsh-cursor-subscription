import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * The panel labels itself with the version of the build that is serving it.
 *
 * The Host answers a `version` endpoint from its own manifest, so the number is
 * never duplicated into the browser bundle, and the client renders it next to
 * the section title. These tests pin both ends: the Host reports the packaged
 * version, and the client turns whatever it receives into a label without ever
 * letting a failed lookup disturb the panel.
 */

const MANIFEST = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

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

test("the Host reports the packaged version", async () => {
	const { VERSION, createCursorRpcHandler } = await import("../lib/index.js");
	assert.equal(typeof MANIFEST.version, "string");
	assert.equal(VERSION, MANIFEST.version, "the reported version is the manifest version");
	const handler = createCursorRpcHandler({}, {});
	const result = await handler("version", {}, new AbortController().signal);
	assert.deepEqual(result, { ok: true, value: { version: MANIFEST.version } });
});

test("the version endpoint needs no Cursor account or settings service", async () => {
	const { createCursorRpcHandler } = await import("../lib/index.js");
	// A coordinator without accountStatus, and no settings/usage/models services:
	// the panel must be able to label itself even then.
	const handler = createCursorRpcHandler({});
	const result = await handler("version", {}, new AbortController().signal);
	assert.equal(result.ok, true);
	assert.equal(result.value.version, MANIFEST.version);
});

test("an explicitly injected version wins over the manifest", async () => {
	const { createCursorRpcHandler } = await import("../lib/index.js");
	const handler = createCursorRpcHandler({}, { version: "9.9.9-test" });
	const result = await handler("version", {}, new AbortController().signal);
	assert.deepEqual(result, { ok: true, value: { version: "9.9.9-test" } });
});

test("the panel labels a reported version and rejects anything unusable", async () => {
	const { formatVersion } = await loadClient();
	assert.equal(formatVersion("0.6.1"), "v0.6.1");
	assert.equal(formatVersion("  1.2.3-rc.1 "), "v1.2.3-rc.1");
	assert.equal(formatVersion(""), undefined);
	assert.equal(formatVersion("   "), undefined);
	assert.equal(formatVersion(undefined), undefined);
	assert.equal(formatVersion(42), undefined);
	assert.equal(formatVersion(null), undefined);
});

test("the panel reads the version endpoint and survives every failure shape", async () => {
	const { readVersion } = await loadClient();
	const calls = [];
	const answering = async (channel, endpoint, payload) => {
		calls.push({ channel, endpoint, payload });
		return { ok: true, value: { version: "0.6.1" } };
	};
	assert.equal(await readVersion({ call: answering }), "v0.6.1");
	assert.deepEqual(calls, [{ channel: "/cursor-subscription", endpoint: "version", payload: {} }]);
	assert.equal(await readVersion({ call: async () => ({ ok: false, error: { code: "internal", message: "no" } }) }), undefined);
	assert.equal(await readVersion({ call: async () => ({ ok: true, value: {} }) }), undefined);
	assert.equal(await readVersion({ call: async () => { throw new Error("transport down"); } }), undefined);
});

test("the panel header carries the version chip", async () => {
	const source = await readFile(new URL("../lib/client.js", import.meta.url), "utf8");
	assert.match(source, /className: "cursorSubscriptionVersion"/, "the header renders the version chip");
	assert.match(source, /cursorSubscriptionVersion\{[^}]*direction:ltr\}/, "the chip stays left-to-right under RTL");
	assert.match(source, /readVersion\(rpc\)/, "the section reads the version through the channel");
});
