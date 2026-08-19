/**
 * Unit tests for dsh-cursor-subscription wire helpers.
 *
 * These tests exercise the hand-rolled protobuf encoder/decoder, Connect
 * framing, and the DSH-history → Cursor-conversation mapping without touching
 * the network.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import http2 from "node:http2";

import {
	varintEncode,
	Writer,
	Reader,
	encodeValue,
	decodeValue,
} from "../lib/proto.js";
import {
	frameEncode,
	ConnectFrameReader,
	CONNECT_END_STREAM_FLAG,
	buildConversationState,
	buildInitialConversationState,
	buildRunPayload,
	decodeAgentServerMessage,
	decodeKvServerMessage,
	decodeMcpArgs,
	decodeUsableModels,
	buildLoginUrl,
	CursorCredentialStore,
	CursorUsageReader,
	parseEndStream,
	parseTextToolCalls,
	classifyCursorError,
	encodeMcpResult,
	encodeSetBlobResult,
	CREDENTIAL_REF,
	getTokenExpiry,
	getTokenSub,
	parseLegacyBucket,
	getRequestCountFromSpendCents,
	computeIncludedRequests,
	parseUsageSummary,
	parseRequestQuotaPerSeat,
	resolveCursorSettings,
	shouldRetryHttpStatus,
	CursorAdapter,
	createCursorRpcHandler,
	AgentRun,
	isSuccessfulAgentResponse,
} from "../lib/index.js";

test("varintEncode encodes small and large values", () => {
	assert.deepEqual([...varintEncode(0)], [0]);
	assert.deepEqual([...varintEncode(1)], [1]);
	assert.deepEqual([...varintEncode(127)], [127]);
	assert.deepEqual([...varintEncode(128)], [128, 1]);
	assert.deepEqual([...varintEncode(300)], [172, 2]);
});

test("Writer/Reader round-trips strings, bytes, varints, doubles", () => {
	const writer = new Writer();
	writer.string(1, "hello");
	writer.varint(2, 300);
	writer.double(3, 1.5);
	const bytes = writer.finish();

	const reader = new Reader(bytes);
	const fields = {};
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 2) fields.a = reader.string();
		else if (field === 2 && wireType === 0) fields.b = reader.varint();
		else if (field === 3 && wireType === 1) fields.c = reader.double();
		else reader.skip(wireType);
	}
	assert.equal(fields.a, "hello");
	assert.equal(fields.b, 300);
	assert.equal(fields.c, 1.5);
});

test("encodeValue/decodeValue round-trip JSON values", () => {
	const samples = [
		null,
		true,
		false,
		42,
		-1.5,
		"text",
		[1, "two", false],
		{ a: 1, b: { c: ["x"] }, d: null },
	];
	for (const sample of samples) {
		const bytes = encodeValue(sample);
		assert.deepEqual(decodeValue(bytes), sample, JSON.stringify(sample));
	}
});

test("Connect framing round-trips through the incremental reader", async () => {
	const reader = new ConnectFrameReader();
	const payloadA = new Uint8Array([1, 2, 3]);
	const payloadB = new Uint8Array([4, 5, 6, 7, 8]);
	reader.push(frameEncode(payloadA));
	// Split the second frame across two pushes to exercise buffering.
	const frameB = frameEncode(payloadB, CONNECT_END_STREAM_FLAG);
	reader.push(frameB.slice(0, 3));
	reader.push(frameB.slice(3));
	reader.finish();

	const first = await reader.next();
	assert.deepEqual([...first.payload], [1, 2, 3]);
	assert.equal(first.flags, 0);
	const second = await reader.next();
	assert.deepEqual([...second.payload], [4, 5, 6, 7, 8]);
	assert.equal(second.flags & CONNECT_END_STREAM_FLAG, CONNECT_END_STREAM_FLAG);
	assert.equal(await reader.next(), undefined);
});

test("buildLoginUrl carries PKCE params on the cursor.com origin", () => {
	const url = buildLoginUrl({ challenge: "ch", uuid: "u" });
	const parsed = new URL(url);
	assert.equal(parsed.origin, "https://cursor.com");
	assert.equal(parsed.pathname, "/loginDeepControl");
	assert.equal(parsed.searchParams.get("challenge"), "ch");
	assert.equal(parsed.searchParams.get("uuid"), "u");
	assert.equal(parsed.searchParams.get("mode"), "login");
	assert.equal(parsed.searchParams.get("redirectTarget"), "cli");
});

test("buildConversationState maps DSH history to Cursor turns", () => {
	const options = {
		system: "You are a helpful assistant.",
		messages: [
			{ role: "user", content: [{ type: "text", text: "first" }] },
			{ role: "assistant", content: [{ type: "text", text: "reply one" }] },
			{ role: "user", content: [{ type: "text", text: "second" }] },
		],
	};
	const state = buildConversationState(options);
	assert.ok(state.conversationState instanceof Uint8Array);
	assert.ok(state.conversationState.length > 0);
	assert.ok(state.action instanceof Uint8Array);
	assert.ok(state.action.length > 0);
	// System prompt stored as a blob the server will fetch via KV handshake.
	assert.equal(state.blobStore.size, 1);
	const [blobIdHex, blob] = state.blobStore.entries().next().value;
	const parsed = JSON.parse(new TextDecoder().decode(blob));
	assert.equal(parsed.role, "system");
	assert.ok(blobIdHex.length === 64); // sha256 hex
});

test("buildInitialConversationState never emits rejected field-8 turns", () => {
	const state = buildInitialConversationState({
		system: "sys",
		messages: [
			{ role: "user", content: [{ type: "text", text: "old question" }] },
			{ role: "assistant", content: [{ type: "text", text: "old answer" }] },
			{ role: "user", content: [{ type: "text", text: "current question" }] },
		],
	});
	const reader = new Reader(state.conversationState);
	const fields = [];
	while (!reader.done) {
		const tag = reader.tag();
		fields.push(tag.field);
		reader.skip(tag.wireType);
	}
	assert.deepEqual(fields, [1]);
	assert.equal(state.blobStore.size, 1);
});

test("cold-start run payload combines the DSH human prompt and runtime context", () => {
	const built = buildRunPayload({
		system: "sys",
		messages: [
			{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "human prompt" }] },
			{ role: "user", source: { kind: "plugin" }, content: [{ type: "text", text: "runtime snapshot" }] },
		],
	}, "default");

	const envelope = new Reader(built.payload);
	assert.deepEqual(envelope.tag(), { field: 1, wireType: 2 });
	const request = new Reader(envelope.bytes());
	assert.deepEqual(request.tag(), { field: 1, wireType: 2 });
	const state = new Reader(request.bytes());
	while (!state.done) {
		const tag = state.tag();
		assert.notEqual(tag.field, 8);
		state.skip(tag.wireType);
	}
	assert.deepEqual(request.tag(), { field: 2, wireType: 2 });
	const action = new Reader(request.bytes());
	assert.deepEqual(action.tag(), { field: 1, wireType: 2 });
	const userAction = new Reader(action.bytes());
	assert.deepEqual(userAction.tag(), { field: 1, wireType: 2 });
	const userMessage = new Reader(userAction.bytes());
	assert.deepEqual(userMessage.tag(), { field: 1, wireType: 2 });
	const text = userMessage.string();
	assert.match(text, /human prompt/);
	assert.match(text, /runtime snapshot/);
	assert.ok(text.indexOf("human prompt") < text.indexOf("runtime snapshot"));
});

test("buildRunPayload produces a run request without throwing", () => {
	const options = {
		system: "sys",
		messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
		tools: [
			{
				name: "pwsh",
				description: "run a command",
				parameters: { type: "object", properties: { command: { type: "string" } } },
			},
		],
	};
	const { payload, blobStore } = buildRunPayload(options, "claude-3.5-sonnet");
	assert.ok(payload instanceof Uint8Array);
	assert.ok(payload.length > 0);
	assert.equal(blobStore.size, 1);
});

test("buildRunPayload uses the persisted checkpoint and blob store", () => {
	const checkpoint = new Uint8Array([8, 42, 18, 3, 1, 2, 3]);
	const blobs = new Map([["aabb", new Uint8Array([9, 8, 7])]]);
	const options = {
		system: "new system text must not rebuild conversation state",
		messages: [
			{ role: "user", content: [{ type: "text", text: "first" }] },
			{ role: "assistant", content: [{ type: "text", text: "reply" }] },
			{ role: "user", source: { kind: "user" }, content: [{ type: "text", text: "follow-up" }] },
			{ role: "user", source: { kind: "plugin" }, content: [{ type: "text", text: "current runtime" }] },
		],
	};
	const built = buildRunPayload(options, "default", { checkpoint, blobs });
	assert.equal(built.blobStore, blobs);

	// AgentClientMessage.run_request=1, RunRequest.conversation_state=1.
	const envelope = new Reader(built.payload);
	const outerTag = envelope.tag();
	assert.deepEqual(outerTag, { field: 1, wireType: 2 });
	const request = new Reader(envelope.bytes());
	const stateTag = request.tag();
	assert.deepEqual(stateTag, { field: 1, wireType: 2 });
	assert.deepEqual([...request.bytes()], [...checkpoint]);
	assert.deepEqual(request.tag(), { field: 2, wireType: 2 });
	const action = new Reader(request.bytes());
	assert.deepEqual(action.tag(), { field: 1, wireType: 2 });
	const userAction = new Reader(action.bytes());
	assert.deepEqual(userAction.tag(), { field: 1, wireType: 2 });
	const userMessage = new Reader(userAction.bytes());
	assert.deepEqual(userMessage.tag(), { field: 1, wireType: 2 });
	assert.equal(userMessage.string(), "follow-up\n\ncurrent runtime");
});

test("decodeKvServerMessage preserves setBlobArgs ids and bytes", () => {
	const blobId = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
	const blobData = new Uint8Array([1, 2, 3, 4, 5]);
	const setArgs = new Writer().bytes(1, blobId).bytes(2, blobData).finish();
	const server = new Writer().varint(1, 17).message(3, setArgs).finish();
	const decoded = decodeKvServerMessage(server);
	assert.equal(decoded.id, 17);
	assert.equal(decoded.case, "setBlobArgs");
	assert.deepEqual([...decoded.blobId], [...blobId]);
	assert.deepEqual([...decoded.blobData], [...blobData]);
});

test("decodeUsableModels parses ModelDetails entries", () => {
	const writer = new Writer();
	const model1 = new Writer().string(1, "composer-2").string(3, "composer-2").string(4, "Composer 2").finish();
	const model2 = new Writer().string(1, "gpt-4o").string(4, "GPT-4o").finish();
	writer.message(1, model1);
	writer.message(1, model2);
	const models = decodeUsableModels(writer.finish());
	assert.equal(models.length, 2);
	assert.equal(models[0].id, "composer-2");
	assert.equal(models[0].name, "Composer 2");
	assert.equal(models[1].id, "gpt-4o");
	assert.equal(models[1].name, "GPT-4o");
});

test("decodeMcpArgs parses name, tool call id, and Value args", () => {
	const writer = new Writer();
	writer.string(1, "my-tool");
	for (const [key, value] of Object.entries({ path: "/tmp/a.txt", count: 3, ok: true })) {
		const entry = new Writer().string(1, key).bytes(2, encodeValue(value)).finish();
		writer.message(2, entry); // map<string, bytes>: repeated entry messages
	}
	writer.string(3, "call-123");
	writer.string(5, "my-tool");
	const decoded = decodeMcpArgs(writer.finish());
	assert.equal(decoded.name, "my-tool");
	assert.equal(decoded.toolCallId, "call-123");
	assert.equal(decoded.toolName, "my-tool");
	assert.equal(decodeValue(decoded.args["path"]), "/tmp/a.txt");
	assert.equal(decodeValue(decoded.args["count"]), 3);
	assert.equal(decodeValue(decoded.args["ok"]), true);
});

test("parseTextToolCalls recovers parameter-tag MCP calls", () => {
	const tools = [{
		name: "read",
		parameters: {
			type: "object",
			properties: { file_path: { type: "string" }, limit: { type: "integer" } },
		},
	}];
	const calls = parseTextToolCalls([
		'<tool_call id="mcp_dsh-cursor-subscription_read">',
		'<parameter name="file_path">D:\\\\work\\\\a.txt</parameter>',
		'<parameter name="limit">100</parameter>',
		'</tool_call>',
	].join("\n"), tools);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].name, "read");
	assert.match(calls[0].id, /^text-tool-/);
	assert.deepEqual(JSON.parse(calls[0].arguments), { file_path: "D:\\\\work\\\\a.txt", limit: 100 });
});

test("parseTextToolCalls maps Cursor native aliases and attribute arguments", () => {
	const tools = [
		{ name: "read", parameters: { type: "object", properties: { file_path: { type: "string" }, limit: { type: "integer" } } } },
		{ name: "glob", parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } } } },
		{ name: "pwsh", parameters: { type: "object", properties: { command: { type: "string" }, description: { type: "string" } } } },
	];
	const calls = parseTextToolCalls([
		'<tool_call id="Read" path="D:\\\\work\\\\a.txt" limit="25"></tool_call>',
		'<tool_call id="Glob" glob_pattern="*.gd" target_directory="D:\\\\work"></tool_call>',
		'<tool_call id="Shell" command="Write-Output &quot;ok&quot;" description="test"></tool_call>',
	].join("\n"), tools);
	assert.deepEqual(calls.map((call) => call.name), ["read", "glob", "pwsh"]);
	assert.deepEqual(JSON.parse(calls[0].arguments), { limit: 25, file_path: "D:\\\\work\\\\a.txt" });
	assert.deepEqual(JSON.parse(calls[1].arguments), { pattern: "*.gd", path: "D:\\\\work" });
	assert.deepEqual(JSON.parse(calls[2].arguments), { command: 'Write-Output "ok"', description: "test" });
});

test("decodeAgentServerMessage recognizes interaction updates", () => {
	// AgentServerMessage { interaction_update = 1 { text_delta = 1 { text = 1 } } }
	const textDelta = new Writer().string(1, "hello delta").finish();
	const interaction = new Writer().message(1, textDelta).finish();
	const server = new Writer().message(1, interaction).finish();
	const decoded = decodeAgentServerMessage(server);
	assert.equal(decoded.case, "interactionUpdate");
	assert.equal(decoded.value.type, "textDelta");
	assert.equal(decoded.value.text, "hello delta");
});

test("getTokenExpiry decodes a JWT exp claim", () => {
	const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
	const payload = Buffer.from(JSON.stringify({ exp: 2000000000 })).toString("base64url");
	const token = `${header}.${payload}.signature`;
	assert.equal(getTokenExpiry(token, () => 0), 2000000000 * 1000);
});

test("credential store accepts the exact credential shape produced by login()", async () => {
	// Regression: login() previously omitted `type: "oauth"`, which
	// assertOAuthCredential rejects, so the token was never persisted and the
	// coordinator reported "login failed" even though the poll returned 200.
	let stored;
	const credentials = {
		resolve: async () => (stored === undefined ? undefined : { value: stored }),
		set: async (_ref, value) => {
			stored = value;
		},
		unset: async () => {
			stored = undefined;
		},
	};
	const store = new CursorCredentialStore(credentials, CREDENTIAL_REF);
	const credential = {
		type: "oauth",
		access: "access-token",
		refresh: "refresh-token",
		expires: getTokenExpiry("x.y.z"),
	};
	const written = await store.modify(() => credential);
	assert.equal(written.access, "access-token");
	assert.equal(written.refresh, "refresh-token");
	assert.ok(Number.isFinite(written.expires));
	const readBack = await store.read();
	assert.equal(readBack.type, "oauth");
	assert.equal(readBack.access, "access-token");
	// A missing `type` must still be rejected loudly.
	await assert.rejects(
		store.modify(() => ({ access: "a", refresh: "r", expires: 1 })),
		/Cursor credential store received a malformed OAuth credential/,
	);
});

test("getTokenSub normalizes the identity-provider prefix", () => {
	const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
	const payload = Buffer.from(JSON.stringify({ sub: "github|user_01KCCA5418KMHSHR8QGKX9SBP5" })).toString("base64url");
	assert.equal(getTokenSub(`${header}.${payload}.sig`), "user_01KCCA5418KMHSHR8QGKX9SBP5");
	assert.equal(getTokenSub("not-a-jwt"), undefined);
});

test("parseLegacyBucket prefers the gpt-4 bucket and falls back by limit", () => {
	const legacy = parseLegacyBucket({ "gpt-4": { numRequests: 120, maxRequestUsage: 500 } });
	assert.deepEqual(legacy, { numRequests: 120, maxRequestUsage: 500 });
	const fallback = parseLegacyBucket({ "claude-3-5-sonnet": { numRequests: 30, maxRequestUsage: 200 } });
	assert.deepEqual(fallback, { numRequests: 30, maxRequestUsage: 200 });
	assert.equal(parseLegacyBucket({}), undefined);
});

test("computeIncludedRequests mirrors the Cursor dashboard math", () => {
	// Individual plan uses the legacy bucket directly.
	const individual = computeIncludedRequests({
		legacy: { numRequests: 120, maxRequestUsage: 500 },
		isTeam: false,
	});
	assert.deepEqual(individual, { used: 120, limit: 500, remaining: 380, pct: 24 });
	// Team plan derives used from spend cents and limit from per-seat quota.
	const team = computeIncludedRequests({
		legacy: undefined,
		isTeam: true,
		planUsedCents: 2000,
		requestQuotaPerSeat: 4,
	});
	assert.deepEqual(team, { used: 500, limit: 2000, remaining: 1500, pct: 25 });
	assert.equal(getRequestCountFromSpendCents(2000), 500);
	assert.equal(getRequestCountFromSpendCents(0), 0);
});

test("parseUsageSummary projects plan, spend, and billing cycle", () => {
	const parsed = parseUsageSummary({
		membershipType: "enterprise",
		limitType: "team",
		isUnlimited: false,
		billingCycleStart: "2026-07-20T05:59:33.000Z",
		billingCycleEnd: "2026-08-20T05:59:33.000Z",
		individualUsage: {
			plan: { used: 2000, limit: 2000, totalPercentUsed: 52.84, autoPercentUsed: 23.17 },
			onDemand: { used: 1273, limit: null, remaining: null },
		},
		teamUsage: { onDemand: { used: 8052, limit: 8000, remaining: 0 } },
	});
	assert.equal(parsed.membershipType, "enterprise");
	assert.equal(parsed.isTeam, true);
	assert.equal(parsed.planUsedCents, 2000);
	assert.equal(parsed.totalPercentUsed, 52.84);
	assert.equal(parsed.autoPercentUsed, 23.17);
	assert.deepEqual(parsed.individualOnDemand, { usedDollars: 12.73 });
	assert.deepEqual(parsed.teamOnDemand, { usedDollars: 80.52, limitDollars: 80, remainingDollars: 0 });
});

test("parseRequestQuotaPerSeat finds the active team", () => {
	const json = { teams: [{ id: 7, requestQuotaPerSeat: 4 }, { id: 8, requestQuotaPerSeat: 2 }] };
	assert.equal(parseRequestQuotaPerSeat(json, 8), 2);
	assert.equal(parseRequestQuotaPerSeat(json, undefined), 4);
	assert.equal(parseRequestQuotaPerSeat({ teams: [] }, 1), undefined);
});

test("CursorUsageReader builds the dashboard cookie and parses live responses", async () => {
	const access = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "github|user_01TEST" })).toString("base64url")}.sig`;
	const auth = {
		credential: async () => ({ access, refresh: "r", expires: Date.now() + 1e6 }),
	};
	const seen = [];
	const fetchImpl = async (url, init) => {
		seen.push({ url: String(url), cookie: init?.headers?.cookie, method: init?.method ?? "GET" });
		const body =
			String(url).includes("/api/usage?user=")
				? { "gpt-4": { numRequests: 100, maxRequestUsage: 500 } }
				: String(url).includes("/api/usage-summary")
					? {
							membershipType: "pro",
							limitType: "individual",
							isUnlimited: false,
							billingCycleStart: "2026-07-20T00:00:00.000Z",
							billingCycleEnd: "2026-08-20T00:00:00.000Z",
							individualUsage: { plan: { used: 400, limit: 2000, totalPercentUsed: 20 }, onDemand: { used: 100, limit: null } },
						}
					: { teams: [] };
		return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
	};
	const reader = new CursorUsageReader(auth, { fetch: fetchImpl, now: () => 1787000000000 });
	const usage = await reader.read();
	assert.equal(usage.includedRequests.used, 100);
	assert.equal(usage.includedRequests.limit, 500);
	assert.equal(usage.plan.totalPercentUsed, 20);
	assert.equal(usage.billingCycle.daysLeft, 3);
	assert.equal(usage.individualOnDemand.usedDollars, 1);
	assert.equal(seen.length, 3);
	for (const entry of seen) {
		assert.equal(entry.cookie, `WorkosCursorSessionToken=user_01TEST::${access}`);
	}
	assert.ok(seen.some((entry) => entry.method === "POST" && entry.url.includes("/api/dashboard/teams")));
});

test("parseEndStream extracts the real Cursor error and classifies quota exhaustion", () => {
	// Real end-stream payload captured from the live agent Run endpoint when the
	// team spend limit is hit.
	const payload = Buffer.from(
		JSON.stringify({
			error: {
				code: "resource_exhausted",
				message: "Error",
				details: [
					{
						type: "aiserver.v1.ErrorDetails",
						debug: {
							error: "ERROR_RATE_LIMITED_CHANGEABLE",
							details: {
								title: "Your team has reached its usage limit",
								detail: "Please reach out to an admin to increase your limit, or return on 8/20/2026 when your usage resets.",
							},
						},
					},
				],
			},
		}),
	);
	const end = parseEndStream(payload);
	assert.equal(end.code, "resource_exhausted");
	assert.equal(end.debugCode, "ERROR_RATE_LIMITED_CHANGEABLE");
	assert.ok(end.message.includes("Your team has reached its usage limit"));
	assert.ok(end.message.includes("return on 8/20/2026"));
	assert.equal(classifyCursorError(`${end.code} ${end.debugCode} ${end.message}`), "RATE_LIMIT");
	assert.equal(classifyCursorError("Cursor agent returned HTTP 408"), "TIMEOUT");
	// A non-error end-stream payload is a clean stop.
	assert.equal(parseEndStream(Buffer.from("{}")), undefined);
	assert.equal(parseEndStream(Buffer.from("not json")), undefined);
});

test("encodeMcpResult encodes text and is_error for bridge continuation", () => {
	const result = new Reader(encodeMcpResult({ content: "tool output", isError: true }));
	assert.deepEqual(result.tag(), { field: 1, wireType: 2 });
	const success = new Reader(result.bytes());
	assert.deepEqual(success.tag(), { field: 1, wireType: 2 });
	const item = new Reader(success.bytes());
	assert.deepEqual(item.tag(), { field: 1, wireType: 2 });
	const text = new Reader(item.bytes());
	assert.deepEqual(text.tag(), { field: 1, wireType: 2 });
	assert.equal(text.string(), "tool output");
	assert.deepEqual(success.tag(), { field: 2, wireType: 0 });
	assert.equal(success.varint(), 1);
});

test("encodeSetBlobResult acks a server blob write", () => {
	// KvClientMessage { id = 1 (varint 3), set_blob_result = 3 (empty message) }
	assert.deepEqual([...encodeSetBlobResult(3)], [8, 3, 26, 0]);
});

test("AgentRun abort rejects a pending HTTP response wait immediately", async () => {
	const server = http2.createServer();
	server.on("stream", (stream) => stream.on("error", () => {}));
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address();
		const run = new AgentRun("test-token", { baseUrl: `http://127.0.0.1:${address.port}` });
		await run.start();
		assert.equal(run.writeMessage(new Uint8Array([1])), true);
		const waiting = run.waitForResponse(10_000);
		const cancelled = new Error("test cancellation");
		run.abort(cancelled);
		await assert.rejects(waiting, /test cancellation/);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});

test("Cursor Agent response requires HTTP 200 Connect protobuf", () => {
	assert.equal(isSuccessfulAgentResponse(200, "application/connect+proto"), true);
	assert.equal(isSuccessfulAgentResponse(200, "application/connect+proto; charset=binary"), true);
	assert.equal(isSuccessfulAgentResponse(201, "application/connect+proto"), false);
	assert.equal(isSuccessfulAgentResponse(204, "application/connect+proto"), false);
	assert.equal(isSuccessfulAgentResponse(200, "application/json"), false);
	assert.equal(isSuccessfulAgentResponse(200, undefined), false);
});

test("Cursor runtime settings validate retry and tool limits", () => {
	const defaults = resolveCursorSettings();
	assert.equal(defaults.maxToolRounds, 64);
	assert.equal(defaults.retryCount, 0);
	assert.equal(defaults.retryIntervalMs, 1000);
	assert.deepEqual(defaults.retryHttpStatusCodes, [408, 425, 429, 500, 502, 503, 504]);
	const custom = resolveCursorSettings({
		maxToolRounds: 17,
		retryCount: 3,
		retryIntervalMs: 250,
		retryHttpStatusCodes: [429, 503],
	});
	assert.equal(shouldRetryHttpStatus(503, 2, custom), true);
	assert.equal(shouldRetryHttpStatus(503, 3, custom), false);
	assert.equal(shouldRetryHttpStatus(500, 0, custom), false);
	assert.throws(() => resolveCursorSettings({ retryHttpStatusCodes: [500, 500] }), /duplicates/);
	assert.throws(() => resolveCursorSettings({ maxToolRounds: 0 }), /maxToolRounds/);
	assert.throws(() => resolveCursorSettings({ retryCount: 11 }), /retryCount/);
});

test("Cursor adapter retries configured pre-output HTTP statuses", async () => {
	const statuses = [503, 200];
	const created = [];
	const delays = [];
	class FakeRun {
		constructor(status) {
			this.status = status;
			this.responseContentType = "application/connect+proto";
			this.finished = false;
			this.stream = { destroyed: false };
			this.frames = {
				next: async () => this.frameTaken++ === 0
					? { flags: CONNECT_END_STREAM_FLAG, payload: Buffer.from("{}") }
					: undefined,
			};
			this.frameTaken = 0;
		}
		async start() {}
		writeMessage() { return true; }
		async waitForResponse() { return this.status; }
		startHeartbeat() {}
		abort() { this.close(); }
		close() { this.finished = true; this.stream.destroyed = true; }
	}
	const adapter = new CursorAdapter({
		auth: { accessToken: async () => "test-token" },
		settings: () => resolveCursorSettings({ retryCount: 2, retryIntervalMs: 1234, retryHttpStatusCodes: [503] }),
		createAgentRun: () => {
			const run = new FakeRun(statuses[created.length]);
			created.push(run);
			return run;
		},
		sleep: async (ms) => delays.push(ms),
	});
	const chunks = [];
	for await (const chunk of adapter.stream({
		provider: "cursor-subscription",
		model: "test-model",
		sessionId: "retry-test",
		messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
	})) chunks.push(chunk);
	assert.equal(created.length, 2);
	assert.deepEqual(delays, [1234]);
	assert.equal(chunks.at(-1).type, "finish");
	assert.deepEqual(chunks.at(-1).reason, { kind: "stop" });
});

test("Cursor adapter stalls when the server only sends heartbeats", async () => {
	// AgentServerMessage { interaction_update = 1 } -> InteractionUpdate { heartbeat = 13 }
	const heartbeatAgentFrame = new Writer()
		.message(1, new Writer().message(13, new Uint8Array(0)).finish())
		.finish();
	let failed;
	let run;
	const frames = {
		next: async () => {
			if (failed !== undefined) throw failed;
			await new Promise((resolve) => setTimeout(resolve, 10));
			return { flags: 0, payload: heartbeatAgentFrame };
		},
		fail: (error) => {
			failed = error;
		},
		ended: false,
		finish: () => {},
	};
	class StalledRun {
		constructor() {
			this.finished = false;
			this.stream = { destroyed: false };
			this.responseContentType = "application/connect+proto";
		}
		async start() {}
		writeMessage() { return true; }
		async waitForResponse() { return 200; }
		startHeartbeat() {}
		abort(error) { this.frames.fail(error); this.close(); }
		close() { this.finished = true; this.stream.destroyed = true; }
	}
	run = new StalledRun();
	run.frames = frames;
	const adapter = new CursorAdapter({
		auth: { accessToken: async () => "test-token" },
		settings: () => resolveCursorSettings(),
		createAgentRun: () => run,
		progressTimeoutMs: 80,
		idleCheckIntervalMs: 25,
	});
	const chunks = [];
	for await (const chunk of adapter.stream({
		provider: "cursor-subscription",
		model: "test-model",
		sessionId: "stall-test",
		messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
	})) chunks.push(chunk);
	const finish = chunks.at(-1);
	assert.equal(finish.type, "finish");
	assert.equal(finish.reason.kind, "error");
	assert.equal(finish.reason.failure.code, "TIMEOUT");
	assert.match(finish.reason.failure.message, /progress timeout/);
});

test("Cursor settings RPC reads and updates only public runtime fields", async () => {
	let current = resolveCursorSettings();
	let revision = 4;
	const handler = createCursorRpcHandler({}, {
		settings: {
			read: () => ({ ...current, revision }),
			update: async (patch, expectedRevision) => {
				assert.equal(expectedRevision, revision);
				current = resolveCursorSettings({ ...current, ...patch });
				revision++;
				return { ...current, revision };
			},
		},
	});
	const signal = new AbortController().signal;
	const read = await handler("settings", {}, signal);
	assert.equal(read.ok, true);
	assert.equal(read.value.maxToolRounds, 64);
	assert.equal(read.value.revision, 4);
	const updated = await handler("settings/update", {
		revision: 4,
		maxToolRounds: 25,
		retryCount: 1,
		retryIntervalMs: 10,
		retryHttpStatusCodes: [429, 503],
		accessToken: "must-not-pass-through",
	}, signal);
	assert.equal(updated.ok, true);
	assert.deepEqual(updated.value, {
		maxToolRounds: 25,
		retryCount: 1,
		retryIntervalMs: 10,
		retryHttpStatusCodes: [429, 503],
		revision: 5,
	});
});
