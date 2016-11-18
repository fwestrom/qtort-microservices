"use strict";

/**
 * Deserializes the body of the message.
 *
 * @returns Object The deserialized body object.
 */
exports.deserialize = function(contentType, body) {
    if (contentType == 'application/json')
        return JSON.parse(body.toString());
    if (contentType == 'text/plain')
        return body.toString();
    if (contentType == 'application/xml')
        return body.toString();
    throw new Error('Unsupported content-type ' + contentType + '.');
};

/**
 * Serializes the body of the message.
 *
 * @returns Buffer The serialized body object.
 */
exports.serialize = function(contentType, body) {
    if (contentType == 'application/json')
        return new Buffer(JSON.stringify(body));
    if (contentType == 'text/plain')
        return new Buffer(body.toString());
    if (contentType == 'application/xml')
        return new Buffer(body.toString());
    throw new Error('Unsupported content-type ' + contentType + '.');
};
