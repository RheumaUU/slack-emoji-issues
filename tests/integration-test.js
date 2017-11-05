'use strict'

require('coffee-script/register')
var Helper = require('hubot-test-helper')
var scriptHelper = new Helper('../hubot/slack-github-issues.js')
var User = require('@slack/client/lib/models/user')
var ReactionMessage = require('hubot-slack/src/reaction-message')

var SlackRtmDataStore = require('../lib/slack-rtm-data-store.js')
var Channel = require('@slack/client/lib/models/channel')
var LogHelper = require('./helpers/log-helper')
var ApiStubServer = require('./helpers/api-stub-server.js')
var helpers = require('./helpers')
var temp = require('temp')
var fs = require('fs')
var path = require('path')
var scriptName = require('../package.json').name
var chai = require('chai')
var chaiAsPromised = require('chai-as-promised')

// The Robot.react method is defined in the hubot-slack adapter package. We need
// to make sure the function definition executes before executing the script.
require('hubot-slack')

chai.should()
chai.use(chaiAsPromised)

describe('Integration test', function() {
  var room, listenerResult, logHelper, apiStubServer, config,
      apiServerDefaults, reactionAddedMessage, patchListenerImpl, sendReaction,
      initLogMessages, wrapInfoMessages,
      matchingRule = 'reactionName: evergreen_tree, ' +
        'githubRepository: slack-github-issues, ' +
        'channelNames: bot-dev'

  before(function() {
    apiStubServer = new ApiStubServer()
    process.env.HUBOT_SLACK_TOKEN = '<hubot-slack-api-token>'
    process.env.HUBOT_GITHUB_TOKEN = '<hubot-github-api-token>'
    delete process.env.HUBOT_LOG_LEVEL
    config = helpers.baseConfig()
    config.slackApiBaseUrl = apiStubServer.address() + '/slack/'
    config.githubApiBaseUrl = apiStubServer.address() + '/github/'

    return new Promise(function(resolve, reject) {
      temp.open(scriptName + '-integration-test-config-', function(err, info) {
        if (err) {
          return reject(err)
        }
        fs.write(info.fd, JSON.stringify(config), function(err) {
          if (err) {
            reject(err)
          }
        })
        fs.close(info.fd, function(err) {
          if (!err) {
            process.env.HUBOT_SLACK_GITHUB_ISSUES_CONFIG_PATH = info.path
            resolve()
          }
          reject(err)
        })
      })
    })
  })

  after(function() {
    var configPath = process.env.HUBOT_SLACK_GITHUB_ISSUES_CONFIG_PATH

    apiStubServer.close()
    delete process.env.HUBOT_SLACK_TOKEN
    delete process.env.HUBOT_GITHUB_TOKEN
    delete process.env.HUBOT_SLACK_GITHUB_ISSUES_CONFIG_PATH
    return new Promise(function(resolve, reject) {
      fs.unlink(configPath, function(err) {
        !err ? resolve() : reject(err)
      })
    })
  })

  beforeEach(function() {
    logHelper = new LogHelper()
    logHelper.capture(function() {
      room = scriptHelper.createRoom({ httpd: false, name: 'bot-dev' })
      listenerResult = new Promise(function(resolve, reject) {
        room.robot.on('reaction_added', function(result) {
          result.err ? reject(result.err) : resolve(result.created)
        })
      })
    })
    patchListenerImpl(room)
    apiStubServer.urlsToResponses = apiServerDefaults()
  })

  apiServerDefaults = function() {
    var metadata = helpers.metadata()

    return {
      '/slack/reactions.get': {
        expectedParams: {
          channel: helpers.CHANNEL_ID,
          timestamp: helpers.TIMESTAMP,
          token: process.env.HUBOT_SLACK_TOKEN
        },
        statusCode: 200,
        payload: helpers.getReactionsResponse()
      },
      '/github/repos/mbland/slack-github-issues/issues': {
        expectedParams: {
          title: metadata.title,
          body: metadata.url
        },
        statusCode: 200,
        payload: {
          'html_url': helpers.ISSUE_URL
        }
      },
      '/slack/reactions.add': {
        expectedParams: {
          channel: helpers.CHANNEL_ID,
          timestamp: helpers.TIMESTAMP,
          name: config.successReaction,
          token: process.env.HUBOT_SLACK_TOKEN
        },
        statusCode: 200,
        payload: { ok: true }
      }
    }
  }

  reactionAddedMessage = function(userName, reaction) {
    var user, itemUser, message
    message = helpers.reactionAddedMessage()

    // https://api.slack.com/types/user
    // node_modules/hubot-slack/src/bot.coffee
    user = new User({ id: message.user, name: userName })
    user.room = message.item.channel
    itemUser = new User({ id: message.item_user, name: 'rando' })

    // node_modules/hubot-slack/src/reaction-message.coffee
    message = new ReactionMessage(message.type, user, message.reaction,
      itemUser, message.item, message.event_ts)
    message.reaction = reaction
    return message
  }

  patchListenerImpl = function(room) {
    var listener, callback

    listener = room.robot.listeners[0]
    callback = listener.callback
    callback.impl.slackClient.dataStore = new SlackRtmDataStore({
      dataStore: {
        getChannelById: function(channelId) {
          return new Channel({ id: channelId, name: 'bot-dev' })
        },
        teams: {
          T19845150: { domain: 'mbland' }
        }
      },
      activeTeamId: 'T19845150'
    })
  }

  initLogMessages = function() {
    return [
      'INFO reading configuration from ' +
        process.env.HUBOT_SLACK_GITHUB_ISSUES_CONFIG_PATH,
      'INFO listening for reaction_added events'
    ]
  }

  wrapInfoMessages = function(messages) {
    return messages.map(function(message) {
      return 'INFO ' + helpers.MESSAGE_ID + ': ' + message
    })
  }

  sendReaction = function(reaction) {
    return new Promise(
      function(resolve) {
        logHelper.beginCapture()
        room.robot.receive(reactionAddedMessage('mbland', reaction), resolve)
      })
      .then(function() { return listenerResult })
      .then(helpers.resolveNextTick, helpers.rejectNextTick)
      .then(logHelper.endCaptureResolve(), logHelper.endCaptureReject())
  }

  it('should successfully load the application script', function() {
    logHelper.filteredMessages().should.eql(initLogMessages())
  })

  it('should not register if the config file is invalid', function() {
    var origPath = process.env.HUBOT_SLACK_GITHUB_ISSUES_CONFIG_PATH,
        invalidConfigPath = path.join(
          __dirname, 'helpers', 'test-config-invalid.json')

    try {
      process.env.HUBOT_SLACK_GITHUB_ISSUES_CONFIG_PATH = invalidConfigPath
      logHelper = new LogHelper()
      logHelper.capture(function() {
        room = scriptHelper.createRoom({ httpd: false, name: 'bot-dev' })
      })
      logHelper.filteredMessages().should.eql([
        'INFO reading configuration from ' + invalidConfigPath,
        'ERROR reaction_added listener registration failed: ' +
          'failed to load configuration: Invalid configuration:'
      ])
      logHelper.messages[logHelper.messages.length - 1].should.have.string(
        'Invalid configuration:\n  missing rules')

    } finally {
      process.env.HUBOT_SLACK_GITHUB_ISSUES_CONFIG_PATH = origPath
    }
  })

  it('should create a GitHub issue given a valid reaction', function() {
    return sendReaction(helpers.REACTION).should.be.fulfilled.then(function() {
      room.messages.should.eql([
        ['hubot', '@mbland created: ' + helpers.ISSUE_URL]
      ])
      logHelper.filteredMessages().should.eql(
        initLogMessages().concat(wrapInfoMessages([
          'processing: ' + helpers.PERMALINK,
          'matches rule: ' + matchingRule,
          'getting reactions',
          'filing GitHub issue in mbland/slack-github-issues',
          'adding ' + config.successReaction,
          'created: ' + helpers.ISSUE_URL
        ]))
      )
    })
  })

  it('should fail to create a GitHub issue', function() {
    var payload = { message: 'test failure' },
        url = '/github/repos/mbland/slack-github-issues/issues',
        response = apiStubServer.urlsToResponses[url],
        errorReply = 'failed to create a GitHub issue: ' +
          'received 500 response from GitHub API: ' + JSON.stringify(payload)

    response.statusCode = 500
    response.payload = payload
    return sendReaction(helpers.REACTION).should.be.rejectedWith(errorReply)
      .then(function() {
        var logMessages

        room.messages.should.eql([
          ['hubot', '@mbland ' + errorReply]
        ])

        logMessages = initLogMessages().concat(wrapInfoMessages([
          'processing: ' + helpers.PERMALINK,
          'matches rule: ' + matchingRule,
          'getting reactions',
          'filing GitHub issue in mbland/slack-github-issues'
        ]))
        logMessages.push('ERROR ' + helpers.MESSAGE_ID + ': ' + errorReply)
        logHelper.filteredMessages().should.eql(logMessages)
      })
  })

  it('should ignore a message receiving an unknown reaction', function() {
    Object.keys(apiStubServer.urlsToResponses).forEach(function(url) {
      var response = apiStubServer.urlsToResponses[url]

      response.statusCode = 500
      response.payload = { message: 'should not happen' }
    })

    return sendReaction('sad-face').should.become(null).then(function() {
      room.messages.should.eql([])
      logHelper.filteredMessages().should.eql(initLogMessages())
    })
  })
})
