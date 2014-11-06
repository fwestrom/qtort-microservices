var microservices = require('../');
var minimist = require('minimist');

module.exports = microservices;

var options = minimist(process.argv.slice(2), {
    default: {
        defaultExchange: 'topic://example',
        debug: false
    }
});

microservices.useTransport(microservices.AmqpTransport, options);
