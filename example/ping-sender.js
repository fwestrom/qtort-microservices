"use strict";

var microservices = require('./microservices.js');
var util = require('util');

var i = 0;
function ping() {
    var body = 'PING-' + ++i;
    microservices.call('topic://example/ping.v1', body, { 'custom-1': 'value-1' })
        .then(function(body) {
            //console.log('[Example.ping-sender] Received reply: ' + body);
            spin();
            setNextPing();
        })
        .done();
}

var timer = -1, interval = 1;
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
