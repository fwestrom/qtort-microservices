'use strict';

var ms;

module.exports = function microservices(_, app, inject, logging, options, Promise) {
    if (ms) {
        return ms;
    }

    var log = logging.getLogger('qtort-microservices.microservices');

    var microservicesFactory = require('../module.js');
    return inject(microservicesFactory)
        .tap(function(ms) {
            ms.on('error', onError);

            var bind = ms.bind;
            _.extend(ms, {
                bindings: {},
                bind: function(rk, action, opts) {
                    ms.bindings[rk] = action;
                    return bind(rk, action, opts);
                },
            });
        })
        .tap(function(ms) {
            return inject(ms.ZmqTransport)
                .then(function(transport) {
                    if (transport.on) {
                        transport.on('error', onError);
                    }
                    app.once('shutdown-last', _.partial(onShutdown, ms, transport));
                    return ms.useTransport(transport, options);
                })
        })

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
