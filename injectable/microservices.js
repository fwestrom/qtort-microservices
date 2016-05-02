'use strict';

module.exports = function microservices(_, app, inject, logging, options) {
    var log = logging.getLogger('microservice-crutch.microservices');
    log.debug('Initializing qtort-microservices module.');

    return inject.resolve('qtort-microservices')
        .then(function(microservices) {
            return inject(microservices);
        })
        .then(function(ms) {
            return inject(ms.AmqpTransport)
                .then(function(transport) {
                    var shutdownHandler = _.partial(onShutdown, ms, transport);
                    app.once('shutdown-last', shutdownHandler);
                    ms.on('error', onError);
                    if (transport.on) {
                        transport.on('error', onError);
                    }
                    return ms.useTransport(transport, options);
                })
                .return(ms);
        })
        .then(function(ms) {
            var bindings = {};
            return _.defaults({
                bindings: bindings,
                bind: function(rk, action, opts) {
                    bindings[rk] = action;
                    return ms.bind(rk, action, opts);
                },
            }, ms);
        });

    function onError(error) {
        if (app.listeners('error').length > 0) {
            return _.partial(app.emit, 'error').apply(app, arguments);
        }
        else {
            throw error;
        }
    }

    function onShutdown(ms, transport) {
        log.debug('Shutting down qtort-microservices module.');
        ms.removeListener('error', onError);
        if (transport.removeListener) {
            transport.removeListener('error', onError);
        }
        ms.dispose();
    }
};
