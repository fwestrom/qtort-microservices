"use strict";

var rx = require('rx');
var util = require('util');

/**
 * Provides functionality for creating and interacting with micro-services.
 *
 * @module medseek-util-microservices
 */

util.inherits(MicroServicesModule, require('events').EventEmitter);
function MicroServicesModule() {
    this.transport = undefined;
    this.toDispose = [];
    var isDisposed = false;
    this.dispose = function() {
        if (!isDisposed) {
            isDisposed = true;
            this.toDispose.forEach(function(x) {
                x.dispose();
            });
            this.toDispose.splice(0, this.toDispose.length);
        }
    };
    process.once('SIGINT', this.dispose.bind(this));
}

var me = new MicroServicesModule();

module.exports.on = me.on.bind(me);

/**
 * A transport for the micro-services module that interacts with an AMQP
 * service.
 *
 * @constructor
 * @api public
 */
Object.defineProperty(module.exports, 'AmqpTransport', {
    get: function() {
        return require('./transport-amqp.js');
    }
});

/**
 * Sets up a transport for use by the micro-services module.
 *
 * @param transport The transport object or constructor.
 * @param [options] The options to provide to the transport if it is specified by constructor.
 * @return Rx.IDisposable that removes the transport from further use when dispose is invoked.
 * @api public
 */
module.exports.useTransport = function(transport, options) {
    if (me.transport)
        throw new Error('Use of multiple transports is not supported.');

    if (transport instanceof Function)
        transport = new transport(options);

    util.log('[Module.addTransport] Using transport: ' + transport.name);
    me.transport = transport;
    setImmediate(function() {
        transport.start();
    });
    return rx.Disposable.create(function() {
        transport.stop();
        me.transport = undefined;
    });
};

/**
 * Binds a micro-service endpoint at the specified address.
 *
 * @param address Describes the endpoint addresses.
 * @return rx.Observable<T> observable stream of messages received at the endpoint.
 * @api public
 */
module.exports.bind = function(address) {
    util.log('[Module.bind] Trying transport: ' + me.transport.name + '');
    var observable = me.transport.bind(address);
    if (!observable)
        throw new Error('No transport was able to bind the endpoint ' + address + '.');

    util.log('[Module.bind] Bound transport: ' + me.transport.name + '');
    return observable;
};

/**
 * Binds a reply endpoint for use with the specified action.
 *
 * @param actionToBind An action to be invoked with the reply context.
 * @return rx.Observable<T> observable stream of messages received at the endpoint.
 * @api public
 */
module.exports.bindReply = function(actionToBind) {
    return me.transport.bindReply(actionToBind);
};

/**
 * Sends a message to the specified endpoint.
 *
 * @param {string} address The address of the destination endpoint.
 * @param {Object} body The message body.
 * @param {Object} properties Additional message properties.
 * @api public
 */
module.exports.send = function(address, body, properties) {
    return me.transport.send(address, body, properties);
};

/**
 * Shuts down the micro-services module components.
 *
 * @api public
 */
module.exports.dispose = function() {
    me.dispose();
};
