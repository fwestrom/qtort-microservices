"use strict";

var microservices = require('../');
var util = require('util');

microservices.useTransport(microservices.AmqpTransport, { defaultExchange: 'topic://example' });

function ping(onReply) {
    microservices
        .bindReply(function(replyContext) {
            replyContext.subscribe(function(messageContext) {
                util.log('[Example.ping-sender] Received reply: ' + messageContext.body);
                replyContext.close();
                if (onReply)
                    onReply();
            });

            var body = 'PING-' + ++i;
            util.log('[Example.ping-sender] Sending message: ' + body);
            replyContext.send('topic://example/ping.v1', body);
        });
}



var i = 0;
function setNextPing() {
    timer = setTimeout(function() {
        timer = -1;
        ping(setNextPing);
    }, 1000);
}

var timer = -1;
process.once('SIGINT', function() {
    if (timer != -1)
        clearTimeout(timer);
});

setNextPing();