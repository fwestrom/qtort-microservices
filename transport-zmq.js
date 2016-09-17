"use strict";
var events = require('events');
var url = require('url');
var util = require('util');
var Transport = require('./transport.js');

/**
 * Provides an AMQP transport for the micro-services module.
 *
 * @module medseek-util-microservices/AmqpTransport
 */

util.inherits(ZmqTransport, Transport);

/**
 * A transport for the micro-services module that interacts with an AMQP
 * service.
 *
 * @constructor
 * @this {ZmqTransport}
 * @param options Options for configuring the transport.
 * @param options.defaultExchange The default exchange.
 * @param [options.amqplib] An optional amqplib to use instead of the default module.
 */
 function ZmqTransport(options, _, zmq, Promise, serializer, uuid) {

    if (!(this instanceof ZmqTransport)) {
        return new ZmqTransport(options, _, zmq, Promise, serializer, uuid);
    }

    Transport.call(this, 'zmqTransport', options);
    this.setMaxListeners(0);


    _ = _ || require('lodash');
    zmq = zmq || require('zmq');
    Promise = Promise || require('bluebird');
    serializer = serializer || require('./serializer');
    uuid = uuid || require('node-uuid');

    /**
     * Binds an endpoint at the specified address.
     *
     * @param address The endpoint address.
     * @return An observable sequences of messages, if the endpoint was bound by the transport, or undefined.
     * @api public
     */
    this.bind = bind;

    /**
     * Binds a reply endpoint for use with the specified action.
     *
     * @param actionToBind An action to be invoked with the reply context.
     * @return observable stream of messages received at the endpoint.
     * @api public
     */
    this.bindReply = bindReply;

    /**
     * Calls a remote RPC-style endpoint and returns a promise for the reply
     * message, error, or timeout.
     */
    this.call = call;

    /**
     * Sends a message to the specified endpoint.
     *
     * @param {string} address The address of the destination endpoint.
     * @param {Object} body The message body.
     * @param {Object} properties Additional message properties.
     * @api public
     */
    this.send = send.bind(this);

    /**
     * Starts the transport.
     *
     * @api public
     */
    this.start = start;


    /**
     * Stops the transport.
     *
     * @api public
     */
    this.stop = stop;

    this.isMatch = options.isMatch || isMatch;

    this.parseAddress = options.parseAddress || parseAddress;

    this.Descriptor = Descriptor;

    var channel = undefined;
    var connection = undefined;
    var descriptors = [];
    var instanceId = uuid.v1();
    var isReady = false;
    var me = this;
    var replyDescriptor;
    var replyIdCounter = 0;

   var declaredAddresses = [];

    declaredAddresses.findByName = function (address) {
        var value = undefined;
        for (var i = 0; i < this.length; i++) {
            value = this[i];
            if (value.address == address)
                return value;
        }
    }.bind(declaredAddresses);

    function addDescriptor(addressOrEp, callback, isReply) {
        var ep = addressOrEp instanceof String || typeof addressOrEp == 'string' ? me.parseAddress(addressOrEp) : addressOrEp;
        if (!ep)
            throw new Error('Unsupported address or endpoint ' + addressOrEp + '.');

        var descriptor = _.bindAll(new Descriptor(ep, callback, isReply));
        var index=_.findIndex(descriptors,function(o) { 
            return o.address==addressOrEp;
        });
        if(index!=-1){
            descriptors[index]=descriptor;
        }
        else{
        descriptors.push(descriptor);
        }
       
        descriptor.once('close', function () {
            var index = descriptors.indexOf(descriptor);
            if (index >= 0)
                descriptors.splice(index, 1);
        });

        return descriptor;
    }

    function bind(address, callback) {
        var descriptor = addDescriptor(address, callback);
        debug('bind', 'Binding endpoint; address = ', address, ', ep = ', descriptor.ep, '.');
        return bindInternal(descriptor)
    }

    function bindInternal(descriptor) {
        return Promise
            .try(function () {
            return isReady || new Promise(function (resolve, reject) {
                me.once('ready', resolve);
            });
        })
            .tap(function () {
            debug('bindInternal', 'received ready notification.');
        })
            .return(descriptor)
            .then(declareAddress)
            .then(consume)
            .tap(descriptor.ready)
            .return(descriptor);
    }

 function consume(descriptor) {
        var consumeQueue = descriptor.ep.address;
        if (descriptor.isReply )
            return Promise.resolve(descriptor);

        debug('consume', 'Consuming from queue; queue: ', consumeQueue);
        return Promise
            .try(function() {
                 connection.on('message', function(data) {
                    debug(connection.identity + ': answer data ' + data);
                    return  getReceiveFn(consumeQueue,data);
                    });
            })
            .then(function() {
                descriptor.on('close', function() {
                    Promise
                        .try(function() {
                            return conection.cancel();//.cancel(consumerTag);
                        })
                        .catch(onError)
                        .done();
                });
            })
            .return(descriptor);
    }
  function getReceiveFn(consumeQueue,x) {
      
            return Promise
                .try(function() {
                    var mc = _.extend(_.omit(x.fields, _.isUndefined), {
                        properties: _(_.omit(x.properties, 'headers'))
                        .defaults(x.properties ? x.properties: {})
                        .omit(_.isUndefined)
                        .value(),
                        body: x
                    });
                   mc.properties.contentType="application/json";
                    var matches = _.filter(descriptors, function(d) { return d.callback ; });
                    if (matches.length < 1) {
                        throw new Error('Unhandled message:')
                    }
                    return Promise.map(matches, function(descriptor) {
                        return Promise.try(function() {
                            var dmc = _.extend(_.clone(mc), {
                                reply: descriptor.address ? getReplyFn(mc) : undefined,
                                replyContext: descriptor.isReply ? descriptor : undefined
                            });
                            return descriptor.callback(dmc, descriptor);
                        });
                    });
                })
                .catch(onError)
                .done();
        
    }

  
    function call(address, body, properties, opts) {
      opts = util._extend({
                 onGotReplyContext: undefined,
                 timeout: options.defaultTimeout
             }, opts);
             var replyDeferred = {};
              replyDeferred.promise = new Promise(function(resolve, reject) {
                  replyDeferred.resolve = resolve;
                  replyDeferred.reject = reject;
              });
              return  bindReply(replyDeferred.resolve)
            .then(function(rc) {

                var result = Promise
                    .try(function() {
                        return connection.send(body.toString());
                    })
                    .catch(replyDeferred.reject)
                    .then(function() {
                        return replyDeferred.promise;
                    });
                if (opts.timeout) {
                    result = result.timeout(opts.timeout, 'Response timeout: ' + opts.timeout);
                }
                return result;

            });
    }
    function declareAddress(descriptor) {
        var addressInfo = declaredAddresses.findByName(descriptor.ep.address);
       if (addressInfo) {
           
            return Promise.resolve(descriptor);
        }
             return Promise
            .try(function() {
                declaredAddresses.push(addressInfo);
                return addressInfo;
            })
            .return(descriptor);
        
    }
    function parseAddress(value) {
        //needs to be implemented
         var a = {
            address: value,
         }
        return a;
    }
    function isMatch(descriptor, messageContext) {
        return descriptor.matches(messageContext);
    }

    function bindReply(callback) {


        var addressPrefix = (options.qServer+":"+options.qPort);
        return Promise
            .try(function() {
                if (replyDescriptor) {
                    return replyDescriptor;
                }
                debug('bindReply', 'Setting up default reply endpoint.');
                var address = addressPrefix ;
                replyDescriptor = addDescriptor(address);
                return bindInternal(replyDescriptor);
            })
            .then(function() {
                var address = addressPrefix ;
                var descriptor = addDescriptor(address, callback, true);
                descriptor.send = function(address, body, properties) {
                    properties = properties || {};
                    properties.replyTo = descriptor.address;
                    return send(address, body, properties);
                };

                debug('bindReply', 'Binding a default endpoint; address = ', address);
                return descriptor;
            });
    }

    function send(address, bodyObject, properties) {
        properties = properties || {};
        var options = {
            contentType: properties.contentType || 'application/json',
            headers: _.omit(properties, ['contentType', 'replyTo'])
        };

        debug('send.serialize', 'contentType = {0}, bodyObject = {1}', options.contentType, bodyObject);
        var body = serializer.serialize(options.contentType, bodyObject);
        debug('send', 'Sending; to = ' + address + ", body = " + bodyObject.toString() + ", options = " + JSON.stringify(options) + '.');
        var sendAddress = me.parseAddress(address);
        return Promise.try(function () {
            return connection.send( body);
        });
    }

    function start() {
        var address = options.address !== undefined ? options.qServer : 'tcp://127.0.0.1:' + options.qPort;
        debug('start', 'Address: ', address);

        return Promise
            .try(function () {
            return connect(address);
        })

          .then(function () {
            if (connection.on) {
                connection.on('bind_error', function (error) {
                    console.error(error);
                    process.exit(1);
                });
            }
        })
            .then(function () {
            debug('start', 'Ready');
            isReady = true;
            me.emit('ready');
        })
            .catch(onError);

        function connect(to) {
            return Promise.try(
                function () {
                    var socket = zmq.socket(options.reqRes);
                    socket.on('connect', function(fd, ep) {console.log('connect, endpoint:', ep);});
                    socket.on('connect_delay', function(fd, ep) {console.log('connect_delay, endpoint:', ep);});
                    socket.on('connect_retry', function(fd, ep) {console.log('connect_retry, endpoint:', ep);});
                    socket.on('listen', function(fd, ep) {console.log('listen, endpoint:', ep);});
                    socket.on('bind_error', function(fd, ep) {console.log('bind_error, endpoint:', ep);});
                    socket.on('accept', function(fd, ep) {console.log('accept, endpoint:', ep);});
                    socket.on('accept_error', function(fd, ep) {console.log('accept_error, endpoint:', ep);});
                    socket.on('close', function(fd, ep) {console.log('close, endpoint:', ep);});
                    socket.on('close_error', function(fd, ep) {console.log('close_error, endpoint:', ep);});
                    socket.on('disconnect', function(fd, ep) {console.log('disconnect, endpoint:', ep);});

                    // Handle monitor error
                    socket.on('monitor_error', function(err) {
                        console.log('Error in monitoring: %s, will restart monitoring in 5 seconds', err);
                        setTimeout(function() { socket.monitor(500, 0); }, 5000);
                    });

                    // Call monitor, check for events every 500ms and get all available events.
                    console.log('Start monitoring...');
                    socket.monitor(500, 0);
                    connection=socket;
                    if(options.reqRes=="req")                    {
                        socket.bind(to);
                    }
                    else{
                        socket.connect(to);
                    }
                    return socket;
                })
                .catch(function (error) {
                if (_.isNumber(options.connectRetry)) {
                    debug('start', 'Connection failed, retrying in', options.connectRetry, 'ms; error:', error);
                    return Promise.delay(options.connectRetry).then(_.partial(connect, to));
                }
                throw error;
            });
        }
    }

    function stop() {
      return new Promise(function(resolve, reject) {
                 setImmediate(function() {
                     isReady = false;
                     var toClose = connection;
                     if (toClose) {
                         Promise.try(function() {
                             connection = undefined;
                             channel = undefined;
                             return toClose.close();
                         }).done(resolve, reject);
                     }
                 });
             });
    }

    function isMatch(descriptor, messageContext) {
        return descriptor.matches(messageContext);
    }
    function onError(error) {
        if (me.listeners('error').length > 0) {
            debug('Emitting error:', error);
            return me.emit('error', error);
        }
        else {
            debug('Unhandled error:', error);
            throw error;
        }
    }
    util.inherits(Descriptor, events.EventEmitter);
    function Descriptor(ep, callback, isReply) {
        events.EventEmitter.call(this);
        this.address = ep.address;
        this.callback = callback;
        this.ep = ep;
        this.isReply = isReply === true;
        this.ready = ready;
        this.close = close;
        this.matches = matches;

        var me = this;
        function ready() {
            debug('Descriptor.ready', 'Descriptor is ready; ep: ', me.ep);
            me.emit('ready');
        }
        function close() {
            debug('Descriptor.close', 'Closing descriptor; ep:', me.ep);
            me.emit('close');
        }

        var matchesRegex = new RegExp(
            '^' + me.ep.address
          .split(':').join('\\.')
          .split('.').join('\\.')
          .split('*').join('[^\\.]+')
          .split('\\.#').join('(\\.[^\\.]+)*')
          .split('#\\.').join('([^\\.]+\\.)*')
          + '$');
        function matches(messageContext) {
            return matchesRegex.test(messageContext.address);
        }
    }
     function debug(label, message) {
        if (!options.debug)
            return;
        function format(x) {
            return (x instanceof String || typeof x == 'string') ? x : util.inspect(x);
        }
        var text = '[zmqTransport.' + Array.prototype.shift.call(arguments) + '] ' + Array.prototype.shift.call(arguments), argumentsUsed = [], match, re = /\{\d+\}/gm;
        while ((match = re.exec(text)) !== null) {
            var tag = match[match.length - 1];
            var i = parseInt(tag.substr(1, tag.length -2));
            var value = format(arguments[i]);
            argumentsUsed[i] = true;
            text = text.substr(0, match.index) + value + text.substr(match.index + tag.length);
            re.lastIndex = match.index = match.index - tag.length + value.length;
        }
        for (var key in arguments)
            if (arguments.hasOwnProperty(key) && !argumentsUsed[parseInt(key)])
                text += format(arguments[key]);

        util.debug(text);
    }


 function getReplyFn(c) {
        return function reply(body, properties) {
            var to = properties.address;
            debug('reply', 'to: {0}, properties: {1}, body: {2}', to, properties, body);
            return send(to, body, properties);
        };
    }
 }

module.exports = ZmqTransport;
