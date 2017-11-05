'use strict'

var Config = require('../lib/config')
var Logger = require('../lib/logger')
var helpers = require('./helpers')
var path = require('path')

var sinon = require('sinon')
var chai = require('chai')
var expect = chai.expect

describe('Config', function() {
  it('should validate a valid configuration', function() {
    var configData = helpers.baseConfig(),
        config = new Config(configData)

    expect(JSON.stringify(config)).to.equal(JSON.stringify(configData))
  })

  it('should raise errors for missing required fields', function() {
    var errors = [
          'missing collection',
          'missing githubApiToken',
          'missing githubTimeout',
          'missing slackApiToken',
          'missing slackTimeout',
          'missing successReaction',
          'missing rules'
        ],
        errorMessage = 'Invalid configuration:\n  ' + errors.join('\n  ')

    expect(function() { return new Config({}) }).to.throw(Error, errorMessage)
  })

  it('should validate optional config fields', function() {
    var configData = helpers.baseConfig(),
        config
    configData.githubApiBaseUrl = 'http://localhost/github/'
    configData.slackApiBaseUrl = 'http://localhost/slack/'
    configData.rules[0].channelNames = ['hub']

    config = new Config(configData)
    expect(JSON.stringify(config)).to.equal(JSON.stringify(configData))
  })

  it('should raise errors for unknown top-level properties', function() {
    var configData = helpers.baseConfig(),
        errors = [
          'unknown property foo',
          'unknown property baz',
          'rule 0 contains unknown property xyzzy',
          'rule 3 contains unknown property quux'
        ],
        errorMessage = 'Invalid configuration:\n  ' + errors.join('\n  ')

    configData.foo = 'bar'
    configData.baz = ['quux']
    configData.rules[0].xyzzy = 'plugh'
    configData.rules.push({
      'reactionName': 'smiley',
      'target': 'mbland/slack-emoji-issues',
      'channelNames': ['hub'],
      'quux': {}
    })

    expect(function() { return new Config(configData) })
      .to.throw(Error, errorMessage)
  })

  it('should raise errors for missing required rules fields', function() {
    var configData = helpers.baseConfig(),
        errors = [
          'rule 0 missing reactionName',
          'rule 2 missing target'
        ],
        errorMessage = 'Invalid configuration:\n  ' + errors.join('\n  ')

    delete configData.rules[0].reactionName
    delete configData.rules[2].target

    expect(function() { return new Config(configData) })
      .to.throw(Error, errorMessage)
  })

  it('should load valid configuration', function() {
    var testConfig = helpers.baseConfig(),
        logger = new Logger(console),
        configPath = path.join(__dirname, 'helpers', 'test-config.json'),
        config

    sinon.stub(logger, 'info')
    config = Config.fromFile(configPath, logger)
    expect(JSON.stringify(config)).to.eql(JSON.stringify(testConfig))
    expect(logger.info.args).to.eql([
      [null, 'reading configuration from', configPath]
    ])
  })

  it('loads a valid configuration with updates', function() {
    var testConfig = helpers.baseConfig(),
        logger = new Logger(console),
        configPath = path.join(__dirname, 'helpers', 'test-config.json'),
        overrides = {
          slackApiToken: '<updated-slack-token>',
          githubApiToken: '<updated-github-token>'
        },
        config

    sinon.stub(logger, 'info')
    testConfig.slackApiToken = '<updated-slack-token>'
    testConfig.githubApiToken = '<updated-github-token>'
    config = Config.fromFile(configPath, logger, overrides)

    expect(JSON.stringify(config)).to.eql(JSON.stringify(testConfig))
    expect(logger.info.args).to.eql([
      [null, 'reading configuration from', configPath]
    ])
  })

  it('should raise an error if the config file does not exist', function() {
    var logger = new Logger(console),
        configPath = path.join(__dirname, 'nonexistent-config-file'),
        errorMessage = 'failed to load configuration: '

    sinon.stub(logger, 'info')
    expect(function() { return Config.fromFile(configPath, logger) })
      .to.throw(Error, errorMessage)
    expect(logger.info.args).to.eql([
      [null, 'reading configuration from', configPath]
    ])
  })

  it('should raise an error if the config file isn\'t valid JSON', function() {
    var logger = new Logger(console),
        errorMessage = 'failed to load configuration: invalid JSON: '

    sinon.stub(logger, 'info')
    expect(function() { return Config.fromFile(__filename, logger) })
      .to.throw(Error, errorMessage)
    expect(logger.info.args).to.eql([
      [null, 'reading configuration from', __filename]
    ])
  })

  describe('checkForMisconfiguredRules', function() {
    it('should detect when rules are not sorted by reactionName', function() {
      var configData = helpers.baseConfig(),
          errorMessage,
          NUM_SPACES = 2

      configData.rules = [
        { reactionName: 'smiley',
          target: 'hubot-slack-github-issues'
        },
        { reactionName: 'evergreen_tree',
          target: 'slack-emoji-issues',
          channelNames: ['bot-dev']
        },
        { reactionName: 'evergreen_tree',
          target: 'handbook'
        }
      ]
      errorMessage = 'Invalid configuration:\n' +
        '  rules are not sorted; expected: ' +
        JSON.stringify(helpers.baseConfig().rules, null, NUM_SPACES)
          .replace(/\n/g, '\n  ')

      expect(function() { return new Config(configData) })
        .to.throw(errorMessage)
    })

    it('should detect when rules are not sorted by channelNames', function() {
      var configData = helpers.baseConfig(),
          errorMessage,
          NUM_SPACES = 2

      configData.rules = [
        { reactionName: 'evergreen_tree',
          target: 'handbook'
        },
        { reactionName: 'evergreen_tree',
          target: 'slack-emoji-issues',
          channelNames: ['bot-dev']
        },
        { reactionName: 'smiley',
          target: 'hubot-slack-github-issues'
        }
      ]
      errorMessage = 'Invalid configuration:\n' +
        '  rules are not sorted; expected: ' +
        JSON.stringify(helpers.baseConfig().rules, null, NUM_SPACES)
          .replace(/\n/g, '\n  ')

      expect(function() { return new Config(configData) })
        .to.throw(errorMessage)
    })

    it('should detect when rules are not sorted by repository', function() {
      var correctConfig = helpers.baseConfig(),
          errorConfig = helpers.baseConfig(),
          errorMessage,
          NUM_SPACES = 2

      correctConfig.rules = [
        { reactionName: 'evergreen_tree',
          target: 'handbook',
          channelNames: ['handbook']
        },
        { reactionName: 'evergreen_tree',
          target: 'hub',
          channelNames: ['hub']
        },
        { reactionName: 'smiley',
          target: 'hubot-slack-github-issues'
        }
      ]

      errorConfig.rules = [
        correctConfig.rules[1],
        correctConfig.rules[0],
        correctConfig.rules[2]
      ]

      errorMessage = 'Invalid configuration:\n' +
        '  rules are not sorted; expected: ' +
        JSON.stringify(correctConfig.rules, null, NUM_SPACES)
          .replace(/\n/g, '\n  ')

      expect(function() { return new Config(errorConfig) })
        .to.throw(errorMessage)
    })

    it('should detect unsorted channel names', function() {
      var configData = helpers.baseConfig(),
          errorMessage

      configData.rules[0].target = 'guides'
      configData.rules[0].channelNames = ['wg-testing', 'wg-documentation']
      configData.rules[1].target = 'handbook'
      configData.rules[1].channelNames = ['hub', 'handbook']
      errorMessage = 'Invalid configuration:\n' +
        '  channelNames for evergreen_tree rule 0 are not sorted; expected:\n' +
        '    wg-documentation\n' +
        '    wg-testing\n' +
        '  channelNames for evergreen_tree rule 1 are not sorted; expected:\n' +
        '    handbook\n' +
        '    hub'
      expect(function() { return new Config(configData) })
        .to.throw(errorMessage)
    })

    it('should detect duplicate repos for same reaction', function() {
      var configData = helpers.baseConfig(),
          errorMessage

      configData.rules.forEach(function(rule) {
        rule.target = 'handbook'
      })
      errorMessage = 'Invalid configuration:\n' +
        '  duplicate repositories for evergreen_tree rules:\n' +
        '    handbook'
      expect(function() { return new Config(configData) })
        .to.throw(errorMessage)
    })

    it('should detect duplicate repos and channels for reaction', function() {
      var configData = helpers.baseConfig(),
          errorMessage

      configData.rules.forEach(function(rule) {
        rule.target = 'handbook'
        rule.channelNames = ['hub']
      })

      configData.rules[0].channelNames.unshift('handbook')
      configData.rules[1].channelNames.push('wg-documentation')
      errorMessage = 'Invalid configuration:\n' +
        '  duplicate repositories for evergreen_tree rules:\n' +
        '    handbook\n' +
        '  duplicate channels for evergreen_tree rules:\n' +
        '    hub'
      expect(function() { return new Config(configData) })
        .to.throw(errorMessage)
    })

    it('should detect multiple all-channel rules for reaction', function() {
      var configData = helpers.baseConfig(),
          errorMessage

      configData.rules[0].target = 'handbook'
      delete configData.rules[0].channelNames
      configData.rules[1].target = 'hub'

      errorMessage = 'Invalid configuration:\n' +
        '  multiple all-channel rules defined for evergreen_tree'
      expect(function() { return new Config(configData) })
        .to.throw(errorMessage)
    })
  })
})
