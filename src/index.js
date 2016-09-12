import {Observable, CompositeDisposable} from 'rx'

export const POPUP = 'popup'
export const REDIRECT = 'redirect'
export const LOGOUT = 'logout'

// streams used in drivers

const FirebaseStream = (ref,evtName) =>
  Observable.create(obs => ref.on(evtName, (snap) => obs.onNext(snap)))
    .map(snap => ({key: snap.key, val: snap.val()}))
    .distinctUntilChanged()

const ValueStream = ref => FirebaseStream(ref,'value').pluck('val')
  .shareReplay(1)

const ChildAddedStream = ref => FirebaseStream(ref,'child_added')
  .share()

// factory takes a FB reference, returns a driver
// source: produces a stream of auth state updates from Firebase.onAuth
// sink: consumes a stream of {type,provider} actions where
//  type: POPUP, REDIRECT, or LOGOUT actions
//  provider: optional 'google' or 'facebook' for some actions
export const makeAuthDriver = firebase => {
  if (firebase.authMigrator) {
    firebase.authMigrator().migrate().then(user => {
      if (!user) {
        return
      }
    }).catch(error => {
      console.log('auth migration error:', error)
    })
  }

  // Maps an action string to a function in Firebase auth
  const actionMap = {
    [POPUP]: prov => firebase.auth().signInWithPopup(prov),
    [REDIRECT]: prov => firebase.auth().signInWithRedirect(prov),
    [LOGOUT]: () => firebase.auth().signOut(),
  }

  /**
  * Create the auth stream that emits a user.
  *
  *  - Listens for getRedirectResult first. If that has a user then it emits
  *    that user. Otherwise it sets a flag that we've dealt with redirects
  *
  *  - Emits the user (or null) from onAuthStateChanged, but only once the
  *    redirect result is known.
  */
  const auth$ = Observable.create(observer => {
    let hasRedirectResult = false

    // This function calls the observer only when hasRedirectResult is true
    const nextUser = user => {
      if (hasRedirectResult) { observer.onNext(user) }
    }

    // Add onAuthStateChanged listener
    const unsubscribe = firebase.auth().onAuthStateChanged(user => {
      if (user && firebase.authMigrator) {
        firebase.authMigrator().clearLegacyAuth()
      }

      nextUser(user)
    })

    // getRedirectResult listener
    firebase.auth().getRedirectResult().then(result => {
      hasRedirectResult = true

      if (result.user) {
        nextUser(result.user)
      }
    })
    // Always set the flag
    .catch(() => {
      hasRedirectResult = true
    })

    return unsubscribe
  })

  /**
   * When given a name this will return an object created from the firebase
   * auth classes. Example, giving 'google' will return an instance of
   * firebase.auth.GoogleAuthProvider.
   *
   * @param {string} name
   * @returns {Object}
   */
  function providerObject(name) {
    if (typeof name === 'string') {
      const className = name[0].toUpperCase() + name.slice(1) + 'AuthProvider'
      return new firebase.auth[className]()
    }
    return name
  }

  /**
  * Perform an authentication action. The input should have provider and type,
  * plus the optional scopes array.
  *
  * @param {Object} input
  * @param {Object|string} input.provider
  * @param {string} input.type 'popup', 'redirect' or 'logout'
  * @param {Array<string>} input.scopes a list of OAuth scopes to add to the
  *   provider
  * @return {void}
  */
  function authAction(input) {
    console.log(input)
    const provider = providerObject(input.provider)
    const scopes = input.scopes || []

    for (let scope of scopes) {
      provider.addScope(scope)
    }

    const action = actionMap[input.type]
    return action(provider)
  }

  function authDriver(input$) {
    const inputSubscription = input$.subscribe(authAction)

    let stream = auth$.distinctUntilChanged().replay(null, 1)
    const disposable = stream.connect()
    stream.dispose = () => {
      disposable.dispose()
      inputSubscription.dispose()
    }
    return stream
  }

  return authDriver
}

// factory takes a FB reference, returns a driver
// source: a function that takes ...args that resolve to a firebase path
//  each object is used to build a fb query (eg orderByChild, equalTo, etc)
//  anything else is treated as a FB key with a chained call to .child
// sinks: none.  to write, see makeQueueDriver
export const makeFirebaseDriver = ref => {
  const cache = {}
  const compositeDisposable = new CompositeDisposable()

  // there are other chainable firebase query buiders, this is wot we need now
  const query = (parentRef,{orderByChild,equalTo}) => {
    let childRef = parentRef
    if (orderByChild) { childRef = childRef.orderByChild(orderByChild) }
    if (equalTo) { childRef = childRef.equalTo(equalTo) }
    return childRef
  }

  // used to build fb ref, each value passed is either child or k:v query def
  const chain = (a,v) => typeof v === 'object' && query(a,v) || a.child(v)

  // building query from fb api is simply mapping the args to chained fn calls
  const build = (args) => {
    const stream = ValueStream(args.reduce(chain,ref)).replay(null, 1)
    const disposable = stream.connect()
    compositeDisposable.add(disposable)
    return stream
  }

  // SIDE EFFECT: build and add to cache if not in cache
  const cacheOrBuild = (key,args) => cache[key] || (cache[key] = build(args))

  return function firebaseDriver() {
    let fn = (...args) => cacheOrBuild(JSON.stringify(args),args)
    fn.dispose = () => compositeDisposable.dispose()
    return fn
  }
}

const deleteResponse = (ref, listenerKey, responseKey) => {
  console.log('removing',ref.key,listenerKey,responseKey)
  ref.child(listenerKey).child(responseKey).remove()
}

// talks to FirebaseQueue on the backend
// factory takes FB ref, plus path names for src and dest locs, returns driver
// source: a function, called with key, returns stream of new items on that key
// sink: consumes objects that it pushes to the destination reference
export const makeQueueDriver = (ref, src = 'responses', dest = 'tasks') =>
  $input => {
    const srcRef = ref.child(src)
    const destRef = ref.child(dest)

    $input
      .doAction(x => console.log('queue input',x))
      .subscribe(item => destRef.push(item))

    return listenerKey =>
      ChildAddedStream(srcRef.child(listenerKey))
        .doAction(({key}) => deleteResponse(srcRef,listenerKey,key))
  }
