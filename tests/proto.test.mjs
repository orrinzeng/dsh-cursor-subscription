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
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
	decodeExecServerMessage,
	rejectionFor,
	TOOL_REJECT_REASON,
	CREDENTIAL_REF,
	getTokenExpiry,
	getTokenSub,
	parseLegacyBucket,
	getRequestCountFromSpendCents,
	computeIncludedRequests,
	parseUsageSummary,
	parseModelAggregations,
	parseModelUsage,
	usagePools,
	usageModelPool,
	sortModelsByName,
	parseRequestQuotaPerSeat,
	resolveCursorSettings,
	shouldRetryHttpStatus,
	Config,
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
			plan: { used: 2000, limit: 2000, totalPercentUsed: 52.84, autoPercentUsed: 23.17, apiPercentUsed: 100 },
			onDemand: { used: 1273, limit: null, remaining: null },
		},
		teamUsage: { onDemand: { used: 8052, limit: 8000, remaining: 0 } },
	});
	assert.equal(parsed.membershipType, "enterprise");
	assert.equal(parsed.isTeam, true);
	assert.equal(parsed.planUsedCents, 2000);
	assert.equal(parsed.totalPercentUsed, 52.84);
	assert.equal(parsed.autoPercentUsed, 23.17);
	assert.equal(parsed.apiPercentUsed, 100);
	assert.deepEqual(parsed.individualOnDemand, { usedDollars: 12.73 });
	assert.deepEqual(parsed.teamOnDemand, { usedDollars: 80.52, limitDollars: 80, remainingDollars: 0 });
});

test("parseUsageSummary coerces string percents and falls back to the API usage message", () => {
	const parsed = parseUsageSummary({
		namedModelSelectedDisplayMessage: "You've used 100% of your included API usage",
		individualUsage: { plan: { autoPercentUsed: "23.17" } },
	});
	assert.equal(parsed.autoPercentUsed, 23.17);
	assert.equal(parsed.apiPercentUsed, 100);
});

test("parseUsageSummary omits apiPercentUsed when Cursor does not report it", () => {
	const parsed = parseUsageSummary({
		individualUsage: { plan: { autoPercentUsed: 10 } },
	});
	assert.equal(parsed.apiPercentUsed, undefined);
});

test("parseUsageSummary reads team plan percents when individual plan is absent", () => {
	const parsed = parseUsageSummary({
		teamUsage: { plan: { autoPercentUsed: 5, apiPercentUsed: "80" } },
	});
	assert.equal(parsed.autoPercentUsed, 5);
	assert.equal(parsed.apiPercentUsed, 80);
});

test("parseModelAggregations sorts named models by spend and drops empty rows", () => {
	const models = parseModelAggregations(
		{
			aggregations: [
				{ modelIntent: "claude-4.6-opus-high", totalCents: 2826.24, tier: 1 },
				{ modelIntent: "cursor-grok-4.6-high", totalCents: 17612.98, tier: 1 },
				{ modelIntent: "composer-2", totalCents: 0, tier: 2 },
				{ modelIntent: "  ", totalCents: 12, tier: 1 },
			],
			totalCostCents: 20439.22,
		},
		{ apiPercentUsed: 100 },
	);
	assert.deepEqual(models, [
		{ id: "cursor-grok-4.6-high", pool: "api", spentDollars: 176.13, pct: 86.2 },
		{ id: "claude-4.6-opus-high", pool: "api", spentDollars: 28.26, pct: 13.8 },
	]);
	assert.deepEqual(parseModelAggregations({ aggregations: [] }), []);
	assert.deepEqual(parseModelAggregations({}), []);
});

test("parseModelAggregations scales each model by its own pool percentage", () => {
	// A single Other Models model reads the pool row's percentage, which is what
	// the dashboard prints for it — not this list's internal 100% share.
	const live = parseModelAggregations(
		{ aggregations: [{ modelIntent: "claude-opus-5-high", totalCents: 3120.763055, tier: 1 }] },
		{ autoPercentUsed: 0, apiPercentUsed: 15.604999999999999 },
	);
	assert.deepEqual(live, [{ id: "claude-opus-5-high", pool: "api", spentDollars: 31.21, pct: 15.6 }]);

	// Two models of one pool split that pool's percentage by their spend.
	const shared = parseModelAggregations(
		{
			aggregations: [
				{ modelIntent: "claude-opus-5-high", totalCents: 3120.763, tier: 1 },
				{ modelIntent: "gpt-5", totalCents: 1040.254, tier: 1 },
			],
		},
		{ apiPercentUsed: 15.604999999999999 },
	);
	assert.deepEqual(shared, [
		{ id: "claude-opus-5-high", pool: "api", spentDollars: 31.21, pct: 11.7 },
		{ id: "gpt-5", pool: "api", spentDollars: 10.4, pct: 3.9 },
	]);

	// Cursor Models rows scale against the auto pool instead.
	const mixed = parseModelAggregations(
		{
			aggregations: [
				{ modelIntent: "composer-2", totalCents: 7500, tier: 2 },
				{ modelIntent: "claude-opus-5-high", totalCents: 2500, tier: 1 },
			],
		},
		{ autoPercentUsed: 8, apiPercentUsed: 40 },
	);
	assert.deepEqual(mixed, [
		{ id: "composer-2", pool: "auto", spentDollars: 75, pct: 8 },
		{ id: "claude-opus-5-high", pool: "api", spentDollars: 25, pct: 40 },
	]);
});

test("parseModelAggregations omits pct when the pool percentage is unknown", () => {
	const models = parseModelAggregations({ aggregations: [{ modelIntent: "gpt-5", totalCents: 500, tier: 1 }] });
	assert.deepEqual(models, [{ id: "gpt-5", pool: "api", spentDollars: 5 }]);
	assert.equal("pct" in models[0], false, "an unreported pool percentage is never rendered as 0%");
});

test("usageModelPool follows the dashboard's tier split", () => {
	assert.equal(usageModelPool({ modelIntent: "composer-2", tier: 2 }), "auto");
	assert.equal(usageModelPool({ modelIntent: "composer-2", tier: "2" }), "auto");
	assert.equal(usageModelPool({ modelIntent: "default" }), "auto");
	assert.equal(usageModelPool({ modelIntent: "default", tier: 1 }), "api");
	assert.equal(usageModelPool({ modelIntent: "claude-opus-5-high", tier: 1 }), "api");
	assert.equal(usageModelPool({ modelIntent: "claude-opus-5-high" }), "api");
});

test("parseModelUsage reports pool token totals beside the model rows", () => {
	// The live aggregate for one Other Models model: the pool row and the model
	// row carry the same tokens and the same percentage, as the dashboard shows.
	const usage = parseModelUsage(
		{
			aggregations: [
				{
					modelIntent: "claude-opus-5-high",
					tier: 1,
					inputTokens: "196812",
					outputTokens: "109116",
					cacheWriteTokens: "1463827",
					cacheReadTokens: "25216789",
					totalCents: 3120.763055,
				},
				{ modelIntent: "composer-2", tier: 2, inputTokens: 1000, outputTokens: 500, totalCents: 900 },
			],
			totalCostCents: 4020.763055,
		},
		{ autoPercentUsed: 0.9, apiPercentUsed: 15.604999999999999 },
	);
	assert.deepEqual(usage.pools, { auto: { tokens: 1500 }, api: { tokens: 26986544 } });
	assert.deepEqual(usage.models, [
		{ id: "claude-opus-5-high", pool: "api", spentDollars: 31.21, tokens: 26986544, pct: 15.6 },
		{ id: "composer-2", pool: "auto", spentDollars: 9, tokens: 1500, pct: 0.9 },
	]);
});

test("parseModelUsage marks Auto usage that spilled into the Other Models pool", () => {
	const usage = parseModelUsage(
		{
			aggregations: [
				{ modelIntent: "default", tier: 1, totalCents: 5000, inputTokens: 2000 },
				{ modelIntent: "gpt-5", tier: 1, totalCents: 5000, inputTokens: 500 },
			],
		},
		{ apiPercentUsed: 10 },
	);
	assert.deepEqual(usage.models, [
		{ id: "default", pool: "api", spentDollars: 50, tokens: 2000, overflow: true, pct: 5 },
		{ id: "gpt-5", pool: "api", spentDollars: 50, tokens: 500, pct: 5 },
	]);
	assert.deepEqual(usage.pools, { auto: { tokens: 0 }, api: { tokens: 2500 } });
});

test("usagePools keeps the reported percentages when the model list is unavailable", () => {
	assert.deepEqual(usagePools({ autoPercentUsed: 0, apiPercentUsed: 15.605 }, undefined), {
		auto: { pct: 0 },
		api: { pct: 15.605 },
	});
	assert.deepEqual(usagePools({}, undefined), {});
	assert.deepEqual(
		usagePools({ autoPercentUsed: 0 }, { pools: { auto: { tokens: 0 }, api: { tokens: 120 } } }),
		{ auto: { pct: 0, tokens: 0 }, api: { tokens: 120 } },
		"a pool with tokens but no reported percentage still renders",
	);
});

test("sortModelsByName orders the picker list by name", () => {
	// GetUsableModels answers newest-family-first, which is not an order a
	// picker should show; the list is sorted by display name instead.
	const listed = sortModelsByName([
		{ id: "gpt-5.1-codex", name: "GPT-5.1 Codex" },
		{ id: "composer-2", name: "Composer 2" },
		{ id: "claude-4.6-opus-high", name: "Claude 4.6 Opus" },
		{ id: "gpt-10", name: "GPT-10" },
		{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
		{ id: "gpt-5", name: "GPT-5" },
	]);
	assert.deepEqual(
		listed.map((model) => model.id),
		["claude-4.6-opus-high", "composer-2", "gemini-2.5-pro", "gpt-5", "gpt-5.1-codex", "gpt-10"],
		"names sort case-insensitively with numbers in natural order",
	);
	// The caller's array keeps its order, so a cached list is never reordered
	// under a caller that is holding it.
	const source = [{ id: "b", name: "Beta" }, { id: "a", name: "Alpha" }];
	sortModelsByName(source);
	assert.deepEqual(source.map((model) => model.id), ["b", "a"]);
});

test("sortModelsByName falls back to the id for equal names", () => {
	assert.deepEqual(
		sortModelsByName([
			{ id: "same-b", name: "Same" },
			{ id: "same-a", name: "Same" },
		]).map((model) => model.id),
		["same-a", "same-b"],
	);
});

test("the adapter sorts both the picker list and the RPC list", async () => {
	const adapter = new CursorAdapter({
		auth: { accessToken: async () => "token" },
		fetchModels: async () => [
			{ id: "gpt-5", name: "GPT-5" },
			{ id: "composer-2", name: "Composer 2" },
			{ id: "claude-4.6-opus-high", name: "Claude 4.6 Opus" },
		],
		fallbackModels: [],
	});
	assert.deepEqual(
		(await adapter.listModels("cursor-subscription")).map((model) => model.id),
		["claude-4.6-opus-high", "composer-2", "gpt-5"],
	);
	assert.deepEqual(
		(await adapter.listModelsForRpc()).map((model) => model.id),
		["claude-4.6-opus-high", "composer-2", "gpt-5"],
		"the settings list reads the same cache and keeps the same order",
	);
});

test("the fallback list is sorted by name too", async () => {
	const adapter = new CursorAdapter({
		auth: { accessToken: async () => "token" },
		fetchModels: async () => {
			throw new Error("offline");
		},
	});
	const listed = await adapter.listModels("cursor-subscription");
	assert.deepEqual(listed.map((model) => model.id), [
		"claude-3.5-sonnet",
		"claude-4-sonnet",
		"claude-sonnet-4",
		"composer-2",
		"cursor-small",
		"gemini-2.5-pro",
		"gpt-4.1",
		"gpt-4o",
		"o3",
		"o4-mini",
	]);
	assert.ok(listed.every((model) => typeof model.name === "string" && model.name.length > 0));
});

test("an exec this build cannot decode keeps its field number so it can be answered", () => {
	// Live shape (2026-09-22): id=2, span_context=19, the new exec=36,
	// and a varint flag=55. Field 19 is a plain non-oneof field, so it must not
	// be mistaken for the exec — nothing would be answered and the step would
	// hang until the progress watchdog fired.
	const bytes = new Writer()
		.varint(1, 2)
		.message(19, new Writer().string(1, "35c7dd8e7cc94e59bf2dcdecc5df4a0c").string(2, "68c4679933f05ade").finish())
		.message(36, new Writer().string(1, "dsh-cursor-subscription").finish())
		.varint(55, 0)
		.finish();
	const exec = decodeExecServerMessage(bytes);
	assert.deepEqual(exec, { id: 2, execId: "", case: "unknown", field: 36, seen: [1, 19, 36, 55] });

	const reply = rejectionFor(exec);
	assert.equal(reply.field, 36, "the reply must use the exec's own field number");
	assert.deepEqual(decodeExecErrorText(reply.payload), TOOL_REJECT_REASON);

	// A message carrying only ids and a span context has no exec to answer.
	const contextOnly = new Writer().varint(1, 3).message(19, new Writer().string(1, "trace").finish()).finish();
	const bare = decodeExecServerMessage(contextOnly);
	assert.equal(bare.field, undefined);
	assert.equal(rejectionFor(bare), undefined, "an unaddressable exec must not be answered on the span-context field");
});

test("every outright-rejected exec answers on its own field number", () => {
	// ExecClientMessage mirrors ExecServerMessage's numbering, which is the
	// invariant that lets an unknown exec be answered generically. Pin it for
	// every exec this build decodes but does not implement.
	for (const field of [2, 3, 4, 5, 7, 8, 9, 14, 16, 17, 18, 20, 21, 22, 23]) {
		const bytes = new Writer().varint(1, 1).message(field, new Writer().string(1, "D:\\work\\file.txt").string(2, "x").finish()).finish();
		const exec = decodeExecServerMessage(bytes);
		assert.notEqual(exec.case, "unknown", `exec field ${field} must decode`);
		assert.equal(rejectionFor(exec)?.field, field, `exec field ${field} must reply on its own number`);
	}
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
		const href = String(url);
		const body =
			href.includes("/api/usage?user=")
				? { "gpt-4": { numRequests: 100, maxRequestUsage: 500 } }
				: href.includes("/api/usage-summary")
					? {
							membershipType: "pro",
							limitType: "individual",
							isUnlimited: false,
							billingCycleStart: "2026-07-20T00:00:00.000Z",
							billingCycleEnd: "2026-08-20T00:00:00.000Z",
							individualUsage: { plan: { used: 400, limit: 2000, totalPercentUsed: 20, autoPercentUsed: 12, apiPercentUsed: 40 }, onDemand: { used: 100, limit: null } },
						}
					: href.includes("/api/dashboard/get-aggregated-usage-events")
						? {
								aggregations: [{ modelIntent: "claude-4.6-opus-high", totalCents: 2500, tier: 1, inputTokens: 100, cacheReadTokens: 900 }],
								totalCostCents: 2500,
							}
						: { teams: [] };
		return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
	};
	const reader = new CursorUsageReader(auth, { fetch: fetchImpl, now: () => 1787000000000 });
	const usage = await reader.read();
	assert.equal(usage.includedRequests.used, 100);
	assert.equal(usage.includedRequests.limit, 500);
	assert.equal(usage.plan.totalPercentUsed, 20);
	assert.equal(usage.plan.autoPercentUsed, 12);
	assert.equal(usage.plan.apiPercentUsed, 40);
	assert.deepEqual(usage.models, [{ id: "claude-4.6-opus-high", pool: "api", spentDollars: 25, tokens: 1000, pct: 40 }]);
	assert.deepEqual(usage.pools, { auto: { pct: 12, tokens: 0 }, api: { pct: 40, tokens: 1000 } });
	assert.equal(usage.billingCycle.daysLeft, 3);
	assert.equal(usage.individualOnDemand.usedDollars, 1);
	assert.equal(seen.length, 4);
	for (const entry of seen) {
		assert.equal(entry.cookie, `WorkosCursorSessionToken=user_01TEST::${access}`);
	}
	assert.ok(seen.some((entry) => entry.method === "POST" && entry.url.includes("/api/dashboard/teams")));
	assert.ok(seen.some((entry) => entry.method === "POST" && entry.url.includes("/api/dashboard/get-aggregated-usage-events")));
});

test("CursorUsageReader keeps summary usage when aggregated model spend is unavailable", async () => {
	const access = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "github|user_01TEST" })).toString("base64url")}.sig`;
	const auth = {
		credential: async () => ({ access, refresh: "r", expires: Date.now() + 1e6 }),
	};
	const fetchImpl = async (url) => {
		const href = String(url);
		if (href.includes("/api/dashboard/get-aggregated-usage-events")) {
			return new Response("nope", { status: 404 });
		}
		const body = href.includes("/api/usage-summary")
			? {
					membershipType: "pro",
					individualUsage: { plan: { autoPercentUsed: 10, apiPercentUsed: 90 } },
				}
			: href.includes("/api/usage?user=")
				? { "gpt-4": { numRequests: 1, maxRequestUsage: 500 } }
				: { teams: [] };
		return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
	};
	const usage = await new CursorUsageReader(auth, { fetch: fetchImpl, now: () => 1787000000000 }).read();
	assert.equal(usage.plan.apiPercentUsed, 90);
	assert.deepEqual(usage.models, []);
	assert.deepEqual(usage.pools, { auto: { pct: 10 }, api: { pct: 90 } }, "pool percentages survive a failed model read");
});

test("CursorUsageReader always emits apiPercentUsed from the API usage message", async () => {
	const access = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "github|user_01TEST" })).toString("base64url")}.sig`;
	const auth = {
		credential: async () => ({ access, refresh: "r", expires: Date.now() + 1e6 }),
	};
	const fetchImpl = async (url) => {
		const href = String(url);
		if (href.includes("/api/dashboard/get-aggregated-usage-events")) {
			return new Response("nope", { status: 404 });
		}
		const body = href.includes("/api/usage-summary")
			? {
					membershipType: "pro",
					namedModelSelectedDisplayMessage: "You've used 100% of your included API usage",
					individualUsage: { plan: { autoPercentUsed: 10 } },
				}
			: href.includes("/api/usage?user=")
				? { "gpt-4": { numRequests: 1, maxRequestUsage: 500 } }
				: { teams: [] };
		return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
	};
	const usage = await new CursorUsageReader(auth, { fetch: fetchImpl, now: () => 1787000000000 }).read();
	assert.equal(usage.plan.autoPercentUsed, 10);
	assert.equal(usage.plan.apiPercentUsed, 100);
});

test("CursorUsageReader keeps summary percents when teams and usage endpoints fail", async () => {
	const access = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "github|user_01TEST" })).toString("base64url")}.sig`;
	const auth = {
		credential: async () => ({ access, refresh: "r", expires: Date.now() + 1e6 }),
	};
	const fetchImpl = async (url) => {
		const href = String(url);
		if (href.includes("/api/usage-summary")) {
			return new Response(JSON.stringify({
				membershipType: "enterprise",
				individualUsage: { plan: { autoPercentUsed: 42, apiPercentUsed: 100 } },
			}), { status: 200, headers: { "content-type": "application/json" } });
		}
		return new Response("nope", { status: 500 });
	};
	const usage = await new CursorUsageReader(auth, { fetch: fetchImpl, now: () => 1787000000000 }).read();
	assert.equal(usage.plan.autoPercentUsed, 42);
	assert.equal(usage.plan.apiPercentUsed, 100);
	assert.deepEqual(usage.models, []);
});

test("CursorUsageReader surfaces HTTP status when summary and usage both fail", async () => {
	const access = `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "github|user_01TEST" })).toString("base64url")}.sig`;
	const auth = {
		credential: async () => ({ access, refresh: "r", expires: Date.now() + 1e6 }),
	};
	const fetchImpl = async () => new Response("nope", { status: 401 });
	await assert.rejects(
		() => new CursorUsageReader(auth, { fetch: fetchImpl, now: () => 1787000000000 }).read(),
		/HTTP 401/,
	);
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
	assert.equal(defaults.maxToolRounds, 200);
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

test("Cursor settings read live volatile references", () => {
	// DSH 0.1.7 hands every `.volatile()` field to the plugin as a reference the
	// Loader keeps updating in place, so reading the reference is what carries a
	// saved edit into a Cursor run that is already in flight. A field that loses
	// the marker also drops the whole section from the generated settings page,
	// because DSH builds the form from the volatile fields alone.
	for (const [field, schema] of Object.entries(Config.dict)) {
		assert.equal(schema.meta?.volatile, true, `${field} must stay volatile: DSH derives the settings page from it`);
	}
	/** A Loader reference: one stable object whose value changes in place. */
	const reference = (initial) => {
		let current = initial;
		return { get: () => current, set: (next) => { current = next; } };
	};
	const maxToolRounds = reference(17);
	const live = resolveCursorSettings({
		maxToolRounds,
		retryCount: reference(2),
		retryIntervalMs: reference(250),
		retryHttpStatusCodes: reference([429]),
	});
	assert.equal(live.maxToolRounds, 17);
	assert.equal(live.retryCount, 2);
	assert.equal(live.retryIntervalMs, 250);
	assert.deepEqual(live.retryHttpStatusCodes, [429]);
	maxToolRounds.set(23);
	assert.equal(resolveCursorSettings({ maxToolRounds }).maxToolRounds, 23, "a live edit is visible on the next read");
	// A volatile field the user never set still arrives as a reference, holding
	// undefined; the documented default applies.
	assert.equal(resolveCursorSettings({ maxToolRounds: reference(undefined) }).maxToolRounds, 200);
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
		hangTracePath: join(tmpdir(), `cursor-hang-${process.pid}-stall.log`),
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

test("Cursor adapter keeps a delivered answer when the server goes silent", async () => {
	// AgentServerMessage { interaction_update = 1 } ->
	//   InteractionUpdate { text_delta = 1 { text = 1 } } / { heartbeat = 13 }
	const textFrame = new Writer()
		.message(1, new Writer().message(1, new Writer().string(1, "已完成的结论").finish()).finish())
		.finish();
	const heartbeatFrame = new Writer()
		.message(1, new Writer().message(13, new Uint8Array(0)).finish())
		.finish();
	const queue = [textFrame];
	let ended = false;
	let paused = false;
	let failure;
	class SilentRun {
		constructor() {
			this.finished = false;
			this.stream = { destroyed: false };
			this.responseContentType = "application/connect+proto";
			this.frames = {
				next: async () => {
					if (failure !== undefined) throw failure;
					if (ended) return undefined;
					const frame = queue.shift();
					if (frame !== undefined) return { flags: 0, payload: frame };
					if (paused) return undefined;
					await new Promise((resolve) => setTimeout(resolve, 5));
					if (failure !== undefined) throw failure;
					return ended ? undefined : { flags: 0, payload: heartbeatFrame };
				},
				pause: () => {
					paused = true;
				},
				finish: () => {
					ended = true;
				},
				fail: (error) => {
					failure = error;
					ended = true;
				},
				ended: false,
			};
		}
		async start() {}
		writeMessage() { return true; }
		async waitForResponse() { return 200; }
		startHeartbeat() {}
		abort(error) { this.frames.fail(error); this.close(); }
		close() { this.finished = true; this.stream.destroyed = true; }
	}
	const tracePath = join(tmpdir(), `cursor-hang-${process.pid}-${Date.now()}.log`);
	rmSync(tracePath, { force: true });
	const run = new SilentRun();
	const adapter = new CursorAdapter({
		auth: { accessToken: async () => "test-token" },
		settings: () => resolveCursorSettings(),
		createAgentRun: () => run,
		progressTimeoutMs: 60,
		idleCheckIntervalMs: 15,
		hangTracePath: tracePath,
	});
	const chunks = [];
	for await (const chunk of adapter.stream({
		provider: "cursor-subscription",
		model: "test-model",
		sessionId: "silent-after-answer",
		messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
	})) chunks.push(chunk);
	const finish = chunks.at(-1);
	assert.equal(finish.type, "finish");
	assert.deepEqual(finish.reason, { kind: "stop" });
	assert.equal(
		chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.text).join(""),
		"已完成的结论",
	);
	const trace = readFileSync(tracePath, "utf8");
	assert.match(trace, /progress timeout/);
	assert.match(trace, /text\(6\)/);
	assert.match(trace, /heartbeat/);
	rmSync(tracePath, { force: true });
});

test("Cursor adapter returns MCP tool calls when no checkpoint follows mcpArgs", async () => {
	// Traced hang shape: `toolCallStarted | checkpoint | exec:mcpArgs` and then
	// nothing but heartbeats. The step must hand its tool call to DSH instead of
	// waiting for a second checkpoint until the progress watchdog fires.
	const tools = [{
		name: "bash",
		description: "run shell",
		parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
	}];
	const heartbeatFrame = new Writer()
		.message(1, new Writer().message(13, new Uint8Array(0)).finish())
		.finish();
	const queue = [
		{ flags: 0, payload: encodeAgentCheckpointFrame(new Uint8Array([1, 2, 3])) },
		{ flags: 0, payload: encodeAgentMcpArgsFrame({ id: 1, execId: "exec-1", name: "bash", toolCallId: "tool-1", toolName: "bash", args: { command: "pwd" } }) },
	];
	const paused = { value: false };
	class BurstRun {
		constructor() {
			this.finished = false;
			this.stream = { destroyed: false };
			this.responseContentType = "application/connect+proto";
			this.frames = {
				next: async () => {
					const frame = queue.shift();
					if (frame !== undefined) return frame;
					if (paused.value) return undefined;
					await new Promise((resolve) => setTimeout(resolve, 5));
					return { flags: 0, payload: heartbeatFrame };
				},
				pause: () => {
					paused.value = true;
				},
				resume: () => {
					paused.value = false;
				},
				finish: () => {
					paused.value = true;
				},
			};
		}
		async start() {}
		writeMessage() { return true; }
		async waitForResponse() { return 200; }
		startHeartbeat() {}
		abort() { this.close(); }
		close() { this.finished = true; this.stream.destroyed = true; }
	}
	const run = new BurstRun();
	const adapter = new CursorAdapter({
		auth: { accessToken: async () => "test-token" },
		settings: () => resolveCursorSettings(),
		createAgentRun: () => run,
		toolCallSettleMs: 40,
		progressTimeoutMs: 5000,
		idleCheckIntervalMs: 25,
		hangTracePath: join(tmpdir(), `cursor-hang-${process.pid}-burst.log`),
	});
	const chunks = [];
	const startedAt = Date.now();
	for await (const chunk of adapter.stream({
		provider: "cursor-subscription",
		model: "test-model",
		sessionId: "tool-burst",
		tools,
		messages: [{ role: "user", content: [{ type: "text", text: "inspect" }] }],
	})) chunks.push(chunk);
	assert.ok(Date.now() - startedAt < 2000, "the tool-call step must settle instead of waiting for the watchdog");
	assert.deepEqual(chunks.at(-1).reason, { kind: "tool-calls" });
	assert.deepEqual(
		chunks.filter((chunk) => chunk.type === "block-end" && chunk.block?.type === "tool-call").map((chunk) => chunk.block.name),
		["bash"],
	);
	assert.equal(run.finished, false, "the run must stay alive so the tool result can resume it");
	assert.equal(paused.value, true, "the reader must be paused, not ended");

	// The next DSH step resumes the same run and reads it again.
	const written = [];
	run.writeMessage = (bytes) => {
		written.push(Buffer.from(bytes));
		return true;
	};
	queue.push({
		flags: 0,
		payload: new Writer().message(1, new Writer().message(1, new Writer().string(1, "工具结果已收到").finish()).finish()).finish(),
	});
	queue.push({ flags: 0, payload: encodeAgentCheckpointFrame(new Uint8Array([4, 5, 6])) });
	queue.push({ flags: 0, payload: new Writer().message(1, new Writer().message(14, new Uint8Array(0)).finish()).finish() });
	const second = [];
	for await (const chunk of adapter.stream({
		provider: "cursor-subscription",
		model: "test-model",
		sessionId: "tool-burst",
		tools,
		messages: [
			{ role: "user", content: [{ type: "text", text: "inspect" }] },
			{ role: "assistant", content: [{ type: "tool-call", id: "tool-1", name: "bash", arguments: "{\"command\":\"pwd\"}" }] },
			{ role: "user", content: [{ type: "tool-result", toolCallId: "tool-1", content: [{ type: "text", text: "/tmp" }], isError: false }] },
		],
	})) second.push(chunk);
	assert.equal(written.length, 1, "the resumed step must send exactly one MCP result");
	assert.equal(
		second.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.text).join(""),
		"工具结果已收到",
	);
	assert.deepEqual(second.at(-1).reason, { kind: "stop" });
});

test("Cursor adapter finishes the step when the server signals turn_ended", async () => {
	// AgentServerMessage { interaction_update = 1 } ->
	//   InteractionUpdate { text_delta = 1 { text = 1 } } / { turn_ended = 14 }
	const textFrame = new Writer()
		.message(1, new Writer().message(1, new Writer().string(1, "结论").finish()).finish())
		.finish();
	const turnEndedFrame = new Writer()
		.message(1, new Writer().message(14, new Uint8Array(0)).finish())
		.finish();
	const heartbeatFrame = new Writer()
		.message(1, new Writer().message(13, new Uint8Array(0)).finish())
		.finish();
	const queue = [
		{ flags: 0, payload: textFrame },
		{ flags: 0, payload: encodeAgentCheckpointFrame() },
		{ flags: 0, payload: turnEndedFrame },
	];
	class TurnEndedRun {
		constructor() {
			this.finished = false;
			this.stream = { destroyed: false };
			this.responseContentType = "application/connect+proto";
			this.frames = {
				next: async () => {
					if (this.failure !== undefined) throw this.failure;
					const next = queue.shift();
					if (next !== undefined) return next;
					// Cursor keeps the run alive with heartbeats instead of closing
					// it; without honoring turn_ended this becomes a progress timeout.
					await new Promise((resolve) => setTimeout(resolve, 5));
					return { flags: 0, payload: heartbeatFrame };
				},
				fail: (error) => {
					this.failure = error;
				},
			};
		}
		async start() {}
		writeMessage() { return true; }
		async waitForResponse() { return 200; }
		startHeartbeat() {}
		abort(error) { this.frames.fail(error); this.close(); }
		close() { this.finished = true; this.stream.destroyed = true; }
	}
	const run = new TurnEndedRun();
	const adapter = new CursorAdapter({
		auth: { accessToken: async () => "test-token" },
		settings: () => resolveCursorSettings(),
		createAgentRun: () => run,
		progressTimeoutMs: 60,
		idleCheckIntervalMs: 15,
	});
	const chunks = [];
	for await (const chunk of adapter.stream({
		provider: "cursor-subscription",
		model: "test-model",
		sessionId: "turn-ended-test",
		messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
	})) chunks.push(chunk);
	assert.equal(chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.text).join(""), "结论");
	const finish = chunks.at(-1);
	assert.equal(finish.type, "finish");
	assert.deepEqual(finish.reason, { kind: "stop" });
	assert.equal(run.finished, true, "turn_ended must close the run instead of waiting for the stream");
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
	assert.equal(read.value.maxToolRounds, 200);
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

test("a Cursor checkpoint captured before DSH compaction is not reused", async () => {
	// DSH frees context by replacing a span of the conversation with a summary
	// and marking that message `source.kind = "compact-checkpoint"`. Cursor's own
	// conversation checkpoint still described the pre-compaction transcript, so
	// the run continued on the context DSH had just dropped and re-planned the
	// same work step after step.
	const COLD_START = "Continue the DSH conversation below.";
	const userMessage = (text, source) => ({
		role: "user",
		...(source === undefined ? {} : { source }),
		content: [{ type: "text", text }],
	});
	const buildAdapter = (runs) => {
		const written = [];
		const queues = runs.map((frames) => [...frames]);
		class Run {
			constructor() {
				this.queue = queues.shift() ?? [];
				this.finished = false;
				this.stream = { destroyed: false };
				this.responseContentType = "application/connect+proto";
				this.frames = {
					next: async () => this.queue.shift(),
					pause: () => {},
					resume: () => {},
					finish: () => {},
				};
			}
			async start() {}
			writeMessage(bytes) {
				written.push(Buffer.from(bytes));
				return true;
			}
			async waitForResponse() { return 200; }
			startHeartbeat() {}
			abort() { this.close(); }
			close() { this.finished = true; this.stream.destroyed = true; }
		}
		return {
			adapter: new CursorAdapter({
				auth: { accessToken: async () => "test-token" },
				settings: () => resolveCursorSettings(),
				createAgentRun: () => new Run(),
			}),
			written,
		};
	};
	const drive = async (adapter, sessionId, messages) => {
		const chunks = [];
		for await (const chunk of adapter.stream({ provider: "cursor-subscription", model: "test-model", sessionId, messages })) chunks.push(chunk);
		return chunks;
	};
	const seed = [
		{ flags: 0, payload: encodeAgentCheckpointFrame(new Uint8Array([7, 7, 7])) },
		{ flags: 0, payload: encodeAgentTurnEndedFrame() },
	];
	const quiet = [{ flags: 0, payload: encodeAgentTurnEndedFrame() }];

	const control = buildAdapter([seed, quiet]);
	await drive(control.adapter, "compaction-control", [userMessage("first request")]);
	control.written.length = 0;
	await drive(control.adapter, "compaction-control", [userMessage("first request"), userMessage("second request")]);
	assert.ok(
		!control.written.map((bytes) => bytes.toString("utf8")).join("").includes(COLD_START),
		"a history DSH has not rewritten keeps reusing the Cursor checkpoint",
	);

	const compacted = buildAdapter([seed, quiet]);
	await drive(compacted.adapter, "compaction-test", [userMessage("first request")]);
	compacted.written.length = 0;
	await drive(compacted.adapter, "compaction-test", [
		userMessage("first request"),
		userMessage("condensed summary", { kind: "compact-checkpoint", compactionId: "compaction-1" }),
	]);
	assert.ok(
		compacted.written.map((bytes) => bytes.toString("utf8")).join("").includes(COLD_START),
		"a compacted history is rebuilt from what DSH kept instead of the stale checkpoint",
	);
});

test("the adapter reports a step's token total instead of the last delta", async () => {
	const queue = [
		// ConversationStateStructure { token_details = 5 { used_tokens = 1, max_tokens = 2 } }
		{ flags: 0, payload: encodeAgentCheckpointFrame(new Writer().message(5, new Writer().varint(1, 4096).varint(2, 200000).finish()).finish()) },
		{ flags: 0, payload: encodeAgentTextFrame("hello") },
		{ flags: 0, payload: encodeAgentTokenDeltaFrame(4) },
		{ flags: 0, payload: encodeAgentTokenDeltaFrame(7) },
		{ flags: 0, payload: encodeAgentTokenDeltaFrame(2) },
		{ flags: 0, payload: encodeAgentTurnEndedFrame() },
	];
	class Run {
		constructor() {
			this.finished = false;
			this.stream = { destroyed: false };
			this.responseContentType = "application/connect+proto";
			this.frames = { next: async () => queue.shift(), pause: () => {}, resume: () => {}, finish: () => {} };
		}
		async start() {}
		writeMessage() { return true; }
		async waitForResponse() { return 200; }
		startHeartbeat() {}
		abort() { this.close(); }
		close() { this.finished = true; this.stream.destroyed = true; }
	}
	const adapter = new CursorAdapter({
		auth: { accessToken: async () => "test-token" },
		settings: () => resolveCursorSettings(),
		createAgentRun: () => new Run(),
	});
	const chunks = [];
	for await (const chunk of adapter.stream({
		provider: "cursor-subscription",
		model: "test-model",
		sessionId: "usage-deltas",
		messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
	})) chunks.push(chunk);
	const usage = chunks.find((chunk) => chunk.type === "usage");
	assert.deepEqual(
		usage.usage,
		{ inputTokens: 4096, outputTokens: 13 },
		"the prompt size comes from the checkpoint Cursor sent, the output from summed deltas",
	);
});

function encodeAgentMcpArgsFrame({ id, execId, name, toolCallId, toolName, args = {} }) {
	const mcp = new Writer();
	mcp.string(1, name);
	for (const [key, value] of Object.entries(args)) {
		const entry = new Writer().string(1, key).bytes(2, encodeValue(value)).finish();
		mcp.message(2, entry);
	}
	if (toolCallId) mcp.string(3, toolCallId);
	if (toolName) mcp.string(5, toolName);
	const exec = new Writer();
	exec.varint(1, id);
	if (execId) exec.string(15, execId);
	exec.message(11, mcp.finish());
	return new Writer().message(2, exec.finish()).finish();
}

function encodeAgentCheckpointFrame(checkpoint = new Uint8Array([9, 9, 9])) {
	return new Writer().message(3, checkpoint).finish();
}

/** `{ error = 2 { error = 1 } }` — the generic result error this build emits. */
function decodeExecErrorText(payload) {
	const reader = new Reader(payload);
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 2 && wireType === 2) {
			const nested = new Reader(reader.bytes());
			while (!nested.done) {
				const { field: inner, wireType: innerType } = nested.tag();
				if (inner === 1 && innerType === 2) return nested.string();
				nested.skip(innerType);
			}
			return undefined;
		}
		reader.skip(wireType);
	}
	return undefined;
}

/** AgentClientMessage { exec_client_message = 2 { id=1, exec_id=15, product=… } } */
function decodeClientExecReply(bytes) {
	const outer = new Reader(bytes);
	let execBytes;
	while (!outer.done) {
		const { field, wireType } = outer.tag();
		if (field === 2 && wireType === 2) {
			execBytes = outer.bytes();
			break;
		}
		outer.skip(wireType);
	}
	const reader = new Reader(execBytes);
	let id = 0;
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 0) {
			id = reader.varint();
			continue;
		}
		if (field === 15 && wireType === 2) {
			reader.string();
			continue;
		}
		if (wireType === 2) return { id, field, payload: reader.bytes() };
		reader.skip(wireType);
	}
	return { id, field: undefined, payload: undefined };
}

/** ExecServerMessage with an exec variant this build does not decode. */
function encodeAgentUnknownExecFrame({ id = 2, field = 36, value = "dsh-cursor-subscription" } = {}) {
	const exec = new Writer()
		.varint(1, id)
		.message(19, new Writer().string(1, "35c7dd8e7cc94e59bf2dcdecc5df4a0c").string(2, "68c4679933f05ade").finish())
		.message(field, new Writer().string(1, value).finish())
		.varint(55, 0)
		.finish();
	return new Writer().message(2, exec).finish();
}

function encodeAgentTextFrame(text) {
	return new Writer().message(1, new Writer().message(1, new Writer().string(1, text).finish()).finish()).finish();
}

function encodeAgentTurnEndedFrame() {
	return new Writer().message(1, new Writer().message(14, new Uint8Array(0)).finish()).finish();
}

/** InteractionUpdate { token_delta = 8 { tokens = 1 } } — one delta's token count. */
function encodeAgentTokenDeltaFrame(tokens) {
	return new Writer().message(1, new Writer().message(8, new Writer().varint(1, tokens).finish()).finish()).finish();
}

test("the adapter answers an exec it cannot decode instead of ending the turn", async () => {
	// Before this, an unknown exec got no reply at all: the server waited for a
	// result that never came, the progress watchdog fired 60s later, and the
	// step ended with only the model's preamble — the user saw a turn that
	// promised work and did nothing.
	const written = [];
	const queue = [
		{ flags: 0, payload: encodeAgentUnknownExecFrame({ id: 2, field: 36 }) },
		{ flags: 0, payload: encodeAgentTextFrame("改用 MCP 工具读取该文件。") },
		{ flags: 0, payload: encodeAgentTurnEndedFrame() },
	];
	class ReplyRun {
		constructor() {
			this.finished = false;
			this.stream = { destroyed: false };
			this.responseContentType = "application/connect+proto";
			this.frames = { next: async () => queue.shift() };
		}
		async start() {}
		writeMessage(bytes) {
			written.push(Buffer.from(bytes));
			return true;
		}
		async waitForResponse() { return 200; }
		startHeartbeat() {}
		abort() { this.close(); }
		close() { this.finished = true; this.stream.destroyed = true; }
	}
	const run = new ReplyRun();
	const warnings = [];
	const adapter = new CursorAdapter({
		auth: { accessToken: async () => "test-token" },
		settings: () => resolveCursorSettings(),
		createAgentRun: () => run,
		logger: { warn: (message) => warnings.push(message) },
	});
	const chunks = [];
	for await (const chunk of adapter.stream({
		provider: "cursor-subscription",
		model: "test-model",
		sessionId: "unknown-exec",
		tools: [{ name: "read", description: "read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
		messages: [{ role: "user", content: [{ type: "text", text: "read package.json" }] }],
	})) chunks.push(chunk);

	// The first write is the run request itself; the reply is the exec message.
	const replies = written.map(decodeClientExecReply).filter((reply) => reply.field === 36);
	assert.equal(replies.length, 1, "the unknown exec must be answered exactly once");
	assert.equal(replies[0].id, 2);
	assert.equal(decodeExecErrorText(replies[0].payload), TOOL_REJECT_REASON);
	assert.ok(
		warnings.some((message) => message.includes("exec this build does not know")),
		"the operator must see that Cursor sent an unknown tool",
	);
	assert.equal(
		chunks.filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.text).join(""),
		"改用 MCP 工具读取该文件。",
		"the run must keep streaming after the rejection",
	);
	assert.deepEqual(chunks.at(-1).reason, { kind: "stop" });
});

test("parallel MCP tool calls keep distinct DSH block indexes and resume without phantom results", async () => {
	const tools = [
		{ name: "bash", description: "run shell", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
		{ name: "grep", description: "search files", parameters: { type: "object", properties: { pattern: { type: "string" }, path: { type: "string" } }, required: ["pattern"] } },
	];
	const written = [];
	const queue = [
		{
			flags: 0,
			payload: encodeAgentMcpArgsFrame({
				id: 1,
				execId: "exec-bash",
				name: "bash",
				toolCallId: "tool-bash",
				toolName: "bash",
				args: { command: "pwd" },
			}),
		},
		{
			flags: 0,
			payload: encodeAgentMcpArgsFrame({
				id: 2,
				execId: "exec-grep",
				name: "grep",
				toolCallId: "tool-grep",
				toolName: "grep",
				args: { pattern: "TODO", path: "." },
			}),
		},
		// Empty/unknown MCP exec must not become a pending bridge entry.
		{
			flags: 0,
			payload: encodeAgentMcpArgsFrame({
				id: 3,
				execId: "exec-empty",
				name: "",
				toolCallId: "tool-empty",
				toolName: "",
				args: {},
			}),
		},
		{ flags: 0, payload: encodeAgentCheckpointFrame() },
	];
	class BridgeRun {
		constructor() {
			this.finished = false;
			this.stream = { destroyed: false };
			this.responseContentType = "application/connect+proto";
			this.frames = {
				next: async () => queue.shift(),
			};
		}
		async start() {}
		writeMessage(bytes) {
			written.push(Buffer.from(bytes));
			return true;
		}
		async waitForResponse() { return 200; }
		startHeartbeat() {}
		abort() { this.close(); }
		close() { this.finished = true; this.stream.destroyed = true; }
	}
	const run = new BridgeRun();
	const adapter = new CursorAdapter({
		auth: { accessToken: async () => "test-token" },
		settings: () => resolveCursorSettings(),
		createAgentRun: () => run,
	});
	const first = [];
	for await (const chunk of adapter.stream({
		provider: "cursor-subscription",
		model: "test-model",
		sessionId: "mcp-parallel",
		tools,
		messages: [{ role: "user", content: [{ type: "text", text: "inspect" }] }],
	})) first.push(chunk);

	const toolEnds = first.filter((chunk) => chunk.type === "block-end" && chunk.block?.type === "tool-call");
	assert.equal(toolEnds.length, 2);
	assert.deepEqual(toolEnds.map((chunk) => chunk.block.name).sort(), ["bash", "grep"]);
	assert.notEqual(toolEnds[0].index, toolEnds[1].index, "parallel MCP calls must use distinct DSH block indexes");
	assert.equal(first.at(-1).type, "finish");
	assert.deepEqual(first.at(-1).reason, { kind: "tool-calls" });

	// Unknown MCP exec was rejected immediately on the open bridge.
	const rejected = written.some((buf) => buf.includes(Buffer.from("Unknown or unsupported MCP tool")));
	assert.equal(rejected, true);

	written.length = 0;
	const second = [];
	for await (const chunk of adapter.stream({
		provider: "cursor-subscription",
		model: "test-model",
		sessionId: "mcp-parallel",
		tools,
		messages: [
			{ role: "user", content: [{ type: "text", text: "inspect" }] },
			{
				role: "assistant",
				content: toolEnds.map((chunk) => ({
					type: "tool-call",
					id: chunk.block.id,
					name: chunk.block.name,
					arguments: chunk.block.arguments,
				})),
			},
			{
				role: "user",
				content: toolEnds.map((chunk) => ({
					type: "tool-result",
					toolCallId: chunk.block.id,
					content: [{ type: "text", text: `${chunk.block.name}-ok` }],
					isError: false,
				})),
			},
		],
	})) second.push(chunk);

	const phantom = written.some((buf) => buf.includes(Buffer.from("Tool result not provided")));
	assert.equal(phantom, false, "resume must not invent Tool result not provided for real tool calls");
	assert.equal(written.length, 2, "exactly one MCP result per pending exec");
});

