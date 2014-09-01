"use strict";

var microservices = require('../');
if (!microservices.transport) {
    microservices.useTransport(microservices.AmqpTransport, {
        defaultExchange: 'topic://example',
        debug: false
    });
}

microservices
    .bind('topic://example/ping.v1/example.ping.v1', function(messageContext) {
        var body = messageContext.deserialize();
        var reply = body.replace('PING', 'PONG');
        //console.log('[Example.ping-listener] Body: ' + body + ', Reply Body: ' + reply);
        //messageContext.reply(reply, { 'custom-2': 'custom-2' });
        return reply;
    });