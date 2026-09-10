import { test } from "node:test";
import assert from "node:assert/strict";
import { inject, apply, name } from "../lib/index.js";

/**
 * Regression test for the plugin-tree load failure:
 *
 *   dsh: plugin tree failed to load: failed to apply loader entry
 *   cursor-subscription (dsh-cursor-subscription):
 *   cannot get property "webServer" without inject
 *
 * `@deepseek-ai/dsh-client-connection` registers an RPC channel on the OWNER
 * context it is handed:
 *
 *   register(owner, channel, ...) {
 *     return owner.effect(() => owner.webServer.register(route), ...);
 *   }
 *
 * The owner is this plugin's own context, which is why the plugin itself must
 * declare `webServer` in `inject` — exactly as
 * `@deepseek-ai/dsh-host-frontend-static` declares
 * `inject = ["webServer", "connection"]`. A cordis context proxy throws
 * `cannot get property "<name>" without inject` for every service a plugin did
 * not declare.
 */

const CHANNEL = "/cursor-subscription";

/** Properties cordis mixes onto every context regardless of `inject`. */
const CONTEXT_OWN = new Set(["get", "effect", "logger", "on", "off", "emit", "plugin", "provide"]);

/**
 * A context that enforces cordis's inject contract: reading a service the
 * plugin did not declare throws the same error the real proxy raises.
 */
function strictContext(declared, services) {
	const allowed = new Set([...declared, ...CONTEXT_OWN]);
	return new Proxy(services, {
		get(target, prop) {
			if (typeof prop === "symbol" || allowed.has(prop)) return target[prop];
			throw new Error(`cannot get property "${String(prop)}" without inject`);
		},
	});
}

/**
 * Build a host context for one run. `connection.rpc.handle` mirrors the real
 * Connection: it registers the channel through the context's own `webServer`,
 * so an undeclared `webServer` dependency fails inside this call.
 */
function hostContext(declared) {
	const routes = [];
	const services = {
		// Cordis mixes these onto every context regardless of `inject`.
		get: (serviceName) => services[serviceName],
		effect: (execute) => execute(),
		logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
		webServer: {
			register: (route) => {
				routes.push(route);
			},
		},
		llm: { registerAdapter: () => {} },
		credentials: {
			resolve: async () => undefined,
			set: async () => {},
			unset: async () => {},
		},
		settings: { installSection: () => {} },
	};
	const ctx = strictContext(declared, services);
	services.connection = {
		rpc: {
			// Mirrors Connection.rpc.handle (real signature: (channel, handler)).
			// The real registry binds its owner to the CALLER's context, so route
			// registration reads `ctx.webServer` here — the operation under test.
			handle: (channel) => {
				ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: channel }), `rpc ${channel}`);
			},
		},
	};
	return { ctx, routes };
}

test("inject declares the webServer dependency Connection.rpc.handle needs", () => {
	assert.ok(
		inject.includes("webServer"),
		"inject must declare webServer: Connection.rpc.handle registers routes through owner.webServer",
	);
	assert.ok(inject.includes("connection"), "inject must declare connection");
	assert.ok(inject.includes("llm"), "inject must declare llm");
	assert.ok(inject.includes("credentials"), "inject must declare credentials");
});

test("apply loads and registers the loopback RPC route on the host webserver", () => {
	const { ctx, routes } = hostContext(inject);

	apply(ctx, {});

	const route = routes.find((entry) => entry.path === CHANNEL);
	assert.ok(route, `expected a webserver route for ${CHANNEL}, got ${JSON.stringify(routes)}`);
	assert.equal(route.kind, "prefix");
});

test("the same apply fails when webServer is not a declared dependency", () => {
	const withoutWebServer = inject.filter((entry) => entry !== "webServer");
	const { ctx } = hostContext(withoutWebServer);

	assert.throws(
		() => apply(ctx, {}),
		/cannot get property "webServer" without inject/,
		"the reported regression must reproduce when webServer is undeclared",
	);
});

test("plugin is named cursor-subscription", () => {
	assert.equal(name, "cursor-subscription");
});
