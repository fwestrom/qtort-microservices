"use strict";

var microservices = require('./microservices.js');
microservices.ready
    .then(function(ms) {
        return microservices.bind('topic://example/ping.v1/example.ping.v1', function(mc) {
            var body = mc.deserialize();
            var reply = body.replace('PING', 'PONG');
            //console.log('[Example.ping-listener] Body: ' + body + ', Reply Body: ' + reply);
            //messageContext.reply(reply, { 'custom-2': 'custom-2' });
            return reply;
        });
    })
    .done();
