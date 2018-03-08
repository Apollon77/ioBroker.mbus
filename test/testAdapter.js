/* jshint -W097 */// jshint strict:false
/*jslint node: true */
/*jshint expr: true*/
var expect = require('chai').expect;
var setup  = require(__dirname + '/lib/setup');
var net = require('net');

var objects = null;
var states  = null;
var onStateChanged = null;
var onObjectChanged = null;
var sendToID = 1;

var adapterShortName = setup.adapterName.substring(setup.adapterName.indexOf('.')+1);

var lastMessage;

function checkConnectionOfAdapter(cb, counter) {
    counter = counter || 0;
    console.log('Try check #' + counter);
    if (counter > 30) {
        if (cb) cb('Cannot check connection');
        return;
    }

    states.getState('system.adapter.' + adapterShortName + '.0.alive', function (err, state) {
        if (err) console.error(err);
        if (state && state.val) {
            if (cb) cb();
        } else {
            setTimeout(function () {
                checkConnectionOfAdapter(cb, counter + 1);
            }, 1000);
        }
    });
}

function checkValueOfState(id, value, cb, counter) {
    counter = counter || 0;
    if (counter > 20) {
        if (cb) cb('Cannot check value Of State ' + id);
        return;
    }

    states.getState(id, function (err, state) {
        if (err) console.error(err);
        if (value === null && !state) {
            if (cb) cb();
        } else
        if (state && (value === undefined || state.val === value)) {
            if (cb) cb();
        } else {
            setTimeout(function () {
                checkValueOfState(id, value, cb, counter + 1);
            }, 500);
        }
    });
}

function sendTo(target, command, message, callback) {
    onStateChanged = function (id, state) {
        if (id === 'messagebox.system.adapter.test.0') {
            callback(state.message);
        }
    };

    states.pushMessage('system.adapter.' + target, {
        command:    command,
        message:    message,
        from:       'system.adapter.test.0',
        callback: {
            message: message,
            id:      sendToID++,
            ack:     false,
            time:    (new Date()).getTime()
        }
    });
}

function setupTcpServer(callback) {
    var port = 15000;

    function sendMessage(socket, message, callback) {
        console.log(new Date().toString() + ':     mbus-TCP-Device: Send to Master: ' + message.toString('hex'));
        socket.write(message, function(err) {
            console.log(new Date().toString() + ':         mbus-TCP-Device: Send done');
            callback && callback(err);
        });
    }

    var server = net.createServer(function(socket) {
        console.log(new Date().toString() + ': mbus-TCP-Device: Connected ' + port + '!');

        socket.setNoDelay();

        socket.on('data', function (data) {
            var sendBuf;
            var counterFD;

            if (!data) {
                console.log(new Date().toString() + ': mbus-TCP-Device: Received empty string!');
                return;
            }
            var hexData = data.toString('hex');
            console.log(new Date().toString() + ': mbus-TCP-Device: Received from Master: ' + hexData);

            if (hexData.substring(0,4) === '1040') {
                var device = hexData.substring(4,6);
                console.log(new Date().toString() + ':     mbus-Serial-Device: Initialization Request ' + device);
                if (device === "fe" || device === "01" || device === "05") {
                    sendBuf = Buffer.from('E5', 'hex');
                    sendMessage(socket, sendBuf);
                }
                else if (device === "fd") {
                    if (counterFD%2 === 0) {
                        sendBuf = Buffer.from('E5', 'hex');
                        sendMessage(socket, sendBuf);
                    }
                    counterFD++;
                }
            }
            else if (hexData.substring(0,6) === '105b01') {
                console.log(new Date().toString() + ':     mbus-TCP-Device: Request for Class 2 Data ID 1');
                sendBuf = Buffer.from('683C3C680808727803491177040E16290000000C7878034911041331D40000426C0000441300000000046D1D0D98110227000009FD0E0209FD0F060F00008F13E816', 'hex');
                sendMessage(socket, sendBuf);
            }
            else if (hexData.substring(0,6) === '105b02') {
                console.log(new Date().toString() + ':     mbus-TCP-Device: Request for Class 2 Data ID 2');
                sendBuf = Buffer.from('689292680801723E020005434C1202130000008C1004521200008C1104521200008C2004334477018C21043344770102FDC9FF01ED0002FDDBFF01200002ACFF014F008240ACFF01EEFF02FDC9FF02E70002FDDBFF02230002ACFF0251008240ACFF02F1FF02FDC9FF03E40002FDDBFF03450002ACFF03A0008240ACFF03E0FF02FF68000002ACFF0040018240ACFF00BFFF01FF1304D916', 'hex');
                sendMessage(socket, sendBuf);
            }
            else if (hexData.substring(0, 23) === '680b0b6873fd52ffffff1ff') {
                console.log(new Date().toString() + ':     mbus-Serial-Device: Secondary Scan found');
                sendBuf = Buffer.from('E5', 'hex');
                sendMessage(socket, sendBuf);
            }
            else if (hexData.substring(0, 6) === '105bfd') {
                console.log(new Date().toString() + ':     mbus-Serial-Device: Request for Class 2 Data ID FD');
                sendBuf = Buffer.from('6815156808017220438317b40901072b0000000c13180000009f16', 'hex');
                sendMessage(socket, sendBuf);
            }
            lastMessage = hexData;
        });
        socket.on('error', function (err) {
            console.error(new Date().toString() + ': mbus-TCP-Device: Error: ' + err);
        });
        socket.on('close', function () {
            console.error(new Date().toString() + ': mbus-TCP-Device: Close');
        });
        socket.on('end', function () {
            console.error(new Date().toString() + ': mbus-TCP-Device: End');
        });
    });

    server.on('listening', function() {
        console.log('mbus-TCP-Device: Listening');
        callback();
    });

    server.listen(port, '127.0.0.1');
}

describe('Test ' + adapterShortName + ' adapter', function() {
    before('Test ' + adapterShortName + ' adapter: Start js-controller', function (_done) {
        this.timeout(600000); // because of first install from npm

        setup.setupController(function () {
            var config = setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';

            config.native.host   = '127.0.0.1';
            config.native.port   = 15000;
            config.native.devices = [
                {
                    "id": "1",
                    "updateInterval": 3600
                },
                {
                    "id": "2",
                }
            ]
            setup.setAdapterConfig(config.common, config.native);

            setupTcpServer(function() {
                setup.startController(true, function(id, obj) {}, function (id, state) {
                        if (onStateChanged) onStateChanged(id, state);
                    },
                    function (_objects, _states) {
                        objects = _objects;
                        states  = _states;
                        _done();
                    });
            });
        });
    });

    it('Test ' + adapterShortName + ' adapter: Check if adapter started', function (done) {
        this.timeout(60000);
        checkConnectionOfAdapter(function (res) {
            if (res) console.log(res);
            expect(res).not.to.be.equal('Cannot check connection');
            objects.setObject('system.adapter.test.0', {
                    common: {

                    },
                    type: 'instance'
                },
                function () {
                    states.subscribeMessage('system.adapter.test.0');
                    done();
                });
        });
    });

    it('Test ' + adapterShortName + ' adapter: delay', function (done) {
        this.timeout(60000);

        setTimeout(function() {
            done();
        }, 55000);
    });

/*
    // We expect ERROR as last Notify necause no nut is running there
    it('Test ' + adapterShortName + ' adapter: test initial state as ERROR', function (done) {
        this.timeout(25000);

        setTimeout(function() {
            states.getState('nut.0.status.last_notify', function (err, state) {
                if (err) console.error(err);
                expect(state).to.exist;
                if (!state) {
                    console.error('state "status.last_notify" not set');
                }
                else {
                    console.log('check status.last_notify ... ' + state.val);
                    expect(state.val).to.exist;
                    expect(state.val).to.be.equal('ERROR');
                }
                states.getState('nut.0.status.severity', function (err, state) {
                    if (err) console.error(err);
                    expect(state).to.exist;
                    if (!state) {
                        console.error('state "status.severity" not set');
                    }
                    else {
                        console.log('check status.severity ... ' + state.val);
                    }
                    expect(state.val).to.exist;
                    expect(state.val).to.be.equal(4);
                    done();
                });
            });
        }, 10000);
    });

    it('Test ' + adapterShortName + ' adapter: send notify Message and receive answer', function (done) {
        this.timeout(25000);
        var now = new Date().getTime();

        console.log('send notify with "COMMBAD" to adapter ...');
        sendTo('nut.0', 'notify', {notifytype: 'COMMBAD', upsname: 'nutName@127.0.0.1'});
        setTimeout(function() {
            states.getState('nut.0.status.last_notify', function (err, state) {
                if (err) console.error(err);
                expect(state).to.exist;
                if (!state) {
                    console.error('state "status.last_notify" not set');
                }
                else {
                    console.log('check status.last_notify ... ' + state.val);
                }
                expect(state.val).to.be.equal('COMMBAD');
                states.getState('nut.0.status.severity', function (err, state) {
                    if (err) console.error(err);
                    expect(state).to.exist;
                    if (!state) {
                        console.error('state "status.severity" not set');
                    }
                    else {
                        console.log('check status.severity ... ' + state.val);
                    }
                    expect(state.val).to.exist;
                    expect(state.val).to.be.equal(4);
                    done();
                });
            });
        }, 2000);
    });
*/
    after('Test ' + adapterShortName + ' adapter: Stop js-controller', function (done) {
        this.timeout(10000);

        setup.stopController(function (normalTerminated) {
            console.log('Adapter normal terminated: ' + normalTerminated);
            done();
        });
    });
});
