/**
 *
 * ioBroker MBUS adapter
 * Copyright 2018 apollon77 
 * MIT LIcense
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
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const MbusMaster = require('node-mbus');
let   serialport;
let   waitForScan;

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

let connected = false;
let errorDevices = {};

let stateValues = {};

function setConnected(isConnected) {
    if (connected !== isConnected) {
        connected = isConnected;
        adapter.setState('info.connection', connected, true, err => {
            // analyse if the state could be set (because of permissions)
            if (err) adapter.log.error('Can not update connected state: ' + err);
              else adapter.log.debug('connected set to ' + connected);
        });
    }
}

adapter.on('ready', main);

adapter.on('message', processMessage);

adapter.on('stateChange', (id, state) => {
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

adapter.on('unload', callback => {
    onClose(callback);
});

process.on('SIGINT', () => {
    onClose();
});

process.on('uncaughtException', err => {
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
    callback && setTimeout(callback, 500);
}

function finishDevice(deviceId, callback) {
    try {
        mbusMaster.close(err => {
            if (mBusDevices[deviceId].updateInterval > 0) {
                mBusDevices[deviceId].updateTimeout = setTimeout(() => {
                    mBusDevices[deviceId].updateTimeout = null;
                    scheduleDeviceUpdate(deviceId);
                }, mBusDevices[deviceId].updateInterval * 1000);
            }
            callback && callback(err);
        });
    } catch (e) {
        adapter.log.error('Error by closing: ' + e);
        callback && callback(err);
    }
}

function updateDevices() {
    if (waitForScan) {
        deviceCommunicationInProgress = false;
        makeScan(waitForScan);
        return;
    }

    if (!deviceUpdateQueue.length) {
        deviceCommunicationInProgress = false;
        return;
    }

    deviceCommunicationInProgress = true;
    const deviceId = deviceUpdateQueue.shift();

    adapter.log.debug('Process: ' + deviceId);

    if (mBusDevices[deviceId].updateTimeout) {
        clearTimeout(mBusDevices[deviceId].updateTimeout);
        mBusDevices[deviceId].updateTimeout = null;
    }

    mbusMaster.connect(err => {
        if (err) {
            adapter.setState(mBusDevices[deviceId].deviceNamespace + '.data.lastStatus', err, true);
            adapter.log.error('M-Bus ID ' + deviceId + ' connect err: ' + err);
            handleDeviceError(deviceId, updateDevices);
            return;
        }
        mbusMaster.getData(deviceId, (err, data) => {
            if (err) {
                adapter.log.warn('M-Bus ID ' + deviceId + ' err: ' + err);
                adapter.setState(mBusDevices[deviceId].deviceNamespace + '.data.lastStatus', err, true);
                return handleDeviceError(deviceId, () =>
                    finishDevice(deviceId, err => {
                        if (err) {
                            adapter.log.error('M-Bus ID ' + deviceId + ' connect err: ' + err);
                            handleDeviceError(deviceId, updateDevices);
                        } else {
                            setTimeout(updateDevices, 500);
                        }
                    })
                );
            }

            adapter.log.debug('M-Bus ID ' + deviceId + ' data: ' + JSON.stringify(data, null, 2));

            initializeDeviceObjects(deviceId, data, () => {
                updateDeviceStates(mBusDevices[deviceId].deviceNamespace, deviceId, data, () => {
                    finishDevice(deviceId, err => {
                        if (err) {
                            adapter.setState(mBusDevices[deviceId].deviceNamespace + '.data.lastStatus', err, true);
                            adapter.log.error('M-Bus ID ' + deviceId + ' connect err: ' + err);
                            handleDeviceError(deviceId, updateDevices);
                        } else {
                            adapter.setState(mBusDevices[deviceId].deviceNamespace + '.data.lastStatus', 'ok', true);
                            setTimeout(updateDevices, 500);
                        }
                    });
                });
            });
        });
    });
}

function adjustUnit(unit, type, forcekWh) {
    let m;
    // regex depending on type as to account for different units and keep it somewhat readable
    switch (type) {
        case "Energy": m = unit.match(/^([0-9e\+\-]+)?\s?([A-Za-z]+)?(Wh|J)$/); break;
        case "Mass": m = unit.match(/^([0-9e\+\-]+)?\s?([A-Za-z]+)?(kg)$/); break;
        case "Power": m = unit.match(/^([0-9e\+\-]+)?\s?([A-Za-z]+)?(W|J\/h)$/); break;
        case "Volume": m = unit.match(/^([0-9e\+\-]+)?\s?([A-Za-z]+)?( m\^3)$/); break;
        case "Volume flow": m = unit.match(/^([0-9e\+\-]+)?\s?([A-Za-z]+)?( m\^3\/(h|min|s))$/); break;
        case "Mass flow": m = unit.match(/^([0-9e\+\-]+)?\s?([A-Za-z]+)?( kg\/h)$/); break;
        case "Flow temperature":
        case "Return temperature": m = unit.match(/^([0-9e\+\-]+)?\s?([A-Za-z]+)?(deg (C|F))$/); break;
        case "External temperature":
        case "Temperature Difference": m = unit.match(/^([0-9e\+\-]+)?\s?([A-Za-z]+)?( deg (C|F))$/); break;
        case "Pressure":  m = unit.match(/^([0-9e\+\-]+)?\s?([A-Za-z]+)?( bar)$/); break;
        case "Voltage":  m = unit.match(/^([0-9e\+\-]+)?\s?([A-Za-z]+)?( V)$/); break;
        case "Current":  m = unit.match(/^([0-9e\+\-]+)?\s?([A-Za-z]+)?( A)$/); break;
        case "Time Point": return {factor: undefined, unit: undefined};
    }
    //special case to adjust unit for durations
    switch (unit) {
        case "seconds": return {factor: 1, unit: "s"};
        case "minutes": return {factor: 1, unit: "min"};
        case "hours": return {factor: 1, unit: "h"};
        case "days": return {factor: 1, unit: "d"};
    }

    // nothing worked
    if (!m) {
        return {factor: undefined, unit: undefined};
    }

    // adjust factor depending on metric prefix
    let factor = parseFloat(m[1]) || 1;
    unit = m[3].trim();
    if (m[2]) {
        switch (m[2]) {
            case "m": factor *= 1e-3; break;
            case "my": factor *= 1e-6; break;
            case "k": factor *= 1e3; break;
            case "M": factor *= 1e6; break;
            case "G": factor *= 1e9; break;
            case "T": factor *= 1e9; break; //this is an error in libmbus...
            default: unit = m[2] + unit;
        }
    }

    // make some units nicer looking
    switch (unit) {
        case "deg C": unit = "°C"; break;
        case "deg F": unit = "°F"; break;
        case "m^3": unit = "m³"; break;
        case "m^3/h": unit = "m³/h"; break;
        case "m^3/min": unit = "m³/min"; break;
        case "m^3/s": unit = "m³/s"; break;
    }
    switch (type) {
        case "Temperature Difference": if (unit == "°C") { unit = "K"; } break;
    }
    
    // force specific SI prefix or unit
    if (forcekWh) {
        if (unit == "Wh") {
            unit = "kWh";
            factor = factor / 1000;
        } else if (unit == "J") {
            unit = "kWh";
            factor = factor / 3600000;
        }            
    }

    return {factor: factor, unit: unit};
}

function getRole(unit, type) {
    switch (type) {
        case 'Energy': return 'value.power.consumption';
        case 'Power': return 'value.power';
        case 'Mass': return 'value.mass'
        case 'Volume': return 'value.volume';
        case 'Volume flow': return 'value.flow';
        case 'Mass flow': return 'value.flow';
        case 'Time Point': return 'date';
        case 'Pressure': return 'value.pressure';
        case 'Flow temperature':
        case 'Return temperature':
        case 'Temperature Difference':
        case 'External temperature': return 'value.temperature';
        case 'Current': return 'value.current';
        case 'Voltage': return 'value.voltage';
    }

    switch (unit) {
        case 'seconds':
        case 'minutes':
        case 'hours':
        case 'days': return 'value.duration';
    }

    return 'value';
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
        let name = state.id;

        let unit = state.unit || '';
        if (unit.endsWith(' V')) {
            unit = 'Voltage (' + unit + ')';
        }
        if (unit.endsWith(' A')) {
            unit = 'Current (' + unit + ')';
        }

        let m = unit.match(/^([^(]+)\s?\(([^)]+)\)$/);
        // parse unit "Volume (100 m^3)" => Volume is name, 100 is factor, m3 is unit)
        let role = 'value';

        if (m) {
            let type = m[1].trim();
            unit = m[2].trim();
            role = getRole(unit, type);
            let tmp = adjustUnit(unit, type, adapter.config.forcekWh);
            state.unit = tmp.unit;
            name = state.id + ' ' + type;
        } else {
            name = state.id + (state.unit ? ' ' + state.unit : '');
        }
        name += state.Tariff !== undefined ? (' (Tariff ' + state.Tariff + ')') : '';

        // remove '.data.25-2-' at start
        name = name.replace(/\.data\.\d+-\d+-?/, '');
        // remove '.info.' from start
        name = name.replace(/\.info\./, '');

        // var stateName = state.id.substring(state.id.indexOf('.', 1));
        adapter.setObjectNotExists(deviceNamespace + state.id, {
            type: 'state',
            common: {
                name,
                role,
                type: state.type,
                read: true,
                write: false,
                unit: state.unit
            },
            native: {
                id: state.id,
                StorageNumber: state.StorageNumber,
                Tariff: state.Tariff,
                Device: state.Device
            }
        }, (err, obj) => {
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
    }, (err, obj) => {
        if (err) {
            adapter.log.error('Error creating State: ' + err);
        }
        adapter.setObjectNotExists(deviceNamespace + '.updateNow', {
            type: 'state',
            common: {name: deviceNamespace + '.updateNow', role: 'button', type: 'boolean', def: false},
            native: {}
        }, err => {
            if (err) {
                adapter.log.error('Error creating State: ' + err);
            }
            adapter.subscribeStates(deviceNamespace + '.updateNow');
        });
        adapter.setObjectNotExists(deviceNamespace + '.info', {
            type: 'channel',
            common: {name: deviceNamespace + '.info'},
            native: {}
        }, err => {
            if (err) {
                adapter.log.error('Error creating State: ' + err);
            }
            adapter.setObjectNotExists(deviceNamespace + '.data', {
                type: 'channel',
                common: {name: deviceNamespace + '.data'},
                native: {}
            }, err => {
                if (err) {
                    adapter.log.error('Error creating State: ' + err);
                }
                let currentState;
                let currentType;
                for (let id in data.SlaveInformation) {
                    if (!data.SlaveInformation.hasOwnProperty(id)) continue;

                    currentState = {};
                    currentState.id = '.info.' + id;
                    currentState.type = typeof data.SlaveInformation[id];
                    currentState.unit = '';
                    neededStates.push(currentState);
                }

                // add deviceId
                neededStates.push({
                    id: '.info.address',
                    type: 'string',
                });
                let padlen = data.DataRecord.length.toString().length;
                for (let i = 0; i < data.DataRecord.length; i++) {
                    currentState = {};
                    currentState.id = '.data.' + data.DataRecord[i].id.toString().padStart(padlen, '0');
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
                    currentState.type = typeof data.DataRecord[i].Value;
                    currentState.unit = data.DataRecord[i].Unit;
                    currentState.Tariff = data.DataRecord[i].Tariff;
                    currentState.StorageNumber = data.DataRecord[i].StorageNumber;
                    currentState.Device = data.DataRecord[i].Device;
                    neededStates.push(currentState);
                }
                neededStates.push({
                    id: '.data.lastStatus',
                    type: 'string',
                    role: 'state'
                });

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

    let padlen = data.DataRecord.length.toString().length;
    for (let i = 0; i < data.DataRecord.length; i++) {
        let stateId = '.data.' + data.DataRecord[i].id.toString().padStart(padlen, '0');
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
        if (adapter.config.alwaysUpdate || stateValues[deviceNamespace + stateId] === undefined || stateValues[deviceNamespace + stateId] !== data.DataRecord[i].Value) {
            stateValues[deviceNamespace + stateId] = data.DataRecord[i].Value;

            let val = data.DataRecord[i].Value;
            let unit = data.DataRecord[i].Unit || '';
            if (unit.endsWith(' V')) {
                unit = 'Voltage (' + unit + ')';
            }
            if (unit.endsWith(' A')) {
                unit = 'Current (' + unit + ')';
            }
            let m = unit.match(/^([^(]+)\s?\(([^)]+)\)$/);
            // parse unit "Volume (100 m^3)" => Volume is name, 100 is factor, m3 is unit)
            let factor = 0;
            if (m) {
                let type = m[1].trim();
                unit = m[2].trim();
                factor = adjustUnit(unit, type, adapter.config.forcekWh).factor || 0;
            }

            adapter.log.debug('Value ' + deviceNamespace + stateId + ': ' + val + ' with factor ' + factor);
            if (factor && typeof val === 'number') {
                val *= factor;
                val = Math.round(val * 1000000000) / 1000000000; // remove 1.250000000000000001
            }
            adapter.setState(deviceNamespace + stateId, {
                ack: true,
                val,
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
            setTimeout(() => scheduleDeviceUpdate(deviceId), 500);
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
                    if (deviceCommunicationInProgress) {
                        waitForScan = obj;
                    } else {
                        makeScan(obj);
                    }
                } else {
                    adapter.sendTo(obj.from, obj.command, {error: 'Master is inactive'}, obj.callback);
                }
                break;
        }
    }
}

function makeScan(msgObj) {
    waitForScan = null;
    deviceCommunicationInProgress = true;
    mbusMaster.scanSecondary((err, data) => {
        deviceCommunicationInProgress = false;        
        if (err) {
            adapter.log.error('M-Bus scan err: ' + err);
            data = [];
        }
        adapter.log.info('M-Bus scan data: ' + JSON.stringify(data, null, 2));
        adapter.sendTo(msgObj.from, msgObj.command, {error: err ? err.toString() : null, result: data}, msgObj.callback);
        updateDevices();
    });
}
