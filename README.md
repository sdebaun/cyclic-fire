# cyclic-fire

Yet another Cycle.js driver for the awesome BaaS [Firebase](http://www.firebase.com).

"I didn't like the others, they were too flat"

## Overview

There are three actual drivers in this package, you can use any or all of them as you wish:

* *makeAuthDriver* gives you a `source` stream of auth states that are the result of the onAuth handler from the firebase library.  It consumes a `sink` of objects that describe auth operations (login, logout)

* *makeFirebaseDriver* is a read-only driver that gives you a `source` function that you can call to hook into a stream of updates from a path or query against your firebase.  Internally, it caches these streams so that multiple calls to the same location or query wont create multiple streams.

* *makeQueueDriver* is (currently) a write-only driver that consumes a `sink` of objects that get written to a specific location on your firebase.  It is intended to be used with [FirebaseQueue](https://github.com/firebase/firebase-queue) handling writes to your firebase on a backend somewhere.

### Contributions

Development is driven by in-house developers at the Sparks.Network.  Public participation (up to and including pull requests) are welcome.  We are investigating ways to reward outside contributions to the code with both cash and equity.  Please email [Steve DeBaun](mailto://sdebaun@sparks.network) with suggestions!

## Example of Use

Taken from [sparks-cyclejs](http://github.com/sdebaun/sparks-cycle-js)

### Building the drivers

Pass any of the drivers you want to use a regular old firebase reference.  Commonly this will be the root of your FB instance, but it doesn't have to be.

`makeQueueDriver` also accepts two optional parameters, the names of paths within the root you pass that are used for the input and output of the queue.

```
// in your main...
import {run} from '@cycle/core'
import {makeDOMDriver} from 'cycle-snabbdom'

import Firebase from 'firebase'

import {
  makeAuthDriver, makeFirebaseDriver, makeQueueDriver,
} from 'cyclic-fire'

import Root from './root'

const fbRoot = new Firebase('http://sparks-development.firebaseio.com')

const {sources, sinks} = run(Root, {
  DOM: makeDOMDriver('#root'),
  firebase$: makeFirebaseDriver(fbRoot),
  auth$: makeAuthDriver(fbRoot),
  // responses and tasks are actually defaults if you don't specify
  queue$: makeQueueDriver(fbRoot.child('!queue'),'responses','tasks'),
})
```

### Using the Sources and Sinks

```
// in a component...
import {Observable} from 'rx'
import combineLatestObj from 'rx-combine-latest-obj'

import {div} from 'cycle-snabbdom'

import ProjectForm from 'components/ProjectForm'

// TODO: move to helpers/dom
const rows = obj =>
  Object.keys(obj).map(k => ({$key: k, ...obj[k]}))

const renderProjects = projects =>
  rows(projects).map(({name}) => div({}, [name]))

const _DOM = ({projects, formDOM}) =>
  div({}, [
    formDOM,
    div({},renderProjects(projects)),
  ])

export default sources => {
  // args passed to firebase driver describe a path or query on your firebase
  const projects$ = sources.firebase('Projects')
    .startWith([])

  const projectForm = ProjectForm(sources)

  // the new 
  const newProject$ = Observable.combineLatest(
      sources.auth$, projectForm.project$,
      (auth, project) => ({...project, uid: auth && auth.uid})
    )

  // within _DOM, projects will contain the contents of 'Projects'
  const DOM = combineLatestObj({projects$, formDOM$: projectForm.DOM}).map(_DOM)

  return {
    DOM,
    queue$: newProject$,
  }
}
```

