/*!
 * flowplayer.js @VERSION. The Flowplayer API
 *
 * Copyright 2009 Flowplayer Oy
 *
 * This file is part of Flowplayer.
 *
 * Flowplayer is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Flowplayer is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Flowplayer.  If not, see <http://www.gnu.org/licenses/>.
 *
 * Date: @DATE
 * Revision: @REVISION
 */
(function() {

/*
    FEATURES
    --------
    - $f() and flowplayer() functions
    - handling multiple instances
    - Flowplayer programming API
    - Flowplayer event model
    - player loading / unloading
    - jQuery support
*/


/*jslint glovar: true, browser: true */
/*global flowplayer, $f */

// {{{ private utility methods

    function log(args) {
        console.log("$f.fireEvent", [].slice.call(args));
    }


    // thanks: http://keithdevens.com/weblog/archive/2007/Jun/07/javascript.clone
    function clone(obj) {
        if (!obj || typeof obj != 'object') { return obj; }
        var temp = new obj.constructor();
        for (var key in obj) {
            if (obj.hasOwnProperty(key)) {
                temp[key] = clone(obj[key]);
            }
        }
        return temp;
    }

    // stripped from jQuery, thanks John Resig
    function each(obj, fn) {
        if (!obj) { return; }

        var name, i = 0, length = obj.length;

        // object
        if (length === undefined) {
            for (name in obj) {
                if (fn.call(obj[name], name, obj[name]) === false) { break; }
            }

        // array
        } else {
            for (var value = obj[0];
                i < length && fn.call( value, i, value ) !== false; value = obj[++i]) {
            }
        }

        return obj;
    }


    // convenience
    function el(id) {
        return document.getElementById(id);
    }


    // used extensively. a very simple implementation.
    function extend(to, from, skipFuncs) {
        if (typeof from != 'object') { return to; }

        if (to && from) {
            each(from, function(name, value) {
                if (!skipFuncs || typeof value != 'function') {
                    to[name] = value;
                }
            });
        }

        return to;
    }

    // var arr = select("elem.className");
    function select(query) {
        var index = query.indexOf(".");
        if (index != -1) {
            var tag = query.slice(0, index) || "*";
            var klass = query.slice(index + 1, query.length);
            var els = [];
            each(document.getElementsByTagName(tag), function() {
                if (this.className && this.className.indexOf(klass) != -1) {
                    els.push(this);
                }
            });
            return els;
        }
    }

    // fix event inconsistencies across browsers
    function stopEvent(e) {
        e = e || window.event;

        if (e.preventDefault) {
            e.stopPropagation();
            e.preventDefault();

        } else {
            e.returnValue = false;
            e.cancelBubble = true;
        }
        return false;
    }

    // push an event listener into existing array of listeners
    function bind(to, evt, fn) {
        to[evt] = to[evt] || [];
        to[evt].push(fn);
    }


    // generates an unique id
   function makeId() {
      return "_" + ("" + Math.random()).slice(2, 10);
   }

//}}}


// {{{ Clip

    var Clip = function(json, index, player) {

        // private variables
        var self = this,
             cuepoints = {},
             listeners = {};

        self.index = index;

        // instance variables
        if (typeof json == 'string') {
            json = {url:json};
        }

        extend(this, json, true);

        // event handling
        each(("Begin*,Start,Pause*,Resume*,Seek*,Stop*,Finish*,LastSecond,Update,BufferFull,BufferEmpty,BufferStop").split(","),
            function() {

            var evt = "on" + this;

            // before event
            if (evt.indexOf("*") != -1) {
                evt = evt.slice(0, evt.length -1);
                var before = "onBefore" + evt.slice(2);

                self[before] = function(fn) {
                    bind(listeners, before, fn);
                    return self;
                };
            }

            self[evt] = function(fn) {
                bind(listeners, evt, fn);
                return self;
            };


            // set common clip event listeners to player level
            if (index == -1) {
                if (self[before]) {
                    player[before] = self[before];
                }
                if (self[evt])  {
                    player[evt] = self[evt];
                }
            }

        });

        extend(this, {

            onCuepoint: function(points, fn) {

                // embedded cuepoints
                if (arguments.length == 1) {
                    cuepoints.embedded = [null, points];
                    return self;
                }

                if (typeof points == 'number') {
                    points = [points];
                }

                var fnId = makeId();
                cuepoints[fnId] = [points, fn];

                if (player.isLoaded()) {
                    player._api().fp_addCuepoints(points, index, fnId);
                }

                return self;
            },

            update: function(json) {
                extend(self, json);

                if (player.isLoaded()) {
                    player._api().fp_updateClip(json, index);
                }
                var conf = player.getConfig();
                var clip = (index == -1) ? conf.clip : conf.playlist[index];
                extend(clip, json, true);
            },


            // internal event for performing clip tasks. should be made private someday
            _fireEvent: function(evt, arg1, arg2, target) {
                if (evt == 'onLoad') {
                    each(cuepoints, function(key, val) {
                        if (val[0]) {
                            player._api().fp_addCuepoints(val[0], index, key);
                        }
                    });
                    return false;
                }

                // target clip we are working against
                target = target || self;

                if (evt == 'onCuepoint') {
                    var fn = cuepoints[arg1];
                    if (fn) {
                        return fn[1].call(player, target, arg2);
                    }
                }

                // 1. clip properties, 2-3. metadata, 4. updates, 5. resumes from nested clip
                if (arg1 && "onBeforeBegin,onMetaData,onStart,onUpdate,onResume".indexOf(evt) != -1) {
                    // update clip properties
                    extend(target, arg1);

                    if (arg1.metaData) {
                        if (!target.duration) {
                            target.duration = arg1.metaData.duration;
                        } else {
                            target.fullDuration = arg1.metaData.duration;
                        }
                    }
                }


                var ret = true;
                each(listeners[evt], function() {
                    ret = this.call(player, target, arg1, arg2);
                });
                return ret;
            }

        });


        // get cuepoints from config
        if (json.onCuepoint) {
            var arg = json.onCuepoint;
            self.onCuepoint.apply(self, typeof arg == 'function' ? [arg] : arg);
            delete json.onCuepoint;
        }

        // get other events
        each(json, function(key, val) {

            if (typeof val == 'function') {
                bind(listeners, key, val);
                delete json[key];
            }

        });


        // setup common clip event callbacks for Player object too (shortcuts)
        if (index == -1) {
            player.onCuepoint = this.onCuepoint;
        }

    };

//}}}


// {{{ Plugin

    var Plugin = function(name, json, player, fn) {

        var self = this,
             listeners = {},
             hasMethods = false;

        if (fn) {
            extend(listeners, fn);
        }

        // custom callback functions in configuration
        each(json, function(key, val) {
            if (typeof val == 'function') {
                listeners[key] = val;
                delete json[key];
            }
        });

        // core plugin methods
        extend(this, {

            // speed and fn are optional
            animate: function(props, speed, fn) {
                if (!props) {
                    return self;
                }

                if (typeof speed == 'function') {
                    fn = speed;
                    speed = 500;
                }

                if (typeof props == 'string') {
                    var key = props;
                    props = {};
                    props[key] = speed;
                    speed = 500;
                }

                if (fn) {
                    var fnId = makeId();
                    listeners[fnId] = fn;
                }

                if (speed === undefined) { speed = 500; }
                json = player._api().fp_animate(name, props, speed, fnId);
                return self;
            },

            css: function(props, val) {
                if (val !== undefined) {
                    var css = {};
                    css[props] = val;
                    props = css;
                }
                json = player._api().fp_css(name, props);
                extend(self, json);
                return self;
            },

            show: function() {
                this.display = 'block';
                player._api().fp_showPlugin(name);
                return self;
            },

            hide: function() {
                this.display = 'none';
                player._api().fp_hidePlugin(name);
                return self;
            },

            // toggle between visible / hidden state
            toggle: function() {
                this.display = player._api().fp_togglePlugin(name);
                return self;
            },

            fadeTo: function(o, speed, fn) {

                if (typeof speed == 'function') {
                    fn = speed;
                    speed = 500;
                }

                if (fn) {
                    var fnId = makeId();
                    listeners[fnId] = fn;
                }
                this.display = player._api().fp_fadeTo(name, o, speed, fnId);
                this.opacity = o;
                return self;
            },

            fadeIn: function(speed, fn) {
                return self.fadeTo(1, speed, fn);
            },

            fadeOut: function(speed, fn) {
                return self.fadeTo(0, speed, fn);
            },

            getName: function() {
                return name;
            },

            getPlayer: function() {
                return player;
            },

            // internal method. should be made private some day
         _fireEvent: function(evt, arg, arg2) {

            // update plugins properties & methods
            if (evt == 'onUpdate') {
               var json = player._api().fp_getPlugin(name);
                    if (!json) { return;    }

               extend(self, json);
               delete self.methods;

               if (!hasMethods) {
                  each(json.methods, function() {
                     var method = "" + this;

                     self[method] = function() {
                        var a = [].slice.call(arguments);
                        var ret = player._api().fp_invoke(name, method, a);
                        return ret === 'undefined' || ret === undefined ? self : ret;
                     };
                  });
                  hasMethods = true;
               }
            }

            // plugin callbacks
            var fn = listeners[evt];

            if (fn) {
                var ret = fn.apply(self, arg);

                // "one-shot" callback
                if (evt.slice(0, 1) == "_") {
                    delete listeners[evt];
                }

                return ret;
            }

            return self;
         }

        });

    };


//}}}


function Player(wrapper, params, conf) {

    // private variables (+ arguments)
    var self = this,
        api = null,
        isUnloading = false,
        html,
        commonClip,
        playlist = [],
        plugins = {},
        listeners = {},
        playerId,
        apiId,

        // n'th player on the page
        playerIndex,

        // active clip's index number
        activeIndex,

        swfHeight,
        wrapperHeight;


// {{{ public methods

    extend(self, {

        id: function() {
            return playerId;
        },

        isLoaded: function() {
            return (api !== null && api.fp_play !== undefined && !isUnloading);
        },

        getParent: function() {
            return wrapper;
        },

        hide: function(all) {
            if (all) { wrapper.style.height = "0px"; }
            if (self.isLoaded()) { api.style.height = "0px"; }
            return self;
        },

        show: function() {
            wrapper.style.height = wrapperHeight + "px";
            if (self.isLoaded()) { api.style.height = swfHeight + "px"; }
            return self;
        },

        isHidden: function() {
            return self.isLoaded() && parseInt(api.style.height, 10) === 0;
        },

        load: function(fn) {
            if (!self.isLoaded() && self._fireEvent("onBeforeLoad") !== false) {
                var onPlayersUnloaded = function() {
                    html = wrapper.innerHTML;

                    // do not use splash as alternate content for flashembed
                    if (html && !flashembed.isSupported(params.version)) {
                        wrapper.innerHTML = "";
                    }

                    // onLoad listener given as argument
                    if (fn) {
                        fn.cached = true;
                        bind(listeners, "onLoad", fn);
                    }

                    // install Flash object inside given container
                    flashembed(wrapper, params, {config: conf});
                };


                // unload all instances
                var unloadedPlayersNb = 0;
                each(players, function()  {
                    this.unload(function(wasUnloaded) {
                        if ( ++unloadedPlayersNb == players.length ) {
                            onPlayersUnloaded();
                        }
                    });
                });
            }

            return self;
        },

        unload: function(fn) {


            // if we are fullscreen on safari, we can't unload as it would crash the PluginHost, sorry
            if (this.isFullscreen() && /WebKit/i.test(navigator.userAgent)) {
                if ( fn ) { fn(false); }
                return self;
            }


            // unload only if in splash state
            if (html.replace(/\s/g,'') !== '') {

                if (self._fireEvent("onBeforeUnload") === false) {
                    if ( fn ) { fn(false); }
                    return self;
                }

                isUnloading = true;
                // try closing
                try {
                    if (api) {
                        api.fp_close();

                        // fire unload only when API is present
                        self._fireEvent("onUnload");
                    }
                } catch (error) {}

                var clean = function() {
                    api = null;
                    wrapper.innerHTML = html;
                    isUnloading = false;

                    if ( fn ) { fn(true); }
                };

                setTimeout(clean, 50);
            }
            else if ( fn ) { fn(false); }

            return self;

        },

        getClip: function(index) {
            if (index === undefined) {
                index = activeIndex;
            }
            return playlist[index];
        },


        getCommonClip: function() {
            return commonClip;
        },

        getPlaylist: function() {
            return playlist;
        },

      getPlugin: function(name) {
         var plugin = plugins[name];

            // create plugin if nessessary
         if (!plugin && self.isLoaded()) {
                var json = self._api().fp_getPlugin(name);
                if (json) {
                    plugin = new Plugin(name, json, self);
                    plugins[name] = plugin;
                }
         }
         return plugin;
      },

        getScreen: function() {
            return self.getPlugin("screen");
        },

        getControls: function() {
            return self.getPlugin("controls")._fireEvent("onUpdate");
        },

        // 3.2
        getLogo: function() {
            try {
                return self.getPlugin("logo")._fireEvent("onUpdate");
            } catch (ignored) {}
        },

        // 3.2
        getPlay: function() {
            return self.getPlugin("play")._fireEvent("onUpdate");
        },


        getConfig: function(copy) {
            return copy ? clone(conf) : conf;
        },

        getFlashParams: function() {
            return params;
        },

        loadPlugin: function(name, url, props, fn) {

            // properties not supplied
            if (typeof props == 'function') {
                fn = props;
                props = {};
            }

            // if fn not given, make a fake id so that plugin's onUpdate get's fired
            var fnId = fn ? makeId() : "_";
            self._api().fp_loadPlugin(name, url, props, fnId);

            // create new plugin
            var arg = {};
            arg[fnId] = fn;
            var p = new Plugin(name, null, self, arg);
            plugins[name] = p;
            return p;
        },


        getState: function() {
            return self.isLoaded() ? api.fp_getState() : -1;
        },

        // "lazy" play
        play: function(clip, instream) {

            var p = function() {
                if (clip !== undefined) {
                    self._api().fp_play(clip, instream);
                } else {
                    self._api().fp_play();
                }
            };

            if (self.isLoaded()) {
                p();
            } else if ( isUnloading ) {
                setTimeout(function() {
                    self.play(clip, instream);
                }, 50);

            } else {
                self.load(function() {
                    p();
                });
            }

            return self;
        },

        getVersion: function() {
            var js = "flowplayer.js @VERSION";
            if (self.isLoaded()) {
                var ver = api.fp_getVersion();
                ver.push(js);
                return ver;
            }
            return js;
        },

        _api: function() {
            if (!self.isLoaded()) {
                throw "Flowplayer " +self.id()+ " not loaded when calling an API method";
            }
            return api;
        },

        setClip: function(clip) {
            self.setPlaylist([clip]);
            return self;
        },

        getIndex: function() {
            return playerIndex;
        },

        _swfHeight: function() {
            return api.clientHeight;
        }

    });


    // event handlers
    each(("Click*,Load*,Unload*,Keypress*,Volume*,Mute*,Unmute*,PlaylistReplace,ClipAdd,Fullscreen*,FullscreenExit,Error,MouseOver,MouseOut").split(","),
        function() {
            var name = "on" + this;

            // before event
            if (name.indexOf("*") != -1) {
                name = name.slice(0, name.length -1);
                var name2 = "onBefore" + name.slice(2);
                self[name2] = function(fn) {
                    bind(listeners, name2, fn);
                    return self;
                };
            }

            // normal event
            self[name] = function(fn) {
                bind(listeners, name, fn);
                return self;
            };
        }
    );


    // core API methods
    each(("pause,resume,mute,unmute,stop,toggle,seek,getStatus,getVolume,setVolume,getTime,isPaused,isPlaying,startBuffering,stopBuffering,isFullscreen,toggleFullscreen,reset,close,setPlaylist,addClip,playFeed,setKeyboardShortcutsEnabled,isKeyboardShortcutsEnabled").split(","),
        function() {
            var name = this;

            self[name] = function(a1, a2) {
                if (!self.isLoaded()) { return self; }
                var ret = null;

                // two arguments
                if (a1 !== undefined && a2 !== undefined) {
                    ret = api["fp_" + name](a1, a2);

                } else {
                    ret = (a1 === undefined) ? api["fp_" + name]() : api["fp_" + name](a1);

                }

                return ret === 'undefined' || ret === undefined ? self : ret;
            };
        }
    );

//}}}


// {{{ public method: _fireEvent

    self._fireEvent = function(a) {

        if (typeof a == 'string') { a = [a]; }

        var evt = a[0], arg0 = a[1], arg1 = a[2], arg2 = a[3], i = 0;
        if (conf.debug) { log(a); }

        // internal onLoad
        if (!self.isLoaded() && evt == 'onLoad' && arg0 == 'player') {

            api = api || el(apiId);
            swfHeight = self._swfHeight();

            each(playlist, function() {
                this._fireEvent("onLoad");
            });

            each(plugins, function(name, p) {
                p._fireEvent("onUpdate");
            });

            commonClip._fireEvent("onLoad");
        }

        // other onLoad events are skipped
        if (evt == 'onLoad' && arg0 != 'player') { return; }


        // "normalize" error handling
        if (evt == 'onError') {
            if (typeof arg0 == 'string' || (typeof arg0 == 'number' && typeof arg1 == 'number'))  {
                arg0 = arg1;
                arg1 = arg2;
            }
        }


      if (evt == 'onContextMenu') {
         each(conf.contextMenu[arg0], function(key, fn)  {
            fn.call(self);
         });
         return;
      }

        if (evt == 'onPluginEvent' || evt == 'onBeforePluginEvent') {
            var name = arg0.name || arg0;
            var p = plugins[name];

            if (p) {
                p._fireEvent("onUpdate", arg0);
                return p._fireEvent(arg1, a.slice(3));
            }
            return;
        }

        // replace whole playlist
        if (evt == 'onPlaylistReplace') {
            playlist = [];
            var index = 0;
            each(arg0, function() {
                playlist.push(new Clip(this, index++, self));
            });
        }

        // insert new clip to the playlist. arg0 = clip, arg1 = index
        if (evt == 'onClipAdd') {

            // instream clip additions are ignored at this point
            if (arg0.isInStream) { return; }

            // add new clip into playlist
            arg0 = new Clip(arg0, arg1, self);
            playlist.splice(arg1, 0, arg0);

            // increment index variable for the rest of the clips on playlist
            for (i = arg1 + 1; i < playlist.length; i++) {
                playlist[i].index++;
            }
        }


        var ret = true;

        // clip event
        if (typeof arg0 == 'number' && arg0 < playlist.length) {

            activeIndex = arg0;
            var clip = playlist[arg0];

            if (clip) {
                ret = clip._fireEvent(evt, arg1, arg2);
            }

            if (!clip || ret !== false) {
                // clip argument is given for common clip, because it behaves as the target
                ret = commonClip._fireEvent(evt, arg1, arg2, clip);
            }
        }


        // trigger player event
        each(listeners[evt], function() {
            ret = this.call(self, arg0, arg1);

            // remove cached entry
            if (this.cached) {
                listeners[evt].splice(i, 1);
            }

            // break loop
            if (ret === false) { return false;   }
            i++;

        });

        return ret;
    };

//}}}


// {{{ init

   function init() {
        // replace previous installation
        if ($f(wrapper)) {
            $f(wrapper).getParent().innerHTML = "";
            playerIndex = $f(wrapper).getIndex();
            players[playerIndex] = self;

        // register this player into global array of instances
        } else {
            players.push(self);
            playerIndex = players.length -1;
        }

        wrapperHeight = parseInt(wrapper.style.height, 10) || wrapper.clientHeight;

        // playerId
        playerId = wrapper.id || "fp" + makeId();
        apiId = params.id || playerId + "_api";
        params.id = apiId;
        conf.playerId = playerId;


        // plain url is given as config
        if (typeof conf == 'string') {
            conf = {clip:{url:conf}};
        }

        if (typeof conf.clip == 'string') {
            conf.clip = {url: conf.clip};
        }

        // common clip is always there
        conf.clip = conf.clip || {};


        // wrapper href as common clip's url
        if (wrapper.getAttribute("href", 2) && !conf.clip.url) {
            conf.clip.url = wrapper.getAttribute("href", 2);
        }

        commonClip = new Clip(conf.clip, -1, self);

        // playlist
        conf.playlist = conf.playlist || [conf.clip];

        var index = 0;

        each(conf.playlist, function() {

            var clip = this;

            /* sometimes clip is given as array. this is not accepted. */
            if (typeof clip == 'object' && clip.length) {
                clip = {url: "" + clip};
            }

            // populate common clip properties to each clip
            each(conf.clip, function(key, val) {
                if (val !== undefined && clip[key] === undefined && typeof val != 'function') {
                    clip[key] = val;
                }
            });

            // modify playlist in configuration
            conf.playlist[index] = clip;

            // populate playlist array
            clip = new Clip(clip, index, self);
            playlist.push(clip);
            index++;
        });

        // event listeners
        each(conf, function(key, val) {
            if (typeof val == 'function') {

                // common clip event
                if (commonClip[key]) {
                    commonClip[key](val);

                // player event
                } else {
                    bind(listeners, key, val);
                }

                // no need to supply for the Flash component
                delete conf[key];
            }
        });


        // plugins
        each(conf.plugins, function(name, val) {
            if (val) {
                plugins[name] = new Plugin(name, val, self);
            }
        });


        // setup controlbar plugin if not explicitly defined
        if (!conf.plugins || conf.plugins.controls === undefined) {
            plugins.controls = new Plugin("controls", null, self);
        }

        // setup canvas as plugin
        plugins.canvas = new Plugin("canvas", null, self);

        html = wrapper.innerHTML;

        // click function
        function doClick(e) {

            // ipad/iPhone --> follow the link if plugin not installed
            var hasiPadSupport = self.hasiPadSupport && self.hasiPadSupport();
            if (/iPad|iPhone|iPod/i.test(navigator.userAgent) && !/.flv$/i.test(playlist[0].url) && ! hasiPadSupport ) {
                return true;
            }

            if (!self.isLoaded() && self._fireEvent("onBeforeClick") !== false) {
                self.load();
            }
            return stopEvent(e);
        }

        function installPlayer() {
            // defer loading upon click
            if (html.replace(/\s/g, '') !== '') {

                if (wrapper.addEventListener) {
                    wrapper.addEventListener("click", doClick, false);

                } else if (wrapper.attachEvent) {
                    wrapper.attachEvent("onclick", doClick);
                }

            // player is loaded upon page load
            } else {

                // prevent default action from wrapper. (fixes safari problems)
                if (wrapper.addEventListener) {
                    wrapper.addEventListener("click", stopEvent, false);
                }
                // load player
                self.load();
            }
        }

        // now that the player is initialized, wait for the plugin chain to finish
        // before actually changing the dom
        setTimeout(installPlayer, 0);
    }

    // possibly defer initialization until DOM get's loaded
    if (typeof wrapper == 'string') {
        var node = el(wrapper);
        if (!node) { throw "Flowplayer cannot access element: " + wrapper; }
        wrapper = node;
        init();

    // we have a DOM element so page is already loaded
    } else {
        init();
    }


//}}}


}


// {{{ flowplayer() & statics

// container for player instances
var players = [];


// this object is returned when multiple player's are requested
function Iterator(arr) {

    this.length = arr.length;

    this.each = function(fn)  {
        each(arr, fn);
    };

    this.size = function() {
        return arr.length;
    };
}

// these two variables are the only global variables
window.flowplayer = window.$f = function() {
    var instance = null;
    var arg = arguments[0];

    // $f()
    if (!arguments.length) {
        each(players, function() {
            if (this.isLoaded())  {
                instance = this;
                return false;
            }
        });

        return instance || players[0];
    }

    if (arguments.length == 1) {

        // $f(index);
        if (typeof arg == 'number') {
            return players[arg];


        // $f(wrapper || 'containerId' || '*');
        } else {

            // $f("*");
            if (arg == '*') {
                return new Iterator(players);
            }

            // $f(wrapper || 'containerId');
            each(players, function() {
                if (this.id() == arg.id || this.id() == arg || this.getParent() == arg)  {
                    instance = this;
                    return false;
                }
            });

            return instance;
        }
    }

    // instance builder
    if (arguments.length > 1) {

        // flashembed parameters
        var params = arguments[1],
             conf = (arguments.length == 3) ? arguments[2] : {};


        if (typeof params == 'string') {
            params = {src: params};
        }

        params = extend({
            bgcolor: "#000000",
            version: [9, 0],
            expressInstall: "http://static.flowplayer.org/swf/expressinstall.swf",
            cachebusting: false

        }, params);

        if (typeof arg == 'string') {

            // select arg by classname
            if (arg.indexOf(".") != -1) {
                var instances = [];

                each(select(arg), function() {
                    instances.push(new Player(this, clone(params), clone(conf)));
                });

                return new Iterator(instances);

            // select node by id
            } else {
                var node = el(arg);
                return new Player(node !== null ? node : arg, params, conf);
            }


        // arg is a DOM element
        } else if (arg) {
            return new Player(arg, params, conf);
        }

    }

    return null;
};

extend(window.$f, {

    // called by Flash External Interface
    fireEvent: function() {
        var a = [].slice.call(arguments);
        var p = $f(a[0]);
        return p ? p._fireEvent(a.slice(1)) : null;
    },


    // create plugins by modifying Player's prototype
    addPlugin: function(name, fn) {
        Player.prototype[name] = fn;
        return $f;
    },

    // utility methods for plugin developers
    each: each,

    extend: extend
});


//}}}


//{{{ jQuery support

if (typeof jQuery == 'function') {

    jQuery.fn.flowplayer = function(params, conf) {

        // select instances
        if (!arguments.length || typeof arguments[0] == 'number') {
            var arr = [];
            this.each(function()  {
                var p = $f(this);
                if (p) {
                    arr.push(p);
                }
            });
            return arguments.length ? arr[arguments[0]] : new Iterator(arr);
        }

        // create flowplayer instances
        return this.each(function() {
            $f(this, clone(params), conf ? clone(conf) : {});
        });

    };

}

//}}}


})();
/**
 * flowplayer.controls.js [3.0.2]. Flowplayer JavaScript plugin.
 *
 * This file is part of Flowplayer, http://flowplayer.org
 *
 * Author: Tero Piirainen, <support@flowplayer.org>
 * Copyright (c) 2008 Flowplayer Ltd
 *
 * Dual licensed under MIT and GPL 2+ licenses
 * SEE: http://www.opensource.org/licenses
 *
 * Version: @VERSION - $Date
 */
$f.addPlugin("controls", function(wrap, options) {


//{{{ private functions

    function fixE(e) {
        if (typeof e == 'undefined') { e = window.event; }
        if (typeof e.layerX == 'undefined') { e.layerX = e.offsetX; }
        if (typeof e.layerY == 'undefined') { e.layerY = e.offsetY; }
        return e;
    }

    function w(e) {
        return e.clientWidth;
    }

    function offset(e) {
        return e.offsetLeft;
    }

    /* a generic dragger utility for hoirzontal dragging */
    function Draggable(o, min, max, offset) {
        var dragging = false;

        function foo() { }

        // callbacks
        o.onDragStart   = o.onDragStart || foo;
        o.onDragEnd     = o.onDragEnd   || foo;
        o.onDrag        = o.onDrag      || foo;

        function move(x) {
            var ret = true;
            // must be withing [min, max]
            if (x > max) { x = max; ret = false; }
            if (x < min) { x = min; ret = false; }
            o.style.left = x + "px";
            return ret;
        }

        function end() {
            document.onmousemove = o.ontouchmove = null;
            document.onmouseup   = o.ontouchend  = null;
            o.onDragEnd(parseInt(o.style.left, 10));
            dragging = false;
        }

        function drag(e) {
            e = e.touches ? e.touches.item(0) : e;
            e = fixE(e);
            var x = e.clientX - offset;
            if (move(x)) {
                dragging = true;
                o.onDrag(x);
            }
            return false;
        }

        o.onmousedown = o.ontouchstart = function(e)  {
            e = fixE(e);
            o.onDragStart(parseInt(o.style.left, 10));

            document.onmousemove = o.ontouchmove = drag;
            document.onmouseup = o.ontouchend = end;

            return false;
        };

        this.dragTo = function(x) {
            if (move(x)) {
                o.onDragEnd(x);
            }
        };

        this.setMax = function(val) {
            max = val;
        };

        this.isDragging = function() {
            return dragging;
        };

        return this;
    }



    function extend(to, from) {
        if (from) {
            for (key in from) {
                if (key) {
                    to[key] = from[key];
                }
            }
        }
    }

    function byClass(name) {
        var els = wrap.getElementsByTagName("*");
        var re = new RegExp("(^|\\s)" + name + "(\\s|$)");
        for (var i = 0; i < els.length; i++) {
            if (re.test(els[i].className)) {
                return els[i];
            }
        }
    }

    // prefix integer with zero when nessessary
    function pad(val) {
        val = parseInt(val, 10);
        return val >= 10 ? val : "0" + val;
    }

    // display seconds in hh:mm:ss format
    function toTime(sec) {

        var h = Math.floor(sec / 3600);
        var min = Math.floor(sec / 60);
        sec = sec - (min * 60);

        if (h >= 1) {
            min -= h * 60;
            return pad(h) + ":" + pad(min) + ":" + pad(sec);
        }

        return pad(min) + ":" + pad(sec);
    }

    function getTime(time, duration) {
        return "<span>" + toTime(time) + "</span> <strong>" + toTime(duration) + "</strong>";
    }

//}}}


    var self = this;

    var opts = {
        playHeadClass: 'playhead',
        trackClass: 'track',
        playClass: 'play',
        pauseClass: 'pause',
        bufferClass: 'buffer',
        progressClass: 'progress',

        timeClass: 'time',
        muteClass: 'mute',
        unmuteClass: 'unmute',
        duration: 0,

        template: '<a class="play">play</a>' +
                     '<div class="track">' +
                        '<div class="buffer"></div>' +
                        '<div class="progress"></div>' +
                        '<div class="playhead"></div>' +
                     '</div>' +
                     '<div class="time"></div>' +
                     '<a class="mute">mute</a>'
    };

    extend(opts, options);

    if (typeof wrap == 'string') {
        wrap = document.getElementById(wrap);
    }

    if (!wrap) { return;    }

    // inner HTML
    if (!wrap.innerHTML.replace(/\s/g, '')) {
        wrap.innerHTML = opts.template;
    }

    // get elements
    var ball = byClass(opts.playHeadClass);
    var bufferBar = byClass(opts.bufferClass);
    var progressBar = byClass(opts.progressClass);
    var track = byClass(opts.trackClass);
    var time = byClass(opts.timeClass);
    var mute = byClass(opts.muteClass);


    // initial time
    time.innerHTML = getTime(0, opts.duration);

    // get dimensions
    var trackWidth = w(track);
    var ballWidth = w(ball);

    // initialize draggable playhead
    var head = new Draggable(ball, 0, 0, offset(wrap) + offset(track) + (ballWidth / 2));

    // track click moves playHead
    track.onclick = function(e) {
        e = fixE(e);
        if (e.target == ball) { return false; }
        head.dragTo(e.layerX - ballWidth / 2);
    };

    // play/pause button
    var play = byClass(opts.playClass);

    play.onclick = function() {
        if (self.isLoaded()) {
            self.toggle();
        } else {
            self.play();
        }
    };

    // mute/unmute button
    mute.onclick = function() {
        if (self.getStatus().muted)  {
            self.unmute();
        } else {
            self.mute();
        }
    };

    // setup timer
    var timer = null;

    function getMax(len, total) {
        return parseInt(Math.min(len / total * trackWidth, trackWidth - ballWidth / 2), 10);
    }

    self.onStart(function(clip) {

        var duration = clip.duration || 0;

        // clear previous timer
        clearInterval(timer);

        // begin timer
        timer = setInterval(function()  {

            var status = self.getStatus();

            // time display
            if (status.time)  {
                time.innerHTML = getTime(status.time, clip.duration);
            }

            if (status.time === undefined) {
                clearInterval(timer);
                return;
            }

            // buffer width
            var x = getMax(status.bufferEnd, duration);
            bufferBar.style.width = x + "px";
            head.setMax(x);



            // progress width
            if (!self.isPaused() && !head.isDragging()) {
                x = getMax(status.time, duration);
                progressBar.style.width = x + "px";
                ball.style.left = (x -ballWidth / 2) + "px";
            }

        }, 500);
    });

    self.onBegin(function() {
        play.className = opts.pauseClass;
    });


    // pause / resume states
    self.onPause(function() {
        play.className = opts.playClass;
    });

    self.onResume(function() {
        play.className = opts.pauseClass;
    });


    // mute / unmute states
    self.onMute(function() {
        mute.className = opts.unmuteClass;
    });

    self.onUnmute(function() {
        mute.className = opts.muteClass;
    });


    // clear timer when clip ends
    self.onFinish(function(clip) {
        clearInterval(timer);
    });

    self.onUnload(function() {
        time.innerHTML = getTime(0, opts.duration);
    });


    ball.onDragEnd = function(x) {
        var to = parseInt(x / trackWidth  * 100, 10) + "%";
        progressBar.style.width = x + "px";
        if (self.isLoaded()) {
            self.seek(to);
        }
    };

    ball.onDrag = function(x) {
        progressBar.style.width = x + "px";
    };


    // return player instance to enable plugin chaining
    return self;

});




/**
 * flowplayer.embed.js [3.0.2]. Flowplayer JavaScript plugin.
 *
 * This file is part of Flowplayer, http://flowplayer.org
 *
 * Author: Tero Piirainen, <support@flowplayer.org>
 * Copyright (c) 2008 Flowplayer Ltd
 *
 * Dual licensed under MIT and GPL 2+ licenses
 * SEE: http://www.opensource.org/licenses
 *
 * Version: @VERSION - $Date
 */
(function() {

    // converts paths to absolute URL's as required in external sites
    function toAbsolute(url, base) {

        // http://some.com/path
        if (url.substring(0, 4) == "http") { return url; }

        if (base) {
            return base + (base.substring(base.length -1) != "/" ? "/" : "") + url;
        }

        // /some/path
        base = location.protocol + "//" + location.host;
        if (url.substring(0, 1) == "/") { return base + url; }

        // yet/another/path
        var path = location.pathname;
        path = path.substring(0, path.lastIndexOf("/"));
        return base + path + "/" + url;
    }


    // Flowplayer plugin implementation
    $f.addPlugin("embed", function(options) {

        var self = this;
        var conf = self.getConfig(true);


        // default configuration for flashembed
        var opts = {
            width: self.getParent().clientWidth || '100%',
            height: self.getParent().clientHeight || '100%',
            url: toAbsolute(self.getFlashParams().src),
            index: -1,
            allowfullscreen: true,
            allowscriptaccess: 'always'
        };

        // override defaults
        $f.extend(opts, options);
        opts.src = opts.url;
        opts.w3c = true;


        // not needed for external objects
        delete conf.playerId;
        delete opts.url;
        delete opts.index;


        // construct HTML code for the configuration
        this.getEmbedCode = function(runnable, index) {

            // selected clip only: given in argument or in configuration
            index = typeof index == 'number' ? index : opts.index;
            if (index >= 0) {
                conf.playlist = [ self.getPlaylist()[index] ];
            }

            // setup absolute path for each clip
            index = 0;
            $f.each(conf.playlist, function() {
                conf.playlist[index++].url = toAbsolute(this.url, this.baseUrl);
            });

            var html = flashembed.getHTML(opts, {config: conf});

            if (!runnable)  {
                html = html.replace(/\</g, "&lt;").replace(/\>/g, "&gt;");
            }

            return html;
        };

        return self;

    });

})();
/*!
 * flowplayer.playlist @VERSION. Flowplayer JavaScript plugin.
 *
 * This file is part of Flowplayer, http://flowplayer.org
 *
 * Author: Tero Piirainen, <info@flowplayer.org>
 * Copyright (c) 2008-2010 Flowplayer Ltd
 *
 * Dual licensed under MIT and GPL 2+ licenses
 * SEE: http://www.opensource.org/licenses
 *
 * Date: @DATE
 * Revision: @REVISION
 */
(function($) {

    $f.addPlugin("playlist", function(wrap, options) {


        // self points to current Player instance
        var self = this;

        var opts = {
            playingClass: 'playing',
            pausedClass: 'paused',
            progressClass:'progress',
            template: '<a href="${url}">${title}</a>',
            loop: false,
            playOnClick: true,
            manual: false
        };

        $.extend(opts, options);
        wrap = $(wrap);
        var manual = self.getPlaylist().length <= 1 || opts.manual;
        var els = null;


//{{{ "private" functions

        function toString(clip) {
            var el = template;

            $.each(clip, function(key, val) {
                if (!$.isFunction(val)) {
                    el = el.replace("$\{" +key+ "\}", val).replace("$%7B" +key+ "%7D", val);
                }
            });
            return el;
        }

        // assign onClick event for each clip
        function bindClicks() {
            els = getEls().unbind("click.playlist").bind("click.playlist", function() {
                return play($(this), els.index(this));
            });
        }

        function buildPlaylist() {
            wrap.empty();

            $.each(self.getPlaylist(), function() {
                wrap.append(toString(this));
            });

            bindClicks();
        }


        function play(el, clip)  {

            if (el.hasClass(opts.playingClass) || el.hasClass(opts.pausedClass)) {
                self.toggle();

            } else {
                el.addClass(opts.progressClass);
                self.play(clip);
            }

            return false;
        }


        function clearCSS() {
            if (manual) { els = getEls(); }
            els.removeClass(opts.playingClass);
            els.removeClass(opts.pausedClass);
            els.removeClass(opts.progressClass);
        }

        function getEl(clip) {
            return (manual) ? els.filter("[href=" + clip.originalUrl + "]") : els.eq(clip.index);
        }

        function getEls() {
            var els = wrap.find("a");
            return els.length ? els : wrap.children();
        }
//}}}

        /* setup playlists with onClick handlers */

        // internal playlist
        if (!manual) {

            var template = wrap.is(":empty") ? opts.template : wrap.html();
            buildPlaylist();


        // manual playlist
        } else {

            els = getEls();

            // allows dynamic addition of elements
            if ($.isFunction(els.live)) {
                var foo = $(wrap.selector + " a");
                if (!foo.length) { foo = $(wrap.selector + " > *"); }

                foo.live("click", function() {
                    var el = $(this);
                    return play(el, el.attr("href"));
                });

            } else {
                els.click(function() {
                    var el = $(this);
                    return play(el, el.attr("href"));
                });
            }


            // setup player to play first clip
            var clip = self.getClip(0);
            if (!clip.url && opts.playOnClick) {
                clip.update({url: els.eq(0).attr("href")});
            }

        }

        // onBegin
        self.onBegin(function(clip) {
            clearCSS();
            getEl(clip).addClass(opts.playingClass);
        });

        // onPause
        self.onPause(function(clip) {
            getEl(clip).removeClass(opts.playingClass).addClass(opts.pausedClass);
        });

        // onResume
        self.onResume(function(clip) {
            getEl(clip).removeClass(opts.pausedClass).addClass(opts.playingClass);
        });

        // what happens when clip ends ?
        if (!opts.loop && !manual) {

            // stop the playback exept on the last clip, which is stopped by default
            self.onBeforeFinish(function(clip) {
                if (!clip.isInStream && clip.index < els.length -1) {
                    return false;
                }
            });
        }

        // on manual setups perform looping here
        if (manual && opts.loop) {
            self.onBeforeFinish(function(clip) {
                var els = getEls(),
                     el = getEl(clip),
                     next = els.eq(els.index(el) + 1);

                if (next.length) {
                    next.click();

                } else {
                    els.eq(0).click();
                }
                return false;
            });
        }

        // onUnload
        self.onUnload(function() {
            clearCSS();
        });

        // onPlaylistReplace
        if (!manual) {
            self.onPlaylistReplace(function() {
                buildPlaylist();
            });
        }

        // onClipAdd
        self.onClipAdd(function(clip, index) {
            els.eq(index).before(toString(clip));
            bindClicks();
        });

        return self;

    });

})(jQuery);
/*!
 * ipad.js @VERSION. The Flowplayer API
 *
 * Copyright 2010 Flowplayer Oy
 * By Thomas Dubois <thomas@flowplayer.org>
 *
 * This file is part of Flowplayer.
 *
 * Flowplayer is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Flowplayer is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Flowplayer.  If not, see <http://www.gnu.org/licenses/>.
 *
 * Date: @DATE
 * Revision: @REVISION
 */


$f.addPlugin("ipad", function(options) {
    var STATE_UNLOADED = -1;
    var STATE_LOADED    = 0;
    var STATE_UNSTARTED = 1;
    var STATE_BUFFERING = 2;
    var STATE_PLAYING   = 3;
    var STATE_PAUSED    = 4;
    var STATE_ENDED     = 5;

    var self = this;

    var currentVolume = 1;
    var onStartFired = false;
    var stopping = false;
    var playAfterSeek = false;

    var activeIndex = 0;
    var activePlaylist = [];
    var clipDefaults = {
        accelerated:    false,      // unused
        autoBuffering:  false,
        autoPlay:       true,
        baseUrl:        null,
        bufferLength:   3,          // unused
        connectionProvider: null,   // unused
        cuepointMultiplier: 1000,   // not yet implemented
        cuepoints: [],              // not yet implemented
        controls: {},               // unused
        duration: 0,                // not yet implemented
        extension: '',
        fadeInSpeed: 1000,          // not yet implemented
        fadeOutSpeed: 1000,         // not yet implemented
        image: false,               // unused
        linkUrl: null,              // not yet implemented
        linkWindow: '_self',        // not yet implemented
        live: false,                // unused
        metaData: {},
        originalUrl: null,
        position: 0,                // unused
        playlist: [],               // unused
        provider: 'http',
        scaling: 'scale',           // not yet implemented
        seekableOnBegin: false,     // unused
        start: 0,                   // not yet implemented
        url: null,
        urlResolvers: []            // unused
    };

    var currentState = STATE_UNLOADED;
    var previousState= STATE_UNLOADED;

    var isiDevice = /iPad|iPhone|iPod/i.test(navigator.userAgent);

    var video = null;

    function extend(to, from, includeFuncs) {
        if (from) {
            for (key in from) {
                if (key) {
                    if ( from[key] && typeof from[key] == "function" && ! includeFuncs )
                        continue;
                    if ( from[key] && typeof from[key] == "object" && from[key].length == undefined) {
                        var cp = {};
                        extend(cp, from[key]);
                        to[key] = cp;
                    } else {
                        to[key] = from[key];
                    }
                }
            }
        }
    }

    var opts = {
        simulateiDevice: false,
        controlsSizeRatio: 1.5,
        controls: true,
        debug: false
    };

    extend(opts, options);

    // some util funcs
    function log() {
        if ( opts.debug ) {
            if ( isiDevice ) {
                var str = [].splice.call(arguments,0).join(', ');
                console.log.apply(console, [str]);
            } else {
                console.log.apply(console, arguments);
            }
        }

    }

    function stateDescription(state) {
        switch(state) {
            case -1: return "UNLOADED";
            case  0: return "LOADED";
            case  1: return "UNSTARTED";
            case  2: return "BUFFERING";
            case  3: return "PLAYING";
            case  4: return "PAUSED";
            case  5: return "ENDED";
        }
        return "UNKOWN";
    }

    function actionAllowed(eventName) {
        var ret = $f.fireEvent(self.id(), "onBefore"+eventName, activeIndex);
        return ret !== false;
    }

    function stopEvent(e) {
        e.stopPropagation();
        e.preventDefault();
        return false;
    }

    function setState(state, force) {
        if ( currentState == STATE_UNLOADED && ! force )
            return;

        previousState = currentState;
        currentState = state;

        log(stateDescription(state));
    }

    function resetState() {
        video.fp_stop();

        onStartFired = false;
        stopping     = false;
        playAfterSeek= false;
        // call twice so previous state is unstarted too
        setState(STATE_UNSTARTED);
        setState(STATE_UNSTARTED);
    }

    function replay() {
        resetState();
        playAfterSeek = true;
        video.fp_seek(0);
    }

    function scaleVideo(clip) {

    }

    // internal func, maps flowplayer's API
    function addAPI() {


        function fixClip(clip) {
            var extendedClip = {};
            extend(extendedClip, clipDefaults);
            extend(extendedClip, self.getCommonClip());
            extend(extendedClip, clip);

            if ( extendedClip.ipadUrl )
                url = extendedClip.ipadUrl;
            else if ( extendedClip.url )
                url = extendedClip.url;

            if ( url && url.indexOf('://') == -1 && extendedClip.baseUrl )
                url = extendedClip.baseUrl + '/' + url;

            extendedClip.originalUrl = extendedClip.url;
            extendedClip.completeUrl = url;
            extendedClip.extension = extendedClip.completeUrl.substr(extendedClip.completeUrl.lastIndexOf('.'));
            extendedClip.type = 'video';

            // remove this
            delete extendedClip.index;

            log("fixed clip", extendedClip);

            return extendedClip;
        }

        video.fp_play = function(clip, inStream, /* private one, handy for playlists */ forcePlay) {
            var url = null;
            var autoBuffering    = true;
            var autoPlay         = true;

            log("Calling play() " + clip, clip);

            if ( inStream ) {
                log("ERROR: inStream clips not yet supported");
                return;
            }

            // we got a param :
            // array, index, clip obj, url
            if ( clip !== undefined ) {

                // simply change the index
                if ( typeof clip == "number" ) {
                    if ( activeIndex >= activePlaylist.length )
                        return;

                    activeIndex = clip;
                    clip = activePlaylist[activeIndex];
                } else {
                    // String
                    if ( typeof clip == "string" ) {
                        clip = {
                            url: clip
                        };
                    }

                    // replace playlist
                    video.fp_setPlaylist(clip.length !== undefined ? clip : [clip]);
                }

                clip = activePlaylist[activeIndex];
                url = clip.completeUrl;

                if ( clip.autoBuffering !== undefined && clip.autoBuffering === false )
                    autoBuffering = false;

                if ( clip.autoPlay === undefined || clip.autoPlay === true || forcePlay === true ) {
                    autoBuffering = true;
                    autoPlay = true;
                } else {
                    autoPlay = false;
                }
            } else {
                log("clip was not given, simply calling video.play, if not already buffering");

                // clip was not given, simply calling play
                if ( currentState != STATE_BUFFERING )
                    video.play();

                return;
            }

            log("about to play "+ url, autoBuffering, autoPlay);

            // we have a new clip to play
            resetState();

            if ( url ) {
                log("Changing SRC attribute"+ url);
                video.setAttribute('src', url);
            }


            //return;

            // autoBuffering is true or we just called play
            if ( autoBuffering ) {
                if ( ! actionAllowed('Begin') )
                    return false;

                $f.fireEvent(self.id(), 'onBegin', activeIndex);

                log("calling video.load()");
                video.load();
            }

            // auto
            if ( autoPlay ) {
                log("calling video.play()");
                video.play();
            }
        }

        video.fp_pause = function() {
            log("pause called");

            if ( ! actionAllowed('Pause') )
                return false;

            video.pause();
        };

        video.fp_resume = function() {
            log("resume called");

            if ( ! actionAllowed('Resume') )
                return false;

            video.play();
        };

        video.fp_stop = function() {
            log("stop called");

            if ( ! actionAllowed('Stop') )
                return false;

            stopping = true;
            video.pause();
            try {
                video.currentTime = 0;
            } catch(ignored) {}
        };

        video.fp_seek = function(position) {
            log("seek called "+ position);

            if ( ! actionAllowed('Seek') )
                return false;

            var seconds = 0;
            var position = position + "";
            if ( position.charAt(position.length-1) == '%' ) {
                var percentage = parseInt(position.substr(0, position.length-1)) / 100;
                var duration = video.duration;

                seconds = duration * percentage;
            } else {
                seconds = position;
            }

            try {
                video.currentTime = seconds;
            } catch(e) {
                log("Wrong seek time");
            }
        };

        video.fp_getTime = function() {
        //  log("getTime called");
            return video.currentTime;
        };

        video.fp_mute = function() {
            log("mute called");

            if ( ! actionAllowed('Mute') )
                return false;

            currentVolume = video.volume;
            video.volume = 0;
        };

        video.fp_unmute = function() {
            if ( ! actionAllowed('Unmute') )
                return false;

            video.volume = currentVolume;
        };

        video.fp_getVolume = function() {
            return video.volume * 100;
        };

        video.fp_setVolume = function(volume) {
            if ( ! actionAllowed('Volume') )
                return false;

            video.volume = volume / 100;
        };

        video.fp_toggle = function() {
            log('toggle called');
            if ( self.getState() == STATE_ENDED ) {
                replay();
                return;
            }

            if ( video.paused )
                video.fp_play();
            else
                video.fp_pause();
        };

        video.fp_isPaused = function() {
            return video.paused;
        };

        video.fp_isPlaying = function() {
            return ! video.paused;
        };

        video.fp_getPlugin = function(name) {
            if ( name == 'canvas' || name == 'controls' ) {
                var config = self.getConfig();
                //log("looking for config for "+ name, config);

                return config['plugins'] && config['plugins'][name] ? config['plugins'][name] : null;
            }
            log("ERROR: no support for "+ name +" plugin on iDevices");
            return null;
        };
        /*
        video.fp_css = function(name, css) {
            if ( self.plugins[name] && self.plugins[name]._api &&
                 self.plugins[name]['_api'] && self.plugins[name]['_api']['css'] &&
                 self.plugins[name]['_api']['css'] instanceof Function )
                return self.plugins[name]['_api']['css']();

            return self;
        }*/

        video.fp_close = function() {
            setState(STATE_UNLOADED);

            video.parentNode.removeChild(video);
            video = null;
        };

        video.fp_getStatus = function() {
            var bufferStart = 0;
            var bufferEnd   = 0;

            try {
                bufferStart = video.buffered.start();
                bufferEnd   = video.buffered.end();
            } catch(ignored) {}

            return {
                bufferStart: bufferStart,
                bufferEnd:  bufferEnd,
                state: currentState,
                time: video.fp_getTime(),
                muted: video.muted,
                volume: video.fp_getVolume()
            };
        };

        video.fp_getState = function() {
            return currentState;
        };

        video.fp_startBuffering = function() {
            if ( currentState == STATE_UNSTARTED )
                video.load();
        };

        video.fp_setPlaylist = function(playlist) {
            log("Setting playlist");
            activeIndex = 0;
            for ( var i = 0; i < playlist.length; i++ )
                playlist[i] = fixClip(playlist[i]);

            activePlaylist = playlist;

            // keep flowplayer.js in sync
            $f.fireEvent(self.id(), 'onPlaylistReplace', playlist);
        };

        video.fp_addClip = function(clip, index) {
            clip = fixClip(clip);
            activePlaylist.splice(index, 0, clip);

            // keep flowplayer.js in sync
            $f.fireEvent(self.id(), 'onClipAdd', clip, index);
        };

        video.fp_updateClip = function(clip, index) {
            extend(activePlaylist[index], clip);
            return activePlaylist[index];
        };

        video.fp_getVersion = function() {
            return '3.2.3';
        }

        video.fp_isFullscreen = function() {
            return false; //video.webkitDisplayingFullscreen;
        }

        video.fp_toggleFullscreen = function() {
            if ( video.fp_isFullscreen() )
                video.webkitExitFullscreen();
            else
                video.webkitEnterFullscreen();
        }

        // install all other core API with dummy function
        // core API methods
        $f.each(("toggleFullscreen,stopBuffering,reset,playFeed,setKeyboardShortcutsEnabled,isKeyboardShortcutsEnabled,addCuepoints,css,animate,showPlugin,hidePlugin,togglePlugin,fadeTo,invoke,loadPlugin").split(","),
            function() {
                var name = this;

                video["fp_"+name] = function() {
                log("ERROR: unsupported API on iDevices "+ name);
                    return false;
                };
            }
        );
    }

    // Internal func, maps Flowplayer's events
    function addListeners() {


        // Volume*,Mute*,Unmute*,PlaylistReplace,ClipAdd,Error"
        // Begin*,Start,Pause*,Resume*,Seek*,Stop*,Finish*,LastSecond,Update,BufferStop

        /* CLIP EVENTS MAPPING */
        /*
        var onBegin = function(e) {
            // we are not getting that one on the device ?
            fireOnBeginIfNeeded(e);
        };
        video.addEventListener('loadstart', onBegin, false);


        */

        var events = [  'abort',
                        'canplay',
                        'canplaythrough',
                        'durationchange',
                        'emptied',
                        'ended',
                        'error',
                        'loadeddata',
                        'loadedmetadata',
                        'loadstart',
                        'pause',
                        'play',
                        'playing',
                        'progress',
                        'ratechange',
                        'seeked',
                        'seeking',
                        'stalled',
                        'suspend',
                        'timeupdate',
                        'volumechange',
                        'waiting'];
        var eventsLogger = function(e) {
            log("Got event "+ e.type, e);
        }

        for ( var i = 0; i < events.length; i++ )
            video.addEventListener(events[i], eventsLogger);



        var onBufferEmpty = function(e) {
            log("got onBufferEmpty event "+e.type)
            setState(STATE_BUFFERING);
            $f.fireEvent(self.id(), 'onBufferEmpty', activeIndex);
        };
        video.addEventListener('emptied', onBufferEmpty, false);
        video.addEventListener('waiting', onBufferEmpty, false);

        var onBufferFull = function(e) {
            if ( previousState == STATE_UNSTARTED || previousState == STATE_BUFFERING ) {
                // wait for play event, nothing to do

            } else {
                log("Restoring old state "+ stateDescription(previousState));
                setState(previousState);
            }
            $f.fireEvent(self.id(), 'onBufferFull', activeIndex);
        };
        video.addEventListener('canplay', onBufferFull, false);
        video.addEventListener('canplaythrough', onBufferFull, false);

        var onMetaData = function(e) {
            // update clip
            video.fp_updateClip({duration: video.duration, metaData: {duration: video.duration}}, activeIndex);
            activePlaylist[activeIndex].duration = video.duration;

            $f.fireEvent(self.id(), 'onMetaData', activeIndex, activePlaylist[activeIndex]);
        };
        video.addEventListener('loadedmetadata', onMetaData, false);
        video.addEventListener('durationchange', onMetaData, false);

        var onStart = function(e) {
            if ( currentState == STATE_PAUSED ) {
                if ( ! actionAllowed('Resume') ) {
                    // user initiated resume
                    log("Resume disallowed, pausing");
                    video.fp_pause();
                    return stopEvent(e);
                }

                $f.fireEvent(self.id(), 'onResume', activeIndex);
            }

            setState(STATE_PLAYING);

            if ( ! onStartFired ) {
                onStartFired = true;
                $f.fireEvent(self.id(), 'onStart', activeIndex);
            }
        };
        video.addEventListener('playing', onStart, false);

        var onFinish = function(e) {
            if ( ! actionAllowed('Finish') ) {
                if ( activePlaylist.length == 1 ) {
                    //In the case of a single clip, the player will start from the beginning of the clip.
                    log("Active playlist only has one clip, onBeforeFinish returned false. Replaying");
                    replay();
                } else if ( activeIndex != (activePlaylist.length -1) ) {
                    // In the case of an ordinary clip in a playlist, the "Play again" button will appear.
                    // oops, we don't have any play again button yet :)
                    // simply go to the beginning of the video
                    log("Not the last clip in the playlist, but onBeforeFinish returned false. Returning to the beginning of current clip");
                    video.fp_seek(0);
                } else {
                    //In the case of the final clip in a playlist, the player will start from the beginning of the playlist.
                    log("Last clip in playlist, but onBeforeFinish returned false, start again from the beginning");
                    video.fp_play(0);
                }

                return stopEvent(e);
            }   // action was canceled

            setState(STATE_ENDED);
            $f.fireEvent(self.id(), 'onFinish', activeIndex);

            if ( activePlaylist.length > 1 && activeIndex < (activePlaylist.length - 1) ) {
                // not the last clip in the playlist
                log("Not last clip in the playlist, moving to next one");
                video.fp_play(++activeIndex, false, true);
            }

        };
        video.addEventListener('ended', onFinish, false);

        var onError = function(e) {
            setState(STATE_LOADED, true);
            $f.fireEvent(self.id(), 'onError', activeIndex, 201);
            if ( opts.onFail && opts.onFail instanceof Function )
                opts.onFail.apply(self, []);
        };
        video.addEventListener('error', onError, false);

        var onPause = function(e) {
            log("got pause event from player" + self.id());
            if ( stopping )
                return;

            if ( currentState == STATE_BUFFERING && previousState == STATE_UNSTARTED ) {
                log("forcing play");
                setTimeout(function() { video.play(); }, 0);
                return;// stopEvent(e);
            }

            if ( ! actionAllowed('Pause') ) {
                // user initiated pause
                video.fp_resume();
                return stopEvent(e);
            }

            setState(STATE_PAUSED);
            $f.fireEvent(self.id(), 'onPause', activeIndex);
        }
        video.addEventListener('pause', onPause, false);

        var onSeek = function(e) {
            $f.fireEvent(self.id(), 'onBeforeSeek', activeIndex);
        };
        video.addEventListener('seeking', onSeek, false);

        var onSeekDone = function(e) {
            if ( stopping ) {
                stopping = false;
                $f.fireEvent(self.id(), 'onStop', activeIndex);
            }
            else
                $f.fireEvent(self.id(), 'onSeek', activeIndex);


            log("seek done, currentState", stateDescription(currentState));

            if ( playAfterSeek ) {
                playAfterSeek = false;
                video.fp_play();
            } else if ( currentState != STATE_PLAYING )
                video.fp_pause();
        };
        video.addEventListener('seeked', onSeekDone, false);





        /* PLAYER EVENTS MAPPING */

        var onVolumeChange = function(e) {
            // add onBeforeQwe here
            $f.fireEvent(self.id(), 'onVolume', video.fp_getVolume());
        };
        video.addEventListener('volumechange', onVolumeChange, false);
    }

    // this is called only on iDevices
    function onPlayerLoaded() {
        video.fp_play(0);
        //installControlbar();
    }


    function installControlbar() {
        // if we're on an iDevice, try to load the js controlbar if needed
        /*
        if ( self['controls'] == undefined )
            return; // js controlbar not loaded

        var controlsConf = {};
        if ( self.getConfig() && self.getConfig()['plugins'] && self.getConfig()['plugins']['controls'] )
            controlsConf = self.getConfig()['plugins']['controls'];

        var controlsRoot = document.createElement('div');

        // dynamically load js, css file according to swf url ?

        // something more smart here

        controlsRoot.style.position = "absolute";
        controlsRoot.style.bottom = 0;
        self.getParent().children[0].appendChild(controlsRoot);

        self.controls(controlsRoot, {heightRatio: opts.controlsSizeRatio  }, controlsConf);
        */
    }




    // Here we are getting serious. If we're on an iDevice, we don't care about Flash embed.
    // replace it by ours so we can install a video html5 tag instead when FP's init will be called.
    if ( isiDevice || opts.simulateiDevice ) {

        if ( ! window.flashembed.__replaced ) {

            var realFlashembed = window.flashembed;
            window.flashembed = function(root, opts, conf) {
                // DON'T, I mean, DON'T use self here as we are in a global func

                if (typeof root == 'string') {
                    root = document.getElementById(root.replace("#", ""));
                }

                // not found
                if (!root) { return; }

                var style = window.getComputedStyle(root, null);
                var width = parseInt(style.width);
                var height= parseInt(style.height);

                // clearing root
                while(root.firstChild)
                    root.removeChild(root.firstChild);

                var container = document.createElement('div');
                var api = document.createElement('video');
                container.appendChild(api);
                root.appendChild(container);

                //var hasBuiltinControls = conf.config['plugins'] == undefined || (conf.config['plugins'] && conf.config['plugins']['controls'] && conf.config['plugins']['controls'] != null
                //                      && self['controls'] == undefined);  // we make a careful use of "self", as we're looking in the prototype

                // styling  container
                container.style.height = height+'px';
                container.style.width  = width+'px';
                container.style.display= 'block';
                container.style.position = 'relative';
                container.style.background = '-webkit-gradient(linear, left top, left bottom, from(rgba(0, 0, 0, 0.5)), to(rgba(0, 0, 0, 0.7)))';
                container.style.cursor = 'default';
                container.style.webkitUserDrag = 'none';

                // styling video tag
                api.style.height = '100%';
                api.style.width  = '100%';
                api.style.display= 'block';
                api.id = opts.id;
                api.name = opts.id;
                api.style.cursor = 'pointer';
                api.style.webkitUserDrag = 'none';

                api.type="video/mp4";
            //  if ( hasBuiltinControls )
            //      api.controls="controls";

                api.playerConfig = conf.config;

                // tell the player we are ready and go back to player's closure
                $f.fireEvent(conf.config.playerId, 'onLoad', 'player');

                //api.fp_play(conf.config.playlist);
            };

            flashembed.getVersion = realFlashembed.getVersion;
            flashembed.asString = realFlashembed.asString;
            flashembed.isSupported = function() {return true;}
            flashembed.__replaced = true;
        }


        // hack so we get the onload event before everybody and we can set the api
        var __fireEvent = self._fireEvent;
        // only on iDevice, of course

        self._fireEvent = function(a) {
            if ( a[0] == 'onLoad' && a[1] == 'player' ) {
                video = self.getParent().querySelector('video');

                if ( opts.controls )
                    video.controls="controls";

                addAPI();
                addListeners();

                setState(STATE_LOADED, true);

                // set up first clip
                video.fp_setPlaylist(video.playerConfig.playlist);

                // we are loaded
                onPlayerLoaded();

                __fireEvent.apply(self, [a]);
            }


            var shouldFireEvent = currentState != STATE_UNLOADED;
            if ( currentState == STATE_UNLOADED && typeof a == 'string' )
                shouldFireEvent = true;

            if ( shouldFireEvent )
                return __fireEvent.apply(self, [a]);
        }

        // please, don't ask me why, but if you call video.clientHeight while the video is buffering
        // it will be stuck buffering
        self._swfHeight = function() {
            return parseInt(video.style.height);
        }

        self.hasiPadSupport = function() {
            return true;
        }
    } // end of iDevice test


    // some chaining
    return self;
});

var site = {

    uploadDone: function(fileName, hostId) {
        var img = hostId ? $("div.hostPicture[hostId=" + hostId + "] img") : $("#picture");
        img.attr("src", "http://flowplayer-users.s3.amazonaws.com/" + fileName + "?_=" + Math.random());
    },

    submitForm: function(form, to) {
        form = $(form);
        form.fadeTo(400, 0.3);

        $.getJSON(form.attr("action") + "?" + form.serialize(), function(json) {
            form.fadeTo(400, 1);

            if (json.message) {
                form.find("div.error").html(json.message).show();

            } else {
                if (to)  {
                    location.href = to;
                } else  {
                    location.reload();
                }
            }
        });

        return false;
    },

    setCookie: function(name, value, days) {
        var c = name + "=" + escape(value);

        if (days) {
            var today = new Date();
            var expiry = new Date(today.getTime() + days * 1000 * 60 * 60 * 24);
            c += ";expires=" + expiry.toGMTString();
        }
        document.cookie = c + ";path=/";
    }

}


$(function() {

    $("#logout").click(function() {
        $.get("http://flowplayer.org/account/logout", function() {
            location.reload();
        });
        return false;
    });

//{{{ messy highlighting stuff


    // get the folder ("f")
    var els = location.pathname.split("/"),
         f = "/" + els[1],
         isTools = f.indexOf('/tools') != -1;

    if (f.indexOf("#") != -1) f = f.substring(0, f.indexOf("#"));

    // the switch
    //$("#global_fp, #global_jt").eq(isTools ? 1 : 0).addClass("active");

    // navigation
    if (f == '/index.html' || f == '/') f = "";

    if (isTools) {
        $("#nav2 a").filter("[href=" + location.pathname + "]").addClass("active");
    } else {
        $("#nav1 a").filter("[href=" + f + "http://flowplayer.org/index.html]").addClass("active");
    }


    // hightlight subnav
    var loc = location.href;
    var page = loc.substring(loc.indexOf("/", 10), loc.indexOf("?") > 0 ? loc.indexOf("?") : loc.length);
    if (page.indexOf("#") != -1) {
        page = page.substring(0, page.indexOf("#"));
    }

    el = $("#right ul a[href=" +page+ "]");
    if (!el.length && (f == 'documentation' || f == 'account')) el = $("#right ul a:first");

    el.addClass("selected").click(function(e) {
        e.preventDefault();
    });

    // remove redundant borders from subnav
    $("#right ul").each(function() {
        $(this).find("a:last").css("borderBottom", 0);
    });


    // setup main title background image
    f = f.substring(1);

    if (f == 'plugins' && els[2] && els[2] != 'index.html') {
        f = els[2];
        if (els[1] == 'tools') f = "tools";
    }

    if (f == 'demos') {
        f = "documentation";
    }

    var title = $("#content h1:first");
    if (f && title.length && title.css("backgroundImage") == 'none') {
        if (f == 'admin') f = 'flowplayer';
        title.css("backgroundImage", "url(http://static.flowplayer.org/img/title/" + f + ".png)");
    }
    //}}}


    // lazy download of jquery.chili.js
    var sourceCode = $("code[class]");

    if (!$.browser.msie && sourceCode.length) {
        $.getScript("http://flowplayer.org/js/highlight.min.js", function() {
             sourceCode.each(function() {
                var el = $(this),
                     lang = el.attr("className"),
                     hl = new DlHighlight({
                        lang: lang == "javascript" ? "js" : lang,
                        lineNumbers: false
                     });

                el.addClass("DlHighlight").html(hl.doItNow($.trim(el.text())));
             });
        });
    }

    // button.custom, span.play hover and mousedown
    $("button.custom").each(function() {
        var el = $(this);
        if (!el.find("span").length) el.html("<span>" + el.html() + "</span>");
    });

    $("button.custom, span.play").each(function()  {

        var el = $(this);
        var xPos = el.attr("id") == 'searchButton' ? '-100px' : '0';

    });

    $("a.player").hover(function() {
        $("img", this).fadeTo(400, 1);
    }, function() {
        $("img", this).fadeTo(400, 0.7);

    }).find("img").css({opacity:0.7});


    $("#latestPosts a").click(function() {
        $("#latestPosts a").removeClass("selected");
        $(this).addClass("selected");
    });


    // download statistics
    $(".download").each(function()  {
        var el = $(this), href = el.attr("href");
        href = href.substring(href.lastIndexOf("/") + 1);

        el.click(function() {
            _tracker._trackEvent("Download", location.pathname, href);

        }).bind("contextmenu", function() {
            _tracker._trackEvent("Download", location.pathname, href);

        });
    });


//{{{ login / signup / logout

    $(".account input").focus(function() {
        var el = $(this);
        if (this.name == 'password' && el.attr("type") != 'password') {
            var el2 = $('<input/>').attr("type", "password").attr("name", "password");
            el.after(el2);
            el.remove();
            el2.focus();
        }
        this.select();

    }).blur(function() {
        if (!this.value) { this.value = this.name; }
    });

    // login / forgot password scrollable
    $("#loginscroll").scrollable({ next: '#anext', prev: '#aprev' });

    // toggle login / signup
    $("#acc a").each(function(i)  {

        var a = $(this);

        a.mouseover(function() {
            a.addClass("active");
        });

        a.tooltip({
            tip: i == 0 ? '#loginscroll' : '#signup',
            position: 'bottom right',
            offset: [-10, i == 0 ? -45 : -52],
            events: {
                tooltip: 'mouseover'
            },

            onShow: function(e) {
                a.addClass("active");
                $(i > 0 ? '#loginscroll' : '#signup').hide();
            },
            onBeforeHide: function(e, i) {
                a.removeClass("active");
            }
        });
    });

    function closeAcc() {
        var panel = $("#acc .active").data("tooltip");
        if (panel) { panel.hide(); }
        $("#acc a").removeClass("active");
    }

    $(document).click(function(e) {
        var el = $(e.target)
        if ($(".account:visible").length && !el.is(".account") && !el.parents(".account").length && !el.is("#acc a")) {
            closeAcc();
        }
    });

    $(document).keydown(function(e) {
        if (e.keyCode == 27) { closeAcc(); }
    });


    function formSubmit(form, action, fn) {

        form = $(form).fadeTo(400, 0.6);

        // error container
        var err = form.find(".error");
        if (!err.length) { err = $("<p></p>").addClass("error"); form.append(err); }
        err.hide();

        $.post(action + "?" + form.serialize(), function(res) {
            form.fadeTo(200, 1);

            res = eval("(" + res + ")");
            if (res.message) {
                err.html(res.message).show();
                setTimeout(function() { err.slideUp(); }, 3000);
            } else {
                if (typeof fn == 'string') { err.html(fn).show(); }
                else { fn.call(); }
            }
        });

        return false;
    }

    $.formSubmit = formSubmit;

    // login
    $("#login").submit(function() {
        return formSubmit(this, "http://flowplayer.org/account/login", function()  {
            if (location.href.indexOf("download") != -1) {
                location.href = "http://flowplayer.org/account/products.html";
            } else {
                location.reload();
            }
        });
    });


    $("#signup").submit(function() {
        return formSubmit(this, "http://flowplayer.org/account/create",
            "Your account was successfully created. Check out your mail for further details."
        );
    });

    $("#forgot").submit(function() {
        return formSubmit(this, "http://flowplayer.org/account/requestPassword", "An activation link has been sent to your email account");
    });

//}}}



    var tweets = $("#tweets"),
        re = /(http:[^\s]+)/;

    if (tweets.length) {

        function prettyDate(dateStr) {

            var date = new Date(dateStr);

            if (date == 'NaN')  {
                return dateStr.substring(0, 11);
            }

            var diff = (((new Date()).getTime() - date.getTime()) / 1000),
                 day_diff = Math.floor(diff / 86400);

            if (isNaN(day_diff) || day_diff < 0) return dateStr;


            return day_diff == 0 && (
                     diff < 60 && "just now" ||
                     diff < 120 && "1 minute ago" ||
                     diff < 3600 && Math.floor( diff / 60 ) + " minutes ago" ||
                     diff < 7200 && "1 hour ago" ||
                     diff < 86400 && Math.floor( diff / 3600 ) + " hours ago") ||
                     day_diff == 1 && "Yesterday" ||
                     day_diff < 7 && day_diff + " days ago" ||
                     Math.ceil( day_diff / 7 ) + " weeks ago";
        }

        $.getJSON("/twitter/jquerytools.json", function (json) {
            $.each(json, function(index, item)  {
                if (index > 3) return false;
                var time = prettyDate(item.created_at),
                     text = item.text.replace(re, '<a href="$1">$1</a>');
                tweets.append("<div class='tweet'><p>" + text + "</p><span class='time'>" + time + "</span></div>");
            });
            tweets.find("p").click(function() {
                location.href = $(this).find("a").attr("href");
            });
        });
    }

});


var _gat=new Object({c:"length",lb:"4.3",m:"cookie",b:undefined,cb:function(d,a){this.zb=d;this.Nb=a},r:"__utma=",W:"__utmb=",ma:"__utmc=",Ta:"__utmk=",na:"__utmv=",oa:"__utmx=",Sa:"GASO=",X:"__utmz=",lc:"http://www.google-analytics.com/__utm.gif",mc:"https://ssl.google-analytics.com/__utm.gif",Wa:"utmcid=",Ya:"utmcsr=",$a:"utmgclid=",Ua:"utmccn=",Xa:"utmcmd=",Za:"utmctr=",Va:"utmcct=",Hb:false,_gasoDomain:undefined,_gasoCPath:undefined,e:window,a:document,k:navigator,t:function(d){var a=1,c=0,h,
o;if(!_gat.q(d)){a=0;for(h=d[_gat.c]-1;h>=0;h--){o=d.charCodeAt(h);a=(a<<6&268435455)+o+(o<<14);c=a&266338304;a=c!=0?a^c>>21:a}}return a},C:function(d,a,c){var h=_gat,o="-",k,l,s=h.q;if(!s(d)&&!s(a)&&!s(c)){k=h.w(d,a);if(k>-1){l=d.indexOf(c,k);if(l<0)l=d[h.c];o=h.F(d,k+h.w(a,"=")+1,l)}}return o},Ea:function(d){var a=false,c=0,h,o;if(!_gat.q(d)){a=true;for(h=0;h<d[_gat.c];h++){o=d.charAt(h);c+="."==o?1:0;a=a&&c<=1&&(0==h&&"-"==o||_gat.P(".0123456789",o))}}return a},d:function(d,a){var c=encodeURIComponent;
return c instanceof Function?(a?encodeURI(d):c(d)):escape(d)},J:function(d,a){var c=decodeURIComponent,h;d=d.split("+").join(" ");if(c instanceof Function)try{h=a?decodeURI(d):c(d)}catch(o){h=unescape(d)}else h=unescape(d);return h},Db:function(d){return d&&d.hash?_gat.F(d.href,_gat.w(d.href,"#")):""},q:function(d){return _gat.b==d||"-"==d||""==d},Lb:function(d){return d[_gat.c]>0&&_gat.P(" \n\r\t",d)},P:function(d,a){return _gat.w(d,a)>-1},h:function(d,a){d[d[_gat.c]]=a},T:function(d){return d.toLowerCase()},
z:function(d,a){return d.split(a)},w:function(d,a){return d.indexOf(a)},F:function(d,a,c){c=_gat.b==c?d[_gat.c]:c;return d.substring(a,c)},uc:function(){var d=_gat.b,a=window;if(a&&a.gaGlobal&&a.gaGlobal.hid)d=a.gaGlobal.hid;else{d=Math.round(Math.random()*2147483647);a.gaGlobal=a.gaGlobal?a.gaGlobal:{};a.gaGlobal.hid=d}return d},wa:function(){return Math.round(Math.random()*2147483647)},Gc:function(){return(_gat.wa()^_gat.vc())*2147483647},vc:function(){var d=_gat.k,a=_gat.a,c=_gat.e,h=a[_gat.m]?
a[_gat.m]:"",o=c.history[_gat.c],k,l,s=[d.appName,d.version,d.language?d.language:d.browserLanguage,d.platform,d.userAgent,d.javaEnabled()?1:0].join("");if(c.screen)s+=c.screen.width+"x"+c.screen.height+c.screen.colorDepth;else if(c.java){l=java.awt.Toolkit.getDefaultToolkit().getScreenSize();s+=l.screen.width+"x"+l.screen.height}s+=h;s+=a.referrer?a.referrer:"";k=s[_gat.c];while(o>0)s+=o--^k++;return _gat.t(s)}});_gat.hc=function(){var d=this,a=_gat.cb;function c(h,o){return new a(h,o)}d.db="utm_campaign";d.eb="utm_content";d.fb="utm_id";d.gb="utm_medium";d.hb="utm_nooverride";d.ib="utm_source";d.jb="utm_term";d.kb="gclid";d.pa=0;d.I=0;d.wb="15768000";d.Tb="1800";d.ea=[];d.ga=[];d.Ic="cse";d.Gb="q";d.ab="google";d.fa=[c(d.ab,d.Gb),c("yahoo","p"),c("msn","q"),c("aol","query"),c("aol","encquery"),c("lycos","query"),c("ask","q"),c("altavista","q"),c("netscape","query"),c("cnn","query"),c("looksmart","qt"),c("about",
"terms"),c("mamma","query"),c("alltheweb","q"),c("gigablast","q"),c("voila","rdata"),c("virgilio","qs"),c("live","q"),c("baidu","wd"),c("alice","qs"),c("yandex","text"),c("najdi","q"),c("aol","q"),c("club-internet","query"),c("mama","query"),c("seznam","q"),c("search","q"),c("wp","szukaj"),c("onet","qt"),c("netsprint","q"),c("google.interia","q"),c("szukacz","q"),c("yam","k"),c("pchome","q"),c("kvasir","searchExpr"),c("sesam","q"),c("ozu","q"),c("terra","query"),c("nostrum","query"),c("mynet","q"),
c("ekolay","q"),c("search.ilse","search_for")];d.B=undefined;d.Kb=false;d.p="/";d.ha=100;d.Da="/__utm.gif";d.ta=1;d.ua=1;d.G="|";d.sa=1;d.qa=1;d.pb=1;d.g="auto";d.D=1;d.Ga=1000;d.Yc=10;d.nc=10;d.Zc=0.2};_gat.Y=function(d,a){var c,h,o,k,l,s,q,f=this,n=_gat,w=n.q,x=n.c,g,z=a;f.a=d;function B(i){var b=i instanceof Array?i.join("."):"";return w(b)?"-":b}function A(i,b){var e=[],j;if(!w(i)){e=n.z(i,".");if(b)for(j=0;j<e[x];j++)if(!n.Ea(e[j]))e[j]="-"}return e}function p(){return u(63072000000)}function u(i){var b=new Date,e=new Date(b.getTime()+i);return"expires="+e.toGMTString()+"; "}function m(i,b){f.a[n.m]=i+"; path="+z.p+"; "+b+f.Cc()}function r(i,b,e){var j=f.V,t,v;for(t=0;t<j[x];t++){v=j[t][0];
v+=w(b)?b:b+j[t][4];j[t][2](n.C(i,v,e))}}f.Jb=function(){return n.b==g||g==f.t()};f.Ba=function(){return l?l:"-"};f.Wb=function(i){l=i};f.Ma=function(i){g=n.Ea(i)?i*1:"-"};f.Aa=function(){return B(s)};f.Na=function(i){s=A(i)};f.Hc=function(){return g?g:"-"};f.Cc=function(){return w(z.g)?"":"domain="+z.g+";"};f.ya=function(){return B(c)};f.Ub=function(i){c=A(i,1)};f.K=function(){return B(h)};f.La=function(i){h=A(i,1)};f.za=function(){return B(o)};f.Vb=function(i){o=A(i,1)};f.Ca=function(){return B(k)};
f.Xb=function(i){k=A(i);for(var b=0;b<k[x];b++)if(b<4&&!n.Ea(k[b]))k[b]="-"};f.Dc=function(){return q};f.Uc=function(i){q=i};f.pc=function(){c=[];h=[];o=[];k=[];l=n.b;s=[];g=n.b};f.t=function(){var i="",b;for(b=0;b<f.V[x];b++)i+=f.V[b][1]();return n.t(i)};f.Ha=function(i){var b=f.a[n.m],e=false;if(b){r(b,i,";");f.Ma(f.t());e=true}return e};f.Rc=function(i){r(i,"","&");f.Ma(n.C(i,n.Ta,"&"))};f.Wc=function(){var i=f.V,b=[],e;for(e=0;e<i[x];e++)n.h(b,i[e][0]+i[e][1]());n.h(b,n.Ta+f.t());return b.join("&")};
f.bd=function(i,b){var e=f.V,j=z.p,t;f.Ha(i);z.p=b;for(t=0;t<e[x];t++)if(!w(e[t][1]()))e[t][3]();z.p=j};f.dc=function(){m(n.r+f.ya(),p())};f.Pa=function(){m(n.W+f.K(),u(z.Tb*1000))};f.ec=function(){m(n.ma+f.za(),"")};f.Ra=function(){m(n.X+f.Ca(),u(z.wb*1000))};f.fc=function(){m(n.oa+f.Ba(),p())};f.Qa=function(){m(n.na+f.Aa(),p())};f.cd=function(){m(n.Sa+f.Dc(),"")};f.V=[[n.r,f.ya,f.Ub,f.dc,"."],[n.W,f.K,f.La,f.Pa,""],[n.ma,f.za,f.Vb,f.ec,""],[n.oa,f.Ba,f.Wb,f.fc,""],[n.X,f.Ca,f.Xb,f.Ra,"."],[n.na,
f.Aa,f.Na,f.Qa,"."]]};_gat.jc=function(d){var a=this,c=_gat,h=d,o,k=function(l){var s=(new Date).getTime(),q;q=(s-l[3])*(h.Zc/1000);if(q>=1){l[2]=Math.min(Math.floor(l[2]*1+q),h.nc);l[3]=s}return l};a.O=function(l,s,q,f,n,w,x){var g,z=h.D,B=q.location;if(!o)o=new c.Y(q,h);o.Ha(f);g=c.z(o.K(),".");if(g[1]<500||n){if(w)g=k(g);if(n||!w||g[2]>=1){if(!n&&w)g[2]=g[2]*1-1;g[1]=g[1]*1+1;l="?utmwv="+_gat.lb+"&utmn="+c.wa()+(c.q(B.hostname)?"":"&utmhn="+c.d(B.hostname))+(h.ha==100?"":"&utmsp="+c.d(h.ha))+l;if(0==z||2==z){var A=
new Image(1,1);A.src=h.Da+l;var p=2==z?function(){}:x||function(){};A.onload=p}if(1==z||2==z){var u=new Image(1,1);u.src=("https:"==B.protocol?c.mc:c.lc)+l+"&utmac="+s+"&utmcc="+a.wc(q,f);u.onload=x||function(){}}}}o.La(g.join("."));o.Pa()};a.wc=function(l,s){var q=[],f=[c.r,c.X,c.na,c.oa],n,w=l[c.m],x;for(n=0;n<f[c.c];n++){x=c.C(w,f[n]+s,";");if(!c.q(x))c.h(q,f[n]+x+";")}return c.d(q.join("+"))}};_gat.i=function(){this.la=[]};_gat.i.bb=function(d,a,c,h,o,k){var l=this;l.cc=d;l.Oa=a;l.L=c;l.sb=h;l.Pb=o;l.Qb=k};_gat.i.bb.prototype.S=function(){var d=this,a=_gat.d;return"&"+["utmt=item","utmtid="+a(d.cc),"utmipc="+a(d.Oa),"utmipn="+a(d.L),"utmiva="+a(d.sb),"utmipr="+a(d.Pb),"utmiqt="+a(d.Qb)].join("&")};_gat.i.$=function(d,a,c,h,o,k,l,s){var q=this;q.v=d;q.ob=a;q.bc=c;q.ac=h;q.Yb=o;q.ub=k;q.$b=l;q.xb=s;q.ca=[]};_gat.i.$.prototype.mb=function(d,a,c,h,o){var k=this,l=k.Eb(d),s=k.v,q=_gat;if(q.b==
l)q.h(k.ca,new q.i.bb(s,d,a,c,h,o));else{l.cc=s;l.Oa=d;l.L=a;l.sb=c;l.Pb=h;l.Qb=o}};_gat.i.$.prototype.Eb=function(d){var a,c=this.ca,h;for(h=0;h<c[_gat.c];h++)a=d==c[h].Oa?c[h]:a;return a};_gat.i.$.prototype.S=function(){var d=this,a=_gat.d;return"&"+["utmt=tran","utmtid="+a(d.v),"utmtst="+a(d.ob),"utmtto="+a(d.bc),"utmttx="+a(d.ac),"utmtsp="+a(d.Yb),"utmtci="+a(d.ub),"utmtrg="+a(d.$b),"utmtco="+a(d.xb)].join("&")};_gat.i.prototype.nb=function(d,a,c,h,o,k,l,s){var q=this,f=_gat,n=q.xa(d);if(f.b==
n){n=new f.i.$(d,a,c,h,o,k,l,s);f.h(q.la,n)}else{n.ob=a;n.bc=c;n.ac=h;n.Yb=o;n.ub=k;n.$b=l;n.xb=s}return n};_gat.i.prototype.xa=function(d){var a,c=this.la,h;for(h=0;h<c[_gat.c];h++)a=d==c[h].v?c[h]:a;return a};_gat.gc=function(d){var a=this,c="-",h=_gat,o=d;a.Ja=screen;a.qb=!self.screen&&self.java?java.awt.Toolkit.getDefaultToolkit():h.b;a.a=document;a.e=window;a.k=navigator;a.Ka=c;a.Sb=c;a.tb=c;a.Ob=c;a.Mb=1;a.Bb=c;function k(){var l,s,q,f,n="ShockwaveFlash",w="$version",x=a.k?a.k.plugins:h.b;if(x&&x[h.c]>0)for(l=0;l<x[h.c]&&!q;l++){s=x[l];if(h.P(s.name,"Shockwave Flash"))q=h.z(s.description,"Shockwave Flash ")[1]}else{n=n+"."+n;try{f=new ActiveXObject(n+".7");q=f.GetVariable(w)}catch(g){}if(!q)try{f=
new ActiveXObject(n+".6");q="WIN 6,0,21,0";f.AllowScriptAccess="always";q=f.GetVariable(w)}catch(z){}if(!q)try{f=new ActiveXObject(n);q=f.GetVariable(w)}catch(z){}if(q){q=h.z(h.z(q," ")[1],",");q=q[0]+"."+q[1]+" r"+q[2]}}return q?q:c}a.xc=function(){var l;if(self.screen){a.Ka=a.Ja.width+"x"+a.Ja.height;a.Sb=a.Ja.colorDepth+"-bit"}else if(a.qb)try{l=a.qb.getScreenSize();a.Ka=l.width+"x"+l.height}catch(s){}a.Ob=h.T(a.k&&a.k.language?a.k.language:(a.k&&a.k.browserLanguage?a.k.browserLanguage:c));a.Mb=
a.k&&a.k.javaEnabled()?1:0;a.Bb=o?k():c;a.tb=h.d(a.a.characterSet?a.a.characterSet:(a.a.charset?a.a.charset:c))};a.Xc=function(){return"&"+["utmcs="+h.d(a.tb),"utmsr="+a.Ka,"utmsc="+a.Sb,"utmul="+a.Ob,"utmje="+a.Mb,"utmfl="+h.d(a.Bb)].join("&")}};_gat.n=function(d,a,c,h,o){var k=this,l=_gat,s=l.q,q=l.b,f=l.P,n=l.C,w=l.T,x=l.z,g=l.c;k.a=a;k.f=d;k.Rb=c;k.ja=h;k.o=o;function z(p){return s(p)||"0"==p||!f(p,"://")}function B(p){var u="";p=w(x(p,"://")[1]);if(f(p,"/")){p=x(p,"/")[1];if(f(p,"?"))u=x(p,"?")[0]}return u}function A(p){var u="";u=w(x(p,"://")[1]);if(f(u,"/"))u=x(u,"/")[0];return u}k.Fc=function(p){var u=k.Fb(),m=k.o;return new l.n.s(n(p,m.fb+"=","&"),n(p,m.ib+"=","&"),n(p,m.kb+"=","&"),k.ba(p,m.db,"(not set)"),k.ba(p,m.gb,"(not set)"),
k.ba(p,m.jb,u&&!s(u.R)?l.J(u.R):q),k.ba(p,m.eb,q))};k.Ib=function(p){var u=A(p),m=B(p);if(f(u,k.o.ab)){p=x(p,"?").join("&");if(f(p,"&"+k.o.Gb+"="))if(m==k.o.Ic)return true}return false};k.Fb=function(){var p,u,m=k.Rb,r,i,b=k.o.fa;if(z(m)||k.Ib(m))return;p=A(m);for(r=0;r<b[g];r++){i=b[r];if(f(p,w(i.zb))){m=x(m,"?").join("&");if(f(m,"&"+i.Nb+"=")){u=x(m,"&"+i.Nb+"=")[1];if(f(u,"&"))u=x(u,"&")[0];return new l.n.s(q,i.zb,q,"(organic)","organic",u,q)}}}};k.ba=function(p,u,m){var r=n(p,u+"=","&"),i=!s(r)?
l.J(r):(!s(m)?m:"-");return i};k.Nc=function(p){var u=k.o.ea,m=false,r,i;if(p&&"organic"==p.da){r=w(l.J(p.R));for(i=0;i<u[g];i++)m=m||w(u[i])==r}return m};k.Ec=function(){var p="",u="",m=k.Rb;if(z(m)||k.Ib(m))return;p=w(x(m,"://")[1]);if(f(p,"/")){u=l.F(p,l.w(p,"/"));if(f(u,"?"))u=x(u,"?")[0];p=x(p,"/")[0]}if(0==l.w(p,"www."))p=l.F(p,4);return new l.n.s(q,p,q,"(referral)","referral",q,u)};k.sc=function(p){var u="";if(k.o.pa){u=l.Db(p);u=""!=u?u+"&":u}u+=p.search;return u};k.zc=function(){return new l.n.s(q,
"(direct)",q,"(direct)","(none)",q,q)};k.Oc=function(p){var u=false,m,r,i=k.o.ga;if(p&&"referral"==p.da){m=w(l.d(p.ia));for(r=0;r<i[g];r++)u=u||f(m,w(i[r]))}return u};k.U=function(p){return q!=p&&p.Fa()};k.yc=function(p,u){var m="",r="-",i,b,e=0,j,t,v=k.f;if(!p)return"";t=k.a[l.m]?k.a[l.m]:"";m=k.sc(k.a.location);if(k.o.I&&p.Jb()){r=p.Ca();if(!s(r)&&!f(r,";")){p.Ra();return""}}r=n(t,l.X+v+".",";");i=k.Fc(m);if(k.U(i)){b=n(m,k.o.hb+"=","&");if("1"==b&&!s(r))return""}if(!k.U(i)){i=k.Fb();if(!s(r)&&
k.Nc(i))return""}if(!k.U(i)&&u){i=k.Ec();if(!s(r)&&k.Oc(i))return""}if(!k.U(i))if(s(r)&&u)i=k.zc();if(!k.U(i))return"";if(!s(r)){var y=x(r,"."),E=new l.n.s;E.Cb(y.slice(4).join("."));j=w(E.ka())==w(i.ka());e=y[3]*1}if(!j||u){var F=n(t,l.r+v+".",";"),I=F.lastIndexOf("."),G=I>9?l.F(F,I+1)*1:0;e++;G=0==G?1:G;p.Xb([v,k.ja,G,e,i.ka()].join("."));p.Ra();return"&utmcn=1"}else return"&utmcr=1"}};_gat.n.s=function(d,a,c,h,o,k,l){var s=this;s.v=d;s.ia=a;s.ra=c;s.L=h;s.da=o;s.R=k;s.vb=l};_gat.n.s.prototype.ka=
function(){var d=this,a=_gat,c=[],h=[[a.Wa,d.v],[a.Ya,d.ia],[a.$a,d.ra],[a.Ua,d.L],[a.Xa,d.da],[a.Za,d.R],[a.Va,d.vb]],o,k;if(d.Fa())for(o=0;o<h[a.c];o++)if(!a.q(h[o][1])){k=h[o][1].split("+").join("%20");k=k.split(" ").join("%20");a.h(c,h[o][0]+k)}return c.join("|")};_gat.n.s.prototype.Fa=function(){var d=this,a=_gat.q;return!(a(d.v)&&a(d.ia)&&a(d.ra))};_gat.n.s.prototype.Cb=function(d){var a=this,c=_gat,h=function(o){return c.J(c.C(d,o,"|"))};a.v=h(c.Wa);a.ia=h(c.Ya);a.ra=h(c.$a);a.L=h(c.Ua);a.da=
h(c.Xa);a.R=h(c.Za);a.vb=h(c.Va)};_gat.Z=function(){var d=this,a=_gat,c={},h="k",o="v",k=[h,o],l="(",s=")",q="*",f="!",n="'",w={};w[n]="'0";w[s]="'1";w[q]="'2";w[f]="'3";var x=1;function g(m,r,i,b){if(a.b==c[m])c[m]={};if(a.b==c[m][r])c[m][r]=[];c[m][r][i]=b}function z(m,r,i){return a.b!=c[m]&&a.b!=c[m][r]?c[m][r][i]:a.b}function B(m,r){if(a.b!=c[m]&&a.b!=c[m][r]){c[m][r]=a.b;var i=true,b;for(b=0;b<k[a.c];b++)if(a.b!=c[m][k[b]]){i=false;break}if(i)c[m]=a.b}}function A(m){var r="",i=false,b,e;for(b=0;b<k[a.c];b++){e=m[k[b]];if(a.b!=
e){if(i)r+=k[b];r+=p(e);i=false}else i=true}return r}function p(m){var r=[],i,b;for(b=0;b<m[a.c];b++)if(a.b!=m[b]){i="";if(b!=x&&a.b==m[b-1]){i+=b.toString();i+=f}i+=u(m[b]);a.h(r,i)}return l+r.join(q)+s}function u(m){var r="",i,b,e;for(i=0;i<m[a.c];i++){b=m.charAt(i);e=w[b];r+=a.b!=e?e:b}return r}d.Kc=function(m){return a.b!=c[m]};d.N=function(){var m=[],r;for(r in c)if(a.b!=c[r])a.h(m,r.toString()+A(c[r]));return m.join("")};d.Sc=function(m){if(m==a.b)return d.N();var r=[m.N()],i;for(i in c)if(a.b!=
c[i]&&!m.Kc(i))a.h(r,i.toString()+A(c[i]));return r.join("")};d._setKey=function(m,r,i){if(typeof i!="string")return false;g(m,h,r,i);return true};d._setValue=function(m,r,i){if(typeof i!="number"&&(a.b==Number||!(i instanceof Number)))return false;if(Math.round(i)!=i||i==NaN||i==Infinity)return false;g(m,o,r,i.toString());return true};d._getKey=function(m,r){return z(m,h,r)};d._getValue=function(m,r){return z(m,o,r)};d._clearKey=function(m){B(m,h)};d._clearValue=function(m){B(m,o)}};_gat.ic=function(d,a){var c=this;c.jd=a;c.Pc=d;c._trackEvent=function(h,o,k){return a._trackEvent(c.Pc,h,o,k)}};_gat.kc=function(d){var a=this,c=_gat,h=c.b,o=c.q,k=c.w,l=c.F,s=c.C,q=c.P,f=c.z,n="location",w=c.c,x=h,g=new c.hc,z=false;a.a=document;a.e=window;a.ja=Math.round((new Date).getTime()/1000);a.H=d;a.yb=a.a.referrer;a.va=h;a.j=h;a.A=h;a.M=false;a.aa=h;a.rb="";a.l=h;a.Ab=h;a.f=h;a.u=h;function B(){if("auto"==g.g){var b=a.a.domain;if("www."==l(b,0,4))b=l(b,4);g.g=b}g.g=c.T(g.g)}function A(){var b=g.g,e=k(b,"www.google.")*k(b,".google.")*k(b,"google.");return e||"/"!=g.p||k(b,"google.org")>-1}function p(b,
e,j){if(o(b)||o(e)||o(j))return"-";var t=s(b,c.r+a.f+".",e),v;if(!o(t)){v=f(t,".");v[5]=v[5]?v[5]*1+1:1;v[3]=v[4];v[4]=j;t=v.join(".")}return t}function u(){return"file:"!=a.a[n].protocol&&A()}function m(b){if(!b||""==b)return"";while(c.Lb(b.charAt(0)))b=l(b,1);while(c.Lb(b.charAt(b[w]-1)))b=l(b,0,b[w]-1);return b}function r(b,e,j){if(!o(b())){e(c.J(b()));if(!q(b(),";"))j()}}function i(b){var e,j=""!=b&&a.a[n].host!=b;if(j)for(e=0;e<g.B[w];e++)j=j&&k(c.T(b),c.T(g.B[e]))==-1;return j}a.Bc=function(){if(!g.g||
""==g.g||"none"==g.g){g.g="";return 1}B();return g.pb?c.t(g.g):1};a.tc=function(b,e){if(o(b))b="-";else{e+=g.p&&"/"!=g.p?g.p:"";var j=k(b,e);b=j>=0&&j<=8?"0":("["==b.charAt(0)&&"]"==b.charAt(b[w]-1)?"-":b)}return b};a.Ia=function(b){var e="",j=a.a;e+=a.aa?a.aa.Xc():"";e+=g.qa?a.rb:"";e+=g.ta&&!o(j.title)?"&utmdt="+c.d(j.title):"";e+="&utmhid="+c.uc()+"&utmr="+a.va+"&utmp="+a.Tc(b);return e};a.Tc=function(b){var e=a.a[n];b=h!=b&&""!=b?c.d(b,true):c.d(e.pathname+unescape(e.search),true);return b};a.$c=
function(b){if(a.Q()){var e="";if(a.l!=h&&a.l.N().length>0)e+="&utme="+c.d(a.l.N());e+=a.Ia(b);x.O(e,a.H,a.a,a.f)}};a.qc=function(){var b=new c.Y(a.a,g);return b.Ha(a.f)?b.Wc():h};a._getLinkerUrl=function(b,e){var j=f(b,"#"),t=b,v=a.qc();if(v)if(e&&1>=j[w])t+="#"+v;else if(!e||1>=j[w])if(1>=j[w])t+=(q(b,"?")?"&":"?")+v;else t=j[0]+(q(b,"?")?"&":"?")+v+"#"+j[1];return t};a.Zb=function(){var b;if(a.A&&a.A[w]>=10&&!q(a.A,"=")){a.u.Uc(a.A);a.u.cd();c._gasoDomain=g.g;c._gasoCPath=g.p;b=a.a.createElement("script");
b.type="text/javascript";b.id="_gasojs";b.src="https://www.google.com/analytics/reporting/overlay_js?gaso="+a.A+"&"+c.wa();a.a.getElementsByTagName("head")[0].appendChild(b)}};a.Jc=function(){var b=a.a[c.m],e=a.ja,j=a.u,t=a.f+"",v=a.e,y=v?v.gaGlobal:h,E,F=q(b,c.r+t+"."),I=q(b,c.W+t),G=q(b,c.ma+t),C,D=[],H="",K=false,J;b=o(b)?"":b;if(g.I){E=c.Db(a.a[n]);if(g.pa&&!o(E))H=E+"&";H+=a.a[n].search;if(!o(H)&&q(H,c.r)){j.Rc(H);if(!j.Jb())j.pc();C=j.ya()}r(j.Ba,j.Wb,j.fc);r(j.Aa,j.Na,j.Qa)}if(!o(C))if(o(j.K())||
o(j.za())){C=p(H,"&",e);a.M=true}else{D=f(j.K(),".");t=D[0]}else if(F)if(!I||!G){C=p(b,";",e);a.M=true}else{C=s(b,c.r+t+".",";");D=f(s(b,c.W+t,";"),".")}else{C=[t,c.Gc(),e,e,e,1].join(".");a.M=true;K=true}C=f(C,".");if(v&&y&&y.dh==t){C[4]=y.sid?y.sid:C[4];if(K){C[3]=y.sid?y.sid:C[4];if(y.vid){J=f(y.vid,".");C[1]=J[0];C[2]=J[1]}}}j.Ub(C.join("."));D[0]=t;D[1]=D[1]?D[1]:0;D[2]=undefined!=D[2]?D[2]:g.Yc;D[3]=D[3]?D[3]:C[4];j.La(D.join("."));j.Vb(t);if(!o(j.Hc()))j.Ma(j.t());j.dc();j.Pa();j.ec()};a.Lc=
function(){x=new c.jc(g)};a._initData=function(){var b;if(!z){a.Lc();a.f=a.Bc();a.u=new c.Y(a.a,g)}if(u())a.Jc();if(!z){if(u()){a.va=a.tc(a.Ac(),a.a.domain);if(g.sa){a.aa=new c.gc(g.ua);a.aa.xc()}if(g.qa){b=new c.n(a.f,a.a,a.va,a.ja,g);a.rb=b.yc(a.u,a.M)}}a.l=new c.Z;a.Ab=new c.Z;z=true}if(!c.Hb)a.Mc()};a._visitCode=function(){a._initData();var b=s(a.a[c.m],c.r+a.f+".",";"),e=f(b,".");return e[w]<4?"":e[1]};a._cookiePathCopy=function(b){a._initData();if(a.u)a.u.bd(a.f,b)};a.Mc=function(){var b=a.a[n].hash,
e;e=b&&""!=b&&0==k(b,"#gaso=")?s(b,"gaso=","&"):s(a.a[c.m],c.Sa,";");if(e[w]>=10){a.A=e;if(a.e.addEventListener)a.e.addEventListener("load",a.Zb,false);else a.e.attachEvent("onload",a.Zb)}c.Hb=true};a.Q=function(){return a._visitCode()%10000<g.ha*100};a.Vc=function(){var b,e,j=a.a.links;if(!g.Kb){var t=a.a.domain;if("www."==l(t,0,4))t=l(t,4);g.B.push("."+t)}for(b=0;b<j[w]&&(g.Ga==-1||b<g.Ga);b++){e=j[b];if(i(e.host))if(!e.gatcOnclick){e.gatcOnclick=e.onclick?e.onclick:a.Qc;e.onclick=function(v){var y=
!this.target||this.target=="_self"||this.target=="_top"||this.target=="_parent";y=y&&!a.oc(v);a.ad(v,this,y);return y?false:(this.gatcOnclick?this.gatcOnclick(v):true)}}}};a.Qc=function(){};a._trackPageview=function(b){if(u()){a._initData();if(g.B)a.Vc();a.$c(b);a.M=false}};a._trackTrans=function(){var b=a.f,e=[],j,t,v,y;a._initData();if(a.j&&a.Q()){for(j=0;j<a.j.la[w];j++){t=a.j.la[j];c.h(e,t.S());for(v=0;v<t.ca[w];v++)c.h(e,t.ca[v].S())}for(y=0;y<e[w];y++)x.O(e[y],a.H,a.a,b,true)}};a._setTrans=
function(){var b=a.a,e,j,t,v,y=b.getElementById?b.getElementById("utmtrans"):(b.utmform&&b.utmform.utmtrans?b.utmform.utmtrans:h);a._initData();if(y&&y.value){a.j=new c.i;v=f(y.value,"UTM:");g.G=!g.G||""==g.G?"|":g.G;for(e=0;e<v[w];e++){v[e]=m(v[e]);j=f(v[e],g.G);for(t=0;t<j[w];t++)j[t]=m(j[t]);if("T"==j[0])a._addTrans(j[1],j[2],j[3],j[4],j[5],j[6],j[7],j[8]);else if("I"==j[0])a._addItem(j[1],j[2],j[3],j[4],j[5],j[6])}}};a._addTrans=function(b,e,j,t,v,y,E,F){a.j=a.j?a.j:new c.i;return a.j.nb(b,e,
j,t,v,y,E,F)};a._addItem=function(b,e,j,t,v,y){var E;a.j=a.j?a.j:new c.i;E=a.j.xa(b);if(!E)E=a._addTrans(b,"","","","","","","");E.mb(e,j,t,v,y)};a._setVar=function(b){if(b&&""!=b&&A()){a._initData();var e=new c.Y(a.a,g),j=a.f;e.Na(j+"."+c.d(b));e.Qa();if(a.Q())x.O("&utmt=var",a.H,a.a,a.f)}};a._link=function(b,e){if(g.I&&b){a._initData();a.a[n].href=a._getLinkerUrl(b,e)}};a._linkByPost=function(b,e){if(g.I&&b&&b.action){a._initData();b.action=a._getLinkerUrl(b.action,e)}};a._setXKey=function(b,e,
j){a.l._setKey(b,e,j)};a._setXValue=function(b,e,j){a.l._setValue(b,e,j)};a._getXKey=function(b,e){return a.l._getKey(b,e)};a._getXValue=function(b,e){return a.l.getValue(b,e)};a._clearXKey=function(b){a.l._clearKey(b)};a._clearXValue=function(b){a.l._clearValue(b)};a._createXObj=function(){a._initData();return new c.Z};a._sendXEvent=function(b){var e="";a._initData();if(a.Q()){e+="&utmt=event&utme="+c.d(a.l.Sc(b))+a.Ia();x.O(e,a.H,a.a,a.f,false,true)}};a._createEventTracker=function(b){a._initData();
return new c.ic(b,a)};a._trackEvent=function(b,e,j,t){var v=true,y=a.Ab;if(h!=b&&h!=e&&""!=b&&""!=e){y._clearKey(5);y._clearValue(5);v=y._setKey(5,1,b)?v:false;v=y._setKey(5,2,e)?v:false;v=h==j||y._setKey(5,3,j)?v:false;v=h==t||y._setValue(5,1,t)?v:false;if(v)a._sendXEvent(y)}else v=false;return v};a.ad=function(b,e,j){a._initData();if(a.Q()){var t=new c.Z;t._setKey(6,1,e.href);var v=j?function(){a.rc(b,e)}:undefined;x.O("&utmt=event&utme="+c.d(t.N())+a.Ia(),a.H,a.a,a.f,false,true,v)}};a.rc=function(b,
e){if(!b)b=a.e.event;var j=true;if(e.gatcOnclick)j=e.gatcOnclick(b);if(j||typeof j=="undefined")if(!e.target||e.target=="_self")a.e.location=e.href;else if(e.target=="_top")a.e.top.document.location=e.href;else if(e.target=="_parent")a.e.parent.document.location=e.href};a.oc=function(b){if(!b)b=a.e.event;var e=b.shiftKey||b.ctrlKey||b.altKey;if(!e)if(b.modifiers&&a.e.Event)e=b.modifiers&a.e.Event.CONTROL_MASK||b.modifiers&a.e.Event.SHIFT_MASK||b.modifiers&a.e.Event.ALT_MASK;return e};a._setDomainName=
function(b){g.g=b};a.dd=function(){return g.g};a._addOrganic=function(b,e){c.h(g.fa,new c.cb(b,e))};a._clearOrganic=function(){g.fa=[]};a.hd=function(){return g.fa};a._addIgnoredOrganic=function(b){c.h(g.ea,b)};a._clearIgnoredOrganic=function(){g.ea=[]};a.ed=function(){return g.ea};a._addIgnoredRef=function(b){c.h(g.ga,b)};a._clearIgnoredRef=function(){g.ga=[]};a.fd=function(){return g.ga};a._setAllowHash=function(b){g.pb=b?1:0};a._setCampaignTrack=function(b){g.qa=b?1:0};a._setClientInfo=function(b){g.sa=
b?1:0};a._getClientInfo=function(){return g.sa};a._setCookiePath=function(b){g.p=b};a._setTransactionDelim=function(b){g.G=b};a._setCookieTimeout=function(b){g.wb=b};a._setDetectFlash=function(b){g.ua=b?1:0};a._getDetectFlash=function(){return g.ua};a._setDetectTitle=function(b){g.ta=b?1:0};a._getDetectTitle=function(){return g.ta};a._setLocalGifPath=function(b){g.Da=b};a._getLocalGifPath=function(){return g.Da};a._setLocalServerMode=function(){g.D=0};a._setRemoteServerMode=function(){g.D=1};a._setLocalRemoteServerMode=
function(){g.D=2};a.gd=function(){return g.D};a._getServiceMode=function(){return g.D};a._setSampleRate=function(b){g.ha=b};a._setSessionTimeout=function(b){g.Tb=b};a._setAllowLinker=function(b){g.I=b?1:0};a._setAllowAnchor=function(b){g.pa=b?1:0};a._setCampNameKey=function(b){g.db=b};a._setCampContentKey=function(b){g.eb=b};a._setCampIdKey=function(b){g.fb=b};a._setCampMediumKey=function(b){g.gb=b};a._setCampNOKey=function(b){g.hb=b};a._setCampSourceKey=function(b){g.ib=b};a._setCampTermKey=function(b){g.jb=
b};a._setCampCIdKey=function(b){g.kb=b};a._getAccount=function(){return a.H};a._getVersion=function(){return _gat.lb};a.kd=function(b){g.B=[];if(b)g.B=b};a.md=function(b){g.Kb=b};a.ld=function(b){g.Ga=b};a._setReferrerOverride=function(b){a.yb=b};a.Ac=function(){return a.yb}};_gat._getTracker=function(d){var a=new _gat.kc(d);return a};
