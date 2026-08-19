/**
 * dsh-cursor-subscription — use a Cursor subscription inside DeepSeek Harness.
 *
 * Host side: PKCE browser login against Cursor's OAuth endpoints, token
 * refresh, an `LlmAdapter` that speaks the Cursor Agent protocol
 * (`agent.v1.AgentService/Run` over HTTP/2 with Connect framing), model
 * discovery via `GetUsableModels`, and a loopback RPC channel for the web
 * client.
 *
 * The Cursor Agent protocol is reverse-engineered and undocumented; wire
 * details are kept in the `proto.js` companion module and the message
 * builders/parsers below. Field numbers were verified against the live API
 * and the vendored `agent.v1` protobuf schemas published by community
 * projects (see README).
 */
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { CallId, LlmAdapter, LlmError } from "@deepseek-ai/dsh-llm";
import { createHash, randomUUID } from "node:crypto";
import http2 from "node:http2";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { encodeValue, decodeValue, Reader, Writer } from "./proto.js";

//#region constants
export const name = "cursor-subscription";
export const inject = ["llm", "credentials", "connection"];

export const PROVIDER = "cursor-subscription";
export const CREDENTIAL_REF = credentialRef("CURSOR_SUBSCRIPTION_OAUTH");
export const CHANNEL = "/cursor-subscription";

export const CURSOR_BASE_URL = "https://api2.cursor.sh";
export const CURSOR_LOGIN_URL = "https://cursor.com/loginDeepControl";
export const CURSOR_AUTH_ORIGIN = "https://cursor.com";
export const CURSOR_POLL_PATH = "/auth/poll";
export const CURSOR_REFRESH_PATH = "/auth/exchange_user_api_key";
export const CURSOR_RUN_PATH = "/agent.v1.AgentService/Run";
export const CURSOR_MODELS_PATH = "/agent.v1.AgentService/GetUsableModels";

/** Cursor dashboard usage endpoints (authenticated with the session cookie). */
export const USAGE_API_ORIGIN = "https://cursor.com";
export const USAGE_URL = `${USAGE_API_ORIGIN}/api/usage`;
export const USAGE_SUMMARY_URL = `${USAGE_API_ORIGIN}/api/usage-summary`;
export const USAGE_TEAMS_URL = `${USAGE_API_ORIGIN}/api/dashboard/teams`;
export const USAGE_TTL_MS = 60 * 1000;

/** Client version reported to the Agent service; bump when Cursor requires it. */
export const CURSOR_CLIENT_VERSION = "cli-2026.02.13-41ac335";
/** Keep-alive heartbeats while an agent run is streaming. */
export const HEARTBEAT_INTERVAL_MS = 5000;
/** How long an agent run may stay completely silent before we abort. */
export const STREAM_IDLE_TIMEOUT_MS = 120 * 1000;
/** Retain checkpoints/live tool bridges for inactive DSH sessions. */
export const SESSION_STATE_TTL_MS = 30 * 60 * 1000;
/** Stop one Cursor Run before an unconstrained agent can loop forever. */
export const MAX_TOOL_ROUNDS = 64;
/** Refresh the access token this early before its JWT expiry. */
export const REFRESH_AHEAD_MS = 5 * 60 * 1000;
/** Default access-token lifetime when the JWT has no usable exp claim. */
export const DEFAULT_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_CONTEXT_WINDOW = 200000;
export const DEFAULT_MAX_TOKENS = 64000;
//#endregion

//#region fallback models (used when GetUsableModels is unreachable)
const FALLBACK_MODELS = Object.freeze([
	{ id: "composer-2", name: "Composer 2", contextWindow: 200000 },
	{ id: "claude-4-sonnet", name: "Claude 4 Sonnet", contextWindow: 200000 },
	{ id: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", contextWindow: 200000 },
	{ id: "claude-sonnet-4", name: "Claude Sonnet 4", contextWindow: 200000 },
	{ id: "gpt-4o", name: "GPT-4o", contextWindow: 128000 },
	{ id: "gpt-4.1", name: "GPT-4.1", contextWindow: 1000000 },
	{ id: "o3", name: "o3", contextWindow: 200000 },
	{ id: "o4-mini", name: "o4-mini", contextWindow: 200000 },
	{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: 1000000 },
	{ id: "cursor-small", name: "Cursor Small", contextWindow: 200000 },
]);
//#endregion

//#region credential store
const clone = (value) => (value === undefined ? undefined : structuredClone(value));

function assertOAuthCredential(value) {
	if (value === undefined) return undefined;
	if (
		value === null ||
		typeof value !== "object" ||
		value.type !== "oauth" ||
		typeof value.access !== "string" ||
		value.access.length === 0 ||
		typeof value.refresh !== "string" ||
		value.refresh.length === 0 ||
		typeof value.expires !== "number" ||
		!Number.isFinite(value.expires)
	) {
		throw new Error("Cursor credential store received a malformed OAuth credential");
	}
	return clone(value);
}

function parseOAuthCredential(raw) {
	try {
		return assertOAuthCredential(JSON.parse(raw));
	} catch (error) {
		if (error?.message === "Cursor credential store received a malformed OAuth credential") throw error;
		throw new Error("Cursor credential store contains malformed OAuth JSON", { cause: error });
	}
}

/**
 * Adapt DSH's managed string credential service to Cursor's typed OAuth
 * credential. Write operations are serialized so an older refresh response
 * cannot overwrite a newer rotated token.
 */
export class CursorCredentialStore {
	#chain = Promise.resolve();

	constructor(credentials, ref) {
		if (credentials === undefined || credentials === null) {
			throw new Error("Cursor OAuth requires the DSH credentials service");
		}
		this.credentials = credentials;
		this.ref = ref;
	}

	#enqueue(operation) {
		const current = this.#chain.catch(() => undefined).then(operation);
		const tail = current.catch(() => undefined);
		this.#chain = tail;
		return current;
	}

	async read() {
		const hit = await this.credentials.resolve(this.ref);
		if (hit?.value === undefined || hit.value === "") return undefined;
		return parseOAuthCredential(hit.value);
	}

	async write(credential) {
		const validated = assertOAuthCredential(credential);
		if (validated === undefined) throw new Error("Cursor credential store cannot write an empty credential");
		await this.credentials.set(this.ref, JSON.stringify(validated));
		return clone(validated);
	}

	modify(update) {
		return this.#enqueue(async () => {
			const current = await this.read();
			const next = await update(clone(current));
			if (next === undefined) return current;
			return this.write(next);
		});
	}

	async clear() {
		await this.#enqueue(async () => {
			await this.credentials.unset(this.ref);
		});
	}
}
//#endregion

//#region token helpers
/**
 * Extract a JWT expiry (ms epoch) with a safety margin.
 * Falls back to a default lifetime when the token cannot be parsed.
 */
export function getTokenExpiry(token, now = Date.now) {
	try {
		const parts = token.split(".");
		if (parts.length !== 3 || !parts[1]) return now() + DEFAULT_TOKEN_LIFETIME_MS;
		const decoded = JSON.parse(
			Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
		);
		if (decoded && typeof decoded === "object" && typeof decoded.exp === "number") {
			return decoded.exp * 1000;
		}
	} catch {}
	return now() + DEFAULT_TOKEN_LIFETIME_MS;
}

/**
 * Decode the `sub` claim of an access token and strip the identity-provider
 * prefix (e.g. `github|user_...` → `user_...`), which is what the dashboard
 * session cookie and the `/api/usage?user=` parameter expect.
 */
export function getTokenSub(token) {
	try {
		const parts = token.split(".");
		if (parts.length !== 3 || !parts[1]) return undefined;
		const decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
		if (typeof decoded?.sub !== "string" || decoded.sub.length === 0) return undefined;
		return decoded.sub.includes("|") ? decoded.sub.split("|").pop() : decoded.sub;
	} catch {
		return undefined;
	}
}
//#endregion

//#region pkce
async function generatePkce() {
	const verifierBytes = new Uint8Array(96);
	globalThis.crypto.getRandomValues(verifierBytes);
	const verifier = Buffer.from(verifierBytes).toString("base64url");
	const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	const challenge = Buffer.from(digest).toString("base64url");
	return { verifier, challenge };
}

/** Build the browser login URL for the PKCE flow. */
export function buildLoginUrl({ challenge, uuid }) {
	const params = new URLSearchParams({ challenge, uuid, mode: "login", redirectTarget: "cli" });
	return `${CURSOR_LOGIN_URL}?${params.toString()}`;
}
//#endregion

//#region external url
/** Validate the only external origin this plugin may launch. */
export function assertCursorAuthUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Cursor auth URL is invalid");
	}
	if (url.protocol !== "https:") throw new Error("Cursor auth URL must use HTTPS");
	if (url.origin !== CURSOR_AUTH_ORIGIN || url.username !== "" || url.password !== "") {
		throw new Error("Cursor auth URL must use the cursor.com origin");
	}
	return url.href;
}

/** Return a shell-free native opener command for the current desktop. */
export function commandForCursorAuthUrl(value, platform = process.platform) {
	const url = assertCursorAuthUrl(value);
	if (platform === "win32") return { file: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url], shell: false };
	if (platform === "darwin") return { file: "open", args: [url], shell: false };
	if (platform === "linux") return { file: "xdg-open", args: [url], shell: false };
	throw new Error(`Cursor auth URL opener is unsupported on ${platform}`);
}

export function openCursorAuthUrl(value, options = {}) {
	const command = commandForCursorAuthUrl(value, options.platform);
	const spawnProcess = options.spawn ?? spawn;
	return new Promise((resolve, reject) => {
		const child = spawnProcess(command.file, command.args, {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
			shell: command.shell,
		});
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}
//#endregion

//#region auth service
/**
 * Owns the Cursor OAuth lifecycle: PKCE login polling, refresh, and status.
 * Tokens live in the DSH credential store; the browser client only ever sees
 * `{ authenticated, provider, type, expiresAt }`.
 */
export class CursorAuthService {
	constructor(store, options = {}) {
		this.store = store;
		this.fetch = options.fetch ?? fetch;
		this.now = options.now ?? Date.now;
		this.logger = options.logger;
	}

	#log(level, message, ...args) {
		try {
			this.logger?.[level]?.(`cursor-subscription: ${message}`, ...args);
		} catch {}
	}

	async status({ signal } = {}) {
		signal?.throwIfAborted();
		const current = await this.store.read();
		if (current === undefined) return { authenticated: false, provider: PROVIDER };
		return {
			authenticated: true,
			provider: PROVIDER,
			type: "oauth",
			expiresAt: current.expires,
		};
	}

	/**
	 * Resolve a usable access token, refreshing first when the stored token is
	 * missing, expired, or about to expire.
	 * @returns {Promise<string>} the bearer token.
	 */
	async accessToken({ signal } = {}) {
		const credential = await this.credential({ signal });
		return credential.access;
	}

	/**
	 * Resolve the stored credential, refreshing first when its token is
	 * missing, expired, or about to expire.
	 * @returns {Promise<{access: string, refresh: string, expires: number}>}
	 */
	async credential({ signal } = {}) {
		signal?.throwIfAborted();
		const current = await this.store.read();
		if (current === undefined) {
			throw new LlmError("Cursor subscription is not signed in", "MISSING_CREDENTIAL");
		}
		if (current.expires - this.now() > REFRESH_AHEAD_MS) return current;
		const refreshed = await this.refresh(current, { signal });
		return refreshed;
	}

	async refresh(current, { signal } = {}) {
		const response = await this.fetch(`${CURSOR_BASE_URL}${CURSOR_REFRESH_PATH}`, {
			method: "POST",
			redirect: "error",
			headers: {
				authorization: `Bearer ${current.refresh}`,
				"content-type": "application/json",
				accept: "application/json",
				"user-agent": "dsh-cursor-subscription/0.1.0",
			},
			body: "{}",
			signal,
		});
		if (!response.ok) {
			this.#log("warn", "token refresh failed (HTTP %s)", response.status);
			if (response.status === 401 || response.status === 403) {
				throw new LlmError("Cursor sign-in needs to be renewed", "INVALID_CREDENTIAL");
			}
			throw new LlmError(`Cursor token refresh failed (HTTP ${response.status})`, "AUTH_FAILED");
		}
		let data;
		try {
			data = await response.json();
		} catch (error) {
			throw new LlmError("Cursor returned an unreadable token response", "AUTH_FAILED", { cause: error });
		}
		if (typeof data?.accessToken !== "string" || data.accessToken.length === 0) {
			throw new LlmError("Cursor sign-in needs to be renewed", "INVALID_CREDENTIAL");
		}
		const next = {
			type: "oauth",
			access: data.accessToken,
			refresh: typeof data.refreshToken === "string" && data.refreshToken.length > 0 ? data.refreshToken : current.refresh,
			expires: getTokenExpiry(data.accessToken, this.now),
		};
		const stored = await this.store.modify((latest) => {
			// Only rotate when the stored credential is still the one we refreshed.
			if (latest === undefined || latest.refresh !== current.refresh) return latest;
			return next;
		});
		return stored ?? next;
	}

	/** Start a login and resolve once the browser flow completes. */
	async login({ interaction, signal }) {
		signal?.throwIfAborted();
		const { verifier, challenge } = await generatePkce();
		const uuid = randomUUID();
		const loginUrl = buildLoginUrl({ challenge, uuid });

		interaction.notify?.({
			type: "auth_url",
			url: assertCursorAuthUrl(loginUrl),
			instructions: "在浏览器中登录 Cursor 并授权后，此页面会自动完成登录。",
		});
		interaction.prompt?.({ type: "text", message: "等待浏览器登录完成…" }).catch(() => {});
		interaction.signal?.throwIfAborted();

		let delay = 1000;
		for (let attempt = 0; attempt < 150; attempt++) {
			await sleep(delay);
			signal?.throwIfAborted();
			interaction.signal?.throwIfAborted();
			let response;
			try {
				response = await this.fetch(`${CURSOR_BASE_URL}${CURSOR_POLL_PATH}?uuid=${encodeURIComponent(uuid)}&verifier=${encodeURIComponent(verifier)}`, {
					redirect: "error",
					headers: { accept: "application/json", "user-agent": "dsh-cursor-subscription/0.1.0" },
					signal,
				});
			} catch (error) {
				this.#log("warn", "login poll request failed on attempt %d: %s", attempt, error?.cause?.code ?? error?.message);
				throw new LlmError("Cursor login poll request failed", "AUTH_FAILED", { cause: error });
			}
			if (response.status === 404) {
				delay = Math.min(delay * 1.2, 10000);
				continue;
			}
			if (!response.ok) {
				this.#log("warn", "login poll returned HTTP %s on attempt %d", response.status, attempt);
				throw new LlmError(`Cursor login poll failed (HTTP ${response.status})`, "AUTH_FAILED");
			}
			const text = await response.text().catch(() => "");
			this.#log("info", "login poll succeeded after %d attempts", attempt);
			let data;
			try {
				data = JSON.parse(text);
			} catch (error) {
				this.#log("warn", "login poll returned unreadable JSON: %s", text.slice(0, 200));
				throw new LlmError("Cursor login returned an unreadable response", "AUTH_FAILED", { cause: error });
			}
			if (typeof data?.accessToken !== "string" || data.accessToken.length === 0) {
				this.#log("warn", "login poll response had no accessToken");
				throw new LlmError("Cursor login returned no access token", "AUTH_FAILED");
			}
			const credential = {
				type: "oauth",
				access: data.accessToken,
				refresh: typeof data.refreshToken === "string" && data.refreshToken.length > 0 ? data.refreshToken : "",
				expires: getTokenExpiry(data.accessToken, this.now),
			};
			try {
				await this.store.modify(() => credential);
			} catch (error) {
				this.#log("error", "failed to store Cursor credential: %s", error?.message);
				throw new LlmError("Cursor login could not store the credential", "AUTH_FAILED", { cause: error });
			}
			return;
		}
		this.#log("warn", "login timed out after 150 poll attempts");
		throw new LlmError("Cursor login timed out", "AUTH_FAILED");
	}

	async logout({ signal } = {}) {
		signal?.throwIfAborted();
		await this.store.clear();
		return this.status({ signal });
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
//#endregion

//#region login coordinator
const TERMINAL_PHASES = new Set(["authenticated", "failed", "cancelled"]);
const publicClone = (value) => structuredClone(value);
const asObject = (value) => (value !== null && typeof value === "object" ? value : {});
const ok = (value) => ({ ok: true, value });
const badRequest = (message) => ({ ok: false, error: { code: "bad-request", message, details: { issues: [] } } });

const deferred = () => {
	let resolve;
	let reject;
	return {
		promise: new Promise((onResolve, onReject) => {
			resolve = onResolve;
			reject = onReject;
		}),
		resolve,
		reject,
	};
};

/** Own one host-side login without exposing tokens to the browser client. */
export class CursorLoginCoordinator {
	#sessions = new Map();
	#activeId;

	constructor(auth, options = {}) {
		this.auth = auth;
		this.createId = options.createId ?? (() => randomUUID());
		this.logger = options.logger;
	}

	#log(level, message, ...args) {
		try {
			this.logger?.[level]?.(`cursor-subscription: ${message}`, ...args);
		} catch {}
	}

	async accountStatus(options) {
		return publicClone(await this.auth.status(options));
	}

	async start() {
		const active = this.#activeId === undefined ? undefined : this.#sessions.get(this.#activeId);
		if (active !== undefined && !TERMINAL_PHASES.has(active.view.phase)) {
			throw new Error("a Cursor login is already active");
		}
		if (active !== undefined) this.#sessions.delete(active.view.id);
		const id = this.createId();
		const ready = deferred();
		const controller = new AbortController();
		const session = {
			controller,
			ready,
			view: { id, provider: PROVIDER, method: "browser", phase: "starting", authenticated: false },
		};
		this.#sessions.set(id, session);
		this.#activeId = id;
		const publishReady = () => ready.resolve(this.read(id));
		const interaction = {
			signal: controller.signal,
			prompt: async (prompt) => {
				controller.signal.throwIfAborted();
				const answer = deferred();
				session.prompt = answer;
				session.view = { ...session.view, phase: "waiting_input", prompt: publicPrompt(prompt) };
				const abortPrompt = () => answer.reject(controller.signal.reason ?? new Error("login cancelled"));
				controller.signal.addEventListener("abort", abortPrompt, { once: true });
				prompt.signal?.addEventListener("abort", abortPrompt, { once: true });
				publishReady();
				try {
					return await answer.promise;
				} finally {
					controller.signal.removeEventListener("abort", abortPrompt);
					prompt.signal?.removeEventListener("abort", abortPrompt);
					if (session.prompt === answer) session.prompt = undefined;
				}
			},
			notify: (event) => {
				if (controller.signal.aborted) return;
				if (event.type === "auth_url") {
					session.view = {
						...session.view,
						phase: "waiting_browser",
						authUrl: assertCursorAuthUrl(event.url),
						...typeof event.instructions === "string" ? { instructions: event.instructions } : {},
					};
				} else {
					session.view = { ...session.view, message: String(event.message ?? "") };
				}
				publishReady();
			},
		};
		session.run = Promise.resolve()
			.then(() => this.auth.login({ interaction, signal: controller.signal }))
			.then(async () => {
				if (controller.signal.aborted) return;
				const status = await this.auth.status();
				session.view = {
					id,
					provider: PROVIDER,
					method: "browser",
					phase: "authenticated",
					authenticated: status.authenticated === true,
					...typeof status.expiresAt === "number" ? { expiresAt: status.expiresAt } : {},
				};
			})
			.catch((error) => {
				if (controller.signal.aborted) {
					session.view = { id, provider: PROVIDER, method: "browser", phase: "cancelled", authenticated: false };
					return;
				}
				const message = error instanceof Error ? error.message : String(error);
				this.#log("warn", "login failed: %s", message);
				session.view = {
					id,
					provider: PROVIDER,
					method: "browser",
					phase: "failed",
					authenticated: false,
					error: "Cursor login failed",
					...(message ? { detail: message.slice(0, 500) } : {}),
				};
				session.hostError = error;
			})
			.finally(publishReady);
		return ready.promise;
	}

	read(id) {
		const session = this.#sessions.get(id);
		if (session === undefined) throw new Error("unknown Cursor login");
		return publicClone(session.view);
	}

	async cancel(id) {
		const session = this.#sessions.get(id);
		if (session === undefined) throw new Error("unknown Cursor login");
		if (!TERMINAL_PHASES.has(session.view.phase)) {
			session.view = { id, provider: PROVIDER, method: "browser", phase: "cancelled", authenticated: false };
			session.controller.abort(new Error("Cursor login cancelled"));
		}
		await Promise.resolve(session.run).catch(() => undefined);
		return this.read(id);
	}

	async logout(options) {
		if (this.#activeId !== undefined) {
			const active = this.#sessions.get(this.#activeId);
			if (active !== undefined && !TERMINAL_PHASES.has(active.view.phase)) await this.cancel(active.view.id);
		}
		await this.auth.logout(options);
		return this.accountStatus(options);
	}
}

const publicPrompt = (prompt) => ({
	type: prompt.type,
	message: String(prompt.message ?? ""),
	...typeof prompt.placeholder === "string" ? { placeholder: prompt.placeholder } : {},
});

/** Map the loopback-only DSH Connection channel onto the coordinator. */
export function createCursorRpcHandler(coordinator, options = {}) {
	const openExternal = options.openExternal;
	const usageReader = options.usageReader;
	const modelsProvider = options.modelsProvider;
	const publicError = (code, message) => ({ ok: false, error: { code, message, details: { issues: [] } } });
	return async (endpoint, payload, signal) => {
		try {
			signal.throwIfAborted();
			const input = asObject(payload);
			if (endpoint === "status") return ok(await coordinator.accountStatus({ signal }));
			if (endpoint === "usage") {
				try {
					return ok(await usageReader.read({ force: input.force === true, signal }));
				} catch (error) {
					const known = new Set(["Cursor subscription is not signed in", "Cursor sign-in needs to be renewed"]);
					const message = error instanceof Error && known.has(error.message)
						? error.message
						: "Could not read Cursor usage";
					return publicError("internal", message);
				}
			}
			if (endpoint === "models") {
				try {
					return ok({
						models: await modelsProvider.listModelsForRpc({ force: input.force === true, signal }),
						fetchedAt: Date.now(),
					});
				} catch (error) {
					return publicError("internal", error instanceof Error ? error.message : "Could not list Cursor models");
				}
			}
			if (endpoint === "login/start") {
				const started = await coordinator.start();
				if (input.openExternal !== true) return ok(started);
				const url = started.authUrl;
				if (typeof url !== "string" || openExternal === undefined) return ok({ ...started, externalOpened: false });
				try {
					await openExternal(url);
					return ok({ ...started, externalOpened: true });
				} catch {
					return ok({ ...started, externalOpened: false });
				}
			}
			if (endpoint === "login/status") return ok(coordinator.read(input.id));
			if (endpoint === "login/cancel") return ok(await coordinator.cancel(input.id));
			if (endpoint === "logout") {
				const result = await coordinator.logout({ signal });
				usageReader?.clear();
				return ok(result);
			}
			return badRequest(`unknown Cursor auth endpoint: ${endpoint}`);
		} catch (error) {
			if (signal.aborted) throw error;
			const message = error instanceof Error && /^(unknown|unsupported|a Cursor|Cursor login|Cursor auth URL)/.test(error.message)
				? error.message
				: "Cursor request failed";
			return badRequest(message);
		}
	};
}
//#endregion

//#region protobuf message builders (agent.v1 subset)
const textEncoder = new TextEncoder();

function bytesOf(value) {
	return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function encodeUserMessage({ text, messageId }) {
	const writer = new Writer();
	if (typeof text === "string" && text.length > 0) writer.string(1, text); // text
	if (typeof messageId === "string" && messageId.length > 0) writer.string(2, messageId); // message_id
	return writer.finish();
}

function encodeAssistantMessage(text) {
	return new Writer().string(1, text).finish(); // text
}

/** ConversationStep { assistant_message = 1 } */
function encodeAssistantStep(text) {
	const inner = encodeAssistantMessage(text);
	return new Writer().message(1, inner).finish();
}

/** AgentConversationTurnStructure { user_message = 1, steps = 2 } */
function encodeAgentTurn(userBytes, stepBytes) {
	const writer = new Writer();
	if (userBytes.length > 0) writer.bytes(1, userBytes);
	for (const step of stepBytes) writer.bytes(2, step);
	return writer.finish();
}

/** ConversationTurnStructure { agent_conversation_turn = 1 } */
function encodeTurnStructure(turnBytes) {
	return new Writer().message(1, turnBytes).finish();
}

/** ModelDetails { model_id = 1, display_model_id = 3, display_name = 4 } */
function encodeModelDetails(modelId) {
	const writer = new Writer();
	writer.string(1, modelId);
	writer.string(3, modelId);
	writer.string(4, modelId);
	return writer.finish();
}

/** ConversationAction { user_message_action = 1 } → UserMessageAction { user_message = 1 } */
function encodeUserMessageAction(userBytes) {
	const inner = new Writer().message(1, userBytes).finish(); // UserMessageAction
	return new Writer().message(1, inner).finish(); // ConversationAction
}

/** ConversationStateStructure — the durable conversation payload. */
function encodeConversationState({ rootPromptBlobIds, turns }) {
	const writer = new Writer();
	for (const id of rootPromptBlobIds) writer.bytes(1, id); // root_prompt_messages_json
	for (const turn of turns) writer.bytes(8, turn); // turns
	return writer.finish();
}

/** AgentRunRequest { conversation_state=1, action=2, model_details=3, conversation_id=5 } */
function encodeRunRequest({ conversationState, action, modelDetails, conversationId }) {
	const writer = new Writer();
	writer.message(1, conversationState);
	writer.message(2, action);
	writer.message(3, modelDetails);
	if (conversationId) writer.string(5, conversationId);
	return writer.finish();
}

/** AgentClientMessage { run_request = 1 } */
function encodeRunMessage(runRequestBytes) {
	return new Writer().message(1, runRequestBytes).finish();
}

/** AgentClientMessage { client_heartbeat = 7 } */
function encodeHeartbeat() {
	return new Writer().message(7, new Uint8Array(0)).finish();
}

/** KvClientMessage { id=1, get_blob_result=2 { blob_data=1 } } */
export function encodeGetBlobResult(id, blobData) {
	const inner = blobData === undefined ? new Uint8Array(0) : blobData;
	const result = new Writer().bytes(1, inner).finish(); // GetBlobResult
	const writer = new Writer();
	writer.varint(1, id);
	writer.message(2, result);
	return writer.finish();
}

/** AgentClientMessage { kv_client_message = 3 } */
export function encodeKvClientMessage(kvBytes) {
	return new Writer().message(3, kvBytes).finish();
}

/** KvClientMessage { id=1, set_blob_result=3 } — acknowledge a server blob write. */
export function encodeSetBlobResult(id) {
	const writer = new Writer();
	writer.varint(1, id);
	writer.message(3, new Uint8Array(0)); // set_blob_result (empty success)
	return writer.finish();
}

/** McpResult.success with one text content item. */
export function encodeMcpResult({ content, isError = false }) {
	return encodeMcpResultSuccess(String(content ?? ""), isError);
}

/** ExecClientMessage { id=1, exec_id=15, message=... } */
export function encodeExecClientMessage(id, execId, messageField, messageBytes) {
	const writer = new Writer();
	writer.varint(1, id);
	if (typeof execId === "string" && execId.length > 0) writer.string(15, execId);
	if (messageBytes !== undefined) writer.message(messageField, messageBytes);
	return writer.finish();
}

/** AgentClientMessage { exec_client_message = 2 } */
export function encodeExecClientMessageEnvelope(execBytes) {
	return new Writer().message(2, execBytes).finish();
}

/** RequestContextResult { success=1 { request_context=1 } } with tools. */
export function encodeRequestContextResult(tools) {
	const context = new Writer();
	for (const tool of tools) context.message(7, tool); // RequestContext.tools
	const success = new Writer().message(1, context.finish()).finish(); // RequestContextSuccess
	return new Writer().message(1, success).finish(); // RequestContextResult
}

/** McpToolDefinition { name=1, description=2, input_schema=3, provider_identifier=4, tool_name=5 } */
export function encodeMcpToolDefinition({ name, description, inputSchema, providerIdentifier, toolName }) {
	const writer = new Writer();
	writer.string(1, name);
	writer.string(2, description ?? "");
	writer.bytes(3, bytesOf(inputSchema));
	writer.string(4, providerIdentifier ?? "dsh-cursor-subscription");
	writer.string(5, toolName ?? name);
	return writer.finish();
}

/** McpTextContent { text = 1 } */
function encodeMcpTextContent(text) {
	return new Writer().string(1, text).finish();
}

/** McpToolResultContentItem { text = 1 } */
function encodeMcpToolResultContentItem(text) {
	return new Writer().message(1, encodeMcpTextContent(text)).finish();
}

/** McpSuccess { content=1, is_error=2 } */
function encodeMcpSuccess(text, isError) {
	const writer = new Writer();
	writer.message(1, encodeMcpToolResultContentItem(text));
	writer.varint(2, isError ? 1 : 0);
	return writer.finish();
}

/** McpResult { success=1 | error=2 } */
function encodeMcpResultSuccess(text, isError) {
	return new Writer().message(1, encodeMcpSuccess(text, isError)).finish();
}

function encodeMcpError(error) {
	return new Writer().message(2, new Writer().string(1, error).finish()).finish();
}

/** ReadResult { rejected=3 { path=1, reason=2 } } */
function encodeReadRejected(path, reason) {
	const rejected = new Writer().string(1, path ?? "").string(2, reason).finish();
	return new Writer().message(3, rejected).finish();
}

/** LsResult { rejected=3 { path=1, reason=2 } } */
function encodeLsRejected(path, reason) {
	const rejected = new Writer().string(1, path ?? "").string(2, reason).finish();
	return new Writer().message(3, rejected).finish();
}

/** GrepResult { error=2 { error=1 } } */
function encodeGrepError(error) {
	return new Writer().message(2, new Writer().string(1, error).finish()).finish();
}

/** WriteResult { rejected = 6 } (oneof: success=1, permission_denied=3, no_space=4, error=5, rejected=6) */
function encodeWriteRejected(path, reason) {
	const rejected = new Writer().string(1, path ?? "").string(2, reason).finish();
	return new Writer().message(6, rejected).finish();
}

/** DeleteResult { rejected = 6 } (oneof: success=1, file_not_found=2, not_file=3, permission_denied=4, file_busy=5, rejected=6) */
function encodeDeleteRejected(path, reason) {
	const rejected = new Writer().string(1, path ?? "").string(2, reason).finish();
	return new Writer().message(6, rejected).finish();
}

/** ShellRejected { command=1, working_directory=2, reason=3, is_readonly=4 } */
function encodeShellRejected(command, workingDirectory, reason) {
	const writer = new Writer();
	writer.string(1, command ?? "");
	writer.string(2, workingDirectory ?? "");
	writer.string(3, reason);
	writer.varint(4, 0);
	return writer.finish();
}

/** ShellResult { rejected = 4 } (oneof: success=1, failure=2, timeout=3, rejected=4) */
function encodeShellRejectedResult(command, workingDirectory, reason) {
	return new Writer().message(4, encodeShellRejected(command, workingDirectory, reason)).finish();
}

/**
 * ShellStream { rejected = 5 } — the reply type for `shellStreamArgs` execs
 * (streaming shell), carried by ExecClientMessage.shell_stream (field 14).
 */
function encodeShellStreamRejected(command, workingDirectory, reason) {
	return new Writer().message(5, encodeShellRejected(command, workingDirectory, reason)).finish();
}

/** BackgroundShellSpawnResult { rejected = 3 } (oneof: success=1, error=2, rejected=3, permission_denied=4) */
function encodeBackgroundShellRejectedResult(command, workingDirectory, reason) {
	return new Writer().message(3, encodeShellRejected(command, workingDirectory, reason)).finish();
}

/** FetchResult { error=2 { url=1, error=2 } } */
function encodeFetchError(url, error) {
	const inner = new Writer().string(1, url ?? "").string(2, error).finish();
	return new Writer().message(2, inner).finish();
}

/** WriteShellStdinResult { error=2 { error=1 } } */
function encodeWriteShellStdinError(error) {
	return new Writer().message(2, new Writer().string(1, error).finish()).finish();
}

/** DiagnosticsResult { success = 1 } — empty success keeps the exec well-formed. */
function encodeDiagnosticsResult() {
	return new Writer().message(1, new Uint8Array(0)).finish();
}
//#endregion

//#region protobuf message parsers (agent.v1 subset)
const decoder = new TextDecoder();

function readTag(reader) {
	if (reader.done) return undefined;
	const { field, wireType } = reader.tag();
	return { field, wireType };
}

/** AgentServerMessage { interaction_update=1, exec_server_message=2, kv_server_message=4, ... } */
export function decodeAgentServerMessage(bytes) {
	const reader = new Reader(bytes);
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (wireType !== 2) {
			reader.skip(wireType);
			continue;
		}
		const payload = reader.bytes();
		if (field === 1) return { case: "interactionUpdate", value: decodeInteractionUpdate(payload) };
		if (field === 2) return { case: "execServerMessage", value: decodeExecServerMessage(payload) };
		if (field === 3) return { case: "conversationCheckpointUpdate", value: payload };
		if (field === 4) return { case: "kvServerMessage", value: decodeKvServerMessage(payload) };
		// 5 = exec_server_control, 7 = interaction_query (ignored)
	}
	return { case: "unknown", value: undefined };
}

/** InteractionUpdate { text_delta=1, thinking_delta=4, token_delta=8, turn_ended=14, ... } */
export function decodeInteractionUpdate(bytes) {
	const reader = new Reader(bytes);
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (wireType !== 2) {
			reader.skip(wireType);
			continue;
		}
		const payload = reader.bytes();
		if (field === 1) return { type: "textDelta", text: decodeTextDelta(payload) }; // TextDeltaUpdate.text=1
		if (field === 4) return { type: "thinkingDelta", text: decodeTextDelta(payload) }; // ThinkingDeltaUpdate.text=1
		if (field === 8) return { type: "tokenDelta", tokens: decodeTokenDelta(payload) }; // TokenDeltaUpdate.tokens=1
		if (field === 14) return { type: "turnEnded" };
		if (field === 2) return { type: "toolCallStarted" };
		if (field === 3) return { type: "toolCallCompleted" };
		if (field === 7) return { type: "partialToolCall", ...decodePartialToolCall(payload) };
		if (field === 15) return { type: "toolCallDelta" };
		if (field === 13) return { type: "heartbeat" };
		// others (summary*, step_*, user_message_appended, shell_output_delta) ignored
	}
	return { type: "unknown" };
}

function decodeTextDelta(bytes) {
	const reader = new Reader(bytes);
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 2) return reader.string();
		reader.skip(wireType);
	}
	return "";
}

function decodeTokenDelta(bytes) {
	const reader = new Reader(bytes);
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 0) return reader.varint();
		reader.skip(wireType);
	}
	return 0;
}

/** PartialToolCallUpdate { call_id=1, args_text_delta=3 } */
function decodePartialToolCall(bytes) {
	const reader = new Reader(bytes);
	let callId = "";
	let argsTextDelta = "";
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 2) callId = reader.string();
		else if (field === 3 && wireType === 2) argsTextDelta = reader.string();
		else reader.skip(wireType);
	}
	return { callId, argsTextDelta };
}

/** KvServerMessage { id=1, get_blob_args=2 { blob_id=1 } | set_blob_args=3 { blob_id=1, blob_data=2 } } */
export function decodeKvServerMessage(bytes) {
	const reader = new Reader(bytes);
	let id = 0;
	let blobId;
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 0) id = reader.varint();
		else if (field === 2 && wireType === 2) blobId = decodeBlobId(reader.bytes());
		else if (field === 3 && wireType === 2) {
			return { id, case: "setBlobArgs", ...decodeSetBlobArgs(reader.bytes()) };
		} else reader.skip(wireType);
	}
	return blobId === undefined ? { id, case: "unknown" } : { id, case: "getBlobArgs", blobId };
}

/** SetBlobArgs { blob_id=1, blob_data=2 } */
function decodeSetBlobArgs(bytes) {
	const reader = new Reader(bytes);
	let blobId;
	let blobData;
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 2) blobId = reader.bytes();
		else if (field === 2 && wireType === 2) blobData = reader.bytes();
		else reader.skip(wireType);
	}
	return { blobId, blobData };
}

function decodeBlobId(bytes) {
	const reader = new Reader(bytes);
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 2) return reader.bytes();
		reader.skip(wireType);
	}
	return undefined;
}

/** ExecServerMessage { id=1, exec_id=15, request_context_args=10, mcp_args=11, ... } */
export function decodeExecServerMessage(bytes) {
	const reader = new Reader(bytes);
	let id = 0;
	let execId = "";
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 0) {
			id = reader.varint();
		} else if (field === 15 && wireType === 2) {
			execId = reader.string();
		} else if (wireType === 2) {
			const payload = reader.bytes();
			if (field === 10) return { id, execId, case: "requestContextArgs" };
			if (field === 11) return { id, execId, case: "mcpArgs", args: decodeMcpArgs(payload) };
			if (field === 2) return { id, execId, case: "shellArgs", path: decodeSinglePathArg(payload) };
			if (field === 3) return { id, execId, case: "writeArgs", path: decodeSinglePathArg(payload) };
			if (field === 4) return { id, execId, case: "deleteArgs", path: decodeSinglePathArg(payload) };
			if (field === 5) return { id, execId, case: "grepArgs" };
			if (field === 7) return { id, execId, case: "readArgs", path: decodeReadArgsPath(payload) };
			if (field === 8) return { id, execId, case: "lsArgs", path: decodeSinglePathArg(payload) };
			if (field === 9) return { id, execId, case: "diagnosticsArgs" };
			if (field === 14) return { id, execId, case: "shellStreamArgs", path: decodeSinglePathArg(payload) };
			if (field === 16) return { id, execId, case: "backgroundShellSpawnArgs" };
			if (field === 17) return { id, execId, case: "listMcpResourcesExecArgs" };
			if (field === 18) return { id, execId, case: "readMcpResourceExecArgs" };
			if (field === 20) return { id, execId, case: "fetchArgs", url: decodeFetchUrl(payload) };
			if (field === 21) return { id, execId, case: "recordScreenArgs" };
			if (field === 22) return { id, execId, case: "computerUseArgs" };
			if (field === 23) return { id, execId, case: "writeShellStdinArgs" };
		} else {
			reader.skip(wireType);
		}
	}
	return { id, execId, case: "unknown" };
}

function decodeSinglePathArg(bytes) {
	const reader = new Reader(bytes);
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 2) return reader.string();
		reader.skip(wireType);
	}
	return "";
}

function decodeReadArgsPath(bytes) {
	return decodeSinglePathArg(bytes);
}

function decodeFetchUrl(bytes) {
	const reader = new Reader(bytes);
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 2) return reader.string();
		reader.skip(wireType);
	}
	return "";
}

/** McpArgs { name=1, args=2 (map<string,bytes>), tool_call_id=3, provider_identifier=4, tool_name=5 } */
export function decodeMcpArgs(bytes) {
	const reader = new Reader(bytes);
	let name = "";
	let toolCallId = "";
	let providerIdentifier = "";
	let toolName = "";
	const args = {};
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 2) name = reader.string();
		else if (field === 2 && wireType === 2) {
			const entry = new Reader(reader.bytes());
			let key = "";
			let value;
			while (!entry.done) {
				const tag = entry.tag();
				if (tag.field === 1 && tag.wireType === 2) key = entry.string();
				else if (tag.field === 2 && tag.wireType === 2) value = entry.bytes();
				else entry.skip(tag.wireType);
			}
			if (key) args[key] = value;
		} else if (field === 3 && wireType === 2) toolCallId = reader.string();
		else if (field === 4 && wireType === 2) providerIdentifier = reader.string();
		else if (field === 5 && wireType === 2) toolName = reader.string();
		else reader.skip(wireType);
	}
	return { name, toolCallId, providerIdentifier, toolName, args };
}

/** GetUsableModelsResponse { models = 1: repeated ModelDetails } */
export function decodeUsableModels(bytes) {
	const reader = new Reader(bytes);
	const models = [];
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 2) {
			const model = decodeModelDetails(reader.bytes());
			if (model?.id) models.push(model);
		} else {
			reader.skip(wireType);
		}
	}
	return models;
}

/** ModelDetails { model_id=1, display_model_id=3, display_name=4, display_name_short=5, aliases=6 } */
function decodeModelDetails(bytes) {
	const reader = new Reader(bytes);
	const model = { id: "", name: "" };
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (wireType === 2) {
			if (field === 1) model.id = reader.string();
			else if (field === 3) model.displayModelId = reader.string();
			else if (field === 4) model.name = reader.string();
			else if (field === 5) model.displayNameShort = reader.string();
			else if (field === 6) reader.bytes(); // aliases
			else reader.bytes();
		} else {
			reader.skip(wireType);
		}
	}
	return model;
}
//#endregion

//#region Connect framing
/** Connect frame: [1-byte flags][4-byte big-endian length][payload]. */
export function frameEncode(payload, flags = 0) {
	const out = new Uint8Array(5 + payload.length);
	const view = new DataView(out.buffer);
	view.setUint8(0, flags);
	view.setUint32(1, payload.length, false);
	out.set(payload, 5);
	return out;
}

export const CONNECT_END_STREAM_FLAG = 0b00000010;
export const CONNECT_COMPRESSED_FLAG = 0b00000001;

/** Upper bound for a decompressed Connect frame; guards against zip bombs. */
export const MAX_CONNECT_FRAME_BYTES = 64 * 1024 * 1024;

/**
 * Incremental Connect frame parser fed by response chunks.
 * Yields { flags, payload } objects. Frames flagged compressed (bit 0) are
 * gzip-decompressed here so consumers only ever see plain payloads.
 */
export class ConnectFrameReader {
	constructor() {
		this.buffer = new Uint8Array(0);
		this.frames = [];
		this.waiters = [];
		this.ended = false;
		this.error = undefined;
	}

	push(chunk) {
		const combined = new Uint8Array(this.buffer.length + chunk.length);
		combined.set(this.buffer);
		combined.set(chunk, this.buffer.length);
		this.buffer = combined;
		while (this.buffer.length >= 5) {
			const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, 5);
			const flags = view.getUint8(0);
			const length = view.getUint32(1, false);
			if (this.buffer.length < 5 + length) break;
			const payload = this.buffer.slice(5, 5 + length);
			this.buffer = this.buffer.slice(5 + length);
			let data = payload;
			if ((flags & CONNECT_COMPRESSED_FLAG) !== 0) {
				try {
					data = gunzipSync(Buffer.from(payload), { maxOutputLength: MAX_CONNECT_FRAME_BYTES });
				} catch (error) {
					this.fail(new Error("Cursor sent an unreadable compressed frame", { cause: error }));
					return;
				}
			}
			this.#enqueue({ flags: flags & ~CONNECT_COMPRESSED_FLAG, payload: data });
		}
	}

	#enqueue(frame) {
		if (this.waiters.length > 0) {
			const waiter = this.waiters.shift();
			waiter.resolve(frame);
			return;
		}
		this.frames.push(frame);
	}

	finish() {
		this.ended = true;
		for (const waiter of this.waiters.splice(0)) waiter.resolve(undefined);
	}

	fail(error) {
		this.error = error;
		this.ended = true;
		for (const waiter of this.waiters.splice(0)) waiter.reject(error);
	}

	async next() {
		if (this.frames.length > 0) return this.frames.shift();
		if (this.ended) {
			if (this.error !== undefined) throw this.error;
			return undefined;
		}
		return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
	}
}
//#endregion

//#region agent transport
const AGENT_HEADERS = {
	"content-type": "application/connect+proto",
	"connect-protocol-version": "1",
	"connect-accept-encoding": "gzip",
	te: "trailers",
	"x-ghost-mode": "true",
	"x-cursor-client-version": CURSOR_CLIENT_VERSION,
	"x-cursor-client-type": "cli",
};

/**
 * One bidirectional agent run over HTTP/2. Writes Connect-framed
 * `AgentClientMessage`s and surfaces `AgentServerMessage`s through the frame
 * reader. Heartbeats keep the run alive.
 */
export class AgentRun {	constructor(accessToken, options = {}) {
		this.accessToken = accessToken;
		this.baseUrl = options.baseUrl ?? CURSOR_BASE_URL;
		this.session = http2.connect(this.baseUrl);
		this.frames = new ConnectFrameReader();
		this.responseStatus = undefined;
		this.trailers = {};
		this.finished = false;
	}

	async start() {
		const url = new URL(CURSOR_RUN_PATH, this.baseUrl);
		const headers = {
			":method": "POST",
			":path": url.pathname,
			authorization: `Bearer ${this.accessToken}`,
			...AGENT_HEADERS,
		};
		this.stream = this.session.request(headers);
		// NOTE: never call stream.setEncoding() here — Node's setEncoding(null)
		// still decodes binary frames as UTF-8, corrupting any non-UTF-8 byte
		// (e.g. blob ids) into U+FFFD replacement characters.
		this.stream.on("response", (headers) => {
			this.responseStatus = headers[":status"];
		});
		this.stream.on("data", (chunk) => this.frames.push(Buffer.from(chunk)));
		this.stream.on("trailers", (trailers) => {
			this.trailers = trailers;
		});
		this.stream.on("end", () => this.frames.finish());
		this.stream.on("error", (error) => this.frames.fail(error));
		this.session.on("error", (error) => this.frames.fail(error));
	}

	write(payload) {
		if (this.finished || this.stream === undefined || this.stream.destroyed) return false;
		try {
			this.stream.write(Buffer.from(payload));
			return true;
		} catch {
			return false;
		}
	}

	writeMessage(bytes) {
		return this.write(frameEncode(bytes));
	}

	startHeartbeat() {
		this.heartbeat = setInterval(() => {
			this.writeMessage(encodeHeartbeat());
		}, HEARTBEAT_INTERVAL_MS);
		this.heartbeat.unref?.();
	}

	/** Fail the run with a terminal error and tear down the connection. */
	abort(error) {
		if (this.finished) return;
		this.frames.fail(error);
		this.close();
	}

	close() {
		if (this.finished) return;
		this.finished = true;
		if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
		if (!this.frames.ended) this.frames.finish();
		try {
			this.stream?.close();
		} catch {}
		// Force-destroy the session so no socket keeps the process alive after a
		// completed run; the agent response is fully consumed by then.
		try {
			this.session.destroy();
		} catch {}
	}
}
//#endregion

//#region conversation building
function sha256(bytes) {
	return createHash("sha256").update(bytes).digest();
}

function flattenBlocks(content) {
	let text = "";
	for (const block of content ?? []) {
		if (block.type === "text") text += block.text;
		else if (block.type === "tool-result") {
			const callId = block.toolCallId ? ` for ${block.toolCallId}` : "";
			text += `\n[TOOL RESULT${callId}]\n${flattenBlocks(block.content)}`;
		}
	}
	return text;
}

function renderAssistant(content) {
	let text = "";
	for (const block of content ?? []) {
		if (block.type === "text") text += block.text;
		else if (block.type === "tool-call") {
			text += `\n<tool_call id="${block.id}" name="${block.name}">${block.arguments}</tool_call>`;
		} else if (block.type === "reasoning") {
			text += `\n<thinking>${block.text}</thinking>`;
		}
	}
	return text.trim();
}

function sanitizeReplayedAssistantText(text) {
	let omitted = false;
	const sanitized = String(text ?? "").replace(/<tool_call\b[\s\S]*?<\/tool_call>/gi, () => {
		omitted = true;
		return "";
	}).replace(/<\/?invoke>|<\|eos\|>/gi, "").trim();
	if (!omitted) return sanitized;
	return `${sanitized}${sanitized ? "\n" : ""}[Previous textual tool-call markup omitted from replay.]`;
}

/** Replay assistant history without teaching models to imitate XML tool tags. */
function renderColdStartAssistant(content) {
	const parts = [];
	for (const block of content ?? []) {
		if (block.type === "text") {
			const text = sanitizeReplayedAssistantText(block.text);
			if (text) parts.push(text);
		} else if (block.type === "tool-call") {
			parts.push(`[Previous tool request: ${block.name}]`);
		}
	}
	return parts.join("\n").trim();
}

function actionBoundary(messages) {
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index].role === "assistant") return index + 1;
	}
	return 0;
}

/** Combine the current DSH turn's adjacent user/context messages into one action. */
function currentActionText(options) {
	const messages = options.messages ?? [];
	const boundary = actionBoundary(messages);
	const parts = [];
	for (let index = boundary; index < messages.length; index++) {
		const message = messages[index];
		if (message.role !== "user") continue;
		const text = flattenBlocks(message.content).trim();
		if (text.length > 0) parts.push(text);
	}
	if (parts.length > 0) return parts.join("\n\n");
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index].role !== "user") continue;
		const text = flattenBlocks(messages[index].content).trim();
		if (text.length > 0) return text;
	}
	return "";
}

/** Extract DSH tool-result blocks for resuming a live Cursor exec bridge. */
function collectToolResults(options) {
	const results = [];
	for (const message of options.messages ?? []) {
		for (const block of message.content ?? []) {
			if (block.type !== "tool-result") continue;
			results.push({
				toolCallId: block.toolCallId ?? message.source?.callId,
				content: flattenBlocks(block.content).trim(),
				isError: block.isError === true,
			});
		}
	}
	return results;
}

function decodeXmlText(value) {
	return String(value ?? "")
		.replace(/&quot;/gi, '"')
		.replace(/&apos;/gi, "'")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&amp;/gi, "&");
}

function parseTagAttributes(source) {
	const attributes = {};
	const pattern = /([A-Za-z_][\w-]*)\s*=\s*"([\s\S]*?)"/g;
	for (let match; (match = pattern.exec(source)) !== null;) attributes[match[1]] = decodeXmlText(match[2]);
	return attributes;
}

function resolveTextTool(candidate, tools) {
	const available = tools ?? [];
	const normalized = String(candidate ?? "").toLowerCase();
	let tool = available.find((entry) => {
		const name = String(entry.name).toLowerCase();
		return normalized === name || normalized.endsWith(`_${name}`);
	});
	if (tool !== undefined) return tool;
	const aliases = {
		shell: ["pwsh", "bash"],
		read: ["read"],
		glob: ["glob"],
		grep: ["grep"],
		write: ["write"],
		edit: ["edit"],
	};
	for (const name of aliases[normalized] ?? []) {
		tool = available.find((entry) => String(entry.name).toLowerCase() === name);
		if (tool !== undefined) return tool;
	}
	return undefined;
}

function normalizeTextToolArguments(tool, raw) {
	const args = { ...raw };
	if (tool.name === "read" && args.file_path === undefined && args.path !== undefined) {
		args.file_path = args.path;
		delete args.path;
	}
	if (tool.name === "glob") {
		if (args.pattern === undefined && args.glob_pattern !== undefined) args.pattern = args.glob_pattern;
		if (args.path === undefined && args.target_directory !== undefined) args.path = args.target_directory;
		delete args.glob_pattern;
		delete args.target_directory;
	}
	for (const [key, value] of Object.entries(args)) {
		const type = tool.parameters?.properties?.[key]?.type;
		if ((type === "number" || type === "integer") && typeof value === "string" && value.trim() !== "") {
			const number = Number(value);
			if (Number.isFinite(number)) args[key] = number;
		} else if (type === "boolean" && typeof value === "string") {
			if (value.toLowerCase() === "true") args[key] = true;
			else if (value.toLowerCase() === "false") args[key] = false;
		} else if ((type === "object" || type === "array") && typeof value === "string") {
			try { args[key] = JSON.parse(value); } catch {}
		}
	}
	return args;
}

/**
 * Recover Cursor models that print tool-call XML as text instead of emitting
 * an execServerMessage.mcpArgs frame. This is a fallback for contaminated or
 * compacted conversations; protocol-native MCP calls remain the primary path.
 */
export function parseTextToolCalls(text, tools) {
	const calls = [];
	const pattern = /<tool_call\b([^>]*)>([\s\S]*?)<\/tool_call>/gi;
	for (let match; (match = pattern.exec(String(text ?? ""))) !== null;) {
		const attributes = parseTagAttributes(match[1]);
		const tool = resolveTextTool(attributes.name ?? attributes.id, tools);
		if (tool === undefined) continue;
		const rawArgs = {};
		const parameterPattern = /<parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/parameter>/gi;
		for (let parameter; (parameter = parameterPattern.exec(match[2])) !== null;) {
			rawArgs[parameter[1]] = decodeXmlText(parameter[2].trim());
		}
		for (const [key, value] of Object.entries(attributes)) {
			if (key !== "id" && key !== "name") rawArgs[key] = value;
		}
		if (Object.keys(rawArgs).length === 0) {
			const body = decodeXmlText(match[2]).trim();
			if (body.startsWith("{")) {
				try { Object.assign(rawArgs, JSON.parse(body)); } catch {}
			}
		}
		calls.push({
			id: `text-tool-${crypto.randomUUID()}`,
			name: tool.name,
			arguments: JSON.stringify(normalizeTextToolArguments(tool, rawArgs)),
		});
	}
	return calls;
}

function coldStartLabel(message) {
	if (message.role === "assistant") return "ASSISTANT";
	if ((message.content ?? []).some((block) => block.type === "tool-result")) return "TOOL RESULT";
	if (message.source?.kind === "plugin") return "RUNTIME CONTEXT";
	return "USER";
}

/**
 * Rehydrate a DSH conversation after process restart without using Cursor's
 * field-8 turns (the current server interprets those entries as blob ids).
 */
function coldStartActionText(options) {
	const entries = [];
	for (const message of options.messages ?? []) {
		if (message.role === "system") continue;
		const text = message.role === "assistant" ? renderColdStartAssistant(message.content) : flattenBlocks(message.content).trim();
		if (text.length === 0) continue;
		entries.push({ label: coldStartLabel(message), text });
	}
	if (entries.length === 0) return "";
	if (entries.length === 1 && entries[0].label === "USER") return entries[0].text;
	return [
		"Continue the DSH conversation below. Treat entries according to their labels. Respond to the final USER request; RUNTIME CONTEXT and TOOL RESULT entries provide context only.",
		...entries.map((entry) => `[${entry.label}]\n${entry.text}`),
	].join("\n\n");
}

/**
 * Build a fresh state with root prompt blobs only. Current Cursor servers reject
 * hand-encoded field-8 turns, so cold starts carry textual history in the action.
 */
export function buildInitialConversationState(options) {
	const systemParts = [options.system ?? ""];
	for (const message of options.messages ?? []) {
		if (message.role === "system") systemParts.push(flattenBlocks(message.content));
	}
	const systemText = systemParts.filter((part) => part.length > 0).join("\n").trim();
	const blobStore = new Map();
	const rootPromptBlobIds = [];
	if (systemText.length > 0) {
		const payload = textEncoder.encode(JSON.stringify({ role: "system", content: systemText }));
		const id = sha256(payload);
		blobStore.set(Buffer.from(id).toString("hex"), payload);
		rootPromptBlobIds.push(id);
	}
	return {
		conversationState: encodeConversationState({ rootPromptBlobIds, turns: [], systemText }),
		blobStore,
		systemText,
	};
}

/**
 * Fold DSH history into Cursor's turn-based conversation state.
 *
 * The last user message becomes the new `ConversationAction`; everything
 * before it is the durable turn history. Tool results are rendered as user
 * messages so a follow-up run after DSH executes a tool carries the result
 * back to the model. The system prompt travels as a blob referenced by
 * `rootPromptMessagesJson`; the server fetches it through the KV handshake.
 */
export function buildConversationState(options) {
	const systemParts = [options.system ?? ""];
	const turns = [];
	let currentUser = null;
	let currentSteps = [];

	const flushTurn = () => {
		if (currentUser !== null) {
			const userBytes = encodeUserMessage({ text: currentUser, messageId: randomUUID() });
			const turnBytes = encodeAgentTurn(userBytes, currentSteps);
			turns.push(encodeTurnStructure(turnBytes));
		}
		currentUser = null;
		currentSteps = [];
	};

	for (const message of options.messages ?? []) {
		if (message.role === "system") {
			systemParts.push(flattenBlocks(message.content));
			continue;
		}
		if (message.role === "user") {
			flushTurn();
			currentUser = flattenBlocks(message.content);
			continue;
		}
		if (message.role === "assistant") {
			const text = renderAssistant(message.content);
			if (currentUser === null) currentUser = ""; // assistant-first history: implicit turn
			if (text.length > 0) currentSteps.push(encodeAssistantStep(text));
		}
	}

	// The final pending user message is the action, not part of history.
	let actionText = "";
	if (currentUser !== null) {
		actionText = currentUser;
	}
	currentUser = null;
	currentSteps = [];

	const systemText = systemParts.filter((part) => part.length > 0).join("\n").trim();
	const blobStore = new Map();
	const rootPromptBlobIds = [];
	if (systemText.length > 0) {
		const payload = textEncoder.encode(JSON.stringify({ role: "system", content: systemText }));
		const id = sha256(payload);
		blobStore.set(Buffer.from(id).toString("hex"), payload);
		rootPromptBlobIds.push(id);
	}

	const conversationState = encodeConversationState({ rootPromptBlobIds, turns, systemText });
	const userBytes = encodeUserMessage({ text: actionText, messageId: randomUUID() });
	const action = encodeUserMessageAction(userBytes);
	return { conversationState, action, blobStore, systemText };
}

/**
 * Build the full `AgentClientMessage` payload for one run.
 *
 * When a persisted checkpoint for this conversation exists (captured from a
 * previous run's `conversation_checkpoint_update`), it becomes the
 * conversation state and its referenced blobs are served from the persisted
 * blob store. Otherwise the state is built from the DSH message history.
 */
export function buildRunPayload(options, modelId, persisted) {
	let conversationState;
	let blobStore;
	let actionText;
	if (persisted?.checkpoint !== undefined) {
		// The checkpoint already encodes prior turns. DSH may append both the
		// human request and a runtime-context user message, so combine the whole
		// trailing user group rather than selecting only the final message.
		conversationState = persisted.checkpoint;
		blobStore = persisted.blobs ?? new Map();
		actionText = currentActionText(options);
	} else {
		// On first use or after a DSH restart there is no server checkpoint. Never
		// hand-encode field-8 turns: current Cursor servers treat them as blob ids.
		const built = buildInitialConversationState(options);
		conversationState = built.conversationState;
		blobStore = built.blobStore;
		actionText = coldStartActionText(options);
	}
	const userBytes = encodeUserMessage({ text: actionText, messageId: randomUUID() });
	const action = encodeUserMessageAction(userBytes);
	const modelDetails = encodeModelDetails(modelId);
	const runRequest = encodeRunRequest({
		conversationState,
		action,
		modelDetails,
		conversationId: randomUUID(),
	});
	return { payload: encodeRunMessage(runRequest), blobStore };
}

//#endregion

//#region models discovery
/**
 * Fetch usable models from Cursor's unary `GetUsableModels` endpoint.
 * The request body is the raw (unframed) empty protobuf message.
 */
export async function fetchUsableModels(accessToken, options = {}) {
	const fetchImpl = options.fetch ?? fetch;
	const response = await fetchImpl(`${CURSOR_BASE_URL}${CURSOR_MODELS_PATH}`, {
		method: "POST",
		redirect: "error",
		headers: {
			"content-type": "application/proto",
			authorization: `Bearer ${accessToken}`,
			"x-ghost-mode": "true",
			"x-cursor-client-version": CURSOR_CLIENT_VERSION,
			"x-cursor-client-type": "cli",
			"user-agent": "dsh-cursor-subscription/0.1.0",
		},
		body: new Uint8Array(0),
		signal: options.signal,
	});
	if (!response.ok) throw new Error(`Cursor model discovery failed (HTTP ${response.status})`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.length === 0) throw new Error("Cursor model discovery returned an empty response");
	// The body may be raw protobuf or Connect-framed; try both.
	const models = decodeUsableModels(bytes);
	if (models.length > 0) return models;
	const frameReader = new ConnectFrameReader();
	frameReader.push(bytes);
	frameReader.finish();
	const framed = [];
	for (;;) {
		const frame = await frameReader.next();
		if (frame === undefined) break;
		if ((frame.flags & CONNECT_END_STREAM_FLAG) !== 0) break;
		framed.push(...decodeUsableModels(frame.payload));
	}
	return framed;
}
//#endregion

//#region usage
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Extract the legacy request bucket from the `/api/usage` model map. Cursor's
 * dashboard hardcodes the `"gpt-4"` entry for the legacy quota; when absent we
 * fall back to the quota-bearing bucket with the largest limit.
 */
export function parseLegacyBucket(json) {
	if (!record(json)) return undefined;
	const gpt4 = json["gpt-4"];
	if (record(gpt4) && typeof gpt4.numRequests === "number") {
		return { numRequests: gpt4.numRequests, maxRequestUsage: gpt4.maxRequestUsage };
	}
	let best;
	let bestLimit = 0;
	for (const value of Object.values(json)) {
		if (record(value) && typeof value.numRequests === "number") {
			const limit = typeof value.maxRequestUsage === "number" ? value.maxRequestUsage : 0;
			if (limit > bestLimit) {
				bestLimit = limit;
				best = { numRequests: value.numRequests, maxRequestUsage: value.maxRequestUsage };
			}
		}
	}
	return best;
}

/** Cursor converts included on-plan spend (cents) to requests at ~4 cents each. */
export function getRequestCountFromSpendCents(cents) {
	return typeof cents === "number" && cents > 0 ? Math.ceil(cents / 4) : 0;
}

/**
 * Compute included-request usage the way Cursor's dashboard does:
 * `used = team ? ceil(spendCents/4) : legacy.numRequests`,
 * `limit = team ? 500 * requestQuotaPerSeat : legacy.maxRequestUsage`.
 */
export function computeIncludedRequests({ legacy, isTeam, planUsedCents, requestQuotaPerSeat }) {
	const usedFromSpend =
		typeof planUsedCents === "number" && planUsedCents > 0 ? getRequestCountFromSpendCents(planUsedCents) : undefined;
	const used = isTeam ? usedFromSpend ?? legacy?.numRequests : legacy?.numRequests;
	const limit = isTeam && typeof requestQuotaPerSeat === "number" ? 500 * requestQuotaPerSeat : legacy?.maxRequestUsage;
	if (typeof used !== "number" || typeof limit !== "number" || limit <= 0) return undefined;
	return {
		used,
		limit,
		remaining: Math.max(0, limit - used),
		pct: Math.round((used / limit) * 1000) / 10,
	};
}

function centsToDollars(cents) {
	return typeof cents === "number" && Number.isFinite(cents) ? Math.round((cents / 100) * 100) / 100 : undefined;
}

/** Project `/api/usage-summary` into browser-safe usage facts. */
export function parseUsageSummary(json) {
	if (!record(json)) return {};
	const out = {};
	if (typeof json.membershipType === "string") out.membershipType = json.membershipType;
	if (typeof json.isUnlimited === "boolean") out.isUnlimited = json.isUnlimited;
	if (typeof json.billingCycleStart === "string") out.billingCycleStart = json.billingCycleStart;
	if (typeof json.billingCycleEnd === "string") out.billingCycleEnd = json.billingCycleEnd;
	if (json.limitType === "team") out.isTeam = true;
	const plan = json.individualUsage?.plan;
	if (record(plan)) {
		if (typeof plan.used === "number") out.planUsedCents = plan.used;
		if (typeof plan.limit === "number") out.planLimitCents = plan.limit;
		if (typeof plan.totalPercentUsed === "number") out.totalPercentUsed = plan.totalPercentUsed;
		if (typeof plan.autoPercentUsed === "number") out.autoPercentUsed = plan.autoPercentUsed;
	}
	const onDemand = json.individualUsage?.onDemand;
	if (record(onDemand)) {
		const usedDollars = centsToDollars(onDemand.used);
		const limitDollars = centsToDollars(onDemand.limit);
		const remainingDollars = centsToDollars(onDemand.remaining);
		if (usedDollars !== undefined || limitDollars !== undefined) {
			out.individualOnDemand = {
				...usedDollars === undefined ? {} : { usedDollars },
				...limitDollars === undefined ? {} : { limitDollars },
				...remainingDollars === undefined ? {} : { remainingDollars },
			};
		}
	}
	const teamOnDemand = json.teamUsage?.onDemand;
	if (record(teamOnDemand)) {
		const usedDollars = centsToDollars(teamOnDemand.used);
		const limitDollars = centsToDollars(teamOnDemand.limit);
		const remainingDollars = centsToDollars(teamOnDemand.remaining);
		if (usedDollars !== undefined || limitDollars !== undefined) {
			out.teamOnDemand = {
				...usedDollars === undefined ? {} : { usedDollars },
				...limitDollars === undefined ? {} : { limitDollars },
				...remainingDollars === undefined ? {} : { remainingDollars },
			};
		}
	}
	return out;
}

/** Pull `requestQuotaPerSeat` for the active team from `/api/dashboard/teams`. */
export function parseRequestQuotaPerSeat(json, teamId) {
	if (!record(json) || !Array.isArray(json.teams)) return undefined;
	const match = (teamId ? json.teams.find((t) => String(t?.id) === String(teamId)) : undefined) ?? json.teams[0];
	const quota = match?.requestQuotaPerSeat ?? match?.request_quota_per_seat;
	return typeof quota === "number" && Number.isFinite(quota) ? quota : undefined;
}

function usageDaysLeft(billingCycleEnd, now) {
	const end = new Date(billingCycleEnd).getTime();
	if (!Number.isFinite(end)) return undefined;
	return Math.max(0, Math.ceil((end - now) / (24 * 60 * 60 * 1000)));
}

/**
 * Read usage from Cursor's dashboard endpoints using the same session cookie
 * the web dashboard sends. The browser receives only the parsed projection;
 * the access token and cookie are request-local host values. Concurrent polls
 * share one in-flight request; successful reads are cached for a short TTL.
 */
export class CursorUsageReader {
	constructor(auth, options = {}) {
		this.auth = auth;
		this.fetch = options.fetch ?? fetch;
		this.now = options.now ?? Date.now;
		this.ttlMs = options.ttlMs ?? USAGE_TTL_MS;
		this.logger = options.logger;
		this.#cache = { at: 0, value: undefined };
	}

	#cache;

	#log(level, message, ...args) {
		try {
			this.logger?.[level]?.(`cursor-subscription: ${message}`, ...args);
		} catch {}
	}

	async #request(url, cookie, options = {}) {
		const response = await this.fetch(url, {
			method: options.method ?? "GET",
			redirect: "error",
			headers: {
				accept: "application/json",
				origin: USAGE_API_ORIGIN,
				referer: "https://cursor.com/dashboard",
				cookie,
				"user-agent": "dsh-cursor-subscription/0.2.0",
				...(options.body === undefined ? {} : { "content-type": "application/json" }),
			},
			...options.body === undefined ? {} : { body: JSON.stringify(options.body) },
			signal: options.signal,
		});
		if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
		const text = await response.text();
		try {
			return JSON.parse(text);
		} catch (error) {
			throw new Error(`unreadable JSON from ${url}`, { cause: error });
		}
	}

	async read({ force = false, signal } = {}) {
		const now = this.now();
		if (!force && this.#cache.value !== undefined && now - this.#cache.at < this.ttlMs) {
			return structuredClone(this.#cache.value);
		}
		const credential = await this.auth.credential({ signal });
		const userSub = getTokenSub(credential.access);
		if (userSub === undefined) throw new Error("Cursor session token has no usable user identity");
		const cookie = `WorkosCursorSessionToken=${userSub}::${credential.access}`;

		const usage = await this.#request(`${USAGE_URL}?user=${encodeURIComponent(userSub)}`, cookie, { signal });
		const summary = await this.#request(USAGE_SUMMARY_URL, cookie, { signal });
		const teams = await this.#request(USAGE_TEAMS_URL, cookie, { method: "POST", body: { activeOnly: false }, signal });

		const legacy = parseLegacyBucket(usage);
		const parsed = parseUsageSummary(summary);
		const requestQuotaPerSeat = parseRequestQuotaPerSeat(teams);
		const includedRequests =
			computeIncludedRequests({
				legacy,
				isTeam: parsed.isTeam === true,
				planUsedCents: parsed.planUsedCents,
				requestQuotaPerSeat,
			}) ?? (legacy !== undefined ? computeIncludedRequests({ legacy, isTeam: false }) : undefined);

		const value = {
			fetchedAt: now,
			membershipType: parsed.membershipType,
			isUnlimited: parsed.isUnlimited,
			isTeam: parsed.isTeam,
			billingCycle: parsed.billingCycleEnd === undefined ? undefined : {
				start: parsed.billingCycleStart,
				end: parsed.billingCycleEnd,
				daysLeft: usageDaysLeft(parsed.billingCycleEnd, now),
			},
			plan: parsed.totalPercentUsed === undefined && parsed.autoPercentUsed === undefined ? undefined : {
				...parsed.totalPercentUsed === undefined ? {} : { totalPercentUsed: parsed.totalPercentUsed },
				...parsed.autoPercentUsed === undefined ? {} : { autoPercentUsed: parsed.autoPercentUsed },
			},
			includedRequests,
			individualOnDemand: parsed.individualOnDemand,
			teamOnDemand: parsed.teamOnDemand,
		};
		this.#cache = { at: now, value };
		this.#log("info", "usage read: %s", JSON.stringify({ membershipType: value.membershipType, includedRequests: value.includedRequests }));
		return structuredClone(value);
	}

	clear() {
		this.#cache = { at: 0, value: undefined };
	}
}
//#endregion

//#region adapter
const TOOL_REJECT_REASON =
	"Tool not available in this environment. Use the MCP tools provided instead.";

/** Block indices are fixed per type so the assembler keeps blocks distinct. */
const TEXT_BLOCK_INDEX = 0;
const REASONING_BLOCK_INDEX = 1;
const TOOL_BLOCK_INDEX = 2;

/**
 * DSH `LlmAdapter` for the Cursor subscription. Normal turns use Cursor
 * checkpoints; MCP tool calls keep their HTTP/2 Run alive across DSH steps so
 * the following tool-result can resume the exact pending exec with mcpResult.
 */
export class CursorAdapter extends LlmAdapter {
	constructor(options) {
		super();
		this.auth = options.auth;
		this.fetchModels = options.fetchModels ?? fetchUsableModels;
		this.fallbackModels = options.fallbackModels ?? FALLBACK_MODELS;
		this.idleTimeoutMs = options.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;
		this.modelsCacheTtlMs = options.modelsCacheTtlMs ?? 5 * 60 * 1000;
		this.sessionStateTtlMs = options.sessionStateTtlMs ?? SESSION_STATE_TTL_MS;
		this.maxToolRounds = options.maxToolRounds ?? MAX_TOOL_ROUNDS;
		this.now = options.now ?? Date.now;
		this.#modelsCache = { at: 0, models: undefined };
	}

	#modelsCache;
	/** Persisted conversation checkpoints + referenced blobs per DSH session id. */
	#sessions = new Map();

	#evictStaleSessions() {
		const now = this.now();
		for (const [key, state] of this.#sessions) {
			if (now - (state.lastAccessMs ?? now) <= this.sessionStateTtlMs) continue;
			state.bridge?.run.close();
			this.#sessions.delete(key);
		}
	}

	async #discoverModels(force = false) {
		const now = this.now();
		if (!force && this.#modelsCache.models !== undefined && now - this.#modelsCache.at < this.modelsCacheTtlMs) {
			return this.#modelsCache.models;
		}
		let models;
		try {
			const access = await this.auth.accessToken();
			models = await this.fetchModels(access);
		} catch {
			models = [];
		}
		const source = models.length > 0 ? models : this.fallbackModels;
		const result = source.map((model) => ({
			id: model.id,
			name: model.name || model.id,
			inputModalities: ["text"],
		}));
		this.#modelsCache = { at: now, models: result };
		return result;
	}

	providerInfo(provider) {
		return { id: provider, name: "Cursor subscription" };
	}

	async listModels(provider) {
		const models = await this.#discoverModels();
		return models.map((model) => ({ provider, ...model }));
	}

	/** RPC-facing model listing; `force` bypasses the discovery cache. */
	async listModelsForRpc({ force = false, signal } = {}) {
		const models = await this.#discoverModels(force);
		if (signal?.aborted) throw new LlmError("Cursor model listing aborted", "ABORTED");
		return models;
	}

	async resolveModel(provider, model, _signal) {
		let name = model;
		try {
			const models = await this.#discoverModels();
			const found = models.find((entry) => entry.id === model);
			if (found !== undefined) name = found.name;
		} catch {}
		return {
			provider,
			id: model,
			name,
			inputModalities: ["text"],
			context: { contextWindow: DEFAULT_CONTEXT_WINDOW },
			defaultMaxTokens: DEFAULT_MAX_TOKENS,
		};
	}

	async *stream(options) {
		const consumer = new AbortController();
		const upstream = options.signal === undefined ? consumer.signal : AbortSignal.any([options.signal, consumer.signal]);
		let run;
		let abortRun;
		let bridgeStored = false;
		// Persisted conversation state per session: the server's checkpoint,
		// referenced blobs, and (while an MCP tool runs) the live HTTP/2 bridge.
		const sessionKey = options.sessionId === undefined ? undefined : String(options.sessionId);
		this.#evictStaleSessions();
		const prior = sessionKey === undefined ? undefined : this.#sessions.get(sessionKey);
		const persisted = {
			checkpoint: prior?.checkpoint === undefined ? undefined : Uint8Array.from(prior.checkpoint),
			blobs: new Map(prior?.blobs ?? []),
		};
		try {
			if (options.stop !== undefined) throw new LlmError("cursor-subscription does not support GenerateOptions.stop", "UNSUPPORTED_OPTION");
			const mcpTools = (options.tools ?? []).map((tool) =>
				encodeMcpToolDefinition({
					name: tool.name,
					description: tool.description,
					inputSchema: encodeValue(tool.parameters ?? {}),
				}),
			);
			const toolResults = collectToolResults(options);
			const liveBridge = prior?.bridge;
			const canResume = liveBridge !== undefined && !liveBridge.run.finished && !liveBridge.run.stream?.destroyed && toolResults.length > 0;
			let toolRoundCount = canResume ? (liveBridge.toolRoundCount ?? 0) : 0;
			let blobStore;
			if (canResume) {
				run = liveBridge.run;
				blobStore = persisted.blobs;
				abortRun = () => run.abort(new Error("Cursor request aborted by caller"));
				upstream.addEventListener("abort", abortRun, { once: true });
				for (const pending of liveBridge.pendingExecs) {
					const result = toolResults.find((entry) => entry.toolCallId === pending.toolCallId);
					const payload = result === undefined
						? encodeMcpError("Tool result not provided")
						: encodeMcpResult(result);
					if (!run.writeMessage(encodeExecClientMessageEnvelope(encodeExecClientMessage(pending.id, pending.execId, 11, payload)))) {
						throw new Error("Cursor tool continuation bridge closed before accepting the result");
					}
				}
			} else {
				if (liveBridge !== undefined) {
					liveBridge.run.close();
					// A checkpoint paused on an MCP call cannot safely accept a normal
					// user action. Fall back to textual cold-start reconstruction.
					persisted.checkpoint = undefined;
					persisted.blobs.clear();
				}
				const access = await this.auth.accessToken({ signal: upstream });
				const built = buildRunPayload(options, options.model, persisted);
				blobStore = built.blobStore;
				run = new AgentRun(access);
				await run.start();
				abortRun = () => run.abort(new Error("Cursor request aborted by caller"));
				upstream.addEventListener("abort", abortRun, { once: true });
				run.writeMessage(built.payload);
				run.startHeartbeat();
			}

			const started = this.now();
			let lastActivity = started;
			const idleCheck = setInterval(() => {
				if (this.now() - lastActivity > this.idleTimeoutMs) {
					run.abort(new Error("Cursor stream idle timeout"));
				}
			}, 15000);
			idleCheck.unref?.();

			let emittedToolCall = false;
			let toolCallBuffer = undefined;
			let textOutput = "";
			let outputTokens = 0;
			let streamClosed = false;
			let terminalErrorEmitted = false;
			let toolCallPending = false;
			let toolRoundCounted = false;
			const pendingExecs = [];

			try {
				for (;;) {
					const frame = await run.frames.next();
					if (frame === undefined) break;
					lastActivity = this.now();
					if ((frame.flags & CONNECT_END_STREAM_FLAG) !== 0) {
						const end = parseEndStream(frame.payload);
						if (end !== undefined) {
							terminalErrorEmitted = true;
							yield {
								type: "finish",
								reason: {
									kind: "error",
									failure: {
										message: end.message,
										code: classifyCursorError(`${end.code} ${end.debugCode ?? ""} ${end.message}`),
									},
								},
							};
							streamClosed = true;
							break;
						}
						break;
					}
					const message = decodeAgentServerMessage(frame.payload);
					if (message.case === "conversationCheckpointUpdate") {
						// Reader.bytes() returns a view into the frame buffer; copy it before
						// retaining it for a later request.
						persisted.checkpoint = Uint8Array.from(message.value);
						if (toolCallPending) {
							// Cursor emits this checkpoint after mcpArgs. Keep the same Run
							// alive; the next DSH step resumes it with McpResult field 11.
							streamClosed = true;
							break;
						}
					} else if (message.case === "interactionUpdate") {
						const update = message.value;
						if (update.type === "textDelta") {
							if (update.text.length > 0) {
								textOutput += update.text;
								yield { type: "text-delta", index: TEXT_BLOCK_INDEX, text: update.text };
							}
						} else if (update.type === "thinkingDelta") {
							if (update.text.length > 0) {
								yield { type: "reasoning-delta", index: REASONING_BLOCK_INDEX, text: update.text };
							}
						} else if (update.type === "tokenDelta") {
							if (Number.isFinite(update.tokens) && update.tokens > 0) outputTokens = update.tokens;
						} else if (update.type === "partialToolCall") {
							if (toolCallBuffer === undefined || toolCallBuffer.id !== update.callId) {
								toolCallBuffer = { id: update.callId, name: "", arguments: "" };
								yield { type: "block-start", index: TOOL_BLOCK_INDEX, blockType: "tool-call" };
								yield { type: "tool-call-delta", index: TOOL_BLOCK_INDEX, id: CallId(update.callId), argumentsDelta: "" };
							}
							if (update.argsTextDelta.length > 0) {
								toolCallBuffer.arguments += update.argsTextDelta;
								yield { type: "tool-call-delta", index: TOOL_BLOCK_INDEX, id: CallId(update.callId), argumentsDelta: update.argsTextDelta };
							}
						} else if (update.type === "toolCallStarted" || update.type === "toolCallCompleted" || update.type === "toolCallDelta") {
							emittedToolCall = true;
						}
					} else if (message.case === "kvServerMessage") {
						const kv = message.value;
						if (kv.case === "getBlobArgs") {
							const key = Buffer.from(kv.blobId).toString("hex");
							const blob = blobStore.get(key);
							run.writeMessage(encodeKvClientMessage(encodeGetBlobResult(kv.id, blob)));
						} else if (kv.case === "setBlobArgs") {
							if (kv.blobId !== undefined && kv.blobData !== undefined) {
								const key = Buffer.from(kv.blobId).toString("hex");
								// Reader.bytes() returns views; retain independent copies for both
								// this run's GET handshake and the next run's checkpoint.
								const data = Uint8Array.from(kv.blobData);
								blobStore.set(key, data);
								persisted.blobs.set(key, data);
							}
							// Acknowledge server blob writes; without the reply the
							// run can stall waiting for the handshake to finish.
							run.writeMessage(encodeKvClientMessage(encodeSetBlobResult(kv.id)));
						}
					} else if (message.case === "execServerMessage") {
						const exec = message.value;
						if (exec.case === "requestContextArgs") {
							run.writeMessage(encodeExecClientMessageEnvelope(encodeExecClientMessage(exec.id, exec.execId, 10, encodeRequestContextResult(mcpTools))));
						} else if (exec.case === "mcpArgs") {
							if (!toolRoundCounted) {
								toolRoundCount++;
								toolRoundCounted = true;
							}
							if (toolRoundCount > this.maxToolRounds) {
								throw new LlmError(
									`Cursor tool-call safety limit reached after ${this.maxToolRounds} rounds. The run was stopped to prevent an infinite loop; send a new message to continue if needed.`,
									"TOOL_LIMIT",
								);
							}
							emittedToolCall = true;
							// decodeExecServerMessage nests the parsed McpArgs under
							// `exec.args`: { name, toolCallId, providerIdentifier, toolName, args }.
							const mcp = exec.args ?? {};
							const args = {};
							for (const [key, value] of Object.entries(mcp.args ?? {})) {
								try {
									args[key] = decodeValue(value);
								} catch {
									args[key] = null;
								}
							}
							const id = mcp.toolCallId || exec.execId || crypto.randomUUID();
							const name = mcp.toolName || mcp.name;
							yield { type: "block-start", index: TOOL_BLOCK_INDEX, blockType: "tool-call" };
							yield {
								type: "tool-call-delta",
								index: TOOL_BLOCK_INDEX,
								id: CallId(id),
								name,
								argumentsDelta: JSON.stringify(args),
							};
							yield {
								type: "block-end",
								index: TOOL_BLOCK_INDEX,
								block: {
									type: "tool-call",
									id: CallId(id),
									name,
									arguments: JSON.stringify(args),
								},
							};
							pendingExecs.push({ id: exec.id, execId: exec.execId, toolCallId: id });
							toolCallPending = true;
							// Do not close the Run. Cursor sends blob writes + a checkpoint
							// immediately after mcpArgs; once captured, return tool-calls to DSH
							// while preserving this bridge for the result.
							streamClosed = true;
						} else {
							const reply = rejectionFor(exec);
							if (reply !== undefined) {
								run.writeMessage(encodeExecClientMessageEnvelope(encodeExecClientMessage(exec.id, exec.execId, reply.field, reply.payload)));
							}
						}
					}
				}
			} finally {
				clearInterval(idleCheck);
			}

			if (!terminalErrorEmitted && !toolCallPending) {
				const textToolCalls = parseTextToolCalls(textOutput, options.tools ?? []);
				for (let index = 0; index < textToolCalls.length; index++) {
					const call = textToolCalls[index];
					const blockIndex = TOOL_BLOCK_INDEX + index;
					yield { type: "block-start", index: blockIndex, blockType: "tool-call" };
					yield {
						type: "tool-call-delta",
						index: blockIndex,
						id: CallId(call.id),
						name: call.name,
						argumentsDelta: call.arguments,
					};
					yield {
						type: "block-end",
						index: blockIndex,
						block: { type: "tool-call", id: CallId(call.id), name: call.name, arguments: call.arguments },
					};
				}
				if (textToolCalls.length > 0) {
					emittedToolCall = true;
					streamClosed = true;
				}
			}

			const liveToolBridge = toolCallPending && pendingExecs.length > 0 && !run.finished;
			if (sessionKey !== undefined && (persisted.checkpoint !== undefined || liveToolBridge)) {
				persisted.lastAccessMs = this.now();
				if (liveToolBridge) {
					persisted.bridge = { run, pendingExecs, toolRoundCount };
					bridgeStored = true;
				}
				// Refresh insertion order for simple LRU-style eviction. A checkpoint
				// may reference every retained blob, so prune whole sessions rather than
				// individual blobs. Close an evicted live bridge to avoid socket leaks.
				this.#sessions.delete(sessionKey);
				this.#sessions.set(sessionKey, persisted);
				while (this.#sessions.size > 100) {
					const oldest = this.#sessions.keys().next().value;
					if (oldest === undefined) break;
					this.#sessions.get(oldest)?.bridge?.run.close();
					this.#sessions.delete(oldest);
				}
			}

			if (!terminalErrorEmitted) {
				yield { type: "usage", usage: { inputTokens: 0, outputTokens } };
				if (streamClosed && emittedToolCall) {
					yield { type: "finish", reason: { kind: "tool-calls" } };
				} else if (run.trailers && Number(run.trailers["grpc-status"]) > 0) {
					const message = run.trailers["grpc-message"] ?? "Cursor agent run failed";
					yield { type: "finish", reason: { kind: "error", failure: { message, code: classifyCursorError(message) } } };
				} else {
					yield { type: "finish", reason: { kind: "stop" } };
				}
			}
		} catch (error) {
			if (upstream.aborted) {
				yield {
					type: "finish",
					reason: { kind: "aborted", failure: { message: "Cursor request aborted by caller", code: "ABORTED" } },
				};
			} else if (error instanceof LlmError) {
				yield { type: "finish", reason: { kind: "error", failure: { message: error.message, code: error.code } } };
			} else {
				const message = error instanceof Error ? error.message : String(error);
				yield { type: "finish", reason: { kind: "error", failure: { message, code: classifyCursorError(message) } } };
			}
		} finally {
			if (abortRun !== undefined) upstream.removeEventListener("abort", abortRun);
			consumer.abort("cursor stream consumer stopped");
			if (!bridgeStored) run?.close();
		}
	}
}

/**
 * Parse a Connect end-stream frame into a structured error. Cursor's agent
 * errors carry a `debug` payload with a stable code and human-readable
 * `title`/`detail`; extracting those gives the user the real reason instead of
 * a bare `resource_exhausted`.
 * @returns {undefined | {code: string, debugCode?: string, message: string}}
 */
export function parseEndStream(payload) {
	try {
		const json = JSON.parse(new TextDecoder().decode(payload));
		const error = json?.error;
		if (!error) return undefined;
		const code = typeof error.code === "string" ? error.code : "unknown";
		let debugCode;
		let title;
		let detail;
		if (Array.isArray(error.details)) {
			for (const entry of error.details) {
				if (!record(entry) || !record(entry.debug)) continue;
				if (typeof entry.debug.error === "string") debugCode = entry.debug.error;
				const details = record(entry.debug.details) ? entry.debug.details : undefined;
				if (details !== undefined) {
					if (typeof details.title === "string") title = details.title;
					if (typeof details.detail === "string") detail = details.detail;
				}
			}
		}
		const fallback = typeof error.message === "string" && error.message.length > 0 ? error.message : undefined;
		const message = [title, detail].filter((part) => typeof part === "string" && part.length > 0).join(" ")
			|| (debugCode !== undefined ? `Cursor: ${debugCode}` : undefined)
			|| (fallback !== undefined ? `Cursor agent error ${code}: ${fallback}` : `Cursor agent error ${code}`);
		return { code, debugCode, message };
	} catch {
		return undefined;
	}
}

export function classifyCursorError(message) {
	if (/\b(?:401|403)\b|unauth|invalid.*(?:key|token|credential)/i.test(message)) return "AUTH";
	if (/rate.?limit|\b429\b|quota|resource_exhausted|spend.?limit|usage limit|exceeded/i.test(message)) return "RATE_LIMIT";
	if (/\b400\b|invalid.?request/i.test(message)) return "INVALID_REQUEST";
	if (/\b5\d\d\b|internal/i.test(message)) return "SERVER";
	if (/timeout|timed out/i.test(message)) return "TIMEOUT";
	if (/\b(?:network|connection|socket|fetch|ECONN|http2)/i.test(message)) return "TRANSPORT";
	return "CURSOR_ERROR";
}

/** Build the exec-client reply for a native Cursor tool we reject. */
export function rejectionFor(exec) {
	switch (exec.case) {
		case "readArgs":
			return { field: 7, payload: encodeReadRejected(exec.path, TOOL_REJECT_REASON) };
		case "lsArgs":
			return { field: 8, payload: encodeLsRejected(exec.path, TOOL_REJECT_REASON) };
		case "grepArgs":
			return { field: 5, payload: encodeGrepError(TOOL_REJECT_REASON) };
		case "writeArgs":
			return { field: 3, payload: encodeWriteRejected(exec.path, TOOL_REJECT_REASON) };
		case "deleteArgs":
			return { field: 4, payload: encodeDeleteRejected(exec.path, TOOL_REJECT_REASON) };
		case "shellArgs":
			// Non-streaming shell exec replies with ShellResult (field 2).
			return { field: 2, payload: encodeShellRejectedResult(undefined, undefined, TOOL_REJECT_REASON) };
		case "shellStreamArgs":
			// Streaming shell exec replies with ShellStream (field 14); a
			// ShellResult here leaves the server waiting for the stream.
			return { field: 14, payload: encodeShellStreamRejected(undefined, undefined, TOOL_REJECT_REASON) };
		case "backgroundShellSpawnArgs":
			return { field: 16, payload: encodeBackgroundShellRejectedResult(undefined, undefined, TOOL_REJECT_REASON) };
		case "fetchArgs":
			return { field: 20, payload: encodeFetchError(exec.url, TOOL_REJECT_REASON) };
		case "writeShellStdinArgs":
			return { field: 23, payload: encodeWriteShellStdinError(TOOL_REJECT_REASON) };
		case "diagnosticsArgs":
			return { field: 9, payload: encodeDiagnosticsResult() };
		case "recordScreenArgs":
			return { field: 21, payload: encodeMcpError("Screen recording is not available") };
		case "computerUseArgs":
			return { field: 22, payload: encodeMcpError("Computer use is not available") };
		case "listMcpResourcesExecArgs":
			return { field: 17, payload: encodeMcpError("MCP resources are not available") };
		case "readMcpResourceExecArgs":
			return { field: 18, payload: encodeMcpError("MCP resources are not available") };
		default:
			return undefined;
	}
}
//#endregion

//#region apply
export function apply(ctx) {
	const store = new CursorCredentialStore(ctx.credentials, CREDENTIAL_REF);
	const auth = new CursorAuthService(store, { logger: ctx.logger });
	const adapter = new CursorAdapter({ auth });
	ctx.llm.registerAdapter([PROVIDER], adapter);
	const usageReader = new CursorUsageReader(auth, { logger: ctx.logger });

	const coordinator = new CursorLoginCoordinator(auth, { logger: ctx.logger });
	const handler = createCursorRpcHandler(coordinator, {
		openExternal: openCursorAuthUrl,
		usageReader,
		modelsProvider: adapter,
	});
	ctx.effect(
		() => ctx.connection.rpc.handle(CHANNEL, handler, { authority: "loopback" }),
		"cursor-subscription: loopback account RPC",
	);
}
//#endregion
