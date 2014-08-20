"use strict";

var events = require('events');
var rx = require('rx');
var util = require('util');
var uuid = require('node-uuid');
var messageContext = require('./messageContext.js');
var serializer = require('./serializer.js');

/**
 * Provides an AMQP transport for the micro-services module.
 *
 * @module medseek-util-microservices/AmqpTransport
 */

util.inherits(AmqpTransport, events.EventEmitter);

/**
 * A transport for the micro-services module that interacts with an AMQP
 * service.
 *
 * @constructor
 * @this {AmqpTransport}
 * @param options Options for configuring the transport.
 * @param options.defaultExchange The default exchange.
 * @param options.broker The optional broker.
 * @param [options.amqplib] An optional amqplib to use instead of the default module.
 */
function AmqpTransport(options) {
    var amqplib = options && options.amqplib ? options.amqplib : require('amqplib');
    var defaultExchange = options.defaultExchange;

    Object.defineProperty(this, 'name', { value: 'AmqpTransport', writable: false });

    var channel = undefined;
    var connection = undefined;
    var currentMessageContext = undefined;
    var descriptors = [];
    var instanceId = uuid.v4();
    var isReady = false;

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

    this.parseAddress = function(value) {
        if (!value)
            return undefined;

        var result = {};
        var index = value.indexOf('://');
        if (index < 0)
            return undefined;
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
    };

    var addDescriptor = function(address) {
        var ep = this.parseAddress(address);
        if (ep) {
            var descriptor = { address: address, ep: ep };
            descriptor.observable = rx.Observable.create(function(observer) {
                descriptor.observer = observer;
            });
            var descriptorEvents = new (require('events').EventEmitter)();
            descriptor.on = descriptorEvents.on.bind(descriptorEvents);
            descriptor.ready = function() {
                descriptorEvents.emit('ready', descriptor);
            };
            descriptors.push(descriptor);
            descriptor.close = function() {
                descriptorEvents.emit('close', descriptor);
                var index = descriptors.indexOf(descriptor);
                if (index >= 0)
                    descriptors.splice(index, 1);
            };
            return descriptor;
        }
    }.bind(this);

    var sendInternal = function(address, bodyObject, properties) {
        var options = {
            contentType: properties && properties.contentType ? properties.contentType : 'application/json',
            replyTo: properties && properties.replyTo ? properties.replyTo : undefined,
            headers: {}
        };
        for (var key in properties) {
            if (properties.hasOwnProperty(key) && key != 'contentType' && key != 'replyTo' && key != 'routingKey')
                options.headers[key] = properties[key];
        }
        var body = serializer.serialize(options.contentType, bodyObject);
        util.log('[AmqpTransport.send] Sending; to = ' + address + ", body = " + bodyObject.toString() + ", options = " + JSON.stringify(options) + '.');
        var sendAddress = this.parseAddress(address);
        channel.publish(sendAddress.exchange, sendAddress.routingKey, body, options);
    }.bind(this);

    var declareExchange = function(name, type) {
        var exchangeInfo = declaredExchanges.findByName(name);
        if (exchangeInfo) {
            if (type && type != exchangeInfo.type)
                throw new Error('Exchange was previously declared as a different type; name = ' + exchangeInfo.name + ', originalType = ' + exchangeInfo.type + ', specifiedType = ' + type + '.');
            return rx.Observable.return(exchangeInfo);
        }
        exchangeInfo = { name: name, type: type, options: { durable: false } };
        return channel.assertExchange(exchangeInfo.name, exchangeInfo.type, exchangeInfo.options)
            .then(function() {
                declaredExchanges.push(exchangeInfo);
                return exchangeInfo;
            })
    };
    var declareQueue = function(name) {
        var queueInfo = declaredQueues.findByName(name);
        if (queueInfo)
            return rx.Observable.return(queueInfo);
        queueInfo = { name: name, options: { autoDelete: true, durable: false } };
        return channel.assertQueue(queueInfo.name, queueInfo.options)
            .then(function(declareOk) {
                queueInfo.name = declareOk.queue;
                declaredQueues.push(queueInfo);
                return queueInfo;
            });
    };
    var bindQueue = function(descriptor) {
        var bindInfo = { queue: descriptor.ep.queue, exchange: descriptor.ep.exchange, routingKey: descriptor.ep.routingKey };
        return channel.bindQueue(bindInfo.queue, bindInfo.exchange, bindInfo.routingKey)
            .then(function() {
                descriptor.on('close', function() {
                    channel.unbindQueue(descriptor.ep.queue, descriptor.ep.exchange, descriptor.ep.routingKey);
                });
                return bindInfo;
            });
    };
    var consume = function(descriptor) {
        return channel
            .consume(descriptor.ep.queue, function(x) {
                util.log('[AmqpTransport.consume] Received: ' + JSON.stringify(x));
                var mc = messageContext.create({
                    body: x.content,
                    contentType: x.properties.contentType,
                    replyTo: x.properties.replyTo,
                    routingKey: x.fields.routingKey,
                    reply: function(body, properties) {
                        if (!mc.properties.replyTo)
                            throw new Error('Cannot send a reply message when no reply-to destination exists on the original message.');
                        if (!properties)
                            properties = {};
                        properties.contentType = mc.properties.contentType;
                        sendInternal(mc.properties.replyTo, body, properties);
                    }
                });

                for (var key in x.properties.headers) {
                    if (x.properties.headers.hasOwnProperty(key))
                        mc.properties[key] = x.properties.headers[key];
                }

                var currentMessageContextTemp = currentMessageContext;
                currentMessageContext = mc;
                try {
                    descriptor.observer.onNext(mc);
                    channel.ack(x);
                }
                finally {
                    currentMessageContext = currentMessageContextTemp;
                }
            })
            .then(function(consumeOk) {
                var consumerTag = consumeOk.consumerTag;
                descriptor.on('close', function() {
                    channel.cancel(consumerTag);
                });
            });
    };

    var subscribe = function(descriptor) {
        var ep = descriptor.ep;
        //util.log('[AmqpTransport.subscribe] endpoint = ' + JSON.stringify(ep));
        rx.Observable.forkJoin(
            declareExchange(ep.exchange, ep.exchangeType),
            declareQueue(ep.queue),
            bindQueue(descriptor),
            consume(descriptor))
            //.do(function(x) { util.log('[AmqpTransport.subscribe] Success; endpoint = ' + JSON.stringify(ep) + ', result = ' + JSON.stringify(x) + '.'); })
            .do(descriptor.ready)
            .subscribe();
    }.bind(this);

    var bindInternal = function(descriptor) {
        var subscribed = false;
        this.on('ready', function() {
            util.log('[AmqpTransport.ready] received ready notification.');
            subscribed = true;
            subscribe(descriptor);
        }.bind(this));

        if (isReady && !subscribed) {
            util.log('[AmqpTransport.ready] isReady was already true.');
            subscribe(descriptor);
        }

        return descriptor.observable;
    }.bind(this);

    /**
     * Binds an endpoint at the specified address.
     *
     * @param address The endpoint address.
     * @return An observable sequences of messages, if the endpoint was bound by the transport, or undefined.
     * @api public
     */
    this.bind = function(address) {
        var descriptor = addDescriptor(address);
        if (descriptor) {
            util.log('[AmqpTransport.bind] Binding endpoint; address = ' + address + ', ep = ' + JSON.stringify(descriptor.ep) + '.');
            return bindInternal(descriptor);
        }
    };

    /**
     * Binds a reply endpoint for use with the specified action.
     *
     * @param actionToBind An action to be invoked with the reply context.
     * @return rx.Observable<T> observable stream of messages received at the endpoint.
     * @api public
     */
    this.bindReply = function(actionToBind) {
        var replyId = uuid.v4();
        var routingKey = 'medseek-util-microservices.' + instanceId + '.reply.' + replyId;
        var queueName = 'medseek-util-microservices.' + instanceId + '.reply.' + replyId;
        var descriptor = addDescriptor(defaultExchange + '/' + routingKey + '/' + queueName);
        //util.log('[AmqpTransport.bindReplyTo] Binding a default endpoint; address = ' + descriptor.address + '.');

        var replyContext = bindInternal(descriptor);
        replyContext.close = descriptor.close;
        replyContext.send = function(address, body, properties) {
            if (!properties)
                properties = {};
            properties.replyTo = descriptor.address;
            sendInternal(address, body, properties);
        };

        descriptor.on('ready', function() {
            if (actionToBind)
                actionToBind(replyContext);
        });

        return replyContext;
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
        sendInternal(address, body, properties);
    };

    /**
     * Starts the transport.
     *
     * @api public
     */
    this.start = function() {
        var brokerAddress = 'amqp://localhost';
        
        if(options.broker) {
            brokerAddress = options.broker;
        } else {
            for (var i = 2; i < process.argv.length; i++) {
                var arg = process.argv[i];
                var index = arg.search(/^[-/]broker([=:].+)?$/i);
                if (index == 0) {
                    index = arg.search(/[=:]/);
                    if (index >= 0 || i < process.argv.length -1) {
                        brokerAddress = index >= 0 ? arg.substr(index + 1) : process.argv[i + 1];
                        break;
                    }
                }
            }
        }
        util.log('[AmqpTransport.start] Broker: ' + brokerAddress);
        return amqplib.connect(brokerAddress)
            .then(function(newConnection) {
                process.once('SIGINT', this.stop.bind(this));
                connection = newConnection;
                return connection.createChannel()
                    .then(function(createdChannel) {
                        channel = createdChannel;
                        return channel.prefetch(1);
                    })
                    .then(function() {
                        util.log('[AmqpTransport.start] Ready');
                        isReady = true;
                        this.emit('ready');
                    }.bind(this));
            }.bind(this), function(error) {
                util.log('[AmqpTransport.start] Error: ' + JSON.stringify(error));
            });
    };


    /**
     * Stops the transport.
     *
     * @api public
     */
    this.stop = function stop() {
        setImmediate(function() {
            isReady = false;
            if (connection) {
                connection.close();
                connection = undefined;
            }
        });
    };
}

/**
 * @alias module:medseek-util-microservices/AmqpTransport
 */
module.exports = AmqpTransport;
