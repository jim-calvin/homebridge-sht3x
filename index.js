const os = require('os')

const moment = require('moment')
const SHT3xSensor = require('raspi-node-sht31')

const {version: packageVersion} = require('./package.json')

let Accessory, Service, Characteristic
let FakeGatoHistoryService

class SHT3xAccessory {
  constructor (log, config) {
    this.log = log
    this.displayName = config.name
    this.category = Accessory.Categories.SENSOR
    this.interval = config.interval || 60
    this.historyOptions = config.history || {}
    this.temperatureCalibration = config.temperatureCalibration || 0
    this.humidityCalibration = config.humidityCalibration || 0
    this.dewpointEnabled = config.dewpointEnabled || false

	this.log(`Temperature calibration: ${this.temperatureCalibration}, Humidity calibration: ${this.humidityCalibration}, dewpointEnabled: ${this.dewpointEnabled}`)
    const address = parseInt(config.address, 16) || 0x44
    const bus = config.bus || 1

    this.log(`Expecting SHT3x I²C sensor at address 0x${address.toString(16)} on bus ${bus}`)
    this.sensor = new SHT3xSensor(address, bus)
  }

  calculateDewpoint(temperature, humidity) {
	return (humidity/100.0)**0.125*(112.0+0.9*temperature) + 0.1*temperature-112.0
  }
  
  pollSensorData () {
    this.sensor.readSensorData().then((data) => {
      var {temperature, humidity} = data
      temperature = temperature + this.temperatureCalibration
      humidity = humidity + this.humidityCalibration
	  if (this.dewpointEnabled) {
	    const dewpoint = this.calculateDewpoint(temperature, humidity)
        this.log(`Humidity: ${humidity.toFixed(2)}%, Temperature: ${temperature.toFixed(2)}°C, Dewpoint: ${dewpoint.toFixed(2)}°C`)
        this.historyService.addEntry({time: moment().unix(), temp: temperature, humidity: humidity, dewpoint: dewpoint})
    } else {
        this.log(`Humidity: ${humidity.toFixed(2)}%, Temperature: ${temperature.toFixed(2)}°C`)
        this.historyService.addEntry({time: moment().unix(), temp: temperature, humidity: humidity})
      }

      this.data = data
    }).catch(err => this.log(err.message))
  }

  getSensorData (dataFunction, callback) {
    if (this.data === undefined) {
      callback(new Error('No data'))
    } else {
      callback(null, dataFunction(this.data))
    }
  }

  getDewPoint (dataFunction, callback) {
    this.sensor.readSensorData().then((data) => {
      var {temperature, humidity} = data
      if (this.data === undefined) {
        callback(new Error('No data'))
      } else {
        temperature = temperature + this.temperatureCalibration
        humidity = humidity + this.humidityCalibration
        const dewpoint = this.calculateDewpoint(temperature, humidity)
        callback(null, dataFunction(dewpoint))
      }
      }).catch(err => this.log(err.message))
  }

  getServices () {
    const informationService = new Service.AccessoryInformation()
    informationService
      .setCharacteristic(Characteristic.Manufacturer, 'Sensirion')
      .setCharacteristic(Characteristic.Model, 'SHT3x')
      .setCharacteristic(Characteristic.SerialNumber, `${os.hostname()}-${this.displayName}`)
      .setCharacteristic(Characteristic.FirmwareRevision, packageVersion)

    const temperatureService = new Service.TemperatureSensor("Temperature", "temperatureService")
    temperatureService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({minValue: -40, maxValue: 125})
      .on('get', this.getSensorData.bind(this, data => data.temperature))

    const humidityService = new Service.HumiditySensor("Humidity", "humidityService")
    humidityService
      .getCharacteristic(Characteristic.CurrentRelativeHumidity)
      .on('get', this.getSensorData.bind(this, data => data.humidity))

    var dewPointService
    if (this.dewpointEnabled) {
      dewPointService = new Service.TemperatureSensor('Dew Point', 'dewPointService')
      dewPointService
        .getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({minValue: -40, maxValue: 125})
        .on('get', this.getDewPoint.bind(this, data => data))
    }

    humidityService.isPrimaryService = true
    humidityService.linkedServices = [temperatureService]

    this.historyService = new FakeGatoHistoryService('weather', this, this.historyOptions)

    setInterval(this.pollSensorData.bind(this), this.interval * 1000)
    this.pollSensorData()

	var services = [informationService, temperatureService, humidityService, this.historyService]
	if (this.dewpointEnabled) {
	  services = [informationService, temperatureService, humidityService, dewPointService, this.historyService]
	}
    return services
  }
}

module.exports = (homebridge) => {
  ({Accessory, Service, Characteristic} = homebridge.hap)
  FakeGatoHistoryService = require('fakegato-history')(homebridge)

  homebridge.registerAccessory('homebridge-sht3x', 'SHT3x', SHT3xAccessory)
}
