"use strict";

/**
 * Provides a message context for getting information about a message and
 * performing actions related to the message.
 *
 * @constructor
 * @param {Object} values An object describing the properties of the message context.
 * @returns MessageContext The message context.
 * @api public
 */
function MessageContext(values)
{
    if (!values)
        throw new Error('MessageContext values must be specified.');

    /**
     * The routing key used to route the message.
     * @type {string}
     * @api public
     */
    this.routingKey = values.routingKey;

    /**
     * Gets the raw message body.
     * @type {Buffer}
     * @api public
     */
    this.body = values.body;

    /**
     * Describes the properties of the message.
     * @type {Object}
     * @api public
     */
    this.properties = {
        /**
         * The content-type of the message body.
         * @type {string}
         * @api public
         */
        contentType: values.contentType,

        /**
         * The address where reply messages should be sent.
         * @type {string}
         * @api public
         */
        replyTo: values.replyTo
    };

    /**
     * Gets the deserialized message body.
     * @type {function}
     * @api public
     */
    this.deserialize = values.deserialize;

    /**
     * Sends a reply message.
     * @type {function}
     * @api public
     */
    this.reply = values.reply;

    for (var key in values)
        if (values.hasOwnProperty(key) && !this.hasOwnProperty(key))
            this.properties[key] = values[key];
}

/**
 * @alias MessageContext
 */
module.exports.MessageContext = MessageContext;
