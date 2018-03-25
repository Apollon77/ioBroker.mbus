/**
 *
 * NUT adapter
 *
 * Adapter loading data from an M-Bus devices
 *
 */
/* jshint -W097 */
/* jshint strict:true */
/* jslint node: true */
/* jslint esversion: 6 */

'use strict';

var path       = require('path');
var utils      = require(path.join(__dirname, 'lib', 'utils')); // Get common adapter utils
var MbusMaster = require('node-mbus');
var serialport;

try {
    serialport = require('serialport');
} catch (err) {
    console.warn('Cannot load serialport module');
}

var adapter = new utils.Adapter('mbus');

var deviceUpdateQueue = [];
var mBusDevices = {};
var deviceCommunicationInProgress = false;
var mbusMaster;

var connected = null;
var errorDevices = {};

var stateValues = {};

function setConnected(isConnected) {
    if (connected !== isConnected) {
        connected = isConnected;
        adapter.setState('info.connection', connected, true, function (err) {
            // analyse if the state could be set (because of permissions)
            if (err) adapter.log.error('Can not update connected state: ' + err);
              else adapter.log.debug('connected set to ' + connected);
        });
    }
}

adapter.on('ready', main);

adapter.on('message', processMessage);

adapter.on('stateChange', function (id, state) {
    adapter.log.debug('stateChange ' + id + ' ' + JSON.stringify(state));
    if (!state || state.ack || !state.val) return;
    var idSplit = id.split('.');
    if (idSplit[idSplit.length - 1] !== 'updateNow') return;
    var deviceNamespace = idSplit[idSplit.length - 2];

    for (var deviceId in mBusDevices) {
        if (mBusDevices[deviceId].deviceNamespace === deviceNamespace) {
            scheduleDeviceUpdate(deviceId);
            break;
        }
    }
});

function onClose(callback) {
    for (var device in mBusDevices) {
        if (mBusDevices[device].updateTimeout) {
            clearTimeout(mBusDevices[device].updateTimeout);
            mBusDevices[device].updateTimeout = null;
        }
    }
    deviceUpdateQueue = [];
    mBusDevices = {};

    try {
        if (mbusMaster) {
            mbusMaster.close(callback);
            setConnected(false);
        }
    } catch (e) {
        if (callback) {
            callback();
        }
    }
}
adapter.on('unload', function (callback) {
    onClose(callback);
});

process.on('SIGINT', function () {
    onClose();
});

process.on('uncaughtException', function (err) {
    if (adapter && adapter.log) {
        adapter.log.warn('Exception: ' + err);
    }
    onClose();
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
    adapter.log.info('Process: ' + deviceId);
    if (mBusDevices[deviceId].updateTimeout) {
        clearTimeout(mBusDevices[deviceId].updateTimeout);
        mBusDevices[deviceId].updateTimeout = null;
    }

    mbusMaster.getData(deviceId, function (err, data) {
        if (err) {
            adapter.log.error('M-Bus ID ' + deviceId + ' err: ' + err);
            errorDevices[deviceId] = true;
            adapter.log.error('M-Bus Devices ' + Object.keys(errorDevices).length + ' errored from ' + Object.keys(mBusDevices).length);
            if (Object.keys(errorDevices).length === Object.keys(mBusDevices).length) {
                adapter.log.error('All M-Bus devices could not be read, reinitialize and start over');
                setConnected(false);
                onClose(main);
                return;
            }
            updateDevices();
            return;
        }

        adapter.log.debug('M-Bus ID ' + deviceId + ' data: ' + JSON.stringify(data, null, 2));

        initializeDeviceObjects(deviceId, data, function () {
            updateDeviceStates(mBusDevices[deviceId].deviceNamespace, data, function() {
                mBusDevices[deviceId].updateTimeout = setTimeout(function () {
                    mBusDevices[deviceId].updateTimeout = null;
                    scheduleDeviceUpdate(deviceId);
                }, mBusDevices[deviceId].updateInterval * 1000);
                updateDevices();
            });
        });
    });
}

function initializeDeviceObjects(deviceId, data, callback) {

    var neededStates = [];
    function createStates() {
        if (!neededStates.length) {
            callback();
            return;
        }
        var state = neededStates.shift();
        adapter.log.debug('Create State ' + deviceNamespace + state.id);
        var stateName = state.id.substring(state.id.indexOf('.', 1));
        adapter.setObjectNotExists(deviceNamespace + state.id, {
            type: 'state',
            common: {
                name: state.id,
                role: 'value',
                type: state.type,
                read: true,
                write: false,
                unit: state.unit
            },
            native: {id: state.id}
        }, function() {
            createStates();
        });
    }

    if (mBusDevices[deviceId].deviceNamespace) {
        callback();
        return;
    }

    var deviceNamespace = data.SlaveInformation.Manufacturer + '-' + data.SlaveInformation.Id;
    mBusDevices[deviceId].deviceNamespace = deviceNamespace;

    adapter.setObjectNotExists(deviceNamespace, {
        type: 'channel',
        common: {name: deviceNamespace},
        native: {}
    }, function () {
        adapter.setObjectNotExists(deviceNamespace + '.updateNow', {
            type: 'state',
            common: {name: deviceNamespace + '.updateNow', role: 'button', type: 'boolean', def: false},
            native: {}
        }, function() {
            adapter.subscribeStates(deviceNamespace + '.updateNow');
        });
        adapter.setObjectNotExists(deviceNamespace + '.info', {
            type: 'channel',
            common: {name: deviceNamespace + '.info'},
            native: {}
        }, function () {
            adapter.setObjectNotExists(deviceNamespace + '.data', {
                type: 'channel',
                common: {name: deviceNamespace + '.data'},
                native: {}
            }, function() {
                var currentState;
                var currentType;
                for (var id in data.SlaveInformation) {
                    if (!data.SlaveInformation.hasOwnProperty(id)) continue;

                    currentState = {};
                    currentState.id = '.info.' + id;
                    currentType = typeof data.SlaveInformation[id];
                    currentState.type = currentType === 'Number' ? 'number' : 'string';
                    currentState.unit = '';
                    neededStates.push(currentState);
                }
                for (var i = 0; i < data.DataRecord.length; i++) {
                    currentState = {};
                    currentState.id = '.data.' + data.DataRecord[i].id;
                    if (data.DataRecord[i].StorageNumber !== undefined) {
                        currentState.id += '-' + data.DataRecord[i].StorageNumber;
                    }
                    switch (data.DataRecord[i].Function) {
                        case 'Instantaneous value':
                            currentState.id += '-Current';
                            break;
                        case 'Maximum value':
                            currentState.id += '-Max';
                            break;
                        case 'Minimum value':
                            currentState.id += '-Min';
                            break;
                        case 'Value during error state':
                            currentState.id += '-Error';
                            break;
                        case 'Manufacturer specific':
                            currentState.id += '';
                            break;
                        default:
                            currentState.id += '-' + data.DataRecord[i].Function;
                            break;
                    }
                    currentType = typeof data.DataRecord[i].Value;
                    if (currentType === 'Number') currentState.type = 'number';
                        else currentState.type = 'string';
                    currentState.unit = data.DataRecord[i].Unit;
                    neededStates.push(currentState);
                }

                createStates();
            });
        });
    });
}

function updateDeviceStates(deviceNamespace, data, callback) {

    for (var id in data.SlaveInformation) {
        if (data.SlaveInformation.hasOwnProperty(id)) {
            if (stateValues[deviceNamespace + '.info.' + id] === undefined || stateValues[deviceNamespace + '.info.' + id] !== data.SlaveInformation[id]) {
                stateValues[deviceNamespace + '.info.' + id] = data.SlaveInformation[id];
                adapter.setState(deviceNamespace + '.info.' + id, {
                    ack: true,
                    val: data.SlaveInformation[id]
                });
            }
        }
    }

    for (var i = 0; i < data.DataRecord.length; i++) {
        var stateId = '.data.' + data.DataRecord[i].id;
        if (data.DataRecord[i].StorageNumber !== undefined) {
            stateId += '-' + data.DataRecord[i].StorageNumber;
        }
        switch (data.DataRecord[i].Function) {
            case 'Instantaneous value':
                stateId += '-Current';
                break;
            case 'Maximum value':
                stateId += '-Max';
                break;
            case 'Minimum value':
                stateId += '-Min';
                break;
            case 'Value during error state':
                stateId += '-Error';
                break;
            case 'Manufacturer specific':
                stateId += '';
                break;
            default:
                stateId += '-' + data.DataRecord[i].Function;
                break;
        }
        if (stateValues[deviceNamespace + stateId] === undefined || stateValues[deviceNamespace + stateId] !== data.DataRecord[i].Value) {
            stateValues[deviceNamespace + stateId] = data.DataRecord[i].Value;
            adapter.setState(deviceNamespace + stateId, {
                ack: true,
                val: data.DataRecord[i].Value,
                ts: new Date(data.DataRecord[i].Timestamp).getTime()
            });
        }
    }
    callback();
}

function onConnect(err) {
    if (err) {
        adapter.log.error(err);
        setConnected(false);
    } else {
        setConnected(true);
    }
}

function main() {
    var mbusOptions = {
        autoConnect: true
    };
    setConnected(false);

    if (!adapter.config.type) {
        if (adapter.config.host && adapter.config.port) {
            adapter.config.type = 'tcp';
        } else {
            adapter.config.type = 'serial';
        }
    }

    adapter.config.defaultUpdateInterval = parseInt(adapter.config.defaultUpdateInterval, 10) || 3600;

    if (adapter.config.type === 'tcp' && adapter.config.host && adapter.config.port) {
        if (adapter.config.host && adapter.config.port) {
            mbusOptions.host = adapter.config.host;
            mbusOptions.port = parseInt(adapter.config.port, 10);
            adapter.log.info('Initialize M-Bus TCP to ' + adapter.config.host + ':' + adapter.config.port);
        } else {
            adapter.log.error('Please specify IP of M-Bus device/gateway');
            return;
        }
    } else if (adapter.config.type === 'serial'){
        if (adapter.config.serialPort) {
            mbusOptions.serialPort = adapter.config.serialPort;
            mbusOptions.serialBaudRate = adapter.config.serialBaudRate;
            adapter.log.info('Initialize M-Bus Serial to ' + adapter.config.serialPort + ' with ' + adapter.config.serialBaudRate + 'baud');
        } else {
            adapter.log.error('Please specify serial port of M-Bus gateway');
            return;
        }
    }

    mbusMaster = new MbusMaster(mbusOptions);

    if (!mbusMaster.connect(onConnect)) {
        adapter.log.error('M-Bus Connection failed. Please check configuration.');
        return; // to allow the user to select other COM port
    }

    for (var i = 0; i < adapter.config.devices.length; i++) {
        var deviceId = adapter.config.devices[i].id;
        mBusDevices[deviceId] = {};
        mBusDevices[deviceId].updateInterval = adapter.config.devices[i].updateInterval || adapter.config.defaultUpdateInterval;
        mBusDevices[deviceId].updateInterval = parseInt(mBusDevices[deviceId].updateInterval, 10) || adapter.config.defaultUpdateInterval;

        adapter.log.info('Schedule initialization for M-Bus-ID ' + deviceId + ' with update interval ' + mBusDevices[deviceId].updateInterval);
        scheduleDeviceUpdate(deviceId);
    }
}

function processMessage(obj) {
    if (!obj) return;

    if (obj) {
        switch (obj.command) {
            case 'listUart':
                if (obj.callback) {
                    if (serialport) {
                        // read all found serial ports
                        serialport.list(function (err, ports) {
                            adapter.log.info('List of port: ' + JSON.stringify(ports));
                            adapter.sendTo(obj.from, obj.command, ports, obj.callback);
                        });
                    } else {
                        adapter.log.warn('Module serialport is not available');
                        adapter.sendTo(obj.from, obj.command, [{comName: 'Not available'}], obj.callback);
                    }
                }
                break;

            case 'scanSecondary':
                if (mbusMaster) {
                    deviceCommunicationInProgress = true;
                    mbusMaster.scanSecondary(function (err, data) {
                        deviceCommunicationInProgress = false;
                        if (err) {
                            adapter.log.error('M-Bus scan err: ' + err);
                            data = [];
                        }
                        adapter.log.info('M-Bus scan data: ' + JSON.stringify(data, null, 2));
                        adapter.sendTo(obj.from, obj.command, {error: err ? err.toString() : null, result: data}, obj.callback);
                        updateDevices();
                    });
                } else {
                    adapter.sendTo(obj.from, obj.command, {error: 'Master is inactive'}, obj.callback);
                }
                break;
        }
    }
}
