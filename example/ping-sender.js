"use strict";

var microservices = require('../'), util = require('util');
if (!microservices.transport) {
    microservices.useTransport(microservices.AmqpTransport, {
        defaultExchange: 'topic://example',
        debug: false
    });
}

function ping() {
    microservices
        .bindReply(function(messageContext, replyContext) {
            var body = messageContext.deserialize();
            //console.log('[Example.ping-sender] Received reply: ' + body);
            spin();
            replyContext.close();
            setNextPing();
        })
        .then(function(replyContext) {
            var body = 'PING-' + ++i;
            //console.log('[Example.ping-sender] Sending message: ' + body);
            replyContext.send('topic://example/ping.v1', body, { 'custom-1': 'value-1' });
        });
}

var i = 0, timer = -1, interval = 1;
function setNextPing() { timer = setImmediate(function() { timer = -1; ping(); }, interval); }
process.once('SIGINT', function() { if (timer != -1) clearTimeout(timer); });
setNextPing();

var spinChar;
function spin() {
    var prefix = spinChar ? '\b' : '';
    switch (spinChar) {
        case '/': spinChar = '-'; break;
        case '-': spinChar = '\\'; break;
        case '\\': spinChar = '|'; break;
        case '|': spinChar = '/'; break;
        default: spinChar = '/';
    }
    util.print(prefix + spinChar);
}