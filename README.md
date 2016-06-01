# qtort-microservices

A simple micro-services framework for Node.js.  Includes the functionality
previously provided by the microservice-crutch module for jump-starting The
implementation of a micro-service.


## Documentation

For the moment, see the files in the examples/ directory for usage.


# microservice-crutch

Provides a jump-start on implementing a micro-service compatible with
micro-services using AMQP and the qtort-microservices module.

This is a fork of the open-source project microservice-crutch that I started
while at Influence Health.  You can check out their fork at
https://github.com/medseek-engineering/microservice-crutch.

## Prerequisites

You must have RabbitMQ installed and working.  You can pass the location of
the RabbitMQ server on the command line when starting your process like this:
```bash
node myapp.js --broker=amqp://username:password@host:port/vhost
```

If you do not specify the location of RabbitMQ, the default of
amqp://guest:guest@localhost:5672/ is used instead.


## Usage

### Quick Start

```bash
npm install qtort-microservices
```

```node
var crutch = require('qtort-microservices').crutch;
crutch({ /*default options*/ }, function(app, microservices, options, Promise) {
    return microservices.bind('topic://exchangeName/routingKey/queueName', function(mc) {
        return Promise.try(function() {
            return { receivedBody: mc.deserialize() };
        }).catch(function(error) {
            return { error: error };
        });
    });
});
```

### Examples

See the examples for a ping sender and listener that illustrates the most
common usage.

First, clone the Github repository for qtort-microservices, and npm install.

Start the ping listener first, then the ping sender.

```bash
git clone https://github.com/fwestrom/qtort-microservices.git
cd qtort-microservices
npm install
node examples/crutch-ping-listener.js
node examples/crutch-ping-sender.js
```
