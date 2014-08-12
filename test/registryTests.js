"use strict";

var descriptor = undefined;
var registry = undefined;
module.exports = {
    setUp: function(callback) {
        descriptor = {};
        registry = require('../registry').createRegistry();
        callback();
    },

    tearDown: function(callback) {
        descriptor = undefined;
        registry = undefined;
        callback();
    },

    register: {
        addsToDescriptors: function(test) {
            registry.register(descriptor);

            var index = registry.descriptors.indexOf(descriptor);
            test.notEqual(index, -1, 'Register should add value to descriptors.');
            test.done();
        },

        raisesRegister: function(test) {
            var items = [];
            registry.on('register', function(descriptor) { items.push(descriptor); });
            registry.register(descriptor);
            test.strictEqual(items[0], descriptor, 'Register should raise the register notification.');
            test.done();
        },

        returnsSelf: function(test) {
            var result = registry.register(descriptor);
            test.strictEqual(result, registry, 'Register should return the registry.');
            test.done();
        }
    },

    unregister: {
        setUp: function(callback) {
            registry.register(descriptor);
            callback();
        },

        raisesUnregister: function(test) {
            var items = [];
            registry.on('unregister', function(descriptor) { items.push(descriptor); });
            registry.unregister(descriptor);
            test.strictEqual(items[0], descriptor, 'Unregister should raise the unregister notification.');
            test.done();
        },

        removesFromDescriptors: function(test) {
            registry.unregister(descriptor);

            var index = registry.descriptors.indexOf(descriptor);
            test.equal(index, -1, 'Unregister should remove value from descriptors.');
            test.done();
        },

        returnsSelf: function(test) {
            var result = registry.unregister(descriptor);
            test.strictEqual(result, registry, 'Unregister should return the registry.');
            test.done();
        }
    }
};