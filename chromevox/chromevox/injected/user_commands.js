// Copyright 2013 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview High level commands that the user can invoke using hotkeys.
 *
 * Usage:
 * If you are here, you probably want to add a new user command. Here are some
 * general steps to get you started.
 * - Go to command_store.js, where all static data about a command lives. Follow
 * the instructions there.
 * - Add the logic of the command to doCommand_ below. Try to reuse or group
 * your command with related commands.
 * @author clchen@google.com (Charles L. Chen)
 */


goog.provide('cvox.ChromeVoxUserCommands');

goog.require('cvox.AutoRunner');
goog.require('cvox.ChromeVox');
goog.require('cvox.CommandStore');
goog.require('cvox.ConsoleTts');
goog.require('cvox.CssSpace');
goog.require('cvox.DomPredicates');
goog.require('cvox.DomUtil');
goog.require('cvox.FocusUtil');
goog.require('cvox.KeyboardHelpWidget');
goog.require('cvox.ContextMenuWidget');
goog.require('cvox.NodeSearchWidget');
goog.require('cvox.PlatformUtil');
goog.require('cvox.SearchWidget');
goog.require('cvox.SelectWidget');
goog.require('cvox.TypingEcho');
goog.require('cvox.UserEventDetail');


/**
 * Initializes commands map.
 * Initializes global members.
 * @private
 */
cvox.ChromeVoxUserCommands.init_ = function() {
  if (cvox.ChromeVoxUserCommands.commands) {
    return;
  } else {
    cvox.ChromeVoxUserCommands.commands = {};
  }
  for (var cmd in cvox.CommandStore.CMD_WHITELIST) {
    cvox.ChromeVoxUserCommands.commands[cmd] =
        cvox.ChromeVoxUserCommands.createCommand_(cmd);
  }
};


/**
 * @type {!Object.<string, function(): boolean>}
 */
cvox.ChromeVoxUserCommands.commands;


/**
 * @type {boolean}
 * TODO (clchen, dmazzoni): Implement syncing on click to avoid needing this.
 */
cvox.ChromeVoxUserCommands.wasMouseClicked = false;


/**
 * @type {boolean} Flag to set whether or not certain user commands will be
 * first dispatched to the underlying web page. Some commands (such as finding
 * the next/prev structural element) may be better implemented by the web app
 * than by ChromeVox.
 *
 * By default, this is enabled; however, for testing, we usually disable this to
 * reduce flakiness caused by event timing issues.
 *
 * TODO (clchen, dtseng): Fix testing framework so that we don't need to turn
 * this feature off at all.
 */
cvox.ChromeVoxUserCommands.enableCommandDispatchingToPage = true;


/**
 * Handles any tab navigation by putting focus at the user's position.
 * This function will create dummy nodes if there is nothing that is focusable
 * at the current position.
 * TODO (adu): This function is too long. We need to break it up into smaller
 * helper functions.
 * @return {boolean} True if default action should be taken.
 * @private
 */
cvox.ChromeVoxUserCommands.handleTabAction_ = function() {
  cvox.ChromeVox.tts.stop();

  // If we are tabbing from an invalid location, prevent the default action.
  // We pass the isFocusable function as a predicate to specify we only want to
  // revert to focusable nodes.
  if (!cvox.ChromeVox.navigationManager.resolve(cvox.DomUtil.isFocusable)) {
    cvox.ChromeVox.navigationManager.setFocus();
    return false;
  }

  // If the user is already focused on a link or control,
  // nothing more needs to be done.
  var isLinkControl = cvox.ChromeVoxUserCommands.isFocusedOnLinkControl_();
  if (isLinkControl) {
    return true;
  }

  // Try to find something reasonable to focus on.
  // Use selection if it exists because it means that the user has probably
  // clicked with their mouse and we should respect their position.
  // If there is no selection, then use the last known position based on
  // NavigationManager's currentNode.
  var anchorNode = null;
  var focusNode = null;
  var sel = window.getSelection();
  if (!cvox.ChromeVoxUserCommands.wasMouseClicked) {
    sel = null;
  } else {
    cvox.ChromeVoxUserCommands.wasMouseClicked = false;
  }
  if (sel == null || sel.anchorNode == null || sel.focusNode == null) {
    anchorNode = cvox.ChromeVox.navigationManager.getCurrentNode();
    focusNode = cvox.ChromeVox.navigationManager.getCurrentNode();
  } else {
    anchorNode = sel.anchorNode;
    focusNode = sel.focusNode;
  }

  // See if we can set focus to either anchorNode or focusNode.
  // If not, try the parents. Otherwise give up and create a dummy span.
  if (anchorNode == null || focusNode == null) {
    return true;
  }
  if (cvox.DomUtil.isFocusable(anchorNode)) {
    anchorNode.focus();
    return true;
  }
  if (cvox.DomUtil.isFocusable(focusNode)) {
    focusNode.focus();
    return true;
  }
  if (cvox.DomUtil.isFocusable(anchorNode.parentNode)) {
    anchorNode.parentNode.focus();
    return true;
  }
  if (cvox.DomUtil.isFocusable(focusNode.parentNode)) {
    focusNode.parentNode.focus();
    return true;
  }

  // Insert and focus a dummy span immediately before the current position
  // so that the default tab action will start off as close to the user's
  // current position as possible.
  var bestGuess = anchorNode;
  var dummySpan = cvox.ChromeVoxUserCommands.createTabDummySpan_();
  bestGuess.parentNode.insertBefore(dummySpan, bestGuess);
  dummySpan.focus();
  return true;
};


/**
 * @return {boolean} True if we are focused on a link or any other control.
 * @private
 */
cvox.ChromeVoxUserCommands.isFocusedOnLinkControl_ = function() {
  var tagName = 'A';
  if ((document.activeElement.tagName == tagName) ||
      cvox.DomUtil.isControl(document.activeElement)) {
    return true;
  }
  return false;
};


/**
 * If a lingering tab dummy span exists, remove it.
 */
cvox.ChromeVoxUserCommands.removeTabDummySpan = function() {
  var previousDummySpan = document.getElementById('ChromeVoxTabDummySpan');
  if (previousDummySpan && document.activeElement != previousDummySpan) {
    previousDummySpan.parentNode.removeChild(previousDummySpan);
  }
};


/**
 * Create a new tab dummy span.
 * @return {Element} The dummy span element to be inserted.
 * @private
 */
cvox.ChromeVoxUserCommands.createTabDummySpan_ = function() {
  var span = document.createElement('span');
  span.id = 'ChromeVoxTabDummySpan';
  span.tabIndex = -1;
  return span;
};


/**
 * @param {string} cmd The programmatic command name.
 * @return {function(): boolean} The callable command.
 * @private
 */
cvox.ChromeVoxUserCommands.createCommand_ = function(cmd) {
  return goog.bind(function() {
    return cvox.ChromeVoxUserCommands.dispatchCommand_(cmd);
  }, cvox.ChromeVoxUserCommands);
};


/**
 * @param {string} cmd The command to do.
 * @return {boolean} False to prevent the default action. True otherwise.
 * @private
 */
cvox.ChromeVoxUserCommands.dispatchCommand_ = function(cmd) {
  if (cvox.Widget.isActive()) {
    return true;
  }
  var cmdStruct = cvox.CommandStore.CMD_WHITELIST[cmd];
  if (!cmdStruct) {
    throw 'Invalid command: ' + cmd;
  }
  if (!cvox.PlatformUtil.matchesPlatform(cmdStruct.platformFilter) ||
      (cmdStruct.skipInput && cvox.FocusUtil.isFocusInTextInputField())) {
    return true;
  }
  // Handle dispatching public command events
  if (cvox.ChromeVoxUserCommands.enableCommandDispatchingToPage &&
      (cvox.UserEventDetail.COMMANDS.indexOf(cmd) != -1)) {
    var detail = new cvox.UserEventDetail({command: cmd});
    var evt = detail.createEventObject();
    var currentNode = cvox.ChromeVox.navigationManager.getCurrentNode();
    if (!currentNode) {
      currentNode = document.body;
    }
    currentNode.dispatchEvent(evt);
    return false;
  }
  // Not a public command; act on this command directly.
  return cvox.ChromeVoxUserCommands.doCommand_(cmd);
};


/**
 * @param {string} cmd The command to do.
 * @param {string=} opt_status Optional string that indicates the status of this
 *     command.
 * @param {Node=} opt_resultNode Optional result node that can be included if
 *     this command was already performed successfully by the page itself.
 * @return {boolean} False to prevent the default action. True otherwise.
 * @private
 */
cvox.ChromeVoxUserCommands.doCommand_ = function(cmd, opt_status,
      opt_resultNode) {
  opt_status = opt_status || cvox.UserEventDetail.Status.PENDING;
  opt_resultNode = opt_resultNode || null;
  if (cvox.Widget.isActive()) {
    return true;
  }
  var cmdStruct = cvox.CommandStore.CMD_WHITELIST[cmd];
  if (!cmdStruct) {
    throw 'Invalid command: ' + cmd;
  }

  if (!cvox.PlatformUtil.matchesPlatform(cmdStruct.platformFilter) ||
      (cmdStruct.skipInput && cvox.FocusUtil.isFocusInTextInputField())) {
    return true;
  }

  if (!cmdStruct.allowEvents) {
    cvox.ChromeVoxEventSuspender.enterSuspendEvents();
  }

  if (cmdStruct.disallowContinuation) {
    cvox.ChromeVox.navigationManager.stopReading(true);
  }

  if (cmdStruct.forward) {
    cvox.ChromeVox.navigationManager.setReversed(false);
  } else if (cmdStruct.backward) {
    cvox.ChromeVox.navigationManager.setReversed(true);
  }

  if (cmdStruct.findNext) {
    cmd = 'find';
    cmdStruct.announce = true;
  }

  var prefixMsg = '';
  var errorMsg = '';
  var ret = false;
  switch (cmd) {
    case 'handleTab':
    case 'handleTabPrev':
      ret = cvox.ChromeVoxUserCommands.handleTabAction_();
      break;
    case 'forward':
    case 'backward':
      ret = !cvox.ChromeVox.navigationManager.navigate();
      break;
    case 'right':
    case 'left':
      cvox.ChromeVox.navigationManager.subnavigate();
      break;
    case 'find':
      if (!cmdStruct.findNext) {
        throw 'Invalid find command.';
      }
      var NodeInfoStruct =
          cvox.CommandStore.NODE_INFO_MAP[cmdStruct.findNext];
      var predicateName = NodeInfoStruct.predicate;
      var predicate = cvox.DomPredicates[predicateName];
      var error = '';
      var wrap = '';
      if (cmdStruct.forward) {
        wrap = cvox.ChromeVox.msgs.getMsg('wrapped_to_top');
        error = cvox.ChromeVox.msgs.getMsg(NodeInfoStruct.forwardError);
      } else if (cmdStruct.backward) {
        wrap = cvox.ChromeVox.msgs.getMsg('wrapped_to_bottom');
        error = cvox.ChromeVox.msgs.getMsg(NodeInfoStruct.backwardError);
      }
      var found = null;
      switch (opt_status) {
        case cvox.UserEventDetail.Status.SUCCESS:
          if (opt_resultNode) {
            cvox.ChromeVox.navigationManager.updateSelToArbitraryNode(
                opt_resultNode, true);
          }
          break;
        case cvox.UserEventDetail.Status.FAILURE:
          prefixMsg = error;
          break;
        default:
          found = cvox.ChromeVox.navigationManager.findNext(
              predicate, predicateName);
          if (!found) {
            cvox.ChromeVox.navigationManager.saveSel();
            prefixMsg = wrap;
            cvox.ChromeVox.navigationManager.syncToBeginning();
            cvox.ChromeVox.earcons.playEarcon(cvox.AbstractEarcons.WRAP);
            found = cvox.ChromeVox.navigationManager.findNext(
                predicate, predicateName, true);
            if (!found) {
              prefixMsg = error;
              cvox.ChromeVox.navigationManager.restoreSel();
            }
          }
          break;
      }
      // NavigationManager performs announcement inside of frames when finding.
      if (found && found.start.node.tagName == 'IFRAME') {
        cmdStruct.announce = false;
      }
      break;
    case 'skipForward':
    case 'skipBackward':
      ret = !cvox.ChromeVox.navigationManager.skip();
      break;
    // TODO(stoarca): Bad naming. Should be less instead of previous.
    case 'previousGranularity':
      cvox.ChromeVox.navigationManager.makeLessGranular();
      prefixMsg = cvox.ChromeVox.navigationManager.getGranularityMsg();
      break;
    case 'nextGranularity':
      cvox.ChromeVox.navigationManager.makeMoreGranular();
      prefixMsg = cvox.ChromeVox.navigationManager.getGranularityMsg();
      break;

    case 'previousCharacter':
      cvox.ChromeVox.navigationManager.navigate(false,
          cvox.NavigationShifter.GRANULARITIES.CHARACTER);
      break;
    case 'nextCharacter':
      cvox.ChromeVox.navigationManager.navigate(false,
          cvox.NavigationShifter.GRANULARITIES.CHARACTER);
      break;

    case 'previousWord':
      cvox.ChromeVox.navigationManager.navigate(false,
          cvox.NavigationShifter.GRANULARITIES.WORD);
      break;
    case 'nextWord':
      cvox.ChromeVox.navigationManager.navigate(false,
          cvox.NavigationShifter.GRANULARITIES.WORD);
      break;

    case 'previousSentence':
      cvox.ChromeVox.navigationManager.navigate(false,
          cvox.NavigationShifter.GRANULARITIES.SENTENCE);
      break;
    case 'nextSentence':
      cvox.ChromeVox.navigationManager.navigate(false,
          cvox.NavigationShifter.GRANULARITIES.SENTENCE);
      break;

    case 'previousLine':
      cvox.ChromeVox.navigationManager.navigate(false,
          cvox.NavigationShifter.GRANULARITIES.LINE);
      break;
    case 'nextLine':
      cvox.ChromeVox.navigationManager.navigate(false,
          cvox.NavigationShifter.GRANULARITIES.LINE);
      break;

    case 'previousObject':
      cvox.ChromeVox.navigationManager.navigate(false,
          cvox.NavigationShifter.GRANULARITIES.OBJECT);
      break;
    case 'nextObject':
      cvox.ChromeVox.navigationManager.navigate(false,
          cvox.NavigationShifter.GRANULARITIES.OBJECT);
      break;

    case 'previousGroup':
      cvox.ChromeVox.navigationManager.navigate(false,
          cvox.NavigationShifter.GRANULARITIES.GROUP);
      break;
    case 'nextGroup':
      cvox.ChromeVox.navigationManager.navigate(false,
          cvox.NavigationShifter.GRANULARITIES.GROUP);
      break;

    case 'previousRow':
    case 'previousCol':
      // Fold these commands to their "next" equivalents since we already set
      // isReversed above.
      cmd = cmd == 'previousRow' ? 'nextRow' : 'nextCol';
    case 'nextRow':
    case 'nextCol':
      cvox.ChromeVox.navigationManager.performAction('enterShifterSilently');
      cvox.ChromeVox.navigationManager.performAction(cmd);
      break;

    case 'moveToStartOfLine':
    case 'moveToEndOfLine':
      cvox.ChromeVox.navigationManager.setGranularity(
          cvox.NavigationShifter.GRANULARITIES.LINE);
      cvox.ChromeVox.navigationManager.sync();
      cvox.ChromeVox.navigationManager.collapseSelection();
      break;

    case 'readFromHere':
      cvox.ChromeVox.navigationManager.startReading(
          cvox.AbstractTts.QUEUE_MODE_FLUSH);
      break;
    case 'cycleTypingEcho':
      cvox.ChromeVox.host.sendToBackgroundPage({
        'target': 'Prefs',
        'action': 'setPref',
        'pref': 'typingEcho',
        'value': cvox.TypingEcho.cycle(cvox.ChromeVox.typingEcho),
        'announce': true
      });
      break;
    case 'jumpToTop':
      cvox.ChromeVox.navigationManager.syncToBeginning();
      break;
    case 'jumpToBottom':
      cvox.ChromeVox.navigationManager.syncToBeginning();
      break;
    case 'stopSpeech':
      cvox.ChromeVox.navigationManager.stopReading(true);
      break;
    case 'toggleKeyboardHelp':
      cvox.KeyboardHelpWidget.getInstance().toggle();
      break;
    case 'help':
      cvox.ChromeVox.tts.stop();
      cvox.ChromeVox.host.sendToBackgroundPage({
        'target': 'HelpDocs',
        'action': 'open'
      });
      break;
    case 'contextMenu':
      // Move this logic to a central dispatching class if it grows any bigger.
      var node = cvox.ChromeVox.navigationManager.getCurrentNode();
      if (node.tagName == 'SELECT' && !node.multiple) {
        new cvox.SelectWidget(node).show();
      } else {
        var contextMenuWidget = new cvox.ContextMenuWidget();
        contextMenuWidget.toggle();
      }
      break;
    case 'showBookmarkManager':
      // TODO(stoarca): Should this have tts.stop()??
      cvox.ChromeVox.host.sendToBackgroundPage({
        'target': 'BookmarkManager',
        'action': 'open'
      });
      break;
    case 'showOptionsPage':
      cvox.ChromeVox.tts.stop();
      cvox.ChromeVox.host.sendToBackgroundPage({
        'target': 'Options',
        'action': 'open'
      });
      break;
    case 'showKbExplorerPage':
      cvox.ChromeVox.tts.stop();
      cvox.ChromeVox.host.sendToBackgroundPage({
        'target': 'KbExplorer',
        'action': 'open'
      });
      break;
    case 'readLinkURL':
      var activeElement = document.activeElement;
      var currentSelectionAnchor = window.getSelection().anchorNode;

      var url = '';
      if (activeElement.tagName == 'A') {
        url = cvox.DomUtil.getLinkURL(activeElement);
      } else if (currentSelectionAnchor) {
        url = cvox.DomUtil.getLinkURL(currentSelectionAnchor.parentNode);
      }

      if (url != '') {
        cvox.ChromeVox.tts.speak(url);
      } else {
        cvox.ChromeVox.tts.speak(cvox.ChromeVox.msgs.getMsg('no_url_found'));
      }
      break;
    case 'readCurrentTitle':
      cvox.ChromeVox.tts.speak(document.title);
      break;
    case 'readCurrentURL':
      cvox.ChromeVox.tts.speak(document.URL);
      break;
    case 'performDefaultAction':
      if (cvox.DomPredicates.linkPredicate([document.activeElement])) {
        cmdStruct.announce = true;
        if (cvox.DomUtil.isInternalLink(document.activeElement)) {
          cvox.DomUtil.syncInternalLink(document.activeElement);
          cvox.ChromeVox.navigationManager.sync();
        }
      }
      break;
    case 'forceClickOnCurrentItem':
      prefixMsg = cvox.ChromeVox.msgs.getMsg('element_clicked');
      var targetNode = cvox.ChromeVox.navigationManager.getCurrentNode();
      cvox.DomUtil.clickElem(targetNode, false, false);
      break;
    case 'forceDoubleClickOnCurrentItem':
      prefixMsg = cvox.ChromeVox.msgs.getMsg('element_double_clicked');
      var targetNode = cvox.ChromeVox.navigationManager.getCurrentNode();
      cvox.DomUtil.clickElem(targetNode, false, false, true);
      break;
    case 'toggleChromeVox':
      cvox.ChromeVox.host.sendToBackgroundPage({
        'target': 'Prefs',
        'action': 'setPref',
        'pref': 'active',
        'value': !cvox.ChromeVox.isActive
      });
      break;
    case 'fullyDescribe':
      var descs = cvox.ChromeVox.navigationManager.getFullDescription();
      cvox.ChromeVox.navigationManager.speakDescriptionArray(
          descs,
          cvox.AbstractTts.QUEUE_MODE_FLUSH,
          null);
      break;
    case 'speakTimeAndDate':
      var dateTime = new Date();
      cvox.ChromeVox.tts.speak(
          dateTime.toLocaleTimeString() + ', ' + dateTime.toLocaleDateString());
      break;
    case 'toggleSelection':
      var selState = cvox.ChromeVox.navigationManager.togglePageSel();
      prefixMsg = cvox.ChromeVox.msgs.getMsg(
          selState ? 'begin_selection' : 'end_selection');
    break;
    case 'startHistoryRecording':
      cvox.History.getInstance().startRecording();
      break;
    case 'stopHistoryRecording':
      cvox.History.getInstance().stopRecording();
      break;
    case 'enterCssSpace':
      cvox.CssSpace.initializeSpace();
      cvox.CssSpace.enterExploration();
      break;
    case 'enableConsoleTts':
      cvox.ConsoleTts.getInstance().setEnabled(true);
      break;

    // Table actions.
    case 'goToFirstCell':
    case 'goToLastCell':
    case 'goToRowFirstCell':
    case 'goToRowLastCell':
    case 'goToColFirstCell':
    case 'goToColLastCell':
    case 'announceHeaders':
    case 'speakTableLocation':
    case 'exitShifterContent':
      if (!cvox.DomPredicates.tablePredicate(cvox.DomUtil.getAncestors(
              cvox.ChromeVox.navigationManager.getCurrentNode())) ||
          !cvox.ChromeVox.navigationManager.performAction(cmd)) {
        errorMsg = 'not_inside_table';
      }
      break;

    // Generic actions.
    case 'enterShifter':
    case 'exitShifter':
      cvox.ChromeVox.navigationManager.performAction(cmd);
      break;
    // TODO(stoarca): Code repetition.
    case 'decreaseTtsRate':
      // TODO(stoarca): This function name is way too long.
      cvox.ChromeVox.tts.increaseOrDecreaseProperty(
          cvox.AbstractTts.RATE, false);
      break;
    case 'increaseTtsRate':
      cvox.ChromeVox.tts.increaseOrDecreaseProperty(
          cvox.AbstractTts.RATE, true);
      break;
    case 'decreaseTtsPitch':
      cvox.ChromeVox.tts.increaseOrDecreaseProperty(
          cvox.AbstractTts.PITCH, false);
      break;
    case 'increaseTtsPitch':
      cvox.ChromeVox.tts.increaseOrDecreaseProperty(
          cvox.AbstractTts.PITCH, true);
      break;
    case 'decreaseTtsVolume':
      cvox.ChromeVox.tts.increaseOrDecreaseProperty(
          cvox.AbstractTts.VOLUME, false);
      break;
    case 'increaseTtsVolume':
      cvox.ChromeVox.tts.increaseOrDecreaseProperty(
          cvox.AbstractTts.VOLUME, true);
      break;
      case 'cyclePunctuationEcho':
        cvox.ChromeVox.host.sendToBackgroundPage({
            'target': 'TTS',
            'action': 'cyclePunctuationEcho'
          });
        break;

    case 'toggleStickyMode':
      cvox.ChromeVox.host.sendToBackgroundPage({
        'target': 'Prefs',
        'action': 'setPref',
        'pref': 'sticky',
        'value': !cvox.ChromeVox.isStickyOn,
        'announce': true
      });
      break;
    case 'toggleKeyPrefix':
      cvox.ChromeVox.keyPrefixOn = !cvox.ChromeVox.keyPrefixOn;
      break;
    case 'toggleSearchWidget':
      cvox.SearchWidget.getInstance().toggle();
      break;

    case 'toggleEarcons':
      prefixMsg = cvox.ChromeVox.earcons.toggle() ?
          cvox.ChromeVox.msgs.getMsg('earcons_on') :
              cvox.ChromeVox.msgs.getMsg('earcons_off');
      break;

    case 'showHeadingsList':
    case 'showLinksList':
    case 'showFormsList':
    case 'showTablesList':
    case 'showLandmarksList':
      if (!cmdStruct.nodeList) {
        break;
      }
      var nodeListStruct =
          cvox.CommandStore.NODE_INFO_MAP[cmdStruct.nodeList];

      cvox.NodeSearchWidget.create(nodeListStruct.typeMsg,
                  cvox.DomPredicates[nodeListStruct.predicate]).show();
      break;

    case 'openLongDesc':
      var currentNode = cvox.ChromeVox.navigationManager.getCurrentNode();
      if (cvox.DomUtil.hasLongDesc(currentNode)) {
        cvox.ChromeVox.host.sendToBackgroundPage({
          'target': 'OpenTab',
          'url': currentNode.longDesc // Use .longDesc instead of getAttribute
                                      // since we want Chrome to convert the
                                      // longDesc to an absolute URL.
        });
      } else {
        cvox.ChromeVox.tts.speak(
          cvox.ChromeVox.msgs.getMsg('no_long_desc'),
          cvox.AbstractTts.QUEUE_MODE_FLUSH,
          cvox.AbstractTts.PERSONALITY_ANNOTATION);
      }
      break;

    case 'pauseAllMedia':
      var videos = document.getElementsByTagName('VIDEO');
      for (var i = 0, mediaElem; mediaElem = videos[i]; i++) {
        mediaElem.pause();
      }
      var audios = document.getElementsByTagName('AUDIO');
      for (var i = 0, mediaElem; mediaElem = audios[i]; i++) {
        mediaElem.pause();
      }
      break;

    case 'debug':
      // TODO(stoarca): This doesn't belong here.
      break;

    case 'nop':
      break;
    default:
      throw 'Command behavior not defined: ' + cmd;
  }

  if (errorMsg != '') {
    cvox.ChromeVox.tts.speak(
        cvox.ChromeVox.msgs.getMsg(errorMsg),
        cvox.AbstractTts.QUEUE_MODE_FLUSH,
        cvox.AbstractTts.PERSONALITY_ANNOTATION);
  } else if (cvox.ChromeVox.navigationManager.isReading()) {
    if (cmdStruct.disallowContinuation) {
      cvox.ChromeVox.navigationManager.stopReading(true);
    } else {
      cvox.ChromeVox.navigationManager.skip();
    }
  } else {
    if (cmdStruct.announce) {
      cvox.ChromeVox.navigationManager.finishNavCommand(prefixMsg);
    }
  }
  if (!cmdStruct.allowEvents) {
    cvox.ChromeVoxEventSuspender.exitSuspendEvents();
  }
  return !!cmdStruct.doDefault || ret;
};


/**
 * Default handler for public user commands that are dispatched to the web app
 * first so that the web developer can handle these commands instead of
 * ChromeVox if they decide they can do a better job than the default algorithm.
 *
 * @param {Object} cvoxUserEvent The cvoxUserEvent to handle.
 */
cvox.ChromeVoxUserCommands.handleChromeVoxUserEvent = function(cvoxUserEvent) {
  var detail = new cvox.UserEventDetail(cvoxUserEvent.detail);
  if (detail.command) {
    cvox.ChromeVoxUserCommands.doCommand_(detail.command, detail.status,
        detail.resultNode);
  }
};


cvox.ChromeVoxUserCommands.init_();