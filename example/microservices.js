var minimist = require('minimist');

var options = minimist(process.argv.slice(2), {
    default: {
        defaultExchange: 'topic://example',
        //defaultQueue: 'ping.example.[sender|listener]',  <-- no sharing here
        defaultTimeout: 15000,
        debug: false
    }
});

var microservices = require('../')(options);
module.exports = microservices;
module.exports.ready = microservices.useTransport(microservices.AmqpTransport, options)
    .then(function() {
        console.log('Ready.');
        return microservices;
    });
