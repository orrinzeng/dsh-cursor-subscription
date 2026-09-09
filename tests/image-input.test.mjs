import assert from "node:assert/strict";
import test from "node:test";
import {
	CursorAdapter,
	buildRunPayload,
	prepareCursorImages,
} from "../lib/index.js";

test("Cursor models advertise image input", async () => {
	const adapter = new CursorAdapter({
		auth: { accessToken: async () => "token" },
		fetchModels: async () => [{ id: "composer-2", name: "Composer 2" }],
		fallbackModels: [],
	});
	const listed = await adapter.listModels("cursor-subscription");
	assert.deepEqual(listed[0].inputModalities, ["text", "image"]);
	const resolved = await adapter.resolveModel("cursor-subscription", "composer-2");
	assert.deepEqual(resolved.inputModalities, ["text", "image"]);
});

test("Cursor image preparation reads durable attachment bytes", async () => {
	const attachment = {
		attachmentId: "att-1",
		mediaType: "image/png",
		bytes: 4,
		width: 1,
		height: 1,
	};
	const images = await prepareCursorImages(
		{
			messages: [{ role: "user", content: [{ type: "image", attachment }] }],
		},
		{
			async readImage(ref) {
				assert.equal(ref.attachmentId, "att-1");
				return { ref, data: Uint8Array.from([1, 2, 3, 4]) };
			},
		},
	);
	assert.equal(images.length, 1);
	assert.equal(images[0].mimeType, "image/png");
	assert.equal(images[0].data, Buffer.from([1, 2, 3, 4]).toString("base64"));
});

test("Cursor action includes image data and MIME type in conversation history", () => {
	const png = Buffer.from([137, 80, 78, 71]).toString("base64");
	const { payload } = buildRunPayload(
		{
			messages: [{ role: "user", content: [{ type: "text", text: "describe this" }] }],
		},
		"composer-2",
		undefined,
		[{ data: png, mimeType: "image/png" }],
	);

	const haystack = Buffer.from(payload).toString("latin1");
	assert.ok(haystack.includes(png), "payload should contain base64 image data");
	assert.ok(haystack.includes("image/png"), "payload should contain image MIME type");
	assert.ok(haystack.includes("describe this"), "payload should contain the user text");
});
