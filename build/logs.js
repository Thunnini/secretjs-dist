"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable @typescript-eslint/camelcase */
const encoding_1 = require("@iov/encoding");
function parseAttribute(input) {
    if (!encoding_1.isNonNullObject(input))
        throw new Error("Attribute must be a non-null object");
    const { key, value } = input;
    if (typeof key !== "string" || !key)
        throw new Error("Attribute's key must be a non-empty string");
    if (typeof value !== "string" && typeof value !== "undefined") {
        throw new Error("Attribute's value must be a string or unset");
    }
    return {
        key: key,
        value: value || "",
    };
}
exports.parseAttribute = parseAttribute;
function parseEvent(input) {
    if (!encoding_1.isNonNullObject(input))
        throw new Error("Event must be a non-null object");
    const { type, attributes } = input;
    if (typeof type !== "string" || type === "") {
        throw new Error(`Event type must be a non-empty string`);
    }
    if (!Array.isArray(attributes))
        throw new Error("Event's attributes must be an array");
    return {
        type: type,
        attributes: attributes.map(parseAttribute),
    };
}
exports.parseEvent = parseEvent;
function parseLog(input) {
    if (!encoding_1.isNonNullObject(input))
        throw new Error("Log must be a non-null object");
    const { msg_index, log, events } = input;
    if (typeof msg_index !== "number")
        throw new Error("Log's msg_index must be a number");
    if (typeof log !== "string")
        throw new Error("Log's log must be a string");
    if (!Array.isArray(events))
        throw new Error("Log's events must be an array");
    return {
        msg_index: msg_index,
        log: log,
        events: events.map(parseEvent),
    };
}
exports.parseLog = parseLog;
function parseLogs(input) {
    if (!Array.isArray(input))
        throw new Error("Logs must be an array");
    return input.map(parseLog);
}
exports.parseLogs = parseLogs;
/**
 * Searches in logs for the first event of the given event type and in that event
 * for the first first attribute with the given attribute key.
 *
 * Throws if the attribute was not found.
 */
function findAttribute(logs, eventType, attrKey) {
    var _a, _b;
    const firstLogs = logs.find(() => true);
    const out = (_b = (_a = firstLogs) === null || _a === void 0 ? void 0 : _a.events.find((event) => event.type === eventType)) === null || _b === void 0 ? void 0 : _b.attributes.find((attr) => attr.key === attrKey);
    if (!out) {
        throw new Error(`Could not find attribute '${attrKey}' in first event of type '${eventType}' in first log.`);
    }
    return out;
}
exports.findAttribute = findAttribute;
//# sourceMappingURL=logs.js.map