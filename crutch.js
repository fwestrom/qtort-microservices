'use strict';

var _ = require('lodash');
var events = require('events');
var microservices = require('./injectable/microservices');
var minimist = require('minimist');
var Promise = require('bluebird');
var util = require('util');

var injector = require('./injectable/injector.js');

module.exports = function crutch(defaultOptions, callback) {
    if (!(callback instanceof Function) && defaultOptions instanceof Function) {
        var tmp = callback;
        callback = defaultOptions;
        defaultOptions = callback;
    }
    if (callback === undefined) {
        throw new Error('A callback initializing the micro-service is required.');
    }

    var inject = injector(_.extend({
        app: _.bindAll(new events.EventEmitter()),
        defaultOptions: defaultOptions,
        Promise: Promise,
        uuid: require('node-uuid'),
        serializer: require('./serializer.js'),
        'qtort-microservices': microservices,
    }, defaultOptions.injectables));

    return Promise.try(function() {
        return inject(function(_, app, inject, logging, options, util) {
            _.extend(app, {
                when: {
                    shutdown: new Promise(function(resolve) { app.on('shutdown', resolve); }),
                },
                shutdown: function() {
                    return inject(shutdown);
                }
            });

            var log = logging.getLogger('qtort-microservices.crutch');
            log.info('Started process; pid: %s, options:\n%s', process.pid, util.inspect(options, { depth: null }));

            return Promise
                .try(function() {
                    return inject(initialize);
                })
                .then(function() {
                    return inject(callback);
                })
                .then(function() {
                    return inject(function(microservices) {
                        log.debug('crutch| microservices.bindings:\n', microservices.bindings);
                        _.extend(app, microservices.bindings);
                    });
                })
                .then(function() {
                    log.info('Ready.');
                    return Promise.try(app.emit.bind(app), 'ready');
                })
                .return(app);
        });
    });
};

function initialize(app, inject, logging, options) {
    var log = logging.getLogger('qtort-microservices.crutch');
    log.debug('Initializing crutch.');

    log.debug('Setting up signal/exit handlers:', options.shutdownOn);

    options.shutdownOn.forEach(function(signal) {
        log.trace('Setting up handler for signal:', signal);

        process.on(signal, signalHandler);
        app.on('shutdown', shutdownHandler);

        function signalHandler() {
            log.warn('Received signal:', signal);
            app.shutdown()
                .delay(10)
                .tap(function() {
                    process.exit();
                })
                .done();
        }

        function shutdownHandler() {
            process.removeListener(signal, signalHandler);
            app.removeListener('shutdown', shutdownHandler);
        }
    });

    return Promise.try(inject, function(microservices) {
        log.trace('Initialized microservices module.');
    });
}

function shutdown(app, logging, microservices) {
    var log = logging.getLogger('qtort-microservices.crutch');
    log.info('Shutting down.');

    return Promise
        .try(function() {
            return app.emit('shutdown');
        })
        .then(function() {
            return app.emit('shutdown-last');
        });
}

// When started directly
if (require.main === module) {
    module.exports({}, function(app, inject, logging) {
        var log = logging.getLogger('qtort-microservices.module.main');
        log.debug('in module.main');
        app.once('shutdown', function(info) {
            log.debug('module.main shutdown:');
        });
        app.once('exit', function(info) {
            log.debug('module.main exit:', info);
        });

        setTimeout(function() {
            app.shutdown().done();
        }, 5000);
    });
}
