"use strict";

var serializer = require('./serializer.js');

/**
 * Creates a new message context.
 * @param {Object} values An object describing the properties of the message context.
 * @return MessageContext The created message context.
 */
module.exports.create = function(values) {
    return new MessageContext(values);
};

/**
 * Provides a message context for getting information about a message and
 * performing actions related to the message.
 * @constructor
 * @this {MessageContext}
 */
function MessageContext(values) {
    if (!values)
        values = {};

    var body = undefined;
    /**
     * Gets the deserialized message body.
     * @type {Object}
     */
    Object.defineProperty(this, 'body', {
        get: function() {
            return body ? body : (body = serializer.deserialize(this.properties.contentType, this.bodyRaw));
        }.bind(this)
    });

    /**
     * Gets the raw message body.
     * @type {Buffer}
     */
    Object.defineProperty(this, 'bodyRaw', {
        value: values.body,
        writable: false
    });

    /**
     * Describes the properties of the message.
     * @type {Object}
     */
    Object.defineProperty(this, 'properties', {
        value: {},
        writable: false
    });

    /**
     * The content-type of the message body.
     * @type {string}
     */
    Object.defineProperty(this.properties, 'contentType', {
        value: values.contentType,
        writable: false
    });

    /**
     * The address where reply messages should be sent.
     * @type {string}
     */
    Object.defineProperty(this.properties, 'replyTo', {
        value: values.replyTo,
        writable: false
    });

    /**
     * Sends a reply message.
     * @type {function}
     */
    Object.defineProperty(this, 'reply', {
        value: values.reply,
        writable: false
    });

    /**
     * The routing key used to route the message.
     * @type {string}
     */
    Object.defineProperty(this, 'routingKey', {
        value: values.routingKey,
        writable: false
    });
}
