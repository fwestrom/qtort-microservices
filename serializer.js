"use strict";

/**
 * Deserializes the body of the message.
 *
 * @returns Object The deserialized body object.
 */
exports.deserialize = function(contentType, body) {
    
    if(contentType==undefined)
        contentType="application/json";
    var serializer = getSerializer(contentType, body);
    if (serializer)
        return serializer.deserialize(contentType, body);

    throw new Error('Unsupported content-type ' + contentType + '.');
};

/**
 * Serializes the body of the message.
 *
 * @returns Buffer The serialized body object.
 */
exports.serialize = function(contentType, body) {
    if (body instanceof Buffer)
        return body;

    var serializer = getSerializer(contentType, body);
    if (serializer)
        return serializer.serialize(contentType, body);

    throw new Error('Unsupported content-type ' + contentType + '.');
};

exports.serializers = [
    {
        supports: function(contentType, body) {
            return /^application\/(octet-stream|font-|x-font-)|^font\/|^image\//
                .test(contentType);
        },
        deserialize: function(contentType, body) {
            return body;
        },
        serialize: function(contentType, body) {
            return body instanceof Buffer ? body : new Buffer(body);
        },
    },
    {
        supports: function(contentType, body) {
            return /^application\/javascript|^text\//
                .test(contentType);
        },
        deserialize: function(contentType, body) {
            return body.toString();
        },
        serialize: function(contentType, body) {
            return new Buffer(body.toString());
        },
    },
    {
        supports: function(contentType, body) {
            return contentType === 'application/json';
        },
        deserialize: function(contentType, body) {
            return JSON.parse(body.toString());
        },
        serialize: function(contentType, body) {
            return new Buffer(JSON.stringify(body));
        },
    },
];

function getSerializer(contentType, body) {
    for (var i = 0; i < exports.serializers.length; i++) {
        var serializer = exports.serializers[i];
        if (serializer.supports(contentType, body)) {
            return serializer;
        }
    }
}
