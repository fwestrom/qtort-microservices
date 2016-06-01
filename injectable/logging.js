'use strict';

module.exports = function logging(_, log4js, options) {
    var config = options.log || {};
    _.defaults(config, {
        appenders: [
            { type: 'console' },
        ],
        levels: {
            '[all]': config.level || 'ERROR',
        },
        replaceConsole: true,
    });

    var opts = {
        reloadSecs: config.refresh,
    };

    log4js.configure(config, opts);

    var log = log4js.getLogger('qtort-microservices.logging');
    log.debug('Configured log4js; config:', config, '\n opts:', opts);

    return log4js;
};
