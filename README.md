![Logo](admin/mbus.png)
# ioBroker.mbus
======================

[![Greenkeeper badge](https://badges.greenkeeper.io/Apollon77/ioBroker.mbus.svg)](https://greenkeeper.io/)

[![NPM version](http://img.shields.io/npm/v/iobroker.mbus.svg)](https://www.npmjs.com/package/iobroker.mbus)
[![Downloads](https://img.shields.io/npm/dm/iobroker.mbus.svg)](https://www.npmjs.com/package/iobroker.mbus)
[![Dependency Status](https://gemnasium.com/badges/github.com/Apollon77/ioBroker.mbus.svg)](https://gemnasium.com/github.com/Apollon77/ioBroker.mbus)
[![Code Climate](https://codeclimate.com/github/Apollon77/ioBroker.mbus/badges/gpa.svg)](https://codeclimate.com/github/Apollon77/ioBroker.mbus)

**Tests:** Linux/Mac: [![Travis-CI](http://img.shields.io/travis/Apollon77/ioBroker.mbus/master.svg)](https://travis-ci.org/Apollon77/ioBroker.mbus)
Windows: [![AppVeyor](https://ci.appveyor.com/api/projects/status/github/Apollon77/ioBroker.mbus?branch=master&svg=true)](https://ci.appveyor.com/project/Apollon77/ioBroker-mbus/)

[![NPM](https://nodei.co/npm/iobroker.mbus.png?downloads=true)](https://nodei.co/npm/iobroker.mbus/)

This adapter for ioBroker connects to a M-Bus Master via TCP or serial to provide the status and details of connected M-Bus devices.

## Description of parameters
### Gateway IP / TCP Port
IP address and port of the M-Bus Master/Gateway when using TCP.

### Serial port / baud rate
Serial Port and Baud rate of M-Bus Master/Gateway.

### Update Interval
Interval in Seconds to update the data. Default is 3600s (1h). Consider how the devices on the M-Bus bus are powered to prevent draining batteries.

## Device IDs
You can use primary (1-250) and secondary (16 characters long) M-Bus IDs


## Todo
* encrypted payload handling (if needed by anyone)

# changelog

## 0.1.6 (2018-03-26)
* disconnect/reconnect for each query

## 0.1.5 (2018-03-26)
* update to node-mbus 0.5 with shorter timeouts

## 0.1.4 (2018-03-26)
* add "updateNow" states to all devices to trigger manual update
* update to node-mbus 0.4.1 with shorter timeouts

## 0.1.2
* official released version

## 0.0.1
* initial release for testing

## License

The MIT License (MIT)

Copyright (c) 2018 Apollon77 <ingo@fischer-ka.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
