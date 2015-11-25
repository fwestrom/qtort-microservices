'use strict';

describe('crutch', function() {
    var _ = require('lodash');
    var events = require('events');
    var log4js = require('log4js');
    var Promise = require('bluebird');
    var proxyquire = require('proxyquire');
    var should = require('should');
    var sinon = require('sinon');
    var inject = require('../injectable/injector.js')({
        defaultOptions: {
            defaultExchange: 'topic://abcdefg',
            defaultQueue: 'crutch.test',
            'log.level': 'warn',
            'log.replaceConsole': false
        }
    });

    var bindings = {
        'a.b.c.d': function abcd() {},
        'e.f.g.h': function efgh() {},
        'x.y.z': function xyz() {},
    };
    var _app;
    var bindings;
    var callback;
    var crutch;
    var log;
    var opts;
    var ms;

    before(function() {
        return inject(function(logging, options) {
            log = logging.getLogger('crutch.test');
            log.debug('before| Setting up');
            opts = options;
        });
    });

    beforeEach(function() {
        log.debug('beforeEach| Setting up');
        ms = _.extend(new events.EventEmitter(), {
            bind: sinon.spy(function(addr, cb) {
                log.debug('bind| %s ->', addr, cb);
                return Promise.resolve();
            }),
            bindReply: function() { return Promise.resolve(); },
            call: function() { return Promise.resolve(); },
            send: function() { return Promise.resolve(); },
            AmqpTransport: function AmqpTransport(options) { return {}; },
            useTransport: function() { return Promise.resolve(); },
            dispose: function() {},
        });

        crutch = _.partial(proxyquire('../crutch.js', {
            'qtort-microservices': _.extend(function(options, serializer) {
                return ms;
            }, {
                '@noCallThru': false,
                //'@runtimeGlobal': true
                //'@global': true
            })
        }), opts);

        callback = function(app, microservices) {
            _app = app;
            return Promise.all(_.map(bindings, function(fn, rk) {
                return microservices.bind(rk, fn)
                    .delay(1);
            }));
        };

        return Promise.resolve();
    });

    afterEach(function() {
        log.debug('afterEach| Cleaning up');
        return Promise.try(function() {
            if (_app) {
                return _app.shutdown();
            }
        }).catch(function(error) {
            log.warn('afterEach| error:', error);
        }).finally(function() {
            _app = undefined;
        });
    });

    describe('returns', function() {
        describe('micro-service bindings as properties', function() {
            _.forEach(bindings, function(fn, rk) {
                it('for binding ' + rk, function() {
                    return crutch(callback)
                        .tap(function(app) {
                            should(app).have.property(rk).exactly(fn);
                        });
                });
            });
        });
    });

    describe('invokes external module', function() {
        describe('microservices', function() {

            describe.skip('bind', function() {
                _.forEach(bindings, function(fn, rk) {
                    it(rk, function() {
                        var addr = opts.defaultExchange + '/' + rk + '/' + opts.defaultQueue;
                        return crutch(callback)
                            .then(function() {
                                ms.bind.withArgs(addr, fn)
                                    .called
                                    .should.be.true;
                            });
                    });
                });
            });

            describe.skip('bindReply', function() {
                it('when used', function() {
                    throw new Error('TODO');
                });
            });

            describe.skip('call', function() {
                it('when used', function() {
                    throw new Error('TODO');
                });
            });

            describe.skip('send', function() {
                it('when used', function() {
                    throw new Error('TODO');
                });
            });
        });
    });
});
