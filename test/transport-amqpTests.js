"use strict";

var _ = require('lodash');
var Promise = require('bluebird')
var sinon = require('sinon');
var uuid = require('node-uuid');

var AmqpTransport = require('../transport-amqp.js');

describe('transport-amqp', function() {
    var act, actThen, actThenVerify;
    var amqplib, amqplibObj;
    var brokerAddress = 'amqp://localhost';
    var callback;
    var channel, channelObj;
    var connection, connectionObj;
    var expectConnect;
    var expectCreateChannel;
    var options;
    var transport;

    beforeEach(function() {
        amqplib = sinon.mock(amqplibObj = { connect: function() {} });
        callback = sinon.mock();
        connection = sinon.mock(connectionObj = { createChannel: function() {} });
        channel = sinon.mock(channelObj = {
            ack: function() {},
            assertExchange: function() {},
            assertQueue: function() {},
            bindQueue: function() {},
            consume: function() {},
            prefetch: function() {},
            unbindQueue: function() {}
        });
        expectConnect = amqplib
            .expects('connect')
            .returns(Promise.resolve(connectionObj));
        expectCreateChannel = connection
            .expects('createChannel')
            .returns(Promise.resolve(channelObj));
        options = {
            defaultExchange: 'topic://test-' + uuid.v4(),
            defaultQueue: 'transport-amqp.test.' + uuid.v4(),
            debug: false
        };
        transport = new AmqpTransport(options, undefined, amqplibObj);
        actThen = function(doAssert) {
            return act().finally(doAssert);
        };
        actThenVerify = function(toVerify) {
            return actThen(toVerify.verify.bind(toVerify));
        };
    });

    afterEach(function() {
        return Promise.resolve().delay(1);
    });

    describe('name', function() {
        it('name is AmqpTransport', function() {
            transport.name
                .should.be.eql('AmqpTransport');
        });
    });

    describe('start', function() {
        beforeEach(function() {
            act = function() {
                return transport.start();
            };
        });

        it('connects to broker', function() {
            expectConnect
                .on(amqplibObj)
                .withArgs(brokerAddress);
            return act().finally(function() {
                expectConnect.verify();
            });
        });

        it('opens a channel', function() {
            expectCreateChannel
                .on(connectionObj);
            return act().finally(function() {
                expectCreateChannel.verify();
            });
        });

        it('sets channel prefetch', function() {
            var expectPrefetch = channel
                .expects('prefetch')
                .on(channelObj)
                .withArgs(1);
            return act().finally(function() {
                expectPrefetch.verify();
            });
        });

        it('raises ready notification', function() {
            transport.on('ready', callback);
            return act().finally(function() {
                callback.verify();
            });
        });
    });

    describe('bind', function() {
        describeWithExchangeType('topic');

        function describeWithExchangeType(exchangeType, additionalTests) {
            describe('with ' + exchangeType + ' exchange', function() {
                var address, exchange, routingKey, queue;
                var expectAssertExchange;
                var expectAssertQueue;
                var expectBindQueue;
                var expectConsume;
                beforeEach(function() {
                    address = toAddress(exchangeType, exchange = 'exchange-' + Math.random(), (routingKey = 'routingKey-' + Math.random()), (queue = 'queue-' + Math.random()));
                    expectAssertExchange = channel
                        .expects('assertExchange')
                        .returns(Promise.resolve());
                    expectAssertQueue = channel
                        .expects('assertQueue')
                        .returns(Promise.resolve({ queue: queue }));
                    expectBindQueue = channel
                        .expects('bindQueue')
                        .returns(Promise.resolve());
                    expectConsume = channel
                        .expects('consume')
                        .returns(Promise.resolve({ consumerTag: 'ctag-' + Math.random() }));
                    act = function() {
                        return transport.bind(address, callback);
                    };
                    return transport.start();
                });

                it('declares exchange', function() {
                    expectAssertExchange
                        .on(channelObj)
                        .withArgs(exchange, exchangeType);
                    return actThenVerify(expectAssertExchange);
                });

                it('declares queue', function() {
                    expectAssertQueue
                        .on(channelObj)
                        .withArgs(queue);
                    return actThenVerify(expectAssertQueue);
                });

                it('binds queue to exchange', function() {
                    expectBindQueue
                        .on(channelObj)
                        .withArgs(queue, exchange, routingKey);
                    return actThenVerify(expectBindQueue);
                });

                it('consumes from queue', function() {
                    expectConsume
                        .on(channelObj)
                        .withArgs(queue);
                    return actThenVerify(expectConsume);
                });

                describe('on receive from consumer', function() {
                    var expectAck;
                    var msg;
                    beforeEach(function() {
                        expectAck = channel.expects('ack');
                        msg = { content: new Buffer(Math.random().toString()), properties: { contentType: 'application/json' }, fields: { routingKey: routingKey } };
                        var promise = act();
                        act = function() {
                            return Promise.try(function() {
                                var consumerCallback = expectConsume.getCall(0).args[1];
                                return consumerCallback(msg);
                            });
                        };
                        return promise;
                    });

                    it('invokes callback with message context', function() {
                        return Promise.try(function() {
                            return actThenVerify(callback);
                        })
                        .then(function() {
                            var mc = callback.getCall(0).args[0];
                            mc.should.have.property('body').eql(msg.content);
                            mc.should.have.property('routingKey').eql(routingKey);
                            mc.should.have.property('properties').with.property('contentType').eql(msg.properties.contentType);
                        });
                    });

                    it('acknowledges message', function() {
                        expectAck.on(channelObj).withArgs(msg);
                        return actThenVerify(expectAck);
                    });

                    it('does not acknowledge message if subscriber throws', function() {
                        var expectedError = new Error('Test-Error');
                        callback.throws(expectedError);
                        expectAck.never();
                        return actThenVerify(expectAck)
                            .then(function() {
                                throw new Error('Error was not produced.')
                            })
                            .catch(function(error) {
                                error.should.be.exactly(expectedError);
                            });
                    });

                    it('raises error notification if subscriber throws', function() {
                        var expectedError = new Error('Test-Error');
                        callback.throws(expectedError);
                        return act()
                            .then(function() {
                                throw new Error('Error was not produced.')
                            })
                            .catch(function(error) {
                                error.should.be.exactly(expectedError);
                            });
                    })
                });
            });

            if (additionalTests)
                additionalTests();
        }
    });

    describe('bindReply', function() {
        // TODO: Write tests for bindReply once its functionality is understood.
    });

    describe('on received from consumer', function() {
    });

    describe('Descriptor.matches', function() {

        describe('topic exchange', function() {
            var t = 'topic';

            tc(t, 'a', 'a', true);
            tc(t, 'a', 'a.b');
            tc(t, 'a', 'x');
            tc(t, 'a.b', 'a');
            tc(t, 'a.b', 'a.b', true);
            tc(t, 'a.b', 'a.b.c');
            tc(t, 'a.b', 'a.x');

            tc(t, 'a.*', 'a');
            tc(t, 'a.*', 'a.b', true);
            tc(t, 'a.*', 'a.b.c');
            tc(t, 'a.*.c', 'a');
            tc(t, 'a.*.c', 'a.b');
            tc(t, 'a.*.c', 'a.b.c', true);
            tc(t, 'a.*.c', 'a.b.c.d');

            tc(t, 'a.#', 'a', true);
            tc(t, 'a.#', 'a.b', true);
            tc(t, 'a.#', 'a.b.c', true);
            tc(t, 'a.#', 'x');
            tc(t, 'a.#.z', 'a');
            tc(t, 'a.#.z', 'a.b');
            tc(t, 'a.#.z', 'a.b.c');
            tc(t, 'a.#.z', 'a.b.z', true);
            tc(t, 'a.#.z', 'a.b.c.z', true);
            tc(t, 'a.#.z', 'a.b.c.d.z', true);
            tc(t, 'a.#.z', 'a.x');
            tc(t, 'a.#.z', 'a.z', true);
            tc(t, 'a.#.z', 'x.z');
            tc(t, 'a.b.#', 'a');
            tc(t, 'a.b.#', 'a.b', true);
            tc(t, 'a.b.#', 'a.b.c', true);
            tc(t, 'a.b.#', 'a.b.c.d', true);
            tc(t, 'a.b.#', 'a.x');
            tc(t, 'a.b.#.z', 'a');
            tc(t, 'a.b.#.z', 'a.b');
            tc(t, 'a.b.#.z', 'a.b.c');
            tc(t, 'a.b.#.z', 'a.b.c.d');
            tc(t, 'a.b.#.z', 'a.b.c.z', true);
            tc(t, 'a.b.#.z', 'a.b.c.d.z', true);
            tc(t, 'a.b.#.z', 'a.b.c.d.e.z', true);
            tc(t, 'a.b.#.z', 'a.b.c.x');
            tc(t, 'a.b.#.z', 'a.b.c.z', true);
            tc(t, 'a.b.#.z', 'a.b.z', true);
            tc(t, 'a.b.#.z', 'a.x.z');
        });

        function tc(bindAddressExchangeType, bindAddressRoutingKey, receivedMessageRoutingKey, isMatch) {
            it(bindAddressRoutingKey + ' | recv ' + receivedMessageRoutingKey + ' | ' + (isMatch ? 'match' : 'skip'), function() {
                var bindAddress = bindAddressExchangeType + '://test-exchange/' + bindAddressRoutingKey;
                var parsedAddress = transport.parseAddress(bindAddress);
                var descriptor = new transport.Descriptor(parsedAddress);
                var messageContext = { routingKey: receivedMessageRoutingKey };

                var result = descriptor.matches(messageContext);

                result.should.eql(isMatch === true);
            });
        }
    });

    describe('parseAddress', function() {

        describe('with rk and defaults', function() {
            var cases = [
                'a',
                'b.c',
                'd.*.f',
                'g.#.z',
            ];
            _.forEach(cases, function(rk) {
                it(rk, function() {
                    var result = transport.parseAddress(rk, true);
                    result.should.have.properties({
                        exchangeType: options.defaultExchange.split('://')[0],
                        exchange: options.defaultExchange.split('://')[1],
                        queue: options.defaultQueue,
                        routingKey: rk
                    });
                });
            });
        });

        describe('with well-formed values', function() {
            var exchangeTypes = ['direct', 'fanout', 'topic'];
            var exchangeNames = ['exchange-name', 'exchange.name'];
            var routingKeys = ['abc.*.ghi', 'abc.#.xyz', 'abc.#'];
            var queueNames = [undefined, '', 'qrs', 'qrs-tuv', 'Qrs.Tuv'];
            exchangeTypes.forEach(function(exchangeType) {
                exchangeNames.forEach(function(exchangeName) {
                    routingKeys.forEach(function(routingKey) {
                        queueNames.forEach(function(queueName) {
                            var value = exchangeType + '://' + exchangeName + '/' + routingKey;
                            if (queueName)
                                value += '/' + queueName;

                            it(value, function() {
                                var result = transport.parseAddress(value);
                                it('returns exchange type', function() {
                                    result.should.have
                                        .properties({ exchangeType: exchangeType });
                                });
                                it('returns exchange', function() {
                                    result.should.have
                                        .properties({ exchange: exchangeName });
                                });
                                it('returns routing key', function() {
                                    result.should.have
                                        .properties({ routingKey: routingKey });
                                });
                                it('returns queue', function() {
                                    var expectedQueue = queueName ? queueName : '';
                                    result.should.have
                                        .properties({ queue: expectedQueue });
                                });
                            });
                        });
                    });
                });
            });
        });

        describe('with unsupported values', function() {
            var values = [
                'http://localhost',
                'http://localhost:1234',
                'http://localhost/my-service',
                'http://localhost:1234/my-service',
                'https://localhost',
                'https://localhost/my-service',
                'https://localhost:1234',
                'https://localhost:1234/my-service',
                undefined
            ];

            var should = require('should');
            values.forEach(function(value) {
                it(value ? value : '[undefined]', function() {
                    var result = transport.parseAddress(value);
                    should(result)
                        .equal(undefined);
                });
            });
        });
    });

    function toAddress(exchangeType, exchangeName, routingKey, queueName) {
        var esi = exchangeType.indexOf('://');
        if (esi >= 0) {
            queueName = routingKey;
            routingKey = exchangeName;
            exchangeName = exchangeType.slice(esi + 3);
            exchangeType = exchangeType.slice(0, esi);
        }
        var value = exchangeType + '://' + exchangeName + '/' + routingKey;
        return queueName ? value  + '/' + queueName : value;
    }
});
