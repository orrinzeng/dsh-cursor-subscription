import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { nativeFetch } from "../lib/index.js";

function startServer(handler) {
	return new Promise((resolve) => {
		const server = http.createServer((req, res) => {
			const chunks = [];
			req.on("data", (c) => chunks.push(c));
			req.on("end", () => {
				handler(req, res, Buffer.concat(chunks));
			});
		});
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			resolve({ server, base: `http://127.0.0.1:${port}` });
		});
	});
}

test("nativeFetch sends headers and method and parses JSON", async () => {
	const { server, base } = await startServer((req, res) => {
		assert.equal(req.method, "POST");
		assert.equal(req.headers["content-type"], "application/json");
		assert.equal(req.headers["x-test"], "ok");
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ hello: "world" }));
	});
	try {
		const r = await nativeFetch(`${base}/x`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-test": "ok" },
			body: JSON.stringify({ a: 1 }),
		});
		assert.equal(r.ok, true);
		assert.equal(r.status, 200);
		assert.deepEqual(await r.json(), { hello: "world" });
	} finally {
		server.close();
	}
});

test("nativeFetch follows redirects by default", async () => {
	const { server, base } = await startServer((req, res) => {
		if (req.url === "/start") {
			res.writeHead(302, { location: "/final" });
			res.end();
			return;
		}
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ path: req.url }));
	});
	try {
		const r = await nativeFetch(`${base}/start`);
		assert.equal(r.ok, true);
		assert.deepEqual(await r.json(), { path: "/final" });
	} finally {
		server.close();
	}
});

test("nativeFetch surfaces HTTP status and non-2xx as not ok", async () => {
	const { server, base } = await startServer((req, res) => {
		res.writeHead(401, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: "not_authenticated" }));
	});
	try {
		const r = await nativeFetch(`${base}/x`);
		assert.equal(r.ok, false);
		assert.equal(r.status, 401);
	} finally {
		server.close();
	}
});

test("nativeFetch exposes arrayBuffer for proto responses", async () => {
	const { server, base } = await startServer((req, res) => {
		res.writeHead(200, { "content-type": "application/proto" });
		res.end(Buffer.from([1, 2, 3, 4]));
	});
	try {
		const r = await nativeFetch(`${base}/x`);
		const buf = new Uint8Array(await r.arrayBuffer());
		assert.deepEqual([...buf], [1, 2, 3, 4]);
	} finally {
		server.close();
	}
});
