"use strict";

var events = require('events');
var util = require('util');
var uuid = require('uuid');

/**
 * Provides a skeleton for transports used with the micro-services module.
 *
 * @module medseek-util-microservices/Transport
 */

/**
 * A base for implementing transports for use with the micro-services module.
 *
 * @constructor
 * @this {Transport}
 * @param name Name of the transport.
 * @param options Options for configuring the transport.
 */
function Transport(name, options)
{
    options = util._extend({ debug: false }, options);
    options.name = name = name || options.name || 'Unnamed-Transport';
    Object.defineProperty(this, 'name', { value: options.name, writable: false });
    Object.defineProperty(this, 'instanceId', { value: uuid.v1(), writable: false });

    var me = this;

    /**
     * Binds an endpoint at the specified address.
     *
     * @param address The endpoint address.
     * @return An observable sequences of messages, if the endpoint was bound by the transport, or undefined.
     * @api public
     */
    this.bind = function(address) {
        log('bind', 'Binding endpoint; address = ' + address + '.');
        me.emit('bind', arguments);
    };

    /**
     * Binds a reply endpoint for use with the specified action.
     *
     * @param actionToBind An action to be invoked with the reply context.
     * @return A promise for the reply context that can be used to send
     * messages to which a reply is expected.
     * @api public
     */
    this.bindReply = function(actionToBind) {
        log('bindReply', 'Binding reply endpoint; actionToBind = ' + actionToBind + '.');
        me.emit('bindReply', arguments);
    };

    /**
     * Sends a message to the specified endpoint.
     *
     * @param {string} address The address of the destination endpoint.
     * @param {Object} body The message body.
     * @param {Object} properties Additional message properties.
     * @api public
     */
    this.send = function(address, body, properties) {
        log('send', 'Sending; to = ' + address + ', body = ' + util.inspect(body) + ', properties = ' + util.inspect(properties) + '.');
        me.emit('send', arguments);
    };

    /**
     * Starts the transport.
     *
     * @api public
     */
    this.start = function() {
        log('start', 'Starting transport.');
        me.emit('start', arguments);
    };

    /**
     * Stops the transport.
     *
     * @api public
     */
    this.stop = function() {
        log('stop', 'Stopping transport.');
        me.emit('stop', arguments);
    };

    var log = function(methodName, message) {
        if (options.debug)
            util.debug('[' + options.name + '.' + methodName + '] ' + message);
    };
}

util.inherits(Transport, events.EventEmitter);

/**
 * @alias module:medseek-util-microservices/Transport
 */
module.exports = Transport;
