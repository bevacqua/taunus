'use strict';

var raf = require('raf');
var clone = require('./clone');
var emitter = require('./emitter');
var fetcher = require('./fetcher');
var prefetcher = require('./prefetcher');
var view = require('./view');
var router = require('./router');
var state = require('./state');
var document = require('./global/document');
var location = require('./global/location');
var history = require('./global/history');
var versioning = require('../versioning');

function modern () { // needs to be a function because testing
  return history && history.modern !== false;
}

function go (url, options) {
  var o = options || {};
  var direction = o.replaceState ? 'replaceState' : 'pushState';
  var context = o.context || null;
  var route = router(url);
  if (!route) {
    if (o.strict !== true) {
      global.DEBUG && global.DEBUG('[activator] redirecting to %s', url);
      location.href = url;
    }
    return;
  }

  global.DEBUG && global.DEBUG('[activator] route matches %s', route.route);

  var notForced = o.force !== true;
  var same = router.equals(route, state.route);
  if (same && notForced) {
    if (route.parts.hash) {
      global.DEBUG && global.DEBUG('[activator] same route and hash, updating scroll position');
      scrollInto(id(route.parts.hash), o.scroll);
      navigation(route, state.model, direction);
      return; // anchor hash-navigation on same page ignores router
    }
    global.DEBUG && global.DEBUG('[activator] same route, resolving');
    resolved(state.model);
    return;
  }

  global.DEBUG && global.DEBUG('[activator] %s', notForced ? 'not same route as before' : 'forced to fetch same route');

  if (!modern()) {
    global.DEBUG && global.DEBUG('[activator] not modern, redirecting to %s', url);
    location.href = url;
    return;
  }

  global.DEBUG && global.DEBUG('[activator] fetching %s', route.url);
  prefetcher.abortIntent();
  fetcher.abortPending();
  fetcher(route, { element: context, source: 'intent' }, maybeResolved);

  function maybeResolved (err, data) {
    if (err) {
      return;
    }
    if (data.version !== state.version) {
      global.DEBUG && global.DEBUG('[activator] version change (is "%s", was "%s"), redirecting to %s', data.version, state.version, url);
      location.href = url; // version change demands fallback to strict navigation
      return;
    }
    if ('redirectTo' in data) {
      global.DEBUG && global.DEBUG('[activator] redirect detected in response, redirecting to %s', data.redirectTo);
      location.href = data.redirectTo; // redirects typically represent layout changes, we should follow them
      return;
    }
    resolved(data.model);
  }

  function resolved (model) {
    var same = router.equals(route, state.route);
    navigation(route, model, same ? 'replaceState' : direction);
    view(state.container, null, model, route);
    scrollInto(id(route.parts.hash), o.scroll);
  }
}

function start (data) {
  if (data.version !== state.version) {
    global.DEBUG && global.DEBUG('[activator] version change, reloading browser');
    location.reload(); // version may change between Taunus loading and a model becoming available
    return;
  }
  var model = data.model;
  var route = router(location.href);
  navigation(route, model, 'replaceState');
  emitter.emit('start', state.container, model, route);
  global.DEBUG && global.DEBUG('[activator] started, executing client-side controller');
  view(state.container, null, model, route, { render: false });
  global.onpopstate = back;
}

function back (e) {
  var s = e.state;
  var empty = !s || !s.__taunus;
  if (empty) {
    return;
  }
  global.DEBUG && global.DEBUG('[activator] backwards history navigation with state', s);
  var model = s.model;
  var route = router(location.href);
  navigation(route, model, 'replaceState');
  view(state.container, null, model, route);
  scrollInto(id(route.parts.hash));
}

function scrollInto (id, enabled) {
  if (enabled === false) {
    return;
  }
  global.DEBUG && global.DEBUG('[activator] scrolling into "%s"', id || '#document');

  var elem = id && document.getElementById(id) || document.documentElement;
  if (elem && elem.scrollIntoView) {
    raf(scrollSoon);
  }

  function scrollSoon () {
    elem.scrollIntoView();
  }
}

function id (hash) {
  return orEmpty(hash).substr(1);
}

function orEmpty (value) {
  return value || '';
}

function navigation (route, model, direction) {
  var data;

  global.DEBUG && global.DEBUG('[activator] history :%s %s', direction.replace('State', ''), route.url);
  state.route = route;
  state.model = clone(model);
  if (model.title) {
    document.title = model.title;
  }
  if (modern() && history[direction]) {
    data = {
      __taunus: true,
      model: model
    };
    history[direction](data, model.title, route.url);
  }
}

module.exports = {
  start: start,
  go: go
};
