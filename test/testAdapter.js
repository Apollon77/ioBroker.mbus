/* jshint -W097 */// jshint strict:false
/*jslint node: true */
/*jshint expr: true*/
const expect = require('chai').expect;
const setup = require(__dirname + '/lib/setup');
const net = require('net');

let objects = null;
let states = null;
let onStateChanged = null;
let sendToID = 1;

const adapterShortName = setup.adapterName.substring(setup.adapterName.indexOf('.') + 1);

let lastMessage;

function checkConnectionOfAdapter(cb, counter) {
    counter = counter || 0;
    console.log('Try check #' + counter);
    if (counter > 30) {
        if (cb) cb('Cannot check connection');
        return;
    }

    states.getState('system.adapter.' + adapterShortName + '.0.alive', (err, state) => {
        if (err) console.error(err);
        if (state && state.val) {
            if (cb) cb();
        } else {
            setTimeout(() => {
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

    states.getState(id, (err, state) =>{
        if (err) console.error(err);
        if (value === null && !state) {
            if (cb) cb();
        } else
        if (state && (value === undefined || state.val === value)) {
            if (cb) cb();
        } else {
            setTimeout(() => {
                checkValueOfState(id, value, cb, counter + 1);
            }, 500);
        }
    });
}

function sendTo(target, command, message, callback) {
    onStateChanged = (id, state) => {
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
    const port = 15000;

    function sendMessage(socket, message, callback) {
        console.log(new Date().toString() + ':     mbus-TCP-Device: Send to Master: ' + message.toString('hex'));
        socket.write(message, (err) => {
            console.log(new Date().toString() + ':         mbus-TCP-Device: Send done');
            callback && callback(err);
        });
    }

    let testSocket;
    const server = net.createServer( (socket) => {
        console.log(new Date().toString() + ': mbus-TCP-Device: Connected ' + port + '!');

        testSocket = socket;
        socket.setNoDelay();

        socket.on('data',  (data) => {
            let sendBuf;
            let counterFD;

            if (!testSocket) {
                console.log(new Date().toString() + ': mbus-TCP-Device: Connection was already closed');
                return;
            }
            if (!data) {
                console.log(new Date().toString() + ': mbus-TCP-Device: Received empty string!');
                return;
            }
            const hexData = data.toString('hex');
            console.log(new Date().toString() + ': mbus-TCP-Device: Received from Master: ' + hexData);

            if (hexData.substring(0, 4) === '1040') {
                const device = hexData.substring(4, 6);
                console.log(new Date().toString() + ':     mbus-Serial-Device: Initialization Request ' + device);
                if (device === "fe" || device === "01" || device === "05") {
                    sendBuf = Buffer.from('E5', 'hex');
                    sendMessage(socket, sendBuf);
                } else if (device === "fd") {
                    if (counterFD % 2 === 0) {
                        sendBuf = Buffer.from('E5', 'hex');
                        sendMessage(socket, sendBuf);
                    }
                    counterFD++;
                }
            } else if (hexData.substring(0, 6) === '105b01' || hexData.substring(0, 6) === '107b01') {
                console.log(new Date().toString() + ':     mbus-TCP-Device: Request for Class 2 Data ID 1');
                sendBuf = Buffer.from('683C3C680808727803491177040E16290000000C7878034911041331D40000426C0000441300000000046D1D0D98110227000009FD0E0209FD0F060F00008F13E816', 'hex');
                sendMessage(socket, sendBuf);
            } else if (hexData.substring(0, 6) === '105b02' || hexData.substring(0, 6) === '107b02') {
                console.log(new Date().toString() + ':     mbus-TCP-Device: Request for Class 2 Data ID 2');
                sendBuf = Buffer.from('689292680801723E020005434C1202130000008C1004521200008C1104521200008C2004334477018C21043344770102FDC9FF01ED0002FDDBFF01200002ACFF014F008240ACFF01EEFF02FDC9FF02E70002FDDBFF02230002ACFF0251008240ACFF02F1FF02FDC9FF03E40002FDDBFF03450002ACFF03A0008240ACFF03E0FF02FF68000002ACFF0040018240ACFF00BFFF01FF1304D916', 'hex');
                sendMessage(socket, sendBuf);
            } else if (hexData.substring(0, 6) === '105b03' || hexData.substring(0, 6) === '107b03') {
                console.log(new Date().toString() + ':     mbus-TCP-Device: Request for Class 2 Data ID 3');
                sendBuf = Buffer.from('689292680801723E020005434C1202130000008C1004521200008C1104521200008C2004334477018C21043344770102FDC9FF01ED0002FDDBFF01200002ACFF014F008240ACFF01EEFF02FDC9FF02E70002FDDBFF02230002ACFF0251008240ACFF02F1FF02FDC9FF03E40002FDDBFF03450002ACFF03A0008240ACFF03E0FF02FF68000002ACFF0040018240ACFF00BFFF01FF1304D916', 'hex');
                sendMessage(socket, sendBuf);
            } else if (hexData.substring(0, 23) === '680b0b6873fd52ffffff1ff') {
                console.log(new Date().toString() + ':     mbus-Serial-Device: Secondary Scan found');
                sendBuf = Buffer.from('E5', 'hex');
                sendMessage(socket, sendBuf);
            } else if (hexData.substring(0, 6) === '105bfd' || hexData.substring(0, 6) === '107bfd') {
                console.log(new Date().toString() + ':     mbus-Serial-Device: Request for Class 2 Data ID FD');
                sendBuf = Buffer.from('6815156808017220438317b40901072b0000000c13180000009f16', 'hex');
                sendMessage(socket, sendBuf);
            }
            lastMessage = hexData;
        });
        socket.on('error', (err) => {
            console.error(new Date().toString() + ': mbus-TCP-Device: Error: ' + err);
        });
        socket.on('close', () => {
            console.error(new Date().toString() + ': mbus-TCP-Device: Close');
        });
        socket.on('end',  () => {
            console.error(new Date().toString() + ': mbus-TCP-Device: End');
        });

        setTimeout( () => {
            server.close();
            if (testSocket) testSocket.end();
            testSocket = null;
            console.error('Destroy TCP-Socket!!');
        }, 60000);
    });

    server.on('listening', () => {
        console.log('mbus-TCP-Device: Listening');
        callback();
    });

    server.listen(port, '127.0.0.1');
}

describe('Test ' + adapterShortName + ' adapter', function() {
    before('Test ' + adapterShortName + ' adapter: Start js-controller', function (_done) {
        this.timeout(45*60*60*1000); // because of first install from npm

        setup.setupController(async () => {
            const config = await setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';

            config.native.host   = '127.0.0.1';
            config.native.port   = 15000;
            config.native.defaultUpdateInterval   = 20;
            config.native.devices = [
                {
                    "id": "1",
                    "updateInterval": 60
                },
                {
                    "id": "2"
                },
                {
                    "id": "3",
                    "updateInterval": 0
                }
            ];
            await setup.setAdapterConfig(config.common, config.native);

            setupTcpServer(() => {
                setup.startController(true, (id, obj) => {},  (id, state) => {
                        if (onStateChanged) onStateChanged(id, state);
                    },
                     (_objects, _states) => {
                        objects = _objects;
                        states  = _states;
                        _done();
                    });
            });
        });
    });

    it('Test ' + adapterShortName + ' adapter: Check if adapter started', function (done) {
        this.timeout(60000);
        checkConnectionOfAdapter( (res) => {
            if (res) console.log(res);
            expect(res).not.to.be.equal('Cannot check connection');
            objects.setObject('system.adapter.test.0', {
                    common: {

                    },
                    type: 'instance'
                },
                () => {
                    states.subscribeMessage('system.adapter.test.0');
                    done();
                });
        });
    });

    it('Test ' + adapterShortName + ' adapter: delay', function (done) {
        this.timeout(120000);

        setTimeout(() => {
            done();
        }, 110000);
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

        setup.stopController( (normalTerminated) => {
            console.log('Adapter normal terminated: ' + normalTerminated);
            done();
        });
    });
});
