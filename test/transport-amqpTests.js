"use strict";

var rx = require('rx');
var util = require('util');

var AmqpTransport = require('../transport-amqp.js');

describe('transport-amqp', function() {
    var amqplib = {
        connect: function(address) { }
    };

    var transport = new AmqpTransport({ amqplib: amqplib, defaultExchange: 'topic://test' });

    describe('parseAddress', function() {
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

    describe('isMatch', function() {
        describe('no-match', function() {
            var cases = [
                [ "topic://medseek-api/A.B.C", "A.B.C.D" ],
                [ "topic://medseek-api/A.B.C.D", "A.B.C" ],
                [ "topic://medseek-api/A.*.C.D", "A.B.X.D" ],
                [ "topic://medseek-api/A.X.C.D", "A.B.C.D" ],
                [ "topic://medseek-api/A.#.C.D", "A.B.C.B.D" ],
                [ "topic://medseek-api/A.#.C.D", "A1.B.C.D" ],
                [ "topic://medseek-api/A.B.#", "A.B" ],
                [ "topic://medseek-api/A.B.*", "A.B.X.D" ]
            ];

            cases.forEach(function(x) {
                var address = x[0];
                var routingKey = x[1];
                it(address + ' ? ' + routingKey, function() {
                    var parsedAddress = transport.parseAddress(address);
                    var result = transport.isMatch(parsedAddress, { routingKey: routingKey });
                    result.should.be
                        .eql(false);
                });
            });
        });

        describe('is-match', function() {
            var cases = [
                [ "topic://medseek-api/A.B.C.D", "A.B.C.D" ],
                [ "topic://medseek-api/A.#.C.D", "A.B.C.D" ],
                [ "topic://medseek-api/A.#.C.D", "A.B1.B2.B3.C.D" ],
                [ "topic://medseek-api/A.B.*.D", "A.B.X.D" ]
            ];

            cases.forEach(function(x) {
                var address = x[0];
                var routingKey = x[1];
                it(address + ' ? ' + routingKey, function() {
                    var parsedAddress = transport.parseAddress(address);
                    var result = transport.isMatch(parsedAddress, { routingKey: routingKey });
                    result.should.be
                        .eql(true);
                });
            });
        });
    });

    describe('bind', function() {
        // TODO: Write tests for bind once its functionality is understood.
    });

    describe('bindReply', function() {
        // TODO: Write tests for bindReply once its functionality is understood.
    });
});