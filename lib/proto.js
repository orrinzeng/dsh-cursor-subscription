/**
 * Minimal protobuf wire-format helpers for the Cursor Agent protocol.
 *
 * Only the subset of protobuf needed by `dsh-cursor-subscription` is
 * implemented: varints, length-delimited fields, fixed64/double, and nested
 * messages. Map fields are encoded as repeated entry messages, exactly like
 * the official protobuf runtime.
 *
 * @module dsh-cursor-subscription/proto
 */

/** Encode one unsigned varint into a Uint8Array. */
export function varintEncode(value) {
	const out = [];
	let n = Math.trunc(value);
	while (n > 0x7f) {
		out.push((n & 0x7f) | 0x80);
		n = Math.floor(n / 128);
	}
	out.push(n);
	return Uint8Array.from(out);
}

/** Combine byte arrays. */
export function concatBytes(parts) {
	let total = 0;
	for (const part of parts) total += part.length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

/** A streaming protobuf message writer. */
export class Writer {
	constructor() {
		this.parts = [];
	}

	/** Append a raw field tag. */
	tag(field, wireType) {
		this.parts.push(varintEncode((field << 3) | wireType));
		return this;
	}

	/** Append a length-delimited payload. */
	bytes(field, data) {
		this.tag(field, 2);
		this.parts.push(varintEncode(data.length));
		this.parts.push(data);
		return this;
	}

	/** Append a UTF-8 string field. */
	string(field, value) {
		return this.bytes(field, new TextEncoder().encode(value));
	}

	/** Append a nested message field. */
	message(field, inner) {
		return this.bytes(field, inner);
	}

	/** Append a varint field (uint32/int32/bool/enum). */
	varint(field, value) {
		this.tag(field, 0);
		this.parts.push(varintEncode(Math.trunc(value)));
		return this;
	}

	/** Append a double (fixed64, little-endian) field. */
	double(field, value) {
		this.tag(field, 1);
		const buffer = new ArrayBuffer(8);
		new DataView(buffer).setFloat64(0, value, true);
		this.parts.push(new Uint8Array(buffer));
		return this;
	}

	finish() {
		return concatBytes(this.parts);
	}
}

/** A streaming protobuf message reader. */
export class Reader {
	constructor(bytes) {
		this.data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
		this.pos = 0;
	}

	get done() {
		return this.pos >= this.data.length;
	}

	varint() {
		let result = 0;
		let shift = 0;
		while (true) {
			if (this.pos >= this.data.length) throw new Error("protobuf: truncated varint");
			const byte = this.data[this.pos++];
			result += (byte & 0x7f) * 2 ** shift;
			if ((byte & 0x80) === 0) break;
			shift += 7;
			if (shift > 63) throw new Error("protobuf: varint too long");
		}
		return result;
	}

	/** Read the tag and return { field, wireType }. */
	tag() {
		const raw = this.varint();
		return { field: Math.floor(raw / 8), wireType: raw % 8 };
	}

	bytes() {
		const length = this.varint();
		if (this.pos + length > this.data.length) throw new Error("protobuf: truncated bytes");
		const out = this.data.subarray(this.pos, this.pos + length);
		this.pos += length;
		return out;
	}

	string() {
		return new TextDecoder().decode(this.bytes());
	}

	double() {
		if (this.pos + 8 > this.data.length) throw new Error("protobuf: truncated double");
		const view = new DataView(this.data.buffer, this.data.byteOffset + this.pos, 8);
		this.pos += 8;
		return view.getFloat64(0, true);
	}

	/** Skip a field of the given wire type (length-delimited or varint or fixed64). */
	skip(wireType) {
		if (wireType === 0) {
			this.varint();
		} else if (wireType === 1) {
			if (this.pos + 8 > this.bytes.length) throw new Error("protobuf: truncated fixed64");
			this.pos += 8;
		} else if (wireType === 2) {
			this.bytes();
		} else if (wireType === 5) {
			if (this.pos + 4 > this.bytes.length) throw new Error("protobuf: truncated fixed32");
			this.pos += 4;
		} else {
			throw new Error(`protobuf: unsupported wire type ${wireType}`);
		}
	}
}

/**
 * Encode a JSON value as `google.protobuf.Value` (the wire format Cursor uses
 * for MCP tool input schemas and MCP argument values).
 */
export function encodeValue(value) {
	const writer = new Writer();
	if (value === null || value === undefined) {
		writer.varint(1, 0); // null_value
	} else if (typeof value === "boolean") {
		writer.varint(4, value ? 1 : 0); // bool_value
	} else if (typeof value === "number") {
		writer.double(2, value); // number_value
	} else if (typeof value === "string") {
		writer.string(3, value); // string_value
	} else if (Array.isArray(value)) {
		const list = new Writer();
		for (const item of value) list.message(1, encodeValue(item)); // ListValue.values
		writer.message(6, list.finish()); // list_value
	} else if (typeof value === "object") {
		const struct = new Writer();
		for (const [key, item] of Object.entries(value)) {
			const entry = new Writer();
			entry.string(1, key); // Struct.FieldsEntry.key
			entry.message(2, encodeValue(item)); // Struct.FieldsEntry.value
			struct.message(1, entry.finish()); // Struct.fields
		}
		writer.message(5, struct.finish()); // struct_value
	} else {
		throw new Error(`cannot encode ${typeof value} as google.protobuf.Value`);
	}
	return writer.finish();
}

/**
 * Decode `google.protobuf.Value` bytes back into a JSON value.
 * @param {Uint8Array} bytes - serialized google.protobuf.Value message.
 * @returns {unknown} the decoded JSON value.
 */
export function decodeValue(bytes) {
	const reader = new Reader(bytes);
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 0) {
			reader.varint();
			return null;
		}
		if (field === 2 && wireType === 1) {
			return reader.double();
		}
		if (field === 3 && wireType === 2) {
			return reader.string();
		}
		if (field === 4 && wireType === 0) {
			return reader.varint() !== 0;
		}
		if (field === 5 && wireType === 2) {
			return decodeStruct(reader.bytes());
		}
		if (field === 6 && wireType === 2) {
			return decodeList(reader.bytes());
		}
		reader.skip(wireType);
	}
	return null;
}

function decodeStruct(bytes) {
	const reader = new Reader(bytes);
	const result = {};
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 2) {
			const entry = new Reader(reader.bytes());
			let key = "";
			let value = null;
			while (!entry.done) {
				const tag = entry.tag();
				if (tag.field === 1 && tag.wireType === 2) key = entry.string();
				else if (tag.field === 2 && tag.wireType === 2) value = decodeValue(entry.bytes());
				else entry.skip(tag.wireType);
			}
			result[key] = value;
		} else {
			reader.skip(wireType);
		}
	}
	return result;
}

function decodeList(bytes) {
	const reader = new Reader(bytes);
	const result = [];
	while (!reader.done) {
		const { field, wireType } = reader.tag();
		if (field === 1 && wireType === 2) result.push(decodeValue(reader.bytes()));
		else reader.skip(wireType);
	}
	return result;
}
