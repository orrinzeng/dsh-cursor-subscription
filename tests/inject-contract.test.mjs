import { test } from "node:test";
import assert from "node:assert/strict";
import { apply, inject, name, CHANNEL } from "../lib/index.js";

/**
 * Contract for mounting the plugin's loopback account RPC channel.
 *
 * The reported profile boot failure was:
 *
 *   dsh: plugin tree failed to load: failed to apply loader entry
 *   cursor-subscription (dsh-cursor-subscription):
 *   cannot get property "webServer" without inject
 *
 * `HostConnectionService` reads `owner.webServer` while registering a channel
 * (`@deepseek-ai/dsh-client-connection` 0.1.5-rc.1, `lib/index.js:618`), but the
 * owner Context it uses is the one that READ the Connection service, and cordis
 * resolves that Context's services through the providing plugin's own scope:
 *
 *   register(owner, channel, handler) {
 *     return owner.effect(() => owner.webServer.register(route), ...);
 *   }
 *   get rpc() {
 *     const owner = this.ctx;                     // provider-scoped Context
 *     return { handle: (channel, handler) => this.register(owner, channel, handler) };
 *   }
 *
 * 0.1.5-rc.1 declares `credentials` alone and mounts its own `/api` transport
 * from a nested `webServer` Context, so `rpc.handle` cannot reach `webServer`
 * for any out-of-tree consumer. Declaring `webServer` in this plugin's own
 * `inject` does not help either: the failing read happens on the provider's
 * scope, never on this plugin's Context. The plugin therefore calls the same
 * registry method with an explicit owner Context that declares `webServer`.
 */

const CHANNEL_PREFIX = "/cursor-subscription";

/** Properties cordis mixes onto every Context regardless of `inject`. */
const CONTEXT_MIXINS = new Set([
	"get",
	"set",
	"effect",
	"logger",
	"on",
	"off",
	"once",
	"emit",
	"parallel",
	"serial",
	"bail",
	"waterfall",
	"plugin",
	"provide",
	"inject",
	"accessor",
	"mixin",
]);

/**
 * A Context that enforces cordis's inject contract: reading a service the
 * plugin did not declare throws the same error the real proxy raises.
 */
function strictContext(declared, services, label = "context") {
	const allowed = new Set([...declared, ...CONTEXT_MIXINS]);
	return new Proxy(services, {
		get(target, prop) {
			if (typeof prop === "symbol" || allowed.has(prop)) return target[prop];
			throw new Error(`${label}: cannot get property "${String(prop)}" without inject`);
		},
	});
}

/**
 * Build a host shaped like a `web` profile: `llm`, `credentials`, and
 * `settings` services, the Connection service with 0.1.5-rc.1's provider-scoped
 * `rpc.handle`, and a web server that records route registrations.
 *
 * `withRegister: false` models a Connection build that only exposes the public
 * `rpc` registry; `providerDeclaresWebServer: true` models a build whose own
 * provider scope declares `webServer` (0.1.0-rc.6).
 */
function host({ withWebServer = true, withRegister = true, providerDeclaresWebServer = false } = {}) {
	const routes = [];
	const adapters = [];
	const channelCalls = { register: [], handle: [] };
	const providerScope = providerDeclaresWebServer ? ["credentials", "webServer"] : ["credentials"];
	const services = {
		// Cordis mixes these onto every Context regardless of `inject`.
		get: (serviceName) => services[serviceName],
		effect: (execute) => {
			execute();
		},
		logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
		llm: { registerAdapter: (names, adapter) => adapters.push({ names, adapter }) },
		credentials: {
			resolve: async () => undefined,
			set: async () => {},
			unset: async () => {},
		},
		settings: { installSection: () => {}, describe: () => [] },
		// Cordis starts the callback once every requested service exists.
		inject: (dependencies, callback) => {
			if (dependencies.some((dependency) => services[dependency] === undefined)) return undefined;
			return callback(strictContext(dependencies, services, `inject(${dependencies.join(",")})`));
		},
	};

	/** The real registration body: the owner Context must resolve `webServer`. */
	const registerRoute = (owner, channel, options) =>
		owner.effect(() => owner.webServer.register({ kind: "prefix", path: channel, options }), `rpc ${channel}`);

	services.connection = {
		rpc: {
			// Mirrors `rpc.handle`: it registers on the providing plugin's scope.
			handle: (channel, handler, options) => {
				channelCalls.handle.push({ channel, handler, options });
				return registerRoute(strictContext(providerScope, services, "client-connection"), channel, options);
			},
		},
	};
	if (withRegister) {
		services.connection.register = (owner, channel, handler, options) => {
			channelCalls.register.push({ owner, channel, handler, options });
			return registerRoute(owner, channel, options);
		};
	}
	if (withWebServer) {
		services.webServer = {
			register: (route) => {
				routes.push(route);
			},
		};
	}

	return {
		ctx: strictContext(inject, services, "cursor-subscription"),
		providerScope: strictContext(providerScope, services, "client-connection"),
		routes,
		adapters,
		channelCalls,
	};
}

test("inject declares the services the provider and account RPC need", () => {
	assert.ok(inject.includes("llm"), "inject must declare llm: apply registers the Cursor adapter");
	assert.ok(inject.includes("credentials"), "inject must declare credentials: the OAuth store needs it");
	assert.ok(inject.includes("connection"), "inject must declare connection: the account channel is mounted through it");
	assert.ok(
		!inject.includes("webServer"),
		"webServer belongs to the channel-mounting Context only: requiring it would keep the Cursor provider out of every profile without a web server",
	);
});

test("apply mounts the loopback account channel through a webServer-declaring owner", () => {
	const { ctx, routes, adapters, channelCalls } = host();

	apply(ctx, {});

	const route = routes.find((entry) => entry.path === CHANNEL);
	assert.ok(route, `expected a web server route for ${CHANNEL}, got ${JSON.stringify(routes)}`);
	assert.equal(route.kind, "prefix");
	assert.deepEqual(
		route.options,
		{ authority: "loopback" },
		"the channel must keep Connection's loopback-only Host fence",
	);
	assert.equal(channelCalls.handle.length, 0, "the provider-scoped rpc.handle path cannot resolve webServer");
	assert.equal(channelCalls.register.length, 1, "the channel must be registered exactly once");
	assert.equal(adapters.length, 1, "the Cursor LLM adapter still registers");
});

test("apply still loads when the profile has no web server", () => {
	const { ctx, routes, adapters } = host({ withWebServer: false });

	apply(ctx, {});

	assert.deepEqual(routes, [], "no web server means no channel route");
	assert.equal(adapters.length, 1, "the Cursor LLM adapter must not depend on a web server");
});

test("apply falls back to rpc.handle when the registry method is unavailable", () => {
	const { ctx, routes, channelCalls } = host({ withRegister: false, providerDeclaresWebServer: true });

	apply(ctx, {});

	assert.equal(channelCalls.handle.length, 1, "the public rpc.handle must be used when register is absent");
	const route = routes.find((entry) => entry.path === CHANNEL);
	assert.ok(route, `expected a web server route for ${CHANNEL}, got ${JSON.stringify(routes)}`);
	assert.deepEqual(route.options, { authority: "loopback" });
});

test("the provider-scoped owner reproduces the reported boot failure", () => {
	const { providerScope } = host();

	assert.throws(
		() => providerScope.effect(() => providerScope.webServer.register({ kind: "prefix", path: CHANNEL_PREFIX })),
		/cannot get property "webServer" without inject/,
		"the reported regression must reproduce on the owner rpc.handle would bind",
	);
});

test("plugin is named cursor-subscription", () => {
	assert.equal(name, "cursor-subscription");
	assert.equal(CHANNEL, CHANNEL_PREFIX);
});
