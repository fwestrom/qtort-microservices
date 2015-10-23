"use strict";

var events = require('events');
var url = require('url');
var util = require('util');
var Transport = require('./transport.js');

/**
 * Provides an AMQP transport for the micro-services module.
 *
 * @module medseek-util-microservices/AmqpTransport
 */

util.inherits(AmqpTransport, Transport);

/**
 * A transport for the micro-services module that interacts with an AMQP
 * service.
 *
 * @constructor
 * @this {AmqpTransport}
 * @param options Options for configuring the transport.
 * @param options.defaultExchange The default exchange.
 * @param [options.amqplib] An optional amqplib to use instead of the default module.
 */
function AmqpTransport(options, _, amqplib, Promise, serializer, uuid)
{
    if (!(this instanceof AmqpTransport)) {
        return new AmqpTransport(options, _, amqplib, Promise, serializer, uuid);
    }

    Transport.call(this, 'AmqpTransport', options);

    _ = _ || require('lodash');
    amqplib = amqplib || require('amqplib');
    Promise = Promise || require('bluebird');
    serializer = serializer || require('./serializer');
    uuid = uuid || require('node-uuid');

    /**
     * Binds an endpoint at the specified address.
     *
     * @param address The endpoint address.
     * @return An observable sequences of messages, if the endpoint was bound by the transport, or undefined.
     * @api public
     */
    this.bind = bind;

    /**
     * Binds a reply endpoint for use with the specified action.
     *
     * @param actionToBind An action to be invoked with the reply context.
     * @return observable stream of messages received at the endpoint.
     * @api public
     */
    this.bindReply = bindReply;

    /**
     * Calls a remote RPC-style endpoint and returns a promise for the reply
     * message, error, or timeout.
     */
    this.call = call;

    /**
     * Sends a message to the specified endpoint.
     *
     * @param {string} address The address of the destination endpoint.
     * @param {Object} body The message body.
     * @param {Object} properties Additional message properties.
     * @api public
     */
    this.send = send.bind(this);

    /**
     * Starts the transport.
     *
     * @api public
     */
    this.start = start;


    /**
     * Stops the transport.
     *
     * @api public
     */
    this.stop = stop;

    this.isMatch = options.isMatch || isMatch;

    this.parseAddress = options.parseAddress || parseAddress;

    this.Descriptor = Descriptor;

    var channel = undefined;
    var connection = undefined;
    var descriptors = [];
    var instanceId = uuid.v1();
    var isReady = false;
    var me = this;
    var replyDescriptor;
    var replyIdCounter = 0;

    var declaredExchanges = [];
    declaredExchanges.findByName = function(name) {
        var value = undefined;
        for (var i = 0; i < this.length; i++) {
            value = this[i];
            if (value.name == name)
                return value;
        }
    }.bind(declaredExchanges);

    var declaredQueues = [];
    declaredQueues.findByName = declaredExchanges.findByName.bind(declaredQueues);

    function addDescriptor(addressOrEp, callback, isReply) {
        var ep = addressOrEp instanceof String || typeof addressOrEp == 'string' ? me.parseAddress(addressOrEp) : addressOrEp;
        if (!ep)
            throw new Error('Unsupported address or endpoint ' + addressOrEp + '.');

        var descriptor = _.bindAll(new Descriptor(ep, callback, isReply));
        descriptors.push(descriptor);
        descriptor.once('close', function() {
            var index = descriptors.indexOf(descriptor);
            if (index >= 0)
                descriptors.splice(index, 1);
        });

        return descriptor;
    }

    function bind(address, callback) {
        var descriptor = addDescriptor(address, callback);
        debug('bind', 'Binding endpoint; address = ', address, ', ep = ', descriptor.ep, '.');
        return bindInternal(descriptor)
    }

    function bindInternal(descriptor) {
        return Promise
            .try(function() {
                return isReady || new Promise(function(resolve, reject) {
                    me.once('ready', resolve);
                });
            })
            .tap(function() {
                debug('bindInternal', 'received ready notification.');
            })
            .return(descriptor)
            .then(declareExchange)
            .then(declareQueue)
            .then(bindQueue)
            .then(consume)
            .tap(descriptor.ready)
            .return(descriptor);
    }

    function bindQueue(descriptor) {
        if (descriptor.isReply && replyDescriptor)
            return Promise.resolve(descriptor);
        var bindInfo = {
            queue: descriptor.ep.queue.name,
            exchange: descriptor.ep.exchange.name,
            routingKey: descriptor.ep.routingKey,
        };
        debug('bindQueue', 'Binding queue; bindInfo: ', bindInfo);
        return Promise
            .try(function() {
                return channel.bindQueue(bindInfo.queue, bindInfo.exchange, bindInfo.routingKey);
            })
            .then(function() {
                descriptor.on('close', function() {
                    return Promise
                        .try(function() {
                            return channel.unbindQueue(descriptor.ep.queue.name, descriptor.ep.exchange.name, descriptor.ep.routingKey);
                        })
                        .catch(onError)
                        .done();
                });
                return bindInfo;
            })
            .return(descriptor);
    }

    function bindReply(callback) {
        var replyQueue = (options.defaultQueue || 'medseek-util-microservices') + '.' + instanceId;
        var addressPrefix = options.defaultExchange + '/' + replyQueue;
        return Promise
            .try(function() {
                if (replyDescriptor) {
                    return replyDescriptor;
                }
                debug('bindReply', 'Setting up default reply endpoint.');
                var address = addressPrefix + '.#/' + replyQueue;
                replyDescriptor = addDescriptor(address);
                return bindInternal(replyDescriptor);
            })
            .then(function() {
                var address = addressPrefix + '.reply.' + ++replyIdCounter + '/' + replyQueue;
                var descriptor = addDescriptor(address, callback, true);
                descriptor.send = function(address, body, properties) {
                    properties = properties || {};
                    properties.replyTo = descriptor.address;
                    return send(address, body, properties);
                };

                debug('bindReply', 'Binding a default endpoint; address = ', address);
                return descriptor;
            });
    }

    function call(address, body, properties, opts) {
        opts = util._extend({
            onGotReplyContext: undefined,
            timeout: options.defaultTimeout
        }, opts);

        var replyDeferred = {};
        replyDeferred.promise = new Promise(function(resolve, reject) {
            replyDeferred.resolve = resolve;
            replyDeferred.reject = reject;
        });
        return bindReply(replyDeferred.resolve)
            .then(function(rc) {
                if (opts.onGotReplyContext) {
                    rc = opts.onGotReplyContext(rc) || rc;
                }
                var result = Promise
                    .try(function() {
                        return rc.send(address, body, properties);
                    })
                    .catch(replyDeferred.reject)
                    .then(function() {
                        return replyDeferred.promise;
                    });
                if (opts.timeout) {
                    result = result.timeout(opts.timeout, 'Response timeout: ' + opts.timeout);
                }
                return result
                    .finally(rc.close);
            });
    }

    function consume(descriptor) {
        var consumeQueue = descriptor.ep.queue.name;
        if (descriptor.isReply && replyDescriptor)
            return Promise.resolve(descriptor);

        debug('consume', 'Consuming from queue; queue: ', consumeQueue);
        return Promise
            .try(function() {
                return channel.consume(consumeQueue, getReceiveFn(consumeQueue));
            })
            .then(function(consumeOk) {
                var consumerTag = consumeOk.consumerTag;
                descriptor.on('close', function() {
                    Promise
                        .try(function() {
                            return channel.cancel(consumerTag);
                        })
                        .catch(onError)
                        .done();
                });
            })
            .return(descriptor);
    }

    function debug(label, message) {
        if (!options.debug)
            return;
        function format(x) {
            return (x instanceof String || typeof x == 'string') ? x : util.inspect(x);
        }
        var text = '[AmqpTransport.' + Array.prototype.shift.call(arguments) + '] ' + Array.prototype.shift.call(arguments), argumentsUsed = [], match, re = /\{\d+\}/gm;
        while ((match = re.exec(text)) !== null) {
            var tag = match[match.length - 1];
            var i = parseInt(tag.substr(1, tag.length -2));
            var value = format(arguments[i]);
            argumentsUsed[i] = true;
            text = text.substr(0, match.index) + value + text.substr(match.index + tag.length);
            re.lastIndex = match.index = match.index - tag.length + value.length;
        }
        for (var key in arguments)
            if (arguments.hasOwnProperty(key) && !argumentsUsed[parseInt(key)])
                text += format(arguments[key]);

        util.debug(text);
    }

    function declareExchange(descriptor) {
        var exchangeInfo = declaredExchanges.findByName(descriptor.ep.exchange.name);
        if (exchangeInfo) {
            if (descriptor.ep.exchange.type != exchangeInfo.type)
                throw new Error('Exchange was previously declared as a different type; name = ' + exchangeInfo.name + ', originalType = ' + exchangeInfo.type + ', specifiedType = ' + type + '.');
            return Promise.resolve(descriptor);
        }
        exchangeInfo = {
            name: descriptor.ep.exchange.name,
            type: descriptor.ep.exchange.type,
            options: {
                durable: descriptor.ep.exchange.durable,
            },
        };
        debug('declareExchange', 'Declaring exchange ' + exchangeInfo.type + '://' + exchangeInfo.name + '; options = ' + util.inspect(exchangeInfo.options) + '.');
        return Promise
            .try(function() {
                return channel.assertExchange(exchangeInfo.name, exchangeInfo.type, exchangeInfo.options);
            })
            .then(function() {
                declaredExchanges.push(exchangeInfo);
                return exchangeInfo;
            })
            .return(descriptor);
    }

    function declareQueue(descriptor) {
        if (declaredQueues.findByName(descriptor.ep.queue.name))
            return Promise.resolve(descriptor);

        var queueInfo = {
            name: descriptor.ep.queue.name,
            options: {
                autoDelete: !descriptor.ep.queue.durable,
                durable: descriptor.ep.queue.durable,
            },
        };
        debug('declareQueue', 'Declaring queue; name = ' + queueInfo.name + '; options = ' + util.inspect(queueInfo.options) + '.');
        return Promise
            .try(function() {
                return channel.assertQueue(queueInfo.name, queueInfo.options);
            })
            .then(function(declareOk) {
                queueInfo.name = declareOk.queue;
                declaredQueues.push(queueInfo);
                return queueInfo;
            })
            .then(function(queueInfo) {
                if (descriptor.ep.queue.name == '')
                    descriptor.ep.queue.name = queueInfo.name;
            })
            .return(descriptor);
    }

    function getReceiveFn(consumeQueue) {
        return function receive(x) {
            return Promise
                .try(function() {
                    var mc = _.extend(_.omit(x.fields, _.isUndefined), {
                        properties: _(_.omit(x.properties, 'headers'))
                        .defaults(x.properties ? x.properties.headers : {})
                        .omit(_.isUndefined)
                        .value(),
                        body: x.content
                    });
                    var matches = _.filter(descriptors, function(d) { return d.callback && d.matches(mc); });
                    if (matches.length < 1) {
                        throw _.extend(new Error(util.format('Unhandled message:', mc)), { mc: mc });
                    }
                    return Promise.map(matches, function(descriptor) {
                        return Promise.try(function() {
                            var dmc = _.extend(_.clone(mc), {
                                reply: mc.properties.replyTo ? getReplyFn(mc) : undefined,
                                replyContext: descriptor.isReply ? descriptor : undefined
                            });
                            return descriptor.callback(dmc, descriptor);
                        });
                    });
                })
                .then(function(results) {
                    return channel.ack(x);
                })
                .catch(onError)
                .done();
        };
    }

    function getReplyFn(mc) {
        return function reply(body, properties) {
            properties = _.defaults(properties || {}, _.omit(mc.properties, 'replyTo'));
            var to = properties.replyTo || mc.properties.replyTo;
            debug('reply', 'to: {0}, body = {1}, properties = {2}', to, body, properties);
            return send(to, body, properties);
        };
    }

    function isMatch(descriptor, messageContext) {
        return descriptor.matches(messageContext);
    }

    function onError(error) {
        if (me.listeners('error').length > 0) {
            debug('Emitting error:', error);
            return me.emit('error', error);
        }
        else {
            debug('Unhandled error:', error);
            throw error;
        }
    }

    function parseAddress(value) {
        if (value instanceof Descriptor)
            return value;
        if (!value)
            return undefined;

        var index = value.indexOf('://');
        if (index < 0) {
            var a = options.defaultExchange + '/' + value + '/' + options.defaultQueue;
            return parseAddress(a);
        }

        var u = url.parse(value), p = u.pathname.substr(1).split('/');
        u.query = u.query || {};
        var a = {
            address: value,
            exchange: {
                type: (u.protocol || '').split(':')[0],
                name: u.hostname,
                durable: u.query['exchange.durable'] || u.query['ed'] || false,
            },
            queue: {
                name: p.length > 1 ? p[1] : '',
                durable: u.query['queue.durable'] || u.query['qd'] || false,
            },
            routingKey: p.length > 0 ? p[0] : undefined,
        };
        console.error(a);

        if (!a.exchange.type || (a.exchange.type != 'topic' && a.exchange.type != 'direct' && a.exchange.type != 'fanout'))
            return undefined;
        if (!a.exchange.name)
            throw new Error('Unable to determine exchange name in address string ' + value + '.');
        if (!a.routingKey)
            throw new Error('Unable to determine routing key in address string ' + value + '.');

        return a;
    }

    function send(address, bodyObject, properties) {
        properties = properties || {};
        var options = {
            contentType: properties.contentType || 'application/json',
            replyTo: properties.replyTo,
            headers: _.omit(properties, ['contentType', 'replyTo'])
        };

        debug('send.serialize', 'contentType = {0}, bodyObject = {1}', options.contentType, bodyObject);
        var body = serializer.serialize(options.contentType, bodyObject);
        debug('send', 'Sending; to = ' + address + ", body = " + bodyObject.toString() + ", options = " + JSON.stringify(options) + '.');
        var sendAddress = me.parseAddress(address);
        return Promise.try(function() {
            return channel.publish(sendAddress.exchange.name, sendAddress.routingKey, body, options);
        });
    }

    function start() {
        var brokerAddress = options.broker !== undefined ? options.broker : 'amqp://localhost';
        for (var i = 2; i < process.argv.length; i++) {
            var arg = process.argv[i];
            var index = arg.search(/^([-/]|--)broker([=:].+)?$/i);
            if (index == 0) {
                index = arg.search(/[=:]/);
                if (index >= 0 || i < process.argv.length - 1) {
                    brokerAddress = index >= 0 ? arg.substr(index + 1) : process.argv[i + 1];
                    break;
                }
            }
        }

        debug('start', 'Broker: ', brokerAddress);
        return Promise
            .try(function() {
                return amqplib.connect(brokerAddress);
            })
            .then(function(newConnection) {
                connection = newConnection;
                return connection.createChannel();
            })
            .then(function(createdChannel) {
                channel = createdChannel;
                if (options.channelPrefetch) {
                    return channel.prefetch(options.channelPrefetch);
                }
            })
            .then(function() {
                if (connection.on) {
                    connection.on('error', function(error) {
                        console.error(error);
                        process.exit(1);
                    });
                }
            })
            .then(function() {
                debug('start', 'Ready');
                isReady = true;
                me.emit('ready');
            })
            .catch(onError);
    }

    function stop() {
        return new Promise(function(resolve, reject) {
            setImmediate(function() {
                isReady = false;
                var toClose = connection;
                if (toClose) {
                    Promise.try(function() {
                        connection = undefined;
                        channel = undefined;
                        return toClose.close();
                    }).done(resolve, reject);
                }
            });
        });
    }

    util.inherits(Descriptor, events.EventEmitter);
    function Descriptor(ep, callback, isReply) {
        events.EventEmitter.call(this);
        this.address = ep.address;
        this.callback = callback;
        this.ep = ep;
        this.isReply = isReply === true;
        this.ready = ready;
        this.close = close;
        this.matches = matches;

        var me = this;
        function ready() {
            debug('Descriptor.ready', 'Descriptor is ready; ep: ', me.ep);
            me.emit('ready');
        }
        function close() {
            debug('Descriptor.close', 'Closing descriptor; ep:', me.ep);
            me.emit('close');
        }

        var matchesRegex = new RegExp(
            '^' + me.ep.routingKey
            .split('.').join('\\.')
            .split('*').join('[^\\.]+')
            .split('\\.#').join('(\\.[^\\.]+)*')
            .split('#\\.').join('([^\\.]+\\.)*')
            + '$');
        function matches(messageContext) {
            return matchesRegex.test(messageContext.routingKey);
        }
    }
}

/**
 * @alias module:medseek-util-microservices/AmqpTransport
 */
module.exports = AmqpTransport;
