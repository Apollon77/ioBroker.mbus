/**
 *
 * NUT adapter
 *
 * Adapter loading NUT data from an UPS
 *
 */
 /* jshint -W097 */
 // jshint strict:true
 /*jslint node: true */
 /*jslint esversion: 6 */
'use strict';

var path = require('path');
var utils = require(path.join(__dirname,'lib','utils')); // Get common adapter utils
var MbusMaster = require('node-mbus');

var adapter = utils.Adapter('mbus');

var deviceUpdateQueue = [];
var mBusDevices = {};
var deviceCommunicationInProgress = false;
var mbusMaster;

adapter.on('ready', function (obj) {
    main();
});

adapter.on('message', function (msg) {
    processMessage(msg);
});

adapter.on('stateChange', function (id, state) {
    adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
    if (!state || state.ack || !state.val) return;
    var idSplit = id.split('.');
    if (idSplit[idSplit.length - 1] !== 'updateNow') return;
    var deviceNamespace = idSplit[idSplit.length - 3] + '.' + idSplit[idSplit.length - 2];

    for (var deviceId in mBusDevices) {
        if (mBusDevices[deviceId].deviceNamespace === deviceNamespace) {
            scheduleDeviceUpdate(deviceId);
            break;
        }
    }
});

adapter.on('unload', function (callback) {
    mbusMaster.close();
    for (var device in mBusDevices) {
        if (mBusDevices[device].updateTimeout) {
            clearTimeout(mBusDevices[device].updateTimeout);
            mBusDevices[device].updateTimeout = null;
        }
    }
});

process.on('SIGINT', function () {
    mbusMaster.close();
    for (var device in mBusDevices) {
        if (mBusDevices[device].updateTimeout) {
            clearTimeout(mBusDevices[device].updateTimeout);
            mBusDevices[device].updateTimeout = null;
        }
    }
});

process.on('uncaughtException', function (err) {
    if (adapter && adapter.log) {
        adapter.log.warn('Exception: ' + err);
    }
    mbusMaster.close();
    for (var device in mBusDevices) {
        if (mBusDevices[device].updateTimeout) {
            clearTimeout(mBusDevices[device].updateTimeout);
            mBusDevices[device].updateTimeout = null;
        }
    }
});

function scheduleDeviceUpdate(deviceId) {
    if (deviceUpdateQueue.indexOf(deviceId) !== -1) {
        adapter.log.debug('Update request for device ' + deviceId + ' already queued, so ignore update request');
        return false;
    }
    deviceUpdateQueue.push(deviceId);
    if (deviceUpdateQueue.length === 1 && !deviceCommunicationInProgress) {
        return updateDevices();
    }
    adapter.log.debug('Update request for device ' + deviceId + ' is queued');
    return true;
}

function updateDevices() {
    if (!deviceUpdateQueue.length) {
        deviceCommunicationInProgress = false;
        return;
    }

    deviceCommunicationInProgress = true;
    var deviceId = deviceUpdateQueue.shift();
    if (mBusDevices[deviceId].updateTimeout) {
        clearTimeout(mBusDevices[deviceId].updateTimeout);
        mBusDevices[deviceId].updateTimeout = null;
    }

    mbusMaster.getData(deviceId, function(err, data) {
        adapter.log.error('mbus ID ' + deviceId + ' err: ' + err);
        adapter.log.info('data: ' + deviceId + ' data: ' + JSON.stringify(data, null, 2));

        mBusDevices[deviceId].updateTimeout = setTimeout(function() {
            mBusDevices[deviceId].updateTimeout = null;
            scheduleDeviceUpdate(deviceId);
        }, mBusDevices[deviceId].updateInterval);
        updateDevices();
    });
}

function main() {
    var mbusOptions = {
        autoConenct: true
    };

    if (adapter.config.host && adapter.config.port) {
        mbusOptions.host = adapter.config.host;
        mbusOptions.port = adapter.config.port;
        adapter.log.info('Initialize mbus TCP to ' + adapter.config.host + ':' + adapter.config.port);
    }
    else if (adapter.config.serialPort) {
        mbusOptions.serialPort = adapter.config.serialPort;
        mbusOptions.serialBaudRate = adapter.config.serialBaudRate;
        adapter.log.info('Initialize mbus TCP to ' + adapter.config.serialPort + ' with ' + adapter.config.serialBaudRate + 'baud');
    }

    mbusMaster = new MbusMaster(mbusOptions);

    if (!mbusMaster.connect()) {
        adapter.log.error('MBus Connection failed. Please check configuration.');
        process.exit();
    }

    for (var i = 0; i < adapter.config.devices.length; i++) {
        var deviceId = adapter.config.devices[i].id;
        mBusDevices[deviceId] = {};
        mBusDevices[deviceId].updateInterval = adapter.config.devices[i].updateInterval ? adapter.config.devices[i].updateInterval : adapter.config.updateInterval;

        adapter.log.info('Schedule initialization for MBus-ID ' + deviceId);
        scheduleDeviceUpdate(deviceId);
    }
}

function processMessage(message) {
    if (!message) return;

    adapter.log.info('Message received = ' + JSON.stringify(message));

    if (message.command === 'scanSecorndary') {
    }
}


/*
function initNutCommands(cmdlist) {
    adapter.log.debug('Create Channel commands');
    adapter.setObjectNotExists('commands', {
        type: 'channel',
        common: {name: 'commands'},
        native: {}
    });

    if (! cmdlist) return;
    nutCommands = cmdlist;
    for (var i = 0; i < cmdlist.length; i++) {
        var cmdName = cmdlist[i].replace(/\./g,'-');
        adapter.log.debug('Create State commands.' + cmdName);
        adapter.setObjectNotExists('commands.' + cmdName, {
            type: 'state',
            common: {
                name: 'commands.' + cmdName,
                role: 'button',
                type: 'boolean',
                read: true,
                write: true,
                def:   false
            },
            native: {id: 'commands.' + cmdName}
        });
        adapter.setState('commands.' + cmdName, {ack: true, val: false});
    }
    adapter.subscribeStates('commands.*');
}


function processMessage(message) {
    if (!message) return;

    adapter.log.info('Message received = ' + JSON.stringify(message));

    var updateNut = false;
    if (message.command === 'notify' && message.message) {
        adapter.log.info('got Notify ' + message.message.notifytype + ' for: ' + message.message.upsname);
        var ownName = adapter.config.ups_name + '@' + adapter.config.host_ip;
        adapter.log.info('ownName=' + ownName + ' --> ' + (ownName === message.message.upsname));
        if (ownName === message.message.upsname) {
            updateNut = true;
            adapter.setState('status.last_notify', {ack: true, val: message.message.notifytype});
            if (message.message.notifytype==='COMMBAD' || message.message.notifytype==='NOCOMM') parseAndSetSeverity("OFF");
        }
    }
    else updateNut = true;

    if (updateNut) {
        if (nutTimeout) clearTimeout(nutTimeout);
        updateNutData();
    }
}

function initNutConnection(callback) {
    var oNut = new Nut(adapter.config.host_port, adapter.config.host_ip);

    oNut.on('error', function(err) {
        adapter.log.error('Error happend: ' + err);
        adapter.getState('status.last_notify', function (err, state) {
            if (!err && !state || (state && state.val!=='COMMBAD' && state.val!=='SHUTDOWN' && state.val!=='NOCOMM')) {
                adapter.setState('status.last_notify', {ack: true, val: 'ERROR'});
            }
            if (!err) parseAndSetSeverity("");
        });
    });

    oNut.on('close', function() {
        adapter.log.debug('NUT Connection closed. Done.');
    });

    oNut.on('ready', function() {
        adapter.log.debug('NUT Connection ready');
        callback(oNut);
    });

    oNut.start();
}

function updateNutData() {
    adapter.log.info('Start NUT update');

    initNutConnection(function(oNut) {
        getCurrentNutValues(oNut, true);
    });

    var update_interval = parseInt(adapter.config.update_interval,10) || 60;
    nutTimeout = setTimeout(updateNutData, update_interval*1000);
}

function getCurrentNutValues(oNut, closeConnection) {
    oNut.GetUPSVars(adapter.config.ups_name, function(varlist, err) {
        if (err) {
            adapter.log.error('Err while getting NUT values: '+ err);
        }
        else {
            adapter.log.debug('Got values, start setting them');
            storeNutData(varlist);
        }
        if (closeConnection) oNut.close();
    });
}

function storeNutData(varlist) {
    var last='';
    var current='';
    var index=0;
    var stateName='';

    for (var key in varlist) {
        if (!varlist.hasOwnProperty(key)) continue;

        index=key.indexOf('.');
        if (index > 0) {
            current=key.substring(0,index);
        }
        else {
            current='';
            last='';
            index=-1;
        }
        if (((last==='') || (last!==current)) && (current!=='')) {
            adapter.log.debug('Create Channel '+current);
            adapter.setObjectNotExists(current, {
                type: 'channel',
                common: {name: current},
                native: {}
            });
        }
        stateName=current+'.'+key.substring(index+1).replace(/\./g,'-');
        adapter.log.debug('Create State '+stateName);
        if (stateName === 'battery.charge') {
            adapter.setObjectNotExists(stateName, {
                type: 'state',
                common: {name: stateName, type: 'number', role: 'value.battery', read: true, write: false},
                native: {id: stateName}
            });
        }
        else {
            adapter.setObjectNotExists(stateName, {
                type: 'state',
                common: {name: stateName, type: 'string', read: true, write: false},
                native: {id: stateName}
            });
        }
        adapter.log.debug('Set State '+stateName+' = '+varlist[key]);
        adapter.setState(stateName, {ack: true, val: varlist[key]});
        last=current;
    }

    adapter.log.debug('Create Channel status');
    adapter.setObjectNotExists('status', {
        type: 'channel',
        common: {name: 'status'},
        native: {}
    });
    adapter.setObjectNotExists('status.severity', {
        type: 'state',
        common: {
            name: 'status.severity',
            role: 'indicator',
            type: 'number',
            read: true,
            write: false,
            def:4,
            states: '0:idle;1:operating;2:operating_critical;3:action_needed;4:unknown'
        },
        native: {id: 'status.severity'}
    });
    if (varlist['ups.status']) {
        parseAndSetSeverity(varlist['ups.status']);
    }
    else parseAndSetSeverity("");

    adapter.log.info('All Nut values set');
}

function parseAndSetSeverity(ups_status) {
    var statusMap = {
              'OL':{name:'online',severity:'idle'},
              'OB':{name:'onbattery',severity:'operating'},
              'LB':{name:'lowbattery',severity:'operating_critical'},
              'HB':{name:'highbattery',severity:'operating_critical'},
              'RB':{name:'replacebattery',severity:'action_needed'},
              'CHRG':{name:'charging',severity:'idle'},
              'DISCHRG':{name:'discharging',severity:'operating'},
              'BYPASS':{name:'bypass',severity:'action_needed'},
              'CAL':{name:'calibration',severity:'operating'},
              'OFF':{name:'offline',severity:'action_needed'},
              'OVER':{name:'overload',severity:'action_needed'},
              'TRIM':{name:'trimming',severity:'operating'},
              'BOOST':{name:'boosting',severity:'operating'},
              'FSD':{name:'shutdown',severity:'operating_critical'}
            };
    var severity = {
              'idle':false,
              'operating':false,
              'operating_critical':false,
              'action_needed':false
            };
    if (ups_status.indexOf('FSD') !== -1) {
        ups_status += ' OB LB';
    }
    var checker=' '+ups_status+' ';
    var stateName="";
    for (var idx in statusMap) {
        if (statusMap.hasOwnProperty(idx)) {
            var found=(checker.indexOf(idx)>-1);
            stateName='status.'+statusMap[idx].name;
            adapter.log.debug('Create State '+stateName);
            adapter.setObjectNotExists(stateName, {
                type: 'state',
                common: {name: stateName, type: 'boolean', read: true, write: false},
                native: {id: stateName}
            });
            adapter.log.debug('Set State '+stateName+' = '+found);
            adapter.setState(stateName, {ack: true, val: found});
            if (found) {
                severity[statusMap[idx].severity]=true;
                adapter.log.debug('Severity Flag '+statusMap[idx].severity+'=true');
            }
        }
    }
    var severityVal = 4;
    if (severity.operating_critical) severityVal=2;
        else if (severity.action_needed) severityVal=3;
        else if (severity.operating) severityVal=1;
        else if (severity.idle) severityVal=0;

    adapter.log.debug('Set State status.severity = '+severityVal);
    adapter.setState('status.severity', {ack: true, val: severityVal});
}
*/
