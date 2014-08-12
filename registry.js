"use strict";

var events = require('events');
var util = require('util');

function Registry()
{
    if (!(this instanceof Registry))
        return new Registry();
    events.EventEmitter.call(this);

    var descriptors = [];
    Object.defineProperty(this, 'descriptors', { configurable: false, enumerable: false, get: function() { return descriptors; } });

    this.register = function(descriptor) {
        descriptors.push(descriptor);
        this.emit('register', descriptor);
        return this;
    };

    this.unregister = function(descriptor) {
        var index = descriptors.indexOf(descriptor);
        if (index > -1) {
            descriptors.splice(index, 1);
            this.emit('unregister', descriptor);
        }
        return this;
    };
}

util.inherits(Registry, events.EventEmitter);

module.exports.Registry = Registry;
module.exports.createRegistry = function createRegistry() {
    return new Registry();
};