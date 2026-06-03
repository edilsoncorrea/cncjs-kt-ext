/* eslint-disable no-useless-escape */
const EventEmitter = require('events')
const SocketWrap = require('./socketwrap')
const fs = require('fs')
const ProbeStateMachine = require('./probe-state-machine.js')

const alFileNamePrefix = '#AL:'

const DEFAULT_PROBE_FILE = '__last_Z_probe.txt';

const Units = {
  MILLIMETERS: 1,
  INCHES: 2,

  convert: function (value, in_units, out_units) {
    if (in_units == out_units) {
      return value;
    }
    if (in_units == this.MILLIMETERS && out_units == this.INCHES) {
      return value / 25.4;
    }
    if (in_units == this.INCHES && out_units == this.MILLIMETERS) {
      return value * 25.4;
    }
  }
}

Object.freeze(Units);

module.exports = class Autolevel {
  constructor(socket, options) {
    this.events = new EventEmitter()
    this.gcodeFileName = ''
    this.gcode = ''
    this.sckw = new SocketWrap(socket, options.port)
    this.outDir = options.outDir;
    this.delta = 10.0 // step
    this.feed = 50 // probing feedrate
    this.height = 2 // travelling height
    this.probedPoints = []
    this.min_dz = 0;
    this.max_dz = 0;
    this.sum_dz = 0;
    this.planedPointCount = 0
    this.probesPerPoint = 1
    this.probeStateMachine = null
    this.probeFile = 0;
    this.wco = {
      x: 0,
      y: 0,
      z: 0
    }

    // Try to read in any pre-existing probe data...
    try {
      const data = fs.readFileSync(DEFAULT_PROBE_FILE, 'utf8')
      console.log(`Loading previous probe from ${DEFAULT_PROBE_FILE}`)
      this.probedPoints = []
      let lines = data.split('\n')
      let invalidLines = 0
      lines.forEach(line => {
        let vals = line.trim().split(/\s+/)
        if (vals.length >= 3) {
          let x = parseFloat(vals[0])
          let y = parseFloat(vals[1])
          let z = parseFloat(vals[2])
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            this.probedPoints.push({ x, y, z })
          } else {
            invalidLines++
          }
        }
      })

      if (invalidLines > 0) {
        console.log(`WARNING: ${invalidLines} lines with invalid data were skipped`)
      }

      // Validate minimum 3 non-colinear points
      if (this.probedPoints.length >= 3) {
        let hasNonColinear = false
        for (let i = 2; i < this.probedPoints.length; i++) {
          let v1 = { x: this.probedPoints[1].x - this.probedPoints[0].x, y: this.probedPoints[1].y - this.probedPoints[0].y, z: 0 }
          let v2 = { x: this.probedPoints[i].x - this.probedPoints[0].x, y: this.probedPoints[i].y - this.probedPoints[0].y, z: 0 }
          if (Math.abs(v1.x * v2.y - v1.y * v2.x) > 0.00001) {
            hasNonColinear = true
            break
          }
        }
        if (!hasNonColinear) {
          console.log('ERROR: All probed points are colinear. Discarding data.')
          this.probedPoints = []
        } else {
          console.log(`Read ${this.probedPoints.length} valid probed points from previous session`)
        }
      } else if (this.probedPoints.length > 0) {
        console.log(`WARNING: Only ${this.probedPoints.length} points loaded (minimum 3 non-colinear required for compensation)`)
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.log(`Failed to read probe data: ${err.message}`)
      }
      // File doesn't exist or can't be read - start without probe data
      this.probedPoints = []
    }

    socket.on('gcode:load', (file, gc) => {
      if (!file.startsWith(alFileNamePrefix)) {
        this.gcodeFileName = file
        this.gcode = gc
        console.log('gcode loaded:', file)
        this.events.emit('gcode:changed', { loaded: true, fileName: file, bounds: null })
      }
    })

    socket.on('gcode:unload', () => {
      this.gcodeFileName = ''
      this.gcode = ''
      console.log('gcode unloaded')
      this.events.emit('gcode:changed', { loaded: false, fileName: '', bounds: null })
    })

    socket.on('serialport:read', (data) => {
      if (data.indexOf('PRB') >= 0) {
        let prbm = /\[PRB:([\+\-\.\d]+),([\+\-\.\d]+),([\+\-\.\d]+),?([\+\-\.\d]+)?:(\d)\]/g.exec(data)
        if (prbm) {
          let prb = [parseFloat(prbm[1]), parseFloat(prbm[2]), parseFloat(prbm[3])]
          let pt = {
            x: prb[0] - this.wco.x,
            y: prb[1] - this.wco.y,
            z: prb[2] - this.wco.z
          }

          // Check probe success flag
          let probeSuccess = parseInt(prbm[5])
          if (!probeSuccess && this.planedPointCount > 0) {
            // Probe failed - retract and abort
            console.log('AL: Probe FAILED at point ' + (this.probedPoints.length + 1))
            this.events.emit('probe:error', { message: 'Probe failed', pointIndex: this.probedPoints.length + 1 })
            this.sckw.sendGcode(`G0 Z${this.height}`)
            this.sckw.sendGcode(`(AL: ERROR - Probe failed at point ${this.probedPoints.length + 1}, X:${pt.x.toFixed(3)} Y:${pt.y.toFixed(3)}. Aborting.)`)
            this.planedPointCount = 0
            this.wco = { x: 0, y: 0, z: 0 }
            return
          }

          if (this.probeFile) {
            // Write the results to the probe file. Use 9 point format for compatibility
            // with LinuxCNC probe file format
            try {
              fs.writeSync(this.probeFile, `${pt.x} ${pt.y} ${pt.z} 0 0 0 0 0 0\n`);
            } catch (err) {
              console.log(`AL: Error writing to probe file: ${err.message}`)
              this.sckw.sendGcode(`(AL: WARNING - Error writing probe file: ${err.message})`)
            }
          }

          if (this.planedPointCount > 0) {
            if (this.probeStateMachine && this.probesPerPoint > 1) {
              // Multi-probe mode: use ProbeStateMachine
              let result = this.probeStateMachine.addMeasurement(pt.x, pt.y, pt.z)

              if (result.pointComplete) {
                // Point fully measured — update stats and push averaged point
                let avgPt = result.point
                if (this.probedPoints.length === 0) {
                  this.min_dz = avgPt.z;
                  this.max_dz = avgPt.z;
                  this.sum_dz = avgPt.z;
                } else {
                  if (avgPt.z < this.min_dz) this.min_dz = avgPt.z;
                  if (avgPt.z > this.max_dz) this.max_dz = avgPt.z;
                  this.sum_dz += avgPt.z;
                }
                this.probedPoints.push(avgPt)

                this.events.emit('probe:point', { index: this.probedPoints.length, total: this.planedPointCount, x: avgPt.x, y: avgPt.y, z: avgPt.z })

                console.log('probed point ' + this.probedPoints.length + '/' + this.planedPointCount + ' (N=' + this.probesPerPoint + ')>', avgPt.x.toFixed(3), avgPt.y.toFixed(3), avgPt.z.toFixed(3))

                if (result.allComplete) {
                  this.sckw.sendGcode(`(AL: dz_min=${this.min_dz.toFixed(3)}, dz_max=${this.max_dz.toFixed(3)}, dz_avg=${(this.sum_dz / this.probedPoints.length).toFixed(3)})`);
                  if (this.probeFile) {
                    this.fileClose();
                  }
                  if (!this.probeOnly) {
                    this.applyCompensation()
                  }
                  this.events.emit('probe:complete', { minZ: this.min_dz, maxZ: this.max_dz, avgZ: this.sum_dz / this.probedPoints.length, count: this.probedPoints.length, success: true })
                  this.planedPointCount = 0
                  this.wco = { x: 0, y: 0, z: 0 }
                }
              } else {
                // Need more measurements for this point — emit re-probe commands
                console.log('probe measurement ' + this.probeStateMachine.currentMeasurements.length + '/' + this.probesPerPoint + ' for point ' + (this.probedPoints.length + 1) + '>', pt.x.toFixed(3), pt.y.toFixed(3), pt.z.toFixed(3))
                let cmds = this.probeStateMachine.getRepeatProbeCommands(pt.x, pt.y, this.height, this.feed)
                this.sckw.sendGcode(cmds)
              }
            } else {
              // Single-probe mode (N=1): original behavior
              if (this.probedPoints.length === 0) {
                this.min_dz = pt.z;
                this.max_dz = pt.z;
                this.sum_dz = pt.z;
              } else {
                if (pt.z < this.min_dz) this.min_dz = pt.z;
                if (pt.z > this.max_dz) this.max_dz = pt.z;
                this.sum_dz += pt.z;
              }
              this.probedPoints.push(pt)

              this.events.emit('probe:point', { index: this.probedPoints.length, total: this.planedPointCount, x: pt.x, y: pt.y, z: pt.z })

              console.log('probed ' + this.probedPoints.length + '/' + this.planedPointCount + '>', pt.x.toFixed(3), pt.y.toFixed(3), pt.z.toFixed(3))
              // send info to console
              if (this.probedPoints.length >= this.planedPointCount) {
                this.sckw.sendGcode(`(AL: dz_min=${this.min_dz.toFixed(3)}, dz_max=${this.max_dz.toFixed(3)}, dz_avg=${(this.sum_dz / this.probedPoints.length).toFixed(3)})`);
                if (this.probeFile) {
                  this.fileClose();
                }
                if (!this.probeOnly) {
                  this.applyCompensation()
                }
                this.events.emit('probe:complete', { minZ: this.min_dz, maxZ: this.max_dz, avgZ: this.sum_dz / this.probedPoints.length, count: this.probedPoints.length, success: true })
                this.planedPointCount = 0
                this.wco = { x: 0, y: 0, z: 0 }
              }
            }
          }
        }
      }
    })

    //  this.socket.emit.apply(socket, ['write', this.port, "gcode", "G91 G1 Z1 F1000"]);
  }

  fileOpen(fileName) {
    try {
      this.probeFile = fs.openSync(fileName, "w");
      console.log(`Opened probe file ${fileName}`);
      this.sckw.sendGcode(`(AL: Opened probe file ${fileName})`)
    }
    catch (err) {
      this.probeFile = 0;
      this.sckw.sendGcode(`(AL: Could not open probe file ${err})`)
    }
  }

  fileClose() {
    if (this.probeFile) {
      console.log('Closing probe file');
      fs.closeSync(this.probeFile);
      this.probeFile = 0;
    }
  }

  reapply(cmd, context) {
    if (!this.gcode) {
      this.sckw.sendGcode('(AL: no gcode loaded)')
      return
    }
    if (this.probedPoints.length < 3) {
      this.sckw.sendGcode('(AL: no previous autolevel points)')
      return;
    }
    this.applyCompensation();
  }

  start(cmd, context) {
    console.log(cmd, context)

    // A parameter of P1 indicates a "probe only", and that
    // the results should NOT be applied to any loaded GCode.
    // The default value is "false"
    this.probeOnly = 0;
    let p = /P([\.\+\-\d]+)/gi.exec(cmd)
    if (p) this.probeOnly = parseFloat(p[1])

    // N parameter: number of probes per point (1-10, default 1)
    let n = /N([\.\+\-\d]+)/gi.exec(cmd)
    if (n) this.probesPerPoint = Math.max(1, Math.min(10, parseInt(n[1])))
    else this.probesPerPoint = 1

    if (!this.gcode) {
      this.sckw.sendGcode('(AL: no gcode loaded)')
      if (!this.probeOnly) {
        return
      }
    }

    if (!this.probeFile) {
      // Since no explicit command was given to open the probe recording
      // file, record the probe entries to be reused (in case of system
      // restart)
      this.fileOpen(DEFAULT_PROBE_FILE);
    }

    this.sckw.sendGcode('(AL: auto-leveling started)')
    let m = /D([\.\+\-\d]+)/gi.exec(cmd)
    if (m) this.delta = parseFloat(m[1])

    let h = /H([\.\+\-\d]+)/gi.exec(cmd)
    if (h) this.height = parseFloat(h[1])

    // Validate Z position before proceeding (collision protection)
    if (context === undefined || context === null || context.posz === undefined) {
      this.sckw.sendGcode('(AL: ERROR - Cannot verify Z position, aborting)')
      return
    }

    if (context.posz < this.height) {
      this.sckw.sendGcode(`(AL: ERROR - Current Z position (${context.posz.toFixed(3)}) is below travel height (${this.height.toFixed(3)}). Move Z up before starting autolevel.)`)
      return
    }

    // Parse FXY and FZ first (more specific), then F (generic)
    let fxyMatch = /FXY([\.\+\-\d]+)/gi.exec(cmd)
    let fzMatch = /FZ([\.\+\-\d]+)/gi.exec(cmd)

    // Parse F — need to match F that is NOT followed by Z or XY
    let cmdForF = cmd.replace(/FXY[\.\+\-\d]+/gi, '').replace(/FZ[\.\+\-\d]+/gi, '')
    let f = /F([\.\+\-\d]+)/gi.exec(cmdForF)
    if (f) this.feed = parseFloat(f[1])

    // FZ: feed for Z up moves (default = same as F)
    this.feedUp = fzMatch ? parseFloat(fzMatch[1]) : this.feed

    // FXY: feed for XY travel moves (default = same as F)
    this.feedXY = fxyMatch ? parseFloat(fxyMatch[1]) : this.feed

    let margin = this.delta / 4;

    let mg = /M([\.\+\-\d]+)/gi.exec(cmd)
    if (mg) margin = parseFloat(mg[1])


    let xSize, ySize;
    let xs = /X([\.\+\-\d]+)/gi.exec(cmd)
    if (xs) xSize = parseFloat(xs[1])

    let ys = /Y([\.\+\-\d]+)/gi.exec(cmd)
    if (ys) ySize = parseFloat(ys[1])

    let area;
    if (xSize) {
      area = `(${xSize}, ${ySize})`
    }
    else {
      area = 'Not specified'
    }
    console.log(`STEP: ${this.delta} mm HEIGHT:${this.height} mm FEED:${this.feed} MARGIN: ${margin} mm  PROBE ONLY:${this.probeOnly}  Area: ${area}`)

    this.wco = {
      x: context.mposx - context.posx,
      y: context.mposy - context.posy,
      z: context.mposz - context.posz
    }
    this.probedPoints = []
    this.planedPointCount = 0
    console.log('WCO:', this.wco)
    let code = []

    let xmin, xmax, ymin, ymax;
    if (xSize) {
      xmin = margin;
      xmax = xSize - margin;
    }
    else {
      xmin = context.xmin + margin;
      xmax = context.xmax - margin;
    }

    if (ySize) {
      ymin = margin;
      ymax = ySize - margin;
    }
    else {
      ymin = context.ymin + margin;
      ymax = context.ymax - margin;
    }

    // Guard against division by zero: if range <= delta, use a single point at midpoint
    let dx, dy
    let singlePointX = false
    let singlePointY = false

    if ((xmax - xmin) <= this.delta) {
      // Range is smaller than or equal to delta: use single midpoint
      dx = xmax - xmin
      let midX = (xmin + xmax) / 2
      xmin = midX
      xmax = midX
      singlePointX = true
    } else {
      let nx = parseInt((xmax - xmin) / this.delta)
      dx = (xmax - xmin) / nx
    }

    if ((ymax - ymin) <= this.delta) {
      // Range is smaller than or equal to delta: use single midpoint
      dy = ymax - ymin
      let midY = (ymin + ymax) / 2
      ymin = midY
      ymax = midY
      singlePointY = true
    } else {
      let ny = parseInt((ymax - ymin) / this.delta)
      dy = (ymax - ymin) / ny
    }

    // Validate that dx and dy are finite numbers
    if (!Number.isFinite(dx)) {
      this.sckw.sendGcode('(AL: error - invalid dx value on X axis: NaN or Infinity)')
      console.log('AL: error - dx is not finite on X axis')
      return
    }
    if (!Number.isFinite(dy)) {
      this.sckw.sendGcode('(AL: error - invalid dy value on Y axis: NaN or Infinity)')
      console.log('AL: error - dy is not finite on Y axis')
      return
    }

    code.push('(AL: probing initial point)')
    code.push(`G21`)
    code.push(`G90`)
    code.push(`G1 Z${this.height} F${this.feedUp}`)
    code.push(`G1 X${xmin.toFixed(3)} Y${ymin.toFixed(3)} F${this.feedXY}`)
    code.push(`G38.2 Z-${this.height + 1} F${this.feed / 2}`)
    code.push(`G10 L20 P1 Z0`) // set the z zero
    code.push(`G1 Z${this.height} F${this.feedUp}`)
    this.planedPointCount++

    let y = ymin - dy

    while (y < ymax - 0.01) {
      y += dy
      if (y > ymax) y = ymax
      let x = xmin - dx
      if (y <= ymin + 0.01) x = xmin // don't probe first point twice

      while (x < xmax - 0.01) {
        x += dx
        if (x > xmax) x = xmax
        // Validate that generated coordinates are finite
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          this.sckw.sendGcode(`(AL: error - generated non-finite coordinate X:${x} Y:${y})`)
          console.log(`AL: error - non-finite coordinate generated X:${x} Y:${y}`)
          return
        }
        code.push(`(AL: probing point ${this.planedPointCount + 1})`)
        code.push(`G90 G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${this.feedXY}`)
        code.push(`G38.2 Z-${this.height + 1} F${this.feed}`)
        code.push(`G1 Z${this.height} F${this.feedUp}`)
        this.planedPointCount++
      }
    }
    this.probeStateMachine = new ProbeStateMachine(this.probesPerPoint, this.planedPointCount)

    // Send probing summary
    const estimatedTime = this.planedPointCount * ((this.height + 1) / this.feed + (dx + dy) / 1000) // rough estimate in minutes
    this.sckw.sendGcode(`(AL: Summary - Points: ${this.planedPointCount}, Area: X[${xmin.toFixed(1)}..${xmax.toFixed(1)}] Y[${ymin.toFixed(1)}..${ymax.toFixed(1)}], Delta: ${this.delta}mm, Feed: ${this.feed}mm/min, Est.time: ${estimatedTime.toFixed(1)}min)`)
    console.log(`AL Summary: ${this.planedPointCount} points, area X[${xmin.toFixed(1)}..${xmax.toFixed(1)}] Y[${ymin.toFixed(1)}..${ymax.toFixed(1)}], delta=${this.delta}mm, feed=${this.feed}mm/min, est.time=${estimatedTime.toFixed(1)}min`)

    this.events.emit('probe:start', { totalPoints: this.planedPointCount, params: { delta: this.delta, height: this.height, feed: this.feed, margin, probesPerPoint: this.probesPerPoint } })

    this.sckw.sendGcode(code.join('\n'))
  }

  updateContext(context) {
    if (this.wco.z != 0 &&
      context.mposz !== undefined &&
      context.posz !== undefined) {
      let wcoz = context.mposz - context.posz;
      if (Math.abs(this.wco.z - wcoz) > 0.00001) {
        this.wco.z = wcoz;
        console.log('WARNING: WCO Z offset drift detected! wco.z is now: ' + this.wco.z);
      }
    }
  }

  applyCompensation() {
    this.sckw.sendGcode('(AL: applying ...)')
    console.log('applying compensation ...')
    try {
      const ArcLinearizer = require('./arc-linearizer.js')
      const GCodeCompensator = require('./gcode-compensator.js')

      const arcLinearizer = new ArcLinearizer(this.delta / 2)
      const compensator = new GCodeCompensator(this.probedPoints, this.delta, arcLinearizer)

      const outputGCode = compensator.process(this.gcode, (lineCount, totalLines) => {
        console.log(`progress info ... line: ${lineCount}/${totalLines}`)
        this.sckw.sendGcode(`(AL: progress ... ${lineCount}/${totalLines})`)
      })

      const newgcodeFileName = alFileNamePrefix + this.gcodeFileName
      this.sckw.sendGcode(`(AL: loading new gcode ${newgcodeFileName} ...)`)
      console.log(`AL: loading new gcode ${newgcodeFileName} ...)`)
      this.sckw.loadGcode(newgcodeFileName, outputGCode)
      if (this.outDir) {
        const outputFile = this.outDir + '/' + newgcodeFileName
        fs.writeFileSync(outputFile, outputGCode)
        this.sckw.sendGcode(`(AL: output file written to ${outputFile})`)
        console.log(`output file written to ${outputFile}`)
      }
      this.sckw.sendGcode('(AL: finished)')
    } catch (x) {
      this.sckw.sendGcode(`(AL: error occurred ${x})`)
      console.log(`error occurred ${x}`)
    }
    console.log('Leveling applied')
  }
}
