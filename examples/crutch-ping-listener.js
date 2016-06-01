var crutch = require('../crutch.js');
var defaults = {
    defaultExchange: 'topic://example',
    defaultQueue: 'ping-listener',
    defaultReturnBody: false,
    'log.level': 'ERROR',
    pongValue: 'PONG',
};

crutch(defaults, function(logging, microservices, options, Promise) {
    var log = logging.getLogger('qtort-microservices.example.ping-listener');
    log.setLevel('INFO');

    return microservices.bind('example.ping', function(mc) {
        return Promise
            .try(function() {
                var body = mc.deserialize();
                log.info('Got ping:', body);
                log.trace('messageContext:', mc);
                return {
                    value: options.pongValue,
                };
            })
        });
});
