"use strict";

var microservices = require('../');
var util = require('util');

microservices.useTransport(microservices.AmqpTransport, { defaultExchange: 'topic://example' });

microservices
    .bind('topic://example/ping.v1')
    .subscribe(function(messageContext) {
        util.log('[Example.ping-listener] Message Context: ' + JSON.stringify(messageContext));

        var reply = messageContext.body.replace('PING', 'PONG');
        util.log('[Example.ping-listener] Body: ' + messageContext.body + ', Reply Body: ' + reply);
        messageContext.reply(reply, {
            'custom-2': 'custom-2'
        });
    });
