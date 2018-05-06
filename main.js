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

const path       = require('path');
const utils      = require(path.join(__dirname, 'lib', 'utils')); // Get common adapter utils
const MbusMaster = require('node-mbus');
let   serialport;

try {
    serialport = require('serialport');
} catch (err) {
    console.warn('Cannot load serialport module');
}

const adapter = new utils.Adapter('mbus');

let deviceUpdateQueue = [];
let mBusDevices = {};
let deviceCommunicationInProgress = false;
let mbusMaster;

let connected = null;
let errorDevices = {};

let stateValues = {};

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
    const idSplit = id.split('.');
    if (idSplit[idSplit.length - 1] !== 'updateNow') return;
    const deviceNamespace = idSplit[idSplit.length - 2];

    for (let deviceId in mBusDevices) {
        if (mBusDevices.hasOwnProperty(deviceId) && mBusDevices[deviceId].deviceNamespace === deviceNamespace) {
            scheduleDeviceUpdate(deviceId);
            break;
        }
    }
});

function onClose(callback) {
    try {
        if (mbusMaster) {
            mbusMaster.close(() => {
                setConnected(false);
                deviceCommunicationInProgress  = false;
                for (let deviceId in mBusDevices) {
                    if (mBusDevices.hasOwnProperty(deviceId) && mBusDevices[deviceId].updateTimeout) {
                        clearTimeout(mBusDevices[deviceId].updateTimeout);
                        mBusDevices[deviceId].updateTimeout = null;
                    }
                }
                deviceUpdateQueue = [];
                mBusDevices = {};
                if (callback) {
                    callback();
                }
            });
            return;
        }
    } catch (e) {
    }
    if (callback) {
        callback();
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

function handleDeviceError(deviceId, callback) {
    errorDevices[deviceId] = true;
    adapter.log.warn('M-Bus Devices with errors: ' + Object.keys(errorDevices).length + ' from ' + Object.keys(mBusDevices).length);
    if (Object.keys(errorDevices).length === Object.keys(mBusDevices).length) {
        adapter.log.error('All M-Bus devices could not be read, reinitialize and start over');
        setConnected(false);
        onClose(main);
        return false;
    }
    if (callback) {
        setTimeout(callback, 500);
    }
}

function updateDevices() {
    if (!deviceUpdateQueue.length) {
        deviceCommunicationInProgress = false;
        return;
    }

    deviceCommunicationInProgress = true;
    const deviceId = deviceUpdateQueue.shift();
    adapter.log.info('Process: ' + deviceId);
    if (mBusDevices[deviceId].updateTimeout) {
        clearTimeout(mBusDevices[deviceId].updateTimeout);
        mBusDevices[deviceId].updateTimeout = null;
    }

    mbusMaster.connect(err => {
        if (err) {
            adapter.log.error('M-Bus ID ' + deviceId + ' connect err: ' + err);
            handleDeviceError(deviceId, updateDevices);
            return;
        }
        mbusMaster.getData(deviceId, (err, data) => {
            if (err) {
                adapter.log.error('M-Bus ID ' + deviceId + ' err: ' + err);

                return handleDeviceError(deviceId, () => {
                    // give the chance to be asked next time once more
                    mbusMaster.close(err => {
                        if (mBusDevices[deviceId].updateInterval > 0) {
                            mBusDevices[deviceId].updateTimeout = setTimeout(function () {
                                mBusDevices[deviceId].updateTimeout = null;
                                scheduleDeviceUpdate(deviceId);
                            }, mBusDevices[deviceId].updateInterval * 1000);
                        }
                        if (err) {
                            adapter.log.error('M-Bus ID ' + deviceId + ' connect err: ' + err);
                            handleDeviceError(deviceId, updateDevices);
                            return;
                        }
                        setTimeout(updateDevices, 500);
                    });
                });
            }

            adapter.log.debug('M-Bus ID ' + deviceId + ' data: ' + JSON.stringify(data, null, 2));

            initializeDeviceObjects(deviceId, data, function () {
                updateDeviceStates(mBusDevices[deviceId].deviceNamespace, deviceId, data, function() {
                    mbusMaster.close(err => {
                        if (mBusDevices[deviceId].updateInterval > 0) {
                            mBusDevices[deviceId].updateTimeout = setTimeout(function () {
                                mBusDevices[deviceId].updateTimeout = null;
                                scheduleDeviceUpdate(deviceId);
                            }, mBusDevices[deviceId].updateInterval * 1000);
                        }

                        if (err) {
                            adapter.log.error('M-Bus ID ' + deviceId + ' connect err: ' + err);
                            handleDeviceError(deviceId, updateDevices);
                        } else {
                            setTimeout(updateDevices, 500);
                        }
                    });
                });
            });
        });
    });
}

function initializeDeviceObjects(deviceId, data, callback) {
    let neededStates = [];
    function createStates() {
        if (!neededStates.length) {
            callback();
            return;
        }
        const state = neededStates.shift();
        adapter.log.debug('Create State ' + deviceNamespace + state.id);
        // var stateName = state.id.substring(state.id.indexOf('.', 1));
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
        }, function(err, obj) {
            if (err) {
                adapter.log.error('Error creating State: ' + err);
            }
            createStates();
        });
    }

    if (mBusDevices[deviceId].deviceNamespace) {
        callback();
        return;
    }

    const deviceNamespace = data.SlaveInformation.Manufacturer + '-' + data.SlaveInformation.Id;
    mBusDevices[deviceId].deviceNamespace = deviceNamespace;

    adapter.setObjectNotExists(deviceNamespace, {
        type: 'channel',
        common: {name: deviceNamespace},
        native: {}
    }, function(err, obj) {
        if (err) {
            adapter.log.error('Error creating State: ' + err);
        }
        adapter.setObjectNotExists(deviceNamespace + '.updateNow', {
            type: 'state',
            common: {name: deviceNamespace + '.updateNow', role: 'button', type: 'boolean', def: false},
            native: {}
        }, function(err, obj) {
            if (err) {
                adapter.log.error('Error creating State: ' + err);
            }
            adapter.subscribeStates(deviceNamespace + '.updateNow');
        });
        adapter.setObjectNotExists(deviceNamespace + '.info', {
            type: 'channel',
            common: {name: deviceNamespace + '.info'},
            native: {}
        }, function(err, obj) {
            if (err) {
                adapter.log.error('Error creating State: ' + err);
            }
            adapter.setObjectNotExists(deviceNamespace + '.data', {
                type: 'channel',
                common: {name: deviceNamespace + '.data'},
                native: {}
            }, function(err, obj) {
                if (err) {
                    adapter.log.error('Error creating State: ' + err);
                }
                let currentState;
                let currentType;
                for (let id in data.SlaveInformation) {
                    if (!data.SlaveInformation.hasOwnProperty(id)) continue;

                    currentState = {};
                    currentState.id = '.info.' + id;
                    currentType = typeof data.SlaveInformation[id];
                    currentState.type = currentType === 'Number' ? 'number' : 'string';
                    currentState.unit = '';
                    neededStates.push(currentState);
                }
                
                // add deviceId
                neededStates.push({
                    id: '.info.address',
                    type: 'string',                    
                });
                
                for (let i = 0; i < data.DataRecord.length; i++) {
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

function updateDeviceStates(deviceNamespace, deviceId, data, callback) {
    for (let id in data.SlaveInformation) {
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
    
    // update deviceId
    if (stateValues[deviceNamespace + '.info.address'] === undefined || stateValues[deviceNamespace + '.info.address'] !== deviceId) {
            stateValues[deviceNamespace + '.info.address'] = deviceId;
            adapter.setState(deviceNamespace + '.info.address', {
                ack: true,
                val: deviceId
            });
        }
    
    for (let i = 0; i < data.DataRecord.length; i++) {
        let stateId = '.data.' + data.DataRecord[i].id;
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
    let mbusOptions = {
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

    if (adapter.config.defaultUpdateInterval && adapter.config.defaultUpdateInterval !== '0' && adapter.config.defaultUpdateInterval !== 0) {
        adapter.config.defaultUpdateInterval = parseInt(adapter.config.defaultUpdateInterval, 10) || 3600;
    } else {
        adapter.config.defaultUpdateInterval = 0;
    }

    adapter.log.info('Default Update Interval: ' + adapter.config.defaultUpdateInterval);

    if (adapter.config.type === 'tcp' && adapter.config.host && adapter.config.port) {
        if (adapter.config.host && adapter.config.port) {
            mbusOptions.host = adapter.config.host;
            mbusOptions.port = parseInt(adapter.config.port, 10);
            if (adapter.config.tcpTimeout) mbusOptions.timeout = parseInt(adapter.config.tcpTimeout, 10);
                else mbusOptions.timeout = 0;
            adapter.log.info('Initialize M-Bus TCP to ' + mbusOptions.host + ':' + mbusOptions.port + ' with timeout ' + mbusOptions.timeout);
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

    mbusMaster.close(err => {
        if (err) {
            adapter.log.error('M-Bus Connection failed. Please check configuration.');
            return; // to allow the user to select other COM port
        }
        for (let i = 0; i < adapter.config.devices.length; i++) {
            const deviceId = adapter.config.devices[i].id;
            mBusDevices[deviceId] = {};

            if (adapter.config.devices[i].updateInterval === '' || adapter.config.devices[i].updateInterval === undefined) {
                mBusDevices[deviceId].updateInterval = adapter.config.defaultUpdateInterval;
            } else
            if (adapter.config.devices[i].updateInterval && adapter.config.devices[i].updateInterval !== '0' && adapter.config.devices[i].updateInterval !== 0) {
                mBusDevices[deviceId].updateInterval = parseInt(adapter.config.devices[i].updateInterval, 10) || adapter.config.defaultUpdateInterval;
            } else {
                mBusDevices[deviceId].updateInterval = 0;
            }

            adapter.log.info('Schedule initialization for M-Bus-ID ' + deviceId + ' with update interval ' + mBusDevices[deviceId].updateInterval);
            scheduleDeviceUpdate(deviceId);
        }
    });
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
