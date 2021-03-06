/**
 * Copyright 2015 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

// Initializes FriendlyChat.
function FriendlyChat() {
  this.checkSetup();

  // Shortcuts to DOM Elements.
  this.messageList = document.getElementById('messages');
  this.messageForm = document.getElementById('message-form');
  this.messageInput = document.getElementById('message');
  this.submitButton = document.getElementById('submit');
  this.submitImageButton = document.getElementById('submitImage');
  this.imageForm = document.getElementById('image-form');
  this.mediaCapture = document.getElementById('mediaCapture');
  this.userPic = document.getElementById('user-pic');
  this.userName = document.getElementById('user-name');
  this.signInButton = document.getElementById('sign-in');
  this.signOutButton = document.getElementById('sign-out');
  this.signInSnackbar = document.getElementById('must-signin-snackbar');
  this.userList = document.getElementById('users');

  // Saves message on form submit.
  this.messageForm.addEventListener('submit', this.saveMessage.bind(this));
  this.signOutButton.addEventListener('click', this.signOut.bind(this));
  this.signInButton.addEventListener('click', this.signIn.bind(this));

  // Toggle for the button.
  var buttonTogglingHandler = this.toggleButton.bind(this);
  this.messageInput.addEventListener('keyup', buttonTogglingHandler);
  this.messageInput.addEventListener('change', buttonTogglingHandler);

  // Events for image upload.
  this.submitImageButton.addEventListener('click', function() {
    this.mediaCapture.click();
  }.bind(this));
  this.mediaCapture.addEventListener('change', this.saveImageMessage.bind(this));

  this.initFirebase();
}

// Sets up shortcuts to Firebase features and initiate firebase auth.
FriendlyChat.prototype.initFirebase = function() {
    this.auth = firebase.auth();
    this.database = firebase.database();
    this.storage = firebase.storage();
    // Initiates Firebase auth and listen to auth state changes.
    this.auth.onAuthStateChanged(this.onAuthStateChanged.bind(this));
    // Listen to online state changes.
    this.onlineRef = this.database.ref(".info/connected");
    this.onlineRef.on('value', this.onOnlineState.bind(this));
};

// Loads chat messages history and listens for upcoming ones.
FriendlyChat.prototype.loadMessages = function() {
  // Reference to the /messages/ database path.
  this.messagesRef = this.database.ref('messages');
  // Make sure we remove all previous listeners.
  this.messagesRef.off();

  // Loads the last 12 messages and listen for new ones.
  var setMessage = function(data) {
    var val = data.val();
    this.displayMessage(data.key, val.name, val.text, val.photoUrl, val.imageUrl);
  }.bind(this);
  this.messagesRef.limitToLast(12).on('child_added', setMessage);
  this.messagesRef.limitToLast(12).on('child_changed', setMessage);
};

// Saves a new message on the Firebase DB.
FriendlyChat.prototype.saveMessage = function(e) {
  e.preventDefault();
  // Check that the user entered a message and is signed in.
  if (this.messageInput.value && this.checkSignedInWithMessage()) {
    var currentUser = this.auth.currentUser;
    // Add a new message entry to the Firebase Database.
    this.messagesRef.push({
      name: currentUser.displayName,
      text: this.messageInput.value,
      photoUrl: currentUser.photoURL || '/images/profile_placeholder.png'
    }).then(function() {
      // Clear message text field and SEND button state.
      FriendlyChat.resetMaterialTextfield(this.messageInput);
      this.toggleButton();
    }.bind(this)).catch(function(error) {
      console.error('Error writing new message to Firebase Database', error);
    });
  }
};

// Sets the URL of the given img element with the URL of the image stored in Firebase Storage.
FriendlyChat.prototype.setImageUrl = function(imageUri, imgElement) {
  imgElement.src = imageUri;

  // If the image is a Firebase Storage URI we fetch the URL.
  if (imageUri.startsWith('gs://')) {
    imgElement.src = FriendlyChat.LOADING_IMAGE_URL; // Display a loading image first.
    this.storage.refFromURL(imageUri).getMetadata().then(function(metadata) {
      imgElement.src = metadata.downloadURLs[0];
    });
  } else {
    imgElement.src = imageUri;
  }
};

// Saves a new message containing an image URI in Firebase.
// This first saves the image in Firebase storage.
FriendlyChat.prototype.saveImageMessage = function(event) {
  var file = event.target.files[0];

  // Clear the selection in the file picker input.
  this.imageForm.reset();

  // Check if the file is an image.
  if (!file.type.match('image.*')) {
    var data = {
      message: 'You can only share images',
      timeout: 2000
    };
    this.signInSnackbar.MaterialSnackbar.showSnackbar(data);
    return;
  }
  // Check if the user is signed-in
  if (this.checkSignedInWithMessage()) {

    // We add a message with a loading icon that will get updated with the shared image.
    var currentUser = this.auth.currentUser;
    this.messagesRef.push({
      name: currentUser.displayName,
      imageUrl: FriendlyChat.LOADING_IMAGE_URL,
      photoUrl: currentUser.photoURL || '/images/profile_placeholder.png'
    }).then(function(data) {

      // Upload the image to Firebase Storage.
      var uploadTask = this.storage.ref(currentUser.uid + '/' + Date.now() + '/' + file.name)
          .put(file, {'contentType': file.type});
      // Listen for upload completion.
      uploadTask.on('state_changed', null, function(error) {
        console.error('There was an error uploading a file to Firebase Storage:', error);
      }, function() {

        // Get the file's Storage URI and update the chat message placeholder.
        var filePath = uploadTask.snapshot.metadata.fullPath;
        data.update({imageUrl: this.storage.ref(filePath).toString()});
      }.bind(this));
    }.bind(this));
  }
};

// Signs-in Friendly Chat.
FriendlyChat.prototype.signIn = function(googleUser) {
  // Sign in Firebase using popup auth and Google as the identity provider.
  var provider = new firebase.auth.GoogleAuthProvider();
  this.auth.signInWithPopup(provider);
};

// Signs-out of Friendly Chat.
FriendlyChat.prototype.signOut = function() {
  // Sign out of Firebase.
  this.auth.signOut();
};

// Triggers when the auth state change for instance when the user signs-in or signs-out.
FriendlyChat.prototype.onAuthStateChanged = function(user) {
  if (user) { // User is signed in!
    // Get profile pic and user's name from the Firebase user object.
    var profilePicUrl = user.photoURL || '/images/profile_placeholder.png';
    var userName = user.displayName;

    // Set the user's profile pic and name.
    this.userPic.style.backgroundImage = 'url(' + profilePicUrl + ')';
    this.userName.textContent = userName;

    // Show user's profile and sign-out button.
    this.userName.removeAttribute('hidden');
    this.userPic.removeAttribute('hidden');
    this.signOutButton.removeAttribute('hidden');

    // Hide sign-in button.
    this.signInButton.setAttribute('hidden', 'true');

    // We load currently existing chant messages.
    this.loadMessages();

    this.initMeidaStream(function () {
      // Initialize PeerJs.
      this.initPeerJs();

      // Save user.
      this.saveUser();

      // load current users.
      this.loadUsers();
    }.bind(this));
  } else { // User is signed out!
    // Hide user's profile and sign-out button.
    this.userName.setAttribute('hidden', 'true');
    this.userPic.setAttribute('hidden', 'true');
    this.signOutButton.setAttribute('hidden', 'true');

    // Show sign-in button.
    this.signInButton.removeAttribute('hidden');

    // End PeerJs
    this.endPeerJs();

    // Clear users
    this.clearUsers();
  }
};

// Returns true if user is signed-in. Otherwise false and displays a message.
FriendlyChat.prototype.checkSignedInWithMessage = function() {
  if (this.auth.currentUser) {
    return true;
  }

  // Display a message to the user using a Toast.
  var data = {
    message: 'You must sign-in first',
    timeout: 2000
  };
  this.signInSnackbar.MaterialSnackbar.showSnackbar(data);
  return false;
};

// Resets the given MaterialTextField.
FriendlyChat.resetMaterialTextfield = function(element) {
  element.value = '';
  element.parentNode.MaterialTextfield.boundUpdateClassesHandler();
};

// Template for messages.
FriendlyChat.MESSAGE_TEMPLATE =
    '<div class="message-container">' +
      '<div class="spacing"><div class="pic"></div></div>' +
      '<div class="message"></div>' +
      '<div class="name"></div>' +
    '</div>';

// A loading image URL.
FriendlyChat.LOADING_IMAGE_URL = 'https://www.google.com/images/spin-32.gif';

// Displays a Message in the UI.
FriendlyChat.prototype.displayMessage = function(key, name, text, picUrl, imageUri) {
  var div = document.getElementById(key);
  // If an element for that message does not exists yet we create it.
  if (!div) {
    var container = document.createElement('div');
    container.innerHTML = FriendlyChat.MESSAGE_TEMPLATE;
    div = container.firstChild;
    div.setAttribute('id', key);
    this.messageList.appendChild(div);
  }
  if (picUrl) {
    div.querySelector('.pic').style.backgroundImage = 'url(' + picUrl + ')';
  }
  div.querySelector('.name').textContent = name;
  var messageElement = div.querySelector('.message');
  if (text) { // If the message is text.
    messageElement.textContent = text;
    // Replace all line breaks by <br>.
    messageElement.innerHTML = messageElement.innerHTML.replace(/\n/g, '<br>');
  } else if (imageUri) { // If the message is an image.
    var image = document.createElement('img');
    image.addEventListener('load', function() {
      this.messageList.scrollTop = this.messageList.scrollHeight;
    }.bind(this));
    this.setImageUrl(imageUri, image);
    messageElement.innerHTML = '';
    messageElement.appendChild(image);
  }
  // Show the card fading-in.
  setTimeout(function() {div.classList.add('visible')}, 1);
};

// Enables or disables the submit button depending on the values of the input
// fields.
FriendlyChat.prototype.toggleButton = function() {
  if (this.messageInput.value) {
    this.submitButton.removeAttribute('disabled');
  } else {
    this.submitButton.setAttribute('disabled', 'true');
  }
};

// Checks that the Firebase SDK has been correctly setup and configured.
FriendlyChat.prototype.checkSetup = function() {
  if (!window.firebase || !(firebase.app instanceof Function) || !window.config) {
    window.alert('You have not configured and imported the Firebase SDK. ' +
        'Make sure you go through the codelab setup instructions.');
  } else if (config.storageBucket === '') {
    window.alert('Your Firebase Storage bucket has not been enabled. Sorry about that. This is ' +
        'actually a Firebase bug that occurs rarely. ' +
        'Please go and re-generate the Firebase initialisation snippet (step 4 of the codelab) ' +
        'and make sure the storageBucket attribute is not empty. ' +
        'You may also need to visit the Storage tab and paste the name of your bucket which is ' +
        'displayed there.');
  }
};

FriendlyChat.prototype.onOnlineState = function(snap) {
  var data = {
    message: null,
    timeout: 2000
  };
  if (snap.val() === true && !this.isOnline) {
    data.message = 'connected';
    this.signInSnackbar.MaterialSnackbar.showSnackbar(data);
    this.initPeerJs();
    this.saveUser();
  } else if (snap.val() === false && this.isOnline){
    data.message = 'disconnected';
    this.signInSnackbar.MaterialSnackbar.showSnackbar(data);
    this.endPeerJs();
    this.clearUsers();
  }
  this.isOnline = snap.val();
};

FriendlyChat.prototype.saveUser = function() {
  if (this.checkSignedInWithMessage()) {
    var currentUser = this.auth.currentUser;
    // Reference to the /users/{:uid} database path.
    this.userRef = this.database.ref('users/' + currentUser.uid);
    this.userRef.onDisconnect().remove();
    this.userRef.set({
      name: currentUser.displayName,
      email: currentUser.email,
      photoUrl: currentUser.photoURL || '/images/profile_placeholder.png',
      peerId: this.peerId || null
    });
  }
};

FriendlyChat.prototype.loadUsers = function() {
  // Reference to the /users/ database path.
  this.usersRef = this.database.ref('users');
  // Make sure we remove all previous listeners.
  this.usersRef.off();

  // Loads users and listen for new ones.
  var setUser = function(data) {
    var val = data.val();
    this.displayUser(data.key, val.name, val.photoUrl, val.peerId);
  }.bind(this);
  var unsetUser = function(data) {
    this.reloadUsers();
  }.bind(this);
  this.usersRef.on('child_added',   setUser);
  this.usersRef.on('child_changed', setUser);
  this.usersRef.on('child_removed', unsetUser);
};

FriendlyChat.prototype.reloadUsers = function() {
  this.clearUsers();
  this.loadUsers();
};

FriendlyChat.prototype.clearUsers = function() {
  while (this.userList.firstChild) {
    this.userList.removeChild(this.userList.firstChild);
  }
};

FriendlyChat.USER_TEMPLATE =
    '<div class="mdl-list__item online-user-container">' +
      '<span class="mdl-list__item-primary-content">' +
        '<span class="pic"></span>' +
        '<span class="name"></span>' +
      '</span>' +
      '<a class="phone" class="mdl-list__item-secondary-action" href="#"><i class="material-icons"></i></a>' +
    '</div>';

FriendlyChat.CALL_EVENTLISTERS = {}

FriendlyChat.prototype.displayUser = function(uid, name, picUrl, peerId) {
  var div = document.getElementById(uid);

  if (!div) {
    var container = document.createElement('div');
    container.innerHTML = FriendlyChat.USER_TEMPLATE;
    div = container.firstChild;
    div.setAttribute('id', uid);
    this.userList.appendChild(div);
  }
  if (picUrl) {
    div.querySelector('.pic').style.backgroundImage = 'url(' + picUrl + ')';
  }
  div.querySelector('.name').textContent = name;

  var currentUser = this.auth.currentUser;
  var phoneBtn    = div.querySelector('.phone');

  if (currentUser && currentUser.uid === uid && phoneBtn) {
    phoneBtn.remove();
  }

  if (currentUser && currentUser.uid !== uid && peerId) {
    phoneBtn.setAttribute('id', peerId);

    if (FriendlyChat.CALL_EVENTLISTERS[uid]) {
      phoneBtn.removeEventListener('click', FriendlyChat.CALL_EVENTLISTERS[uid]);
    }

    var phoneIcon = phoneBtn.querySelector('.material-icons');

    if (this.peer.connections[peerId]) {
      phoneIcon.textContent = 'call_end';

      FriendlyChat.CALL_EVENTLISTERS[uid] = function () {
        this.endCall();
      }.bind(this);

    } else {
      phoneIcon.textContent = 'call';

      FriendlyChat.CALL_EVENTLISTERS[uid] = function () {
        this.callToUser(peerId);
      }.bind(this);
    }

    phoneBtn.addEventListener('click', FriendlyChat.CALL_EVENTLISTERS[uid]);
  }

  // Show the card fading-in.
  setTimeout(function() {div.classList.add('visible')}, 1);
};

FriendlyChat.prototype.initMeidaStream = function (cb) {
  navigator.getUserMedia({audio: true, video: false}, function (stream) {
    this.mediaStream = stream;
    document.getElementById('myVideo').setAttribute('src', URL.createObjectURL(stream));
    cb();
  }.bind(this),
  function (err) {
    console.error(err);
  }.bind(this));
};

FriendlyChat.prototype.initPeerJs = function() {
  if (this.checkSignedInWithMessage()) {
    var currentUser = this.auth.currentUser;
    // Initialize PeerJs
    this.peer = new Peer({key: 'd83398ad-b951-45ed-8fc4-44464b10a697'});
    this.peer.on('open', function (peerId) {
      this.peerId = peerId;
      this.saveUser();
    }.bind(this))
    this.peer.on('call',       this.reciveCall.bind(this));
    this.peer.on('close',      this.endPeerJs.bind(this));
    this.peer.on('error', function (err) {
      console.error(err);
      this.endPeerJs();
    }.bind(this));
  }
};

FriendlyChat.prototype.endPeerJs = function() {
  if (this.peer) {
    this.peer.destroy();
    this.peer = null;
  }
};

FriendlyChat.prototype.callToUser = function(peerId) {
  if (!this.mediaStream) {
    return this.initMeidaStream(this.callToUser.bind(this));
  }

  if (!this.peer) {
    this.initPeerJs();
  }

  if (this.call) {
    this.endCall();    
  }

  this.call = this.peer.call(peerId, this.mediaStream);
  this.call.on('close', this.endCall.bind(this));
  this.call.on('error', function (err) {
    console.error(err);
    this.endCall();
  }.bind(this));

  this.reloadUsers();
};

FriendlyChat.prototype.getUserByPeerId = function(peerId) {
  var div  = document.getElementById(peerId);
  var uid  = div.parentNode.getAttribute('id');
  var name = div.parentNode.querySelector('.name').textContent;
  return {
    uid: uid,
    name: name,
    peerId: peerId
  }
};

FriendlyChat.prototype.reciveCall = function (call) {
  var user = this.getUserByPeerId(call.peer);
  var data = {
    message: 'Calling From ' + user.name,
    timeout: 6000,
    actionHandler: function () {
      this.answerCall(user, call);
    }.bind(this),
    actionText: 'Answer'
  };
  this.signInSnackbar.MaterialSnackbar.showSnackbar(data);
};

FriendlyChat.prototype.answerCall = function (user, call) {
  if (this.call) {
    this.endCall();
  }
  this.call = call;
  this.call.answer(this.mediaStream);
  this.call.on('stream', function (stream) {
    document.getElementById('peerVideo').setAttribute('src', URL.createObjectURL(stream));
  }.bind(this));
  this.call.on('error', function (err) {
    console.error(err);
    this.endCall();
  }.bind(this));

  this.reloadUsers();
};

FriendlyChat.prototype.endCall = function () {
  if (this.call) {
    this.call.close();
    this.call = null;
    this.reloadUsers();
  }
};

window.onload = function() {
  window.friendlyChat = new FriendlyChat();
};
