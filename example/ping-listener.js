"use strict";

var microservices = require('../');
var util = require('util');

microservices.useTransport(microservices.AmqpTransport, { defaultExchange: 'topic://example' });

microservices
    .bind('topic://example/ping.v1')
    .subscribe(function(messageContext) {
        var body = messageContext.body;
        var reply = body.replace('PING', 'PONG');
        util.log('[Example.ping-listener] Body: ' + body + ', sending reply: ' + reply + '.');
        messageContext.reply(reply);
    });
