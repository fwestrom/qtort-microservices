"use strict";

var events = require('events');
var util = require('util');

function Descriptor(type, bindings) {
    this.bindings = bindings;
    this.type = type;
}

util.inherits(Descriptor, events.EventEmitter);
Descriptor.prototype.bindings = undefined;
Descriptor.prototype.type = undefined;

module.exports.Descriptor = Descriptor;