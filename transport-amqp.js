"use strict";

var _ = require('lodash');
var events = require('events');
var util = require('util');
var uuid = require('node-uuid');
var messageContext = require('./messageContext.js');
var serializer = require('./serializer.js');
var Transport = require('./transport.js');
var when = require('when');

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
function AmqpTransport(options)
{
    Transport.call(this, 'AmqpTransport', options);

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

    var amqplib = options && options.amqplib ? options.amqplib : require('amqplib');

    var channel = undefined;
    var connection = undefined;
    var descriptors = [];
    var instanceId = uuid.v4();
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

        var descriptor = new Descriptor(ep, callback, isReply);
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
        var deferred = when.defer();
        if (isReady) {
            debug('bindInternal', 'isReady was already true.');
            deferred.resolve();
        }
        else {
            me.once('ready', function() {
                debug('bindInternal', 'received ready notification.');
                deferred.resolve();
            });
        }
        return deferred.promise
            .yield(descriptor)
            .then(declareExchange)
            .then(declareQueue)
            .then(bindQueue)
            .then(consume)
            .tap(descriptor.ready)
            .yield(descriptor);
    }

    function bindQueue(descriptor) {
        if (descriptor.isReply && replyDescriptor)
            return when.resolve(descriptor);
        var bindInfo = { queue: descriptor.ep.queue, exchange: descriptor.ep.exchange, routingKey: descriptor.ep.routingKey };
        debug('bindQueue', 'Binding queue; bindInfo: ', bindInfo);
        return channel.bindQueue(bindInfo.queue, bindInfo.exchange, bindInfo.routingKey)
            .then(function() {
                descriptor.on('close', function() {
                    channel.unbindQueue(descriptor.ep.queue, descriptor.ep.exchange, descriptor.ep.routingKey);
                });
                return bindInfo;
            })
            .yield(descriptor);
    }

    function bindReply(callback) {
        var replyQueue = (options.defaultQueue || 'medseek-util-microservices') + '.' + instanceId;
        var addressPrefix = options.defaultExchange + '/' + replyQueue;
        return when.resolve(replyDescriptor)
            .then(function(descriptor) {
                if (descriptor)
                    return descriptor;
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

        var replyDeferred = when.defer();
        return bindReply(replyDeferred.resolve)
            .then(function(rc) {
                if (opts.onGotReplyContext) {
                    rc = opts.onGotReplyContext(rc) || rc;
                }
                var result = when.try(rc.send, address, body, properties)
                    .catch(replyDeferred.reject)
                    .yield(replyDeferred.promise);
                if (opts.timeout) {
                    var error = new Error('Response timeout after ' + opts.timeout);
                    result = result.timeout(opts.timeout, error);
                }
                return result
                    .finally(rc.close);
            });
    }

    function consume(descriptor) {
        var consumeQueue = descriptor.ep.queue;
        if (descriptor.isReply && replyDescriptor)
            return when.resolve(descriptor);

        debug('consume', 'Consuming from queue; queue: ', consumeQueue);
        return channel.consume(consumeQueue, getReceiveFn(consumeQueue))
            .then(function(consumeOk) {
                var consumerTag = consumeOk.consumerTag;
                descriptor.on('close', function() {
                    when(channel.cancel(consumerTag))
                        .catch(onError)
                        .done();
                });
            })
            .yield(descriptor);
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
        var exchangeInfo = declaredExchanges.findByName(descriptor.ep.exchange);
        if (exchangeInfo) {
            if (descriptor.ep.exchangeType != exchangeInfo.type)
                throw new Error('Exchange was previously declared as a different type; name = ' + exchangeInfo.name + ', originalType = ' + exchangeInfo.type + ', specifiedType = ' + type + '.');
            return when.resolve(descriptor);
        }
        exchangeInfo = { name: descriptor.ep.exchange, type: descriptor.ep.exchangeType, options: { durable: false } };
        debug('declareExchange', 'Declaring exchange ' + exchangeInfo.type + '://' + exchangeInfo.name + '; options = ' + util.inspect(exchangeInfo.options) + '.');
        return channel.assertExchange(exchangeInfo.name, exchangeInfo.type, exchangeInfo.options)
            .then(function() {
                declaredExchanges.push(exchangeInfo);
                return exchangeInfo;
            })
            .yield(descriptor);
    }

    function declareQueue(descriptor) {
        if (declaredQueues.findByName(descriptor.ep.queue))
            return when.resolve(descriptor);

        var queueInfo = { name: descriptor.ep.queue, options: { autoDelete: true, durable: false } };
        debug('declareQueue', 'Declaring queue; name = ' + queueInfo.name + '; options = ' + util.inspect(queueInfo.options) + '.');
        return channel.assertQueue(queueInfo.name, queueInfo.options)
            .then(function(declareOk) {
                queueInfo.name = declareOk.queue;
                declaredQueues.push(queueInfo);
                return queueInfo;
            })
            .then(function(queueInfo) {
                if (descriptor.ep.queue == '')
                    descriptor.ep.queue = queueInfo.name;
            })
            .yield(descriptor);
    }

    function getReceiveFn(consumeQueue) {
        return function receive(x) {
            var mc = _.extend(_.omit(x.fields, _.isUndefined), {
                properties: _(_.omit(x.properties, 'headers'))
                    .defaults(x.properties ? x.properties.headers : {})
                    .omit(_.isUndefined)
                    .value(),
                body: x.content
            });
            return when.map(
                _.filter(descriptors, function(d) { return d.callback && d.matches(mc); }),
                function(descriptor) {
                    return when.try(function() {
                        var dmc = _.extend(_.clone(mc), {
                            reply: mc.properties.replyTo ? getReplyFn(mc) : undefined,
                            replyContext: descriptor.isReply ? descriptor : undefined
                        });
                        descriptor.callback(dmc, descriptor);
                    });
                })
                .then(function(results) {
                    if (results.length > 0) {
                        return channel.ack(x);
                    }
                    else {
                        var error = _.extend(new Error(util.format('Unhandled message:', mc)), { mc: mc });
                        onError(error, true);
                    }
                });
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

    function onError(error, thenThrow) {
        debug('Emitting error:', error);
        me.emit('error', error);
        if (thenThrow)
            throw error;
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

        var result = { address: value };
        result.exchangeType = value.substr(0, index);
        if (!result.exchangeType || (result.exchangeType != 'topic' && result.exchangeType != 'direct' && result.exchangeType != 'fanout'))
            return undefined;

        var remain = value.substr(index + 3);
        index = remain.indexOf('/');
        result.exchange = index >= 0 ? remain.substr(0, index) : undefined;
        if (!result.exchange)
            throw new Error('Unable to determine exchange name in address string ' + value + '.');

        remain = remain.substr(index + 1);
        index = remain.indexOf('/');
        result.routingKey = index >= 0 ? remain.substr(0, index) : remain;
        if (!result.routingKey)
            throw new Error('Unable to determine exchange name in address string ' + value + '.');

        result.queue = index >= 0 ? remain.substr(index + 1) : '';
        return result;
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
        return when.try(function() {
            return channel.publish(sendAddress.exchange, sendAddress.routingKey, body, options);
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
        return amqplib.connect(brokerAddress)
            .then(function(newConnection) {
                connection = newConnection;
                return connection.createChannel();
            })
            .then(function(createdChannel) {
                channel = createdChannel;
                return channel.prefetch(1);
            })
            .then(function() {
                debug('start', 'Ready');
                isReady = true;
                me.emit('ready');
            })
            .catch(function(error) {
                debug('start', 'Error = ', error);
                onError(error, true);
            });
    }

    function stop() {
        return when.promise(function(resolve, reject) {
            setImmediate(function() {
                isReady = false;
                var toClose = connection;
                if (toClose) {
                    when.try(function() {
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
