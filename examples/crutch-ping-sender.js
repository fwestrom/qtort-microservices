var crutch = require('../crutch.js');
var defaults = {
    // qtort-microservices options
    defaultExchange: 'topic://example',
    defaultQueue: 'ping-sender',
    defaultReturnBody: true, // false returns message-context from .call/etc

    // microservice-crutch options
    'log.level': 'ERROR',

    // custom options
    //   override on command line like
    //     --pingValue=MYPING
    pingValue: 'PING',
};

crutch(defaults, function(app, logging, microservices, options, Promise) {
    var log = logging.getLogger('qtort-microservices.example.ping-sender');
    log.setLevel('INFO');

    // return a promise that is resolved when your application is ready
    return Promise
        .delay(100)
        .then(function() {
            var body = {
                value: options.pingValue,
            };
            var properties = {
                'sent-by': 'ping-sender',
            };
            microservices.call('example.ping', body, properties)
                .then(function(reply) {
                    log.info('Got reply:', reply);
                })
                .finally(app.shutdown)
                .done();
        });
});
