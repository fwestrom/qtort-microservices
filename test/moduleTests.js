"use strict";

var should = require('should');
var sinon = require('sinon');
var when = require('when');

describe('module', function() {
    var a = { 1: 1 }, b = { 2: 2 }, c = { 3: 3 }, d = { 4: 4 };
    var act, actThenVerify;
    var action;
    var expectStart;
    var expectStop;
    var messageContext;
    var microservices;
    var observable;
    var transport;
    var transportDisposable;
    var transportObj;
    var value1, value2;

    beforeEach(function() {
        action = sinon.mock();
        messageContext = { properties: { replyTo: undefined }, reply: undefined, routingKey: 'a.b.c.d', custom1: 123 };
        observable = {};
        microservices = require('../')({});
        transportObj = new (require('../transport.js'))('Test-Transport', { debug: true });
        transport = sinon.mock(transportObj);
        value1 = { a: Math.random() };
        value2 = { b: Math.random() };
        expectStart = transport.expects('start');
        expectStop = transport.expects('stop');

        transportDisposable = microservices.useTransport(transportObj);

        act = function() { return when.resolve(); };
        actThenVerify = function(toVerify) {
            return act().then(function() {
                toVerify.verify();
            });
        };

        return when(transportDisposable);
    });

    afterEach(function() {
        if (transportDisposable) {
            return when(transportDisposable)
                .tap(function(disposable) {
                    disposable.dispose();
                })
                .finally(function() {
                    transportDisposable = undefined;
                });
        }
    });

    describe('useTransport', function() {
        it('invokes transport.start', function() {
            return actThenVerify(expectStart);
        });
    });

    describe('bind', function() {
        var address;
        var expectBind;
        beforeEach(function() {
            address = 'topic://tests/abc.123.def.' + Math.random();
            expectBind = transport
                .expects('bind')
                .returns(when.resolve(observable));
        });

        describe('with address, action', function() {
            beforeEach(function() {
                act = function() {
                    return microservices.bind(address, action);
                };
            });

            describeOnMessageContextFromTransport(function() { return expectBind; }, function() {
                it('invokes messageContext.reply with message handler result', function() {
                    action.withArgs(messageContext).returns(value1);
                    messageContext.reply = sinon.mock().withArgs(value1);
                    return actThenVerify(messageContext.reply);
                });
            });
        });
    });

    describe('bindReply', function() {
        var expectBindReply = undefined;
        var replyContext;
        beforeEach(function() {
            replyContext = observable;
            replyContext.close = sinon.mock();
            replyContext.send = sinon.mock();
            expectBindReply = transport
                .expects('bindReply')
                .returns(when.resolve(replyContext));
        });

        describe('with replyAction', function() {
            beforeEach(function() {
                act = function() {
                    return microservices.bindReply(action);
                };
            });

            describeOnMessageContextFromTransport(function() { return expectBindReply; }, function() {
                it('invokes messageContext.reply with message handler result', function() {
                    action.withArgs(messageContext).returns(value1);
                    messageContext.reply = sinon.mock().withArgs(value1);
                    return actThenVerify(messageContext.reply);
                });
            });

            it('invokes transport', function() {
                return actThenVerify(expectBindReply);
            });

            it('returns promise for replyContext', function() {
                return act().then(function(result) {
                    result.should.have.property('close').exactly(replyContext.close);
                    result.should.have.property('send').exactly(replyContext.send);
                });
            });
        });
    });

    function describeOnMessageContextFromTransport(getBindMock, additionalTests) {
        describe('on message context from transport', function() {
            beforeEach(function() {
                var promise = act();
                act = function() {
                    var bind = getBindMock();
                    var callback = bind.getCall(0).args[1];
                    if (!callback)
                        callback = bind.getCall(0).args[0];
                    return when.try(function() {
                        callback(messageContext, {});
                    });
                };
                return promise;
            });

            it('invokes subscriber with message contexts from transport', function() {
                action.withArgs(messageContext);
                return actThenVerify(action);
            });

            it('adds deserialize to message contexts from transport', function() {
                return act().then(function() {
                    messageContext
                        .should.have.property('deserialize')
                        .with.instanceOf(Function);
                });
            });

            if (additionalTests)
                additionalTests();
        });
    }

    describe('send', function() {
        var expectSend = undefined;
        var expectSendResult = { value: 2345 };
        beforeEach(function() {
            expectSend = transport
                .expects('send')
                .returns(when.resolve(expectSendResult));
            act = function() {
                return microservices.send(a, b, c);
            };
        });

        it('invokes transport.send', function() {
            expectSend.withArgs(a, b, c);
            return actThenVerify(expectSend);
        });

        it('returns value from transport', function() {
            return act().then(function(result) {
                should(result).be
                    .exactly(expectSendResult);
            });
        });
    });

    describe('dispose', function() {
        beforeEach(function() {
            act = function() {
                microservices.dispose();
                return when.resolve();
            };
        });

        it('stops transport', function() {
            return actThenVerify(expectStop);
        });
    });
});
