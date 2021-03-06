'use strict'
// general error messages
const GENERAL_ERROR_MESSAGES = ['I\'m sorry, but there was an internal problem, it\'s probably the old hydraulic pump again. Please try again later, it should be less squeaky once it\'s cooled down a little...']
const TASK_ERROR_MESSAGES = ['I\'m sorry, but I didn\'t understand that command. Please feel free to ask for `task help` at any time, if you want me to show you the available commands again.']
const NOT_MOST_URGENT_MESSAGES = ['You have more urgent tasks though... :zipper_mouth_face:',
                                'Looks like you should have been working on something else though... :building_construction:',
                                'But aren\'t you running out of time for some other tasks on your list? :hourglass_flowing_sand:',
                                'But shouldn\'t you be paying attention to some other construction sites? :construction:',
                                'The clock seems to be ticking for some other tasks on your list though... :alarm_clock:']

// shuffle an array and return it
const shuffle = array => {
  const a = array
  let currentIndex = a.length
  let temporaryValue
  let randomIndex

  // While there remain elements to shuffle...
  while (currentIndex !== 0) {
    // Pick a remaining element...
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    temporaryValue = a[currentIndex];
    a[currentIndex] = a[randomIndex];
    a[randomIndex] = temporaryValue;
  }

  return a;
}

const randomMessage = messages =>
  shuffle(messages)[0]

module.exports.randomErrorMessage = () =>
  randomMessage(GENERAL_ERROR_MESSAGES)

module.exports.randomNotMostUrgendMessage = () =>
  randomMessage(NOT_MOST_URGENT_MESSAGES)

module.exports.randomTaskErrorMessage = () =>
  randomMessage(TASK_ERROR_MESSAGES)
