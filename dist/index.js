'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.makeQueueDriver = exports.makeFirebaseDriver = exports.makeAuthDriver = exports.LOGOUT = exports.REDIRECT = exports.POPUP = undefined;

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol ? "symbol" : typeof obj; };

var _rx = require('rx');

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

var POPUP = exports.POPUP = 'popup';
var REDIRECT = exports.REDIRECT = 'redirect';
var LOGOUT = exports.LOGOUT = 'logout';

// streams used in drivers

var FirebaseStream = function FirebaseStream(ref, evtName) {
  return _rx.Observable.create(function (obs) {
    return ref.on(evtName, function (snap) {
      return obs.onNext(snap);
    });
  }).map(function (snap) {
    return { key: snap.key(), val: snap.val() };
  }).distinctUntilChanged();
};

var ValueStream = function ValueStream(ref) {
  return FirebaseStream(ref, 'value').pluck('val').shareReplay(1);
};

var ChildAddedStream = function ChildAddedStream(ref) {
  return FirebaseStream(ref, 'child_added').share();
};

// factory takes a FB reference, returns a driver
// source: produces a stream of auth state updates from Firebase.onAuth
// sink: consumes a stream of {type,provider} actions where
//  type: POPUP, REDIRECT, or LOGOUT actions
//  provider: optional 'google' or 'facebook' for some actions
var makeAuthDriver = exports.makeAuthDriver = function makeAuthDriver(ref) {
  var _actionMap;

  var auth$ = _rx.Observable.create(function (obs) {
    return ref.onAuth(function (auth) {
      return obs.onNext(auth);
    });
  });
  var scope = 'email';

  var actionMap = (_actionMap = {}, _defineProperty(_actionMap, POPUP, function (prov) {
    return ref.authWithOAuthPopup(prov, function () {}, { scope: scope });
  }), _defineProperty(_actionMap, REDIRECT, function (prov) {
    return ref.authWithOAuthRedirect(prov, function () {}, { scope: scope });
  }), _defineProperty(_actionMap, LOGOUT, function (prov) {
    return ref.unauth(prov);
  }), _actionMap);

  return function (input$) {
    input$.subscribe(function (_ref) {
      var type = _ref.type;
      var provider = _ref.provider;

      console.log('auth$ received', type, provider);
      actionMap[type](provider);
    });
    var stream = auth$.distinctUntilChanged().replay(null, 1);
    var disposable = stream.connect();
    stream.dispose = function () {
      return disposable.dispose();
    };
    return stream;
  };
};

// factory takes a FB reference, returns a driver
// source: a function that takes ...args that resolve to a firebase path
//  each object is used to build a fb query (eg orderByChild, equalTo, etc)
//  anything else is treated as a FB key with a chained call to .child
// sinks: none.  to write, see makeQueueDriver
var makeFirebaseDriver = exports.makeFirebaseDriver = function makeFirebaseDriver(ref) {
  var cache = {};
  var compositeDisposable = new _rx.CompositeDisposable();

  // there are other chainable firebase query buiders, this is wot we need now
  var query = function query(parentRef, _ref2) {
    var orderByChild = _ref2.orderByChild;
    var equalTo = _ref2.equalTo;

    var childRef = parentRef;
    if (orderByChild) {
      childRef = childRef.orderByChild(orderByChild);
    }
    if (equalTo) {
      childRef = childRef.equalTo(equalTo);
    }
    return childRef;
  };

  // used to build fb ref, each value passed is either child or k:v query def
  var chain = function chain(a, v) {
    return (typeof v === 'undefined' ? 'undefined' : _typeof(v)) === 'object' && query(a, v) || a.child(v);
  };

  // building query from fb api is simply mapping the args to chained fn calls
  var build = function build(args) {
    var stream = ValueStream(args.reduce(chain, ref)).replay(null, 1);
    var disposable = stream.connect();
    compositeDisposable.add(disposable);
    return stream;
  };

  // SIDE EFFECT: build and add to cache if not in cache
  var cacheOrBuild = function cacheOrBuild(key, args) {
    return cache[key] || (cache[key] = build(args));
  };

  return function firebaseDriver() {
    var fn = function fn() {
      for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }

      return cacheOrBuild(JSON.stringify(args), args);
    };
    fn.dispose = function () {
      return compositeDisposable.dispose();
    };
    return fn;
  };
};

var deleteResponse = function deleteResponse(ref, listenerKey, responseKey) {
  console.log('removing', ref.key(), listenerKey, responseKey);
  ref.child(listenerKey).child(responseKey).remove();
};

// talks to FirebaseQueue on the backend
// factory takes FB ref, plus path names for src and dest locs, returns driver
// source: a function, called with key, returns stream of new items on that key
// sink: consumes objects that it pushes to the destination reference
var makeQueueDriver = exports.makeQueueDriver = function makeQueueDriver(ref) {
  var src = arguments.length <= 1 || arguments[1] === undefined ? 'responses' : arguments[1];
  var dest = arguments.length <= 2 || arguments[2] === undefined ? 'tasks' : arguments[2];
  return function ($input) {
    var srcRef = ref.child(src);
    var destRef = ref.child(dest);

    $input.doAction(function (x) {
      return console.log('queue input', x);
    }).subscribe(function (item) {
      return destRef.push(item);
    });

    return function (listenerKey) {
      return ChildAddedStream(srcRef.child(listenerKey)).doAction(function (_ref3) {
        var key = _ref3.key;
        return deleteResponse(srcRef, listenerKey, key);
      });
    };
  };
};