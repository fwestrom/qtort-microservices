"use strict";

var events = require('events');
var rx = require('rx');
var util = require('util');

describe('module', function() {
    var bindAddress = 'topic://tests/abc';
    var transport = undefined;
    var microservices = undefined;

    var transportDisposable = undefined;
    beforeEach(function() {
        microservices = require('../');
        util.log('\n\n[moduleTests.module] microservices = \n' + microservices);
        util.log('\n\n[moduleTests.module] microservices = \n' + JSON.stringify(microservices));
        util.log('\n\n');

        function TestTransport () {
            this.onNext = undefined;
            this.onCompleted = undefined;
            this.onError = undefined;
            Object.defineProperty(this, 'name', { value: 'test-transport' });
            this.bind = function(address) {
                return rx.Observable.create(function(observer) {
                    this.onNext = function(x) { observer.onNext(x); };
                    this.onCompleted = function() { observer.onCompleted(); };
                    this.onError = function(e) { observer.onError(e); };
                }.bind(this));
            };
            this.bindReply = function(actionToBind) {
                return rx.Observable.create(function(observer) {
                    this.onNext = function(x) { observer.onNext(x); };
                    this.onCompleted = function() { observer.onCompleted(); };
                    this.onError = function(e) { observer.onError(e); };
                }.bind(this));
            };
            this.start = function() { };
            this.stop = function() { };
        }
        util.inherits(TestTransport, events.EventEmitter);
        transport = new TestTransport();

        transportDisposable = microservices.useTransport(transport);
    });
    afterEach(function() {
        if (transportDisposable) {
            transportDisposable.dispose();
            transportDisposable = undefined;
        }
    });

    describe('bind', function() {

        it('returns value from transport', function() {
            var observable = rx.Observable.empty();
            transport.bind = function() { return observable; };

            var result = microservices.bind(bindAddress);
            result.should.be
                .exactly(observable);
        });

        it('result.subscribe gets notifications from transport', function() {
            var items = [];
            microservices
                .bind(bindAddress)
                .subscribe(function(x) { items.push(x); });

            var value = { testing: '123' };
            transport.onNext(value);

            items[0].should.be
                .exactly(value);
        });
    });

    describe('bindReply', function() {
        var actionToBind = function() {};

        it('actionToBind can be invoked by transport', function() {
            var actionInvoked = false;
            actionToBind = function() { actionInvoked = true; };
            transport.bindReply = function(x) { x(); };

            microservices.bindReply(actionToBind);

            actionInvoked.should.be
                .eql(true);
        });

        it('returns value from transport', function() {
            var observable = rx.Observable.empty();
            transport.bindReply = function() { return observable; };

            var result = microservices.bindReply(actionToBind);
            result.should.be
                .exactly(observable);
        });

        it('result.subscribe gets notifications from transport', function() {
            var items = [];
            microservices
                .bindReply(actionToBind)
                .subscribe(function(x) { items.push(x); });

            var value = { testing: '123' };
            transport.onNext(value);

            items[0].should.be
                .exactly(value);
        });
    });
});
