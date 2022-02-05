// EVbox Elvi RS485 messaging interface
// Parameters:
// maxCurrent: maximal Charge current in A (usually between 6 and 32A)
// Timeout: Timespan for how long this current will be used in seconds
// nextCurrent: Current to be set afterwards

// Setup default settings
const serialInterface = '/dev/ttyUSB0';
const mqttBroker = 'localhost:1883';
const defaultCurrent = 16;
const defaultTimeout = 60;
const defaultNextCurrent = defaultCurrent;
const minCurrent = 6;
const phases = 3;
const updateInterval = 60; // update interval of data in seconds
const persistent = true; // Persistent mode constantly runs with listeners on serial port and mqtt; non-persistent takes a command line argument, processes it and stops (no MQTT is used)
const rootTopic = "evbox";
const debug = true;

// Settings for MQTT connection
var mqttOptions = {
  clientId: "evbox01",
  username: "evbox",
  password: "vZ7cT5Y@2Sv5",
  clean: true
};
var msgopt = {
  retain: true,
  qos: 1
};

var evbox = new Object();

// Settings for EVCC
const evccTopics = [rootTopic + "/enable", rootTopic + "/maxcurrent"];

const SerialPort = require('serialport')
const Readline = require('@serialport/parser-readline')
const port = new SerialPort(serialInterface, {
  baudRate: 38400
})
var client = new Object();

if (process.argv[2]) {
  persistent = false;
  evbox.maxCurrent = process.argv[2] || defaultCurrent;
  evbox.Timeout = process.argv[3] || defaultTimeout;
  evbox.nextCurrent = process.argv[4] || defaultNextCurrent;
}

if (persistent) {
  client = initialize(mqttBroker, mqttOptions);
  if (debug) { console.log("Initialized"); }
  //setInterval(sendMessage, updateInterval * 1000, setEvboxString());
} else {
  sendMessage(setEvboxString());
  port.close();
  client.end();
}

function setEvboxString () {
  var comString;

  var smartGrid = "A0";
  var chargePoint = "80";
  var command = "69";

  if (persistent) validateCurrent();

  var evBoxCurrent = decToHex(evbox.maxCurrent * 10, 4);
  var timeoutHex = decToHex(evbox.Timeout, 4);
  var evNextCurrent = decToHex(evbox.nextCurrent * 10, 4);

  comString = chargePoint + smartGrid + command + evBoxCurrent + evBoxCurrent + evBoxCurrent + timeoutHex + evNextCurrent + evNextCurrent + evNextCurrent;
  comString += checkSum(comString);
  var result = ['\x02', comString, '\x03'];
  result = result.join('');
  // if (debug) { console.log ("Command String: " + result); }
  return result;
}

function parseEvBoxString (response) {
  if(response.charAt(0) == '\x02') { response = response.slice(1); }
  if(debug) { console.log('Wallbox Response: ' + response); }

  var obj = new Object();

  // Address infos (static for EVbox)
  obj.smartGrid = response.substr(0,2);
  obj.chargePoint = response.substr(2,2);
  obj.command = response.substr(4,2);

  // General Info about Charging solution
  obj.minInterval = hexToDec(response.substr(6,4));
  obj.maxPhaseCurrent = hexToDec(response.substr(10,4)) / 10;
  evbox.maxPhaseCurrent = obj.maxPhaseCurrent;
  obj.chargeBoxes = hexToDec(response.substr(14,2));

  // Chargebox specific
  obj.minPhaseCurrent = hexToDec(response.substr(16,4)) / 10;
  evbox.minPhaseCurrent = obj.minPhaseCurrent;
  obj.currentL1 = hexToDec(response.substr(20,4)) / 10;
  obj.currentL2 = hexToDec(response.substr(24,4)) / 10;
  obj.currentL3 = hexToDec(response.substr(28,4)) / 10;
  obj.cosPhiL1 = hexToDec(response.substr(32,4));
  if (obj.cosPhiL1 > 60000) {
    obj.cosPhiL1 = (obj.cosPhiL1 - 65536) / 1000; } else {
    obj.cosPhiL1 = obj.cosPhiL1 / 1000;
  }
  obj.cosPhiL2 = hexToDec(response.substr(36,4));
  if (obj.cosPhiL2 > 60000) {
    obj.cosPhiL2 = (obj.cosPhiL2 - 65536) / 1000; } else {
    obj.cosPhiL2 = obj.cosPhiL2 / 1000;
  }
  obj.cosPhiL3 = hexToDec(response.substr(40,4));
  if (obj.cosPhiL3 > 60000) {
    obj.cosPhiL3 = (obj.cosPhiL3 - 65536) / 1000; } else {
    obj.cosPhiL3 = obj.cosPhiL3 / 1000;
  }
  obj.smartMeter = hexToDec(response.substr(44,8)) / 1000;

  // checkSum
  obj.checkSum = response.substr(52,4);

  // EVCC relevant topics
  obj.enabled = evbox.enable;
  if(obj.currentL1 > 0) {
    obj.status = "C"; // Charging
  } else {
    obj.status = "A"; // Not charging
  }
  if (obj.checkSum == checkSum(response.substr(0,52))) {
    check = true;
    if (debug) { console.log('Checksum correct'); }
  } else {
    check = false;
    if (debug) { console.log('Checksum incorrect: ' + obj.checkSum + ' vs ' + checkSum(response.substr(0,52))); }
  }

  if (check) { return obj; } else { return false; }
}

function initialize (mqttBroker, mqttOptions) {
  const mqtt=require('mqtt');
  client = mqtt.connect ('mqtt://' + mqttBroker, mqttOptions);
  client.on("error", function(error) {
    console.log("Can't connect to MQTT Broker: " + error);
    process.exit(1);
  })
  client.on("connect", function() {
    if (debug) { console.log("MQTT Broker " + mqttBroker + " connected"); }
  })
  // EVCC topics
  if(debug) { console.log('Subscribing to ' + evccTopics); }
  client.subscribe(evccTopics,{qos:1});
  client.on('message', function(topic, message, packet) {
    if(debug) { console.log("Incoming message: " + topic + ": " + message)}
    if(topic == rootTopic + '/enable') {
      evbox.enable = message;
      if(message) {
        client.publish(rootTopic + '/enabled', message, msgopt);
      } else {
        client.publish(rootTopic + '/enabled', false, msgopt);
      }
      if(debug) { console.log('EVbox enabled: ' + message); }
    }
    if(topic == rootTopic + '/maxcurrent') {
      evbox.maxCurrent = message;
      sendMessage(setEvboxString());
    }
  })
  return client;
}

function sendMessage (message) {
  if (debug) { console.log('sending message: ' + message + ' to ' + serialInterface); }
  const parser = port.pipe(new Readline({ delimiter: '\x03' }));
  var mqttAck = false;
  if(!evbox.serialParser) {
    parser.on('data', function(response) {
      evbox.serialParser = true;
      var object = parseEvBoxString(response);
      if (persistent && object) {
        mqttAck = sendMQTT(object);
      }
    })
  }
  port.write(message, function(err) {
    if (err) {
      console.log('Error on write: ', err.message);
      return false;
    }
    if (debug) { console.log('message sent: ' + evbox.maxCurrent + 'A'); }
  })
  return mqttAck;
}

function sendMQTT (obj) {
  for(var prop in obj) {
    if (client.connected == true) {
      client.publish(rootTopic + '/' + prop, obj[prop].toString(), msgopt);
    } else {
      if(debug) { console.log("Could not publish topic " + prop); }
      return false;
    }
    if (debug) { console.log("Publishing " + prop + " = " + obj[prop]); }
  }
  return true;
  client.on("error", function(error) {
    console.log("Can't connect: "+error);
    return false;
  })
}

function validateCurrent () {
  evbox.maxCurrent = Math.round(evbox.maxCurrent * 10) / 10;
  evbox.Timeout = evbox.Timeout || defaultTimeout;
  if(!evbox.minPhaseCurrent) evbox.minPhaseCurrent = minCurrent;
  if(!evbox.maxPhaseCurrent) evbox.maxPhaseCurrent = defaultCurrent;
  if(evbox.maxCurrent < evbox.minPhaseCurrent && evbox.maxCurrent != 0) evbox.maxCurrent = evbox.minPhaseCurrent;
  if(evbox.maxCurrent > evbox.maxPhaseCurrent) evbox.maxCurrent = evbox.maxPhaseCurrent;
  evbox.nextCurrent = evbox.maxCurrent; // do not use nextCurrent feature
}

function decToHex (dec, offset) {
  return (dec + 0x100000000).toString(16).substr(offset * -1).toUpperCase();
}

function hexToDec (hex) {
  return parseInt(hex, 16);
}

function checkSum (string) {
  let csXor = 0;
  let csMod = 0;
  for (let char of string) {
    csXor ^= char.charCodeAt(0);
    csMod += char.charCodeAt(0);
  }
  return (((csMod % 256) + 0x100).toString(16).substr(-2).toUpperCase() + ((csXor + 0x100).toString(16).substr(-2).toUpperCase()))
}
