#!/usr/bin/env node

const { Command } = require('commander')
const pkg = require('./package.json')
const fs = require('fs')
const path = require('path')
const ioClient = require('socket.io-client')
const jwt = require('jsonwebtoken')
const Autolevel = require('./autolevel.js')
const http = require('http');

const program = new Command();

//#region  prevent starting multiple instances
// create Sentinel server
let server = http.createServer(function(req, res) {
    res.send("ok");
});
// make sure this server doesn't keep the process running
server.unref();

server.on('error', function(e) {
    if (e.code === "EADDRINUSE") {
        console.log("Can't run more than one instance");
        process.exit(1);
    } else {
        console.log(e);
    }
});
server.listen(8399, function() {
   console.log("Sentinel server running")   
});
//#endregion prevent starting multiple instances

program
  .version(pkg.version)
  .usage('-s <secret> -p <port> -id <id> -name <username> [options]')
  .option('-i, --id <id>', 'the id stored in the ~/.cncrc file')
  .option('-n, --name <name>', 'the user name stored in the ~/.cncrc file')
  .option('-s, --secret <secret>', 'the secret key stored in the ~/.cncrc file')
  .option('-p, --port <port>', 'path or name of serial port', '/dev/ttyACM0')
  .option('-b, --baudrate <baudrate>', 'baud rate', '115200')
  .option('-c, --config <filepath>', 'set the config file', '')
  .option('-o, --out-dir <path>', 'path to directory where to write output files, if not present output file is not written to disk', '')
  .option('--socket-address <address>', 'socket address or hostname', 'localhost')
  .option('--socket-port <port>', 'socket port', '8000')
  .option('--controller-type <type>', 'controller type: Grbl|Smoothie|TinyG', 'Grbl')
  .option('--access-token-lifetime <lifetime>', 'access token lifetime in seconds or a time span string', '30d')
  .option('-w, --web-widget', 'enable web widget interface')
  .option('--widget-port <port>', 'web widget port', '8190')

program.parse(process.argv)

const opts = program.opts()

var options = {
  id: opts.id,
  name: opts.name,
  secret: opts.secret,
  port: opts.port,
  baudrate: opts.baudrate,
  config: opts.config,
  outDir: opts.outDir,
  socketAddress: opts.socketAddress,
  socketPort: opts.socketPort,
  controllerType: opts.controllerType,
  accessTokenLifetime: opts.accessTokenLifetime
}

var defaults = {
  secret: process.env['CNCJS_SECRET'],
  port: '/dev/ttyACM0',
  baudrate: 115200,
  socketAddress: 'localhost',
  outDir: '',
  socketPort: 8000,
  controllerType: 'Grbl',
  accessTokenLifetime: '30d'
}

// Get secret key from the config file and generate an access token
const getUserHome = function () {
  return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME']
}

const cncrc = (opts.config) ? opts.config : path.resolve(getUserHome(), '.cncrc')
var config

const generateAccessToken = function (payload, secret, expiration) {
  const token = jwt.sign(payload, secret, {
    expiresIn: expiration
  })

  return token
}

Object.keys(options).forEach((key) => {
  if (!options[key]) {
    options[key] = defaults[key]
  }
})

if (opts.config) {
  config = JSON.parse(fs.readFileSync(cncrc, 'utf8'))
  if (!opts.port) {
    if (config.hasOwnProperty('ports') && config.ports[0] && config.ports[0].comName) {
      options.port = config.ports[0].comName
    }
  }

  if (!opts.baudrate) {
    if (config.hasOwnProperty('baudrates') && config.baudrates[0]) {
      options.baudrate = config.baudrates[0]
    }
  }

  if (!opts.controllerType) {
    if (config.hasOwnProperty('controller')) {
      options.controllerType = config.controller
    }
  }
}

if (!options.secret) {
  try {
    if (!config) {
      config = JSON.parse(fs.readFileSync(cncrc, 'utf8'))
    }
    options.secret = config.secret
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

if (!options.id && !options.name) {
  try {
    if (!config) {
      config = JSON.parse(fs.readFileSync(cncrc, 'utf8'))
    }
    if (config.users) {
      options.id = config.users[0].id
      options.name = config.users[0].name
    } else {
      options.id = undefined;
      options.name = undefined;
    }
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

const token = generateAccessToken({ id: options.id, name: options.name }, options.secret, options.accessTokenLifetime)
const url = 'ws://' + options.socketAddress + ':' + options.socketPort

let socket = ioClient.connect('ws://' + options.socketAddress + ':' + options.socketPort, {
  query: 'token=' + token,
  reconnection: true,
  reconnectionAttempts: 3,
  reconnectionDelay: 5000,
  timeout: 10000,
  transports: ['websocket']
})

socket.on('connect', () => {
  console.log('Connected to ' + url)
  // Open port
  socket.emit('open', options.port, {
    baudrate: Number(options.baudrate),
    controllerType: options.controllerType
  })
})

socket.on('error', (err) => {
  console.error('Connection error.', err)
  if (socket) {
    socket.close()
    socket = null
  }
})

socket.on('close', () => {
  console.log('Connection closed.')
})

socket.on('disconnect', (reason) => {
  console.log('Disconnected from server:', reason)
})

socket.on('reconnect_failed', () => {
  console.error(`AL: Reconnection failed after 3 attempts. Saving probe data and exiting.`)
  // The socket.io v4 reconnection is already configured with reconnectionAttempts: 3
  process.exit(1)
})

socket.on('serialport:open', function (options) {
  options = options || {}

  console.log('Connected to port "' + options.port + '" (Baud rate: ' + options.baudrate + ')')
  socket.emit('command', options.port, 'gcode', '(AL: connected)');
  callback(null, socket)
})

socket.on('serialport:error', function (options) {
  console.error('Serial port error: "' + options.port + '" - continuing without serial connection')
  // Still initialize autolevel and widget even without serial port
  callback(null, socket)
})

// eslint-disable-next-line handle-callback-err
function callback(err, socket) {

  if (err) {
    // SOME kind of error handling if an error occurs
    throw err;
  }

  let autolevel = new Autolevel(socket, options)

  // Start widget server if --web-widget flag is set
  if (opts.webWidget) {
    const WidgetServer = require('./widget-server.js');
    const widgetServer = new WidgetServer(autolevel, { port: parseInt(opts.widgetPort || '8190') });
    widgetServer.start();
  }

  socket.on('serialport:write', function (data, context) {
    if (data.indexOf('#autolevel_reapply') >= 0 && context && context.source === 'feeder') {
      autolevel.reapply(data, context)
    } else if (data.indexOf('#autolevel') >= 0 && context && context.source === 'feeder') {
      autolevel.start(data, context)
    } else if (data.indexOf('PROBEOPEN') > 0) {
      console.log(`Probe file open command: ${data}`);
      let startNdx = data.indexOf('PROBEOPEN') + 9;
      let endParen = data.indexOf(')');
      if (endParen > 0) {
        let fileName = data.substring(startNdx, endParen).trim();
        autolevel.fileOpen(fileName);
      }
    } else if (data.indexOf('PROBECLOSE') > 0) {
      console.log('Probe file close command');
      autolevel.fileClose();
    }
    else {
      autolevel.updateContext(context)
    }
  })
}
