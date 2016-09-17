'use strict';

module.exports = function(_, defaultOptions, minimist, util) {
    var aliases = {
        'log.config': ['lc', 'logConfig'],
        'log.level': ['ll', 'logLevel'],
        'log.refresh': ['lr', 'logRefresh']
    };

    var options = _.omit(minimist(process.argv.slice(2), {
        alias: aliases,
        boolean: [
            'debug',
            'log.replaceConsole'
        ],
        default: util._extend({
            broker: 'amqp://localhost',
            connectRetry: 5000,
            defaultExchange: 'default-exchange',
            defaultQueue: undefined,
			qServer: 'tcp://127.0.0.1',
			qPort: 3000,
			reqRes:"rep",
            'log.config': undefined,
            'log.level': undefined,
            'log.refresh': undefined,
            'log.replaceConsole': true,
            shutdownOn: ['SIGINT', 'SIGQUIT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']
        }, defaultOptions)
    }), _.flatten(_.values(aliases)));

    if (options.debug === undefined && options.log.level !== undefined) {
        options.debug = options.log.level.toLowerCase() === 'trace';
    }
    else if (options.debug !== undefined) {
        options.debug = options.debug.toString().toLowerCase() === true.toString().toLowerCase();
    }

    options.log.level = (options.log.level || (options.debug ? 'DEBUG' : 'INFO'));
    options.log.replaceConsole = ('' + options.log.replaceConsole).toLowerCase() !== 'false';

    return options;
};
