'use strict';

var _ = require('lodash');
var Promise;

var idMap = {
    _: 'lodash'
};

module.exports = _.partial(injector, { _: _ });

function injector(cache, injectables) {
    if (!Promise) {
        Promise = injectables.Promise || require('bluebird');
    }
    return _.extend(_.partial(inject, cache, injectables), {
        child: _.partial(child, cache, injectables),
        resolve: function(id, overrides) {
            overrides = overrides || {};
            return resolve(cache, injectables, id, overrides);
        }
    });
}

function child(cache, injectables, overrides) {
    overrides = overrides || {};
    return injector(cache, _.defaults(overrides, injectables));
}

function inject(cache, injectables, fn, overrides) {
    return Promise.try(function() {
        var re = /^function\s(?:\w+)?\(([^\)]*)\)/g;
        var ids = _(re.exec(fn.toString())).drop(1).first().split(', ');
        var resolver = _.partialRight(_.partial(resolve, cache, injectables), overrides);
        return Promise.all(_.map(ids, resolver))
            .then(function(values) {
                return fn.apply(undefined, values);
            });
    });
}

function resolve(cache, injectables, id, overrides) {
    return Promise.try(function() {
        var mappedId = idMap[id];
        if (mappedId !== undefined) {
            id = mappedId;
        }
        if (id === 'inject') {
            return injector(cache, injectables);
        }
        var source = _.find([overrides, injectables, cache], function(x) { return x[id] !== undefined; });
        var module = source ? source[id] : undefined;
        if (!module) {
            var module = tryRequire('./' + id + '.js', true);
            if (module) {
                return inject(cache, injectables, module, overrides)
                    .tap(function(value) {
                        //console.log('resolve| %s:', id, value);
                        cache[id] = value;
                    })
                    .catch(function(error) {
                        console.error('Error resolving injectable:', error);
                        throw error;
                    });
            }
            else if (!module) {
                module = tryRequire(id);
                cache[id] = module;
            }
        }

        return module;
    }).catch(function(error) {
        console.error('Unexpected error in resolve:', error);
        throw error;
    });
}

function tryRequire(id, ignoreErrors)
{
    try {
        var result = require(id);
        //console.log('tryRequire| id: %s, ignoreErrors: %s, result:', id, ignoreErrors, result);
        return result;
    }
    catch (error) {
        //console.warn('tryRequire| id: %s, ignoreErrors: %s, error:', id, ignoreErrors, error);
        if (!ignoreErrors)
            throw error;
    }
}
