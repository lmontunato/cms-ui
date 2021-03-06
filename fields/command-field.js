define(function (require, exports, module) {

    var UI = require("ui");
    var Alpaca = require("alpaca");
    var _ = require('./lodash.js');

    Alpaca.Extend(Alpaca, {
        rules: [
            [_.isNull, () => ({type: 'null'})],
            [_.isNumber, (field, key) => ({type: 'number', format: "independent-slave-field"})],
            [_.isBoolean, () => ({type: 'boolean'})],
            [_.isString, (field, key) => ({type: 'string', readonly: true})],
            [_.isRegExp, pattern => ({type: 'string', pattern})],

            // Empty array -> array of any items
            [(example) => _.isArray(example) && !example.length, () => ({type: 'array'})],

            [_.isArray, items => ({type: 'array', items: Alpaca.schemaByExample(items[0])})],
            [_.isPlainObject, (object, key) => ({
                type: 'object',
                properties: _.mapValues(object, Alpaca.schemaByExample),
            })],
        ],

        schemaByExample: function (example, key) {
            for (const [isMatch, makeSchema] of Alpaca.rules) {
                if (isMatch(example)) {
                    var schema = makeSchema(example, key);
                    return schema
                }
            }

            throw new TypeError(example);
        },
    })


    Alpaca.registerDefaultFormatFieldMapping("text", "text");

    return UI.registerField("appliance-command", Alpaca.Fields.ObjectField.extend({

        getFieldType: function () {
            return "appliance-command";
        },

        updateSchemaOptions: function (nodeId, callback) {

            var clist = null;

            function loadCacheAttachment(field, node, attachmentName) {
                var cachedDocument = null;
                var cachedDocument = self.connector.cache(nodeId + '/' + attachmentName);
                if (cachedDocument) {
                    Object.assign(field, cachedDocument)
                } else {
                    node.attachment(attachmentName).download(function (data) {
                        var parsedData = JSON.parse(data);
                        self.connector.cache(nodeId + '/' + attachmentName, parsedData);
                        Object.assign(field, parsedData)
                    })
                }
                //console.log("update " + attachmentName + ' ' + self.name)
            }

            function makeSlaveSchema(schema) {
                if (schema.type == "object") {
                    var newSchema = {};
                    Object.assign(newSchema, schema)
                    newSchema.properties = _.mapValues(schema.properties, makeSlaveSchema);
                    return newSchema
                } else {
                    var newSchema = {}
                    Object.assign(newSchema, schema)
                    if (!schema.isVariant) {
                        newSchema["readonly"] = true;
                        newSchema["format"] = "text";
                    }
                    return newSchema
                }
            }

            function makeSlaveOptions(schema) {
                if (!Alpaca.isUndefined(schema.fields)) {
                    var newSchema = {};
                    Object.assign(newSchema, schema)
                    newSchema.fields = _.mapValues(schema.fields, makeSlaveOptions);
                    return newSchema
                } else {
                    var newSchema = {}
                    Object.assign(newSchema, schema)
                    if (schema.type == "select") {
                        newSchema.type = "text"
                    }
                    return newSchema
                }
            }

            function loadCacheAttachments(node) {
                //var t0 = performance.now();
                if (self.options.isSlave) {
                    var masterSchema = {};
                    var masterOptions = {};
                    var f1 = function () {
                        loadCacheAttachment(masterSchema, node, 'schema');
                        Object.assign(self.schema, makeSlaveSchema(masterSchema))
                    }
                    var f2 = function () {
                        loadCacheAttachment(masterOptions, node, 'options');
                        Object.assign(self.options, makeSlaveOptions(masterOptions))
                    }
                    Alpaca.parallel([f1, f2], function () {
                        //var t1 = performance.now();
                        //console.log('Took', (t1 - t0).toFixed(4), 'milliseconds for loadCacheAttachments:', self.path);
                    })
                } else {
                    loadCacheAttachment(self.schema, node, 'schema');
                    loadCacheAttachment(self.options, node, 'options');
                    //var t1 = performance.now();
                    //console.log('Took', (t1 - t0).toFixed(4), 'milliseconds for loadCacheAttachments:', self.path);
                }
            }

            function cacheHandlers() {
                var callbacks = $.Callbacks("once")
                var addFn = function (func) {
                    var context = this,
                        args = arguments;
                    var cb = function () {
                        func.apply(context, args);
                    };
                    callbacks.add(cb)
                }
                var fireFn = function () {
                    callbacks.fire()
                }
                return {add: addFn, fire: fireFn}
            }

            function loadCachedNode() {
                //console.log(self.name, ": fired")
                loadCacheAttachments(clist.node)
                if (callback)
                    callback();
            }

            var self = this;
            var cacheKey = "command-field:" + nodeId;
            //var t0 = performance.now();
            //console.log(self.name, ": ", cacheKey)
            clist = self.connector.cache(cacheKey);
            if (clist) {
                if (clist.node) {
                    //console.log("found")
                    loadCachedNode()
                } else {
                    //console.log("callback added")
                    clist.add(loadCachedNode)
                }
            } else {
                //console.log("not found")
                clist = cacheHandlers();
                clist.add(loadCachedNode);
                self.connector.cache(cacheKey, clist);
                self.connector.branch.queryOne({"_doc": nodeId}).then(function () {
                    clist.node = this;
                    loadCacheAttachments(this)
                }).then(function () {
                    //var t1 = performance.now();
                    //console.log('Took', (t1 - t0).toFixed(4), 'milliseconds to load node:', self.path);
                    clist.fire()
                })
            }
        },

        setupField: function (callback) {
            var self = this;

            //console.log("setup field " + self.name)
            function refresh() {
                if (!self.initializing) {
                    if (self.top && self.top() && self.top().initializing) {
                        // if we're rendering under a top most control that isn't finished initializing, then don't refresh
                    } else {
                        //var t0 = performance.now();
                        //console.log("refreshing ", self.path)
                        self.refresh(function () {
                            //var t1 = performance.now();
                            //console.log('Took', (t1 - t0).toFixed(4), 'milliseconds to refresh:', self.path);
                        });
                    }
                }
            }

            if (self.options.dependentField) {
                // find the field and register a callback
                self.top().on("ready", function (e) {
                    var dep = self.top().getControlByPath(self.options.dependentField);
                    //console.log(self.name, dep)
                    if (dep) {
                        if (!self.subscribed) {
                            self.subscribed = true;
                            self.subscribe(dep, function (value) {
                                if (value) {
                                    var id;
                                    if (Alpaca.isArray(value))
                                        id = value[0].id
                                    else
                                        id = value.id
                                    self.updateSchemaOptions(id, refresh)
                                }
                            });
                        }
                        if (dep.data) {
                            var id;
                            if (Alpaca.isArray(dep.data))
                                id = dep.data[0].id
                            else
                                id = dep.data.id
                            self.updateSchemaOptions(id, refresh)
                        }
                    }
                });
                var dep = self.top().getControlByPath(self.options.dependentField);
                if (dep && dep.data)
                    this.base(function () {
                        if (!self.subscribed) {
                            self.subscribed = true;
                            self.subscribe(dep, function (value) {
                                if (value)
                                    var id;
                                if (Alpaca.isArray(value))
                                    id = value[0].id
                                else
                                    id = value.id
                                self.updateSchemaOptions(id, refresh)
                            });
                        }
                        var id;
                        if (Alpaca.isArray(dep.data))
                            id = dep.data[0].id
                        else
                            id = dep.data.id
                        self.updateSchemaOptions(id, callback)
                    })
                else {
                    this.base(callback)
                }
            } else {
                this.base(callback)
            }
        },

        setValue: function (value) {
            if (!Alpaca.isEmpty(value)) {
                this.checkApplianceCommand(value);
            }
            this.base(value)
        },

        checkApplianceCommand: function (value) {
            if (value.hasOwnProperty('deviceCommandCode') && this.data.hasOwnProperty('deviceCommandCode') && this.schema) {
                this.checkSchema(value, this.data, this.schema);
            }
        },

        checkSchema: function (src, data, schema) {
            if (schema.hasOwnProperty('properties')) {
                for (const key in src) {
                    if (src.hasOwnProperty(key) && data.hasOwnProperty(key)) {
                        const properties = schema.properties[key];
                        if (typeof src[key] === 'object') {
                            this.checkSchema(src[key], data[key], properties);
                        } else if (data[key] && src[key] !== data[key] && properties.isVariant) {
                            src[key] = data[key];
                        }
                    }
                }
            }
        }
    }));

});

define(function (require, exports, module) {
    var UI = require("ui");
    var Alpaca = require("alpaca");


});