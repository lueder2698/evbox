# evbox
Smart Charging Tool for the Elvi EVbox wallbox
The script can be used to dynamically change the charging current while charging.
It requires the following additional packages:
- node.js
- Node SerialPort
- Node MQTT
- An MQTT broker like Mosquitto, preconfigured as a broker

The script is optimized to run on a Raspberry Pi!
To get a connection to the Wallbox you need a physical serial connection through a USB serial device adapter connecting the Raspberry with the serial port of the Wallbox.

The tool can be used on the command line, e.g.
node evbox.js 12  # Set the charging current to 12A
or in a persistent mode through connecting to a MQTT broker where you can set the topic maxcurrent as the charging current.
