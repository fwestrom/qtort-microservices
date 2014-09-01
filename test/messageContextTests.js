"use strict";

var MessageContext = require('../messageContext.js').MessageContext;
var sinon = require('sinon');

describe('messageContext', function() {

    describe('reply', function() {
        var messageContext;
        var reply;
        beforeEach(function() {
            messageContext = new MessageContext({});
            reply = sinon.stub();
        });

        it('reply is undefined', function() {
            messageContext.should.have.property('reply').exactly(undefined);
        });

        it('reply can be set', function() {
            messageContext.reply = reply;
            messageContext.should.have.property('reply').exactly(reply);
        });

        it('reply can be passed in values', function() {
            messageContext = new MessageContext({ reply: reply });
            messageContext.should.have.property('reply').exactly(reply);
        });
    });
});