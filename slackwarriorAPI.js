'use strict'
const moment = require('moment');
const request = require('request');
const Promise = require('bluebird');
Promise.promisifyAll(require('request'));

const taskFunctions = require('./slackwarriorTaskFunctions');
const messages = require('./slackwarriorMessages');

// function to compare tasks by urgency
function compareTasks(a, b) {
  if (a.urgency > b.urgency) {
    return -1;
  } else if (a.urgency < b.urgency) {
    return 1;
  }
  return 0;
}

// basic settings for an inthe.am API call
function prepareAPI(api, method, token) {
  return {
    async: true,
    json: true,
    crossDomain: true,
    url: `https://inthe.am/api/v2/${api}/`,
    method,
    headers: {
      authorization: `Token ${token}`,
      'cache-control': 'no-cache',
      'Content-Type': 'application/json',
      Referer: 'https://inthe.am/',
    },
    data: '',
    processData: false,
  }
}

// wrapper function for API requests to inthe.am
function apiRequest(bot, message, settings, cb) {
  request(settings, (err, response, body) => {
    const rc = response.statusCode;

    // if this was not a success
    if (rc !== 200 && rc !== 201) {
      bot.botkit.log('API request error - err', err)
      bot.botkit.log('API request error - res', response)
      bot.botkit.log('API request error - body', body)
      // remove the thinking_face reaction again
      bot.removeReaction(message, 'thinking_face')
    }
    // general error occured
    if (err || !rc) {
      bot.reply(message, messages.randomErrorMessage())
    // malformed request, see error details
    } else if (rc === 400) {
      bot.reply(message, 'I\'m sorry, but it looks like inthe.am had some trouble with that :confused:')
      bot.reply(message, 'Maybe their message(s) can help you narrowing it down?')
      for (var prop in body) {
        if (body.hasOwnProperty(prop)) {
          bot.reply(message, `\`${prop}\` : ${body[prop].join(' ')}`)
        }
      }
    // entity does not exist
    } else if (rc === 404) {
      bot.reply(message, 'I\'m sorry, but it looks like that task doesn\'t even exist? :confused:')
    // repo locked
    } else if (rc === 409) {
      bot.reply(message, 'I\'m sorry, but it looks like your repository is locked. You should check on inthe.am for more information...')
    // inthe.am server error
    } else if (rc === 500) {
      bot.reply(message, 'I\'m sorry, but it looks like inthe.am is having some troubles right now. The error has been logged and the admins have been notified. Please try again in a little while.')
    // auth
    } else if (rc === 401 || rc === 403) {
      const answer = { channel: message.channel, text: 'Oops, that didn\'t work. Looks like I remember your token wrong. If you want to tell me your token please ask me about `onboarding` or just tap on the :computer: now.', as_user: true }
      bot.api.chat.postMessage(answer, (postErr, postResponse) => {
        if (!postErr) {
          bot.addReaction(postResponse, 'computer')
        }
      })
    // success
    } else if (rc === 200 || rc === 201) {
      cb(err, response, body)
    }
  })
}

// get a the user's token from the local storage
function getIntheamToken(bot, message, userID, cb) {
  controller.storage.users.get(userID, (err, user) => {
    if (!err && user && user.token && user.token.length > 0) {
      const token = user.token;
      bot.botkit.log('found user token in local storage', token)
      cb(token)
    } else {
      bot.botkit.log('error getting user or user token from storage', err)
      bot.removeReaction(message, 'thinking_face')
      bot.reply(message, 'Looks like we haven\'t been introduced yet. I\'m Slackwarrior and I\'m here to help you manage your tasks. Please feel free to ask me for `help` any time. :robot_face:')
    }
  })
}

// call the inthe.am API to get a list of all tasks
function getTasks(bot, message, user, short_id, cb) {
  getIntheamToken(bot, message, user, (token) => {
    const settings = prepareAPI('tasks', 'GET', token);
    // call the API pass the callback function on
    apiRequest(bot, message, settings, (err, response, body) => {
      if (short_id) {
        let found = false;
        for (let i = 0; i < body.length; i++) {
          const task = body[i]
          if (String(task.short_id) === String(short_id)) {
            found = true;
          }
        }
        if (found) {
          cb(err, response, body)
        } else {
          bot.botkit.log(`no error, but problem getting task details for task ${short_id} for user ${message.user}`)
          bot.removeReaction(message, 'thinking_face')
          bot.reply(message, 'I\'m sorry, but there was a problem getting that task on your task list - maybe you have already completed it or it\'s not a `pending` task :confused:')
        }
      } else {
        cb(err, response, body)
      }
    });
  })
}

// create and upload a snippet with all pending tasks
function sendAllTasks(bot, message) {
  bot.botkit.log('getting all tasks for user', message.user);
  // add a reaction so the user knows we're working on it
  bot.addReaction(message, 'thinking_face')

  // get a list of all tasks
  getTasks(bot, message, message.user, false, (err, response, body) => {
    // remove the thinking face again
    bot.removeReaction(message, 'thinking_face')

    // sort list of tasks by urgency
    const tasks = body;

    if (tasks && tasks.length && tasks.length > 0) {
      tasks.sort(compareTasks);
      const l = tasks.length;
      bot.botkit.log(`got ${l} tasks for user ${message.user}`);

      // add some headers to the snippet
      let result = [' ID  Prio  Project     Description', ''];
      // add one line in the snippet for every pending task
      for (let i = 0; i < l; i++) {
        const task = tasks[i];
        // format short_id to a length of three
        let short_id = String(task.short_id);
        short_id = short_id.padLeft(3, ' ')

        let priority = ' ';
        if (task.priority) {
          priority = task.priority;
        }
        priority = priority.padRight(4, ' ')

        let project = ' ';
        if (task.project) {
          project = String(task.project)
        }
        project = project.padRight(11, ' ')
        // concat the values with some spaces
        let line = `${short_id}  ${priority}  ${project}  ${task.description}`
        if (task.start) {
          line = `${line} (active)`
        }

        result.push(line)
      }

      result = result.join('\n')

      const d = new Date();
      const date = d.toLocaleString();

      // upload the resulting snippet
      bot.api.files.upload({
        content: result,
        channels: message.channel,
        title: `Tasks on ${date}`,
      }, (uploadErr) => {
        // bot.botkit.log('res', res);
        if (uploadErr) {
          bot.botkit.log('err uploading tasks snippet', err);
          bot.reply(message, 'There was some problem uploading the tasks file')
          bot.reply(message, messages.randomErrorMessage())
        } else {
          bot.reply(message, `These are your ${l} pending tasks, sorted by urgency :notebook:`)
        }
      })
    } else {
      bot.reply(message, 'Looks like you have no pending tasks right now! You should go relax for a while :beach_with_umbrella:')
    }
  })
}

// create a message (with attachments) and list the the user's three most urgent tasks
function sendTasks(bot, message) {
  bot.botkit.log('getting tasks for user', message.user);
  // add a reaction so the user knows we're working on it
  bot.addReaction(message, 'thinking_face')

  getTasks(bot, message, message.user, false, (err, response, tasks) => {
    // remove the thinking face again
    bot.removeReaction(message, 'thinking_face')

    // sort list of tasks by urgency
    if (tasks && tasks.length && tasks.length > 0) {
      tasks.sort(compareTasks);
      const l = tasks.length;
      bot.botkit.log(`got ${l} tasks for user ${message.user}`);

      //
      let pretext = `:notebook: You have ${tasks.length} pending tasks right now`;
      if (l >= 2) {
        pretext = `${pretext}, here are the top 3: `
      } else {
        pretext = `${pretext}:`
      }

      // basic settings for the result message
      const answer = {
        channel: message.channel,
        as_user: true,
      }

      // limit tasks to 3
      let maxTasks = l;
      if (l >= 2) {
        maxTasks = 2;
      }

      if (l < 3) {
        maxTasks = l - 1;
      }

      // create a list of attachments, one per task
      const attachments = [];
      for (let i = 0; i <= maxTasks; i++) {
        const task = tasks[i];

        // create a message attachment from this task
        const attachment = taskFunctions.task2attachment(task);

        // if this is the very first attachment we set the pretext
        if (i === 0) {
          attachment.pretext = pretext;
        }

        attachments.push(attachment);
      }

      // add attachments to the message and send it
      answer.attachments = attachments;
      bot.api.chat.postMessage(answer, (postErr, postResponse) => {
        if (!postErr) {
          // bot.botkit.log('tasks sent');
        } else {
          bot.botkit.log('error sending tasks', postResponse, postErr);
        }
      })
    } else {
      bot.reply(message, 'Looks like you have no pending tasks right now! You should go relax for a while :beach_with_umbrella:')
    }
  })
}

// parse the user's command and add a task using the inthe.am API
function addTask(bot, message, text) {
  // add a reaction so the user knows we're working on it
  bot.addReaction(message, 'thinking_face')

  // create a task object from the user input
  const task = taskFunctions.cl2task(text)

  // get the token for the user
  getIntheamToken(bot, message, message.user, (token) => {
    const settings = prepareAPI('tasks', 'POST', token);

    settings.body = task;

    // call the inthe.am API to add the new task
    apiRequest(bot, message, settings, (err, response, body) => {
      // remove the reaction again
      bot.removeReaction(message, 'thinking_face')

      bot.botkit.log(`added task for ${message.user}`);
      let priority;
      if (task.priority === 'L') {
        priority = 'low" :blue_book:';
      } else if (task.priority === 'M') {
        priority = 'medium" :notebook_with_decorative_cover:'
      } else {
        priority = 'high" :closed_book:'
      }

      const answer = {
        channel: message.channel,
        as_user: true,
      }
      answer.text = `Alright, I've added task <https://inthe.am/tasks/${body.id}|${body.short_id}> to the list with priority ${priority}`

      bot.api.chat.postMessage(answer, (postErr, postResponse) => {
        if (!postErr) {
          // bot.botkit.log('task details sent');
        } else {
          bot.botkit.log('error sending task added message', postResponse, postErr);
        }
      })
    })
  });
}

// parse the user's command and add a task using the inthe.am API
function modifyTask(bot, message, short_id, commandline, annotate) {
  // add a reaction so the user knows we're working on it
  bot.addReaction(message, 'thinking_face')

  const tokens = commandline.split(' ')
  tokens.splice(0, 2)
  const text = tokens.join(' ')


  // get a list of all pending tasks
  getTasks(bot, message, message.user, short_id, (err, response, tasks) => {
    // loop over all tasks...
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];

      // if this is the task to start/stop
      if (String(task.short_id) === String(short_id)) {
        // create a task object from old task and the user input
        const newTask = taskFunctions.cl2task(text, task, annotate)

        // get the token for the user
        getIntheamToken(bot, message, message.user, (token) => {
          const settings = prepareAPI(`tasks/${task.id}`, 'PUT', token);

          settings.body = newTask;

          // call the inthe.am API to add the new task
          apiRequest(bot, message, settings, (apiErr, apiResponse, body) => {
            // remove the reaction again
            bot.removeReaction(message, 'thinking_face')

            bot.botkit.log('changed task', message.user);

            const answerText = `Alright, I've changed task ${body.short_id} for you.`
            bot.reply(message, { text: answerText })
          })
        });
      }
    }
  })
}

// mark as task as completed using the inthe.am API
function completeTask(bot, message, short_id) {
  // add a reaction so the user knows we're working on it
  bot.addReaction(message, 'thinking_face')

  // get a list of all pending tasks
  getTasks(bot, message, message.user, short_id, (err, response, tasks) => {
    // sort them by urgency
    tasks.sort(compareTasks);
    // the highest urgency of all pending tasks in the list
    let highestUrgency = 0;
    // the urgency of the completed task
    let completedUrgency = -1;
    // loop over all tasks...
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      // remember the max urgency
      if (task.urgency > highestUrgency) {
        highestUrgency = task.urgency;
      }
      // if this is the completed task
      if (String(task.short_id) === String(short_id)) {
        // remember the urgency of the completed task
        completedUrgency = task.urgency;

        getIntheamToken(bot, message, message.user, (token) => {
          const settings = prepareAPI(`tasks/${task.id}`, 'DELETE', token);

          // call the inthe.am API and mark the task as complete
          apiRequest(bot, message, settings, () => {
            // remove the thinking_face reaction again
            bot.removeReaction(message, 'thinking_face')

            bot.botkit.log(`marked task ${short_id} for user ${message.user} as complete`);
            let answerText = `Ok, task ${short_id} has been marked as complete - well done!`
            if (tasks.length - 1 === 0) {
              answerText = `${answerText} That was the last pending task on your list! You should go relax for a while :beach_with_umbrella:`
            } else {
              answerText = `${answerText} One done, ${(tasks.length - 1)} to go :clap:`
            }
            bot.reply(message, answerText)
            // if the completed task was not the one with the highest urgency
            if (completedUrgency < highestUrgency) {
              bot.reply(message, messages.randomNotMostUrgendMessage())
            }
          })
        });
      }
    }
  })
}

// start or stop a task using the inthe.am API (depending on param "mode")
function startStopTask(bot, message, short_id, mode) {
  // add a reaction so the user knows we're working on it
  bot.addReaction(message, 'thinking_face')

  // get a list of all pending tasks
  getTasks(bot, message, message.user, short_id, (err, response, tasks) => {
    // loop over all tasks...
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];

      // if this is the task to start/stop
      if (String(task.short_id) === String(short_id)) {
        if (mode === 'start' && task.start) {
          bot.removeReaction(message, 'thinking_face')
          bot.reply(message, `Hm, you've already started this task ${moment(task.start).fromNow()}. :confused:`)
        } else if (mode === 'stop' && !task.start) {
          bot.removeReaction(message, 'thinking_face')
          bot.reply(message, 'Hm, I\'m sorry, but I can\'t really stop a task that hasn\'t been started yet. :confused:')
        } else {
          getIntheamToken(bot, message, message.user, (token) => {
            const settings = prepareAPI(`tasks/${task.id}/${mode}/`, 'POST', token);

            // call the inthe.am API and mark the task as started or stopped
            apiRequest(bot, message, settings, () => {
              // remove the thinking_face reaction again
              bot.removeReaction(message, 'thinking_face')

              bot.botkit.log(`${mode}ed task ${short_id} for user ${message.user}`);
              let answerText = 'Ok, I have '
              if (mode === 'start') {
                answerText = `${answerText} started`
              } else {
                answerText = `${answerText} stopped`
              }
              answerText = `${answerText} the timer for task ${short_id} for you. :stopwatch:`;

              bot.reply(message, answerText)
            })
          });
        }
      }
    }
  })
}

// get the details for the specified task
function taskDetails(bot, message, short_id) {
  // add a reaction so the user knows we're working on it
  bot.addReaction(message, 'thinking_face')

  // get a list of all pending tasks
  getTasks(bot, message, message.user, short_id, (err, response, tasks) => {
    // remove the thinking_face reaction again
    bot.removeReaction(message, 'thinking_face')
    // loop over all tasks...
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      // if this is the task we're looking for
      if (String(task.short_id) === String(short_id)) {
        bot.botkit.log('in details', short_id)
        // basic settings for the result message
        const answer = {
          channel: message.channel,
          as_user: true,
        }

        const attachment = taskFunctions.task2details(task)

        answer.attachments = [attachment];

        bot.api.chat.postMessage(answer, (postErr, postResponse) => {
          if (!postErr) {
            bot.botkit.log('task details sent');
          } else {
            bot.botkit.log('error sending task details', postResponse, postErr);
          }
        })
      }
    }
  })
}

// handler for all commands that specify an ID, e.g. "task 23 done"
function changeTask(bot, message, text) {
  const tokens = text.split(' ');
  const short_id = tokens[0]
  const command = tokens[1]
  if (!command) {
    taskDetails(bot, message, short_id);
  } else if (command === 'done') {
    completeTask(bot, message, short_id)
  } else if (command === 'start') {
    startStopTask(bot, message, short_id, 'start')
  } else if (command === 'stop') {
    startStopTask(bot, message, short_id, 'stop')
  } else if (command === 'modify') {
    modifyTask(bot, message, short_id, text)
  } else if (command === 'annotate') {
    modifyTask(bot, message, short_id, text, true)
  } else {
    bot.reply(message, `I'm sorry, but I don't know how to execute the command \`${command}\`, right now I only know \`done\`.`)
  }
}

module.exports.addTask = addTask;
module.exports.changeTask = changeTask;
module.exports.sendTasks = sendTasks;
module.exports.sendAllTasks = sendAllTasks;
