"use strict";

var events = require('events');
var util = require('util');

/**
 * Provides functionality for creating and interacting with micro-services.
 *
 * @module medseek-util-microservices
 */
module.exports = function microservices(options, _, Promise, serializer) {
    _ = _ || require('lodash');
    Promise = Promise || require('bluebird');
    serializer = serializer || require('./serializer');

    options.debug = options.debug && options.debug.toString().toLowerCase() === 'true';
    options.defaultReturnBody = ('' + options.defaultReturnBody).toString().toLowerCase() === 'true';

    var ms = util._extend(new events.EventEmitter(), {
        /**
         * Provides access to options that can be used to configure the micro-services
         * module before it is initialized.
         */
        options: options,

        /**
         * The transport used by the micro-services module.
         */
        transport: undefined
    });

    /**
     * A transport for the micro-services module that interacts with an AMQP
     * service.
     */
    Object.defineProperty(ms, 'AmqpTransport', {
        get: function() {
            return require('./transport-amqp.js');
        }
    });

    /**
     * The serializer used by the micro-services module.
     */
    Object.defineProperty(ms, 'serializer', {
        get: function() {
            return serializer || (serializer = require('./serializer'));
        },
        set: function(value) {
            ms.serializer = value;
        }
    });

    var isDisposed = false, toDispose = [];
    return util._extend(ms, {
        /**
        * Shuts down the micro-services module components.
        *
        * @api public
        */
        dispose: function() {
            if (!isDisposed) {
                isDisposed = true;
                toDispose.forEach(function(x) { x.dispose(); });
                toDispose.splice(0, toDispose.length);
            }
        },

        /**
        * Sets up a serializer for use by the micro-services module.
        *
        * @param serializer The serializer object.
        * @api public
        */
        useSerializer: function(serializer) {
            ms.serializer = serializer;
        },

        /**
        * Sets up a transport for use by the micro-services module.
        *
        * @param transport The transport object or constructor.
        * @param [options] The options to provide to the transport if specified by constructor.
        * @return An object that removes the transport from further use when dispose is invoked.
        * @api public
        */
        useTransport: function(value, options) {
            if (ms.transport) {
                throw new Error('Use of multiple transports is not supported.');
            }
            if (value instanceof Function) {
                return new value(options);
            }

            debug('useTransport', 'Using transport: ' + value.name);
            ms.transport = value;

            return new Promise(function(resolve, reject) {
                setImmediate(function() {
                    Promise.try(function() {
                        value.start();
                    }).done(resolve, reject);
                });
            }).then(function() {
                var disposed = false, disposable = {
                    dispose: function() {
                        if (!disposed) {
                            disposed = true;
                            if (ms.transport === value) {
                                ms.transport = undefined;
                            }
                            return value.stop();
                        }
                    }
                };
                toDispose.push(disposable);
                return disposable;
            });
        },

        /**
         * Binds a micro-service endpoint at the specified address.
         *
         * @param address Describes the endpoint addresses.
         * @param [action] A function to invoke for incoming messages.
         * @return An observable stream of messages received at the endpoint.
         * @api public
         */
        bind: function(address, action, opts) {
            debug('bind', 'Trying transport:', ms.transport.name);
            var callback = getBindCallback(action, opts, 'bind.callback');
            return ms.transport.bind(address, callback, opts)
                .then(function(descriptor) {
                    if (!descriptor) {
                        throw new Error('No transport could bind the endpoint ' + address + '.');
                    }
                    debug('bind', 'Bound transport: ' + ms.transport.name + '\n');
                    return descriptor;
                });
        },

        /**
         * Binds a reply endpoint for use with the specified action.
         *
         * @param action An action to be invoked with the reply context.
         * @param [replyAction] A function to invoke for incoming reply messages.
         * @return An observable stream of messages received at the endpoint.
         * @api public
         */
        bindReply: function(replyAction, opts) {
            var callback = getBindCallback(replyAction, opts, 'bindReply.callback');
            return ms.transport.bindReply(callback)
                .then(function(replyContext) {
                    if (!replyContext) {
                        throw new Error('No transport was able to bind the reply endpoint.');
                    }
                    return replyContext;
                });
        },

        /**
         * Calls a remote RPC-style endpoint and returns a promise for the reply
         * message, error, or timeout.
         */
        call: function(address, body, properties, opts) {
            opts = opts || {};
            opts.returnBody = opts.returnBody || options.defaultReturnBody;
            return ms.transport.call(address, body, properties, opts)
                .then(function(mc) {
                    updateMessageContext(mc);
                    return opts.returnBody ? mc.deserialize() : mc;
                });
        },

        /**
         * Sends a message to the specified endpoint.
         *
         * @param {string} address The address of the destination endpoint.
         * @param {Object} body The message body.
         * @param {Object} [properties] Additional message properties.
         * @api public
         */
        send: function(address, body, properties) {
            return ms.transport.send(address, body, properties);
        }
    });

    function debug(/*label, arg1, ...*/) {
        if (options.debug) {
            arguments[0] = '[medseek-util-microservices.' + arguments[0] + ']';
            console.log.apply(util, arguments);
        }
    }

    function updateMessageContext(x) {
        x.deserialize = ms.serializer.deserialize.bind(ms.serializer, (x.properties || {}).contentType, x.body);
    }

    function getBindCallback(action, opts, label) {
        opts = opts || {};
        opts.returnBody = opts.returnBody || options.defaultReturnBody;
        return function(mc, rc) {
            return Promise
                .try(function(state) {
                    debug(label, 'Received:', mc);
                    updateMessageContext(mc);
                    return opts.returnBody
                        ? action(mc.deserialize(), mc, rc)
                        : action(mc, rc);
                })
                .then(function(result) {
                    if (result !== undefined && mc.reply) {
                        return mc.reply(result);
                    }
                    else if (result !== undefined) {
                        throw _.extend(new Error('Cannot send reply.'), {
                            messageContext: mc,
                            result: result
                        });
                    }
                });
        };
    }
};

module.exports.crutch = require('./crutch.js');
