/*
@id {7eeff186-cfb4-f7c3-21f2-a15f210dca49}
@name FakeSmile
@version 0.1.17
@description SMIL implementation in ECMAScript
@creator David Leunen (leunen.d@gmail.com)
@homepageURL http://leunen.d.free.fr/fakesmile
@ff_min_version 2.0
@ff_max_version 2.0.0.*
*/
// ==UserScript==
// @name           smil
// @namespace      svg.smil
// ==/UserScript==

var mpf = 25; // milliseconds per frame
var splinePrecision = 25;

var svgns="http://www.w3.org/2000/svg";
var smilanimns="http://www.w3.org/2001/smil-animation";
var smil2ns="http://www.w3.org/2001/SMIL20";
var basicanim2ns="http://www.w3.org/2001/SMIL20/BasicAnimation";
var splineanim2ns="http://www.w3.org/2001/SMIL20/SplineAnimation";
var smil21ns="http://www.w3.org/2005/SMIL21";
var basicanim21ns="http://www.w3.org/2005/SMIL21/BasicAnimation";
var splineanim21ns="http://www.w3.org/2005/SMIL21/SplineAnimation";
var xlinkns="http://www.w3.org/1999/xlink";

var animators = new Array();  // all animators
var id2anim = new Object();   // id -> animation elements (workaround a gecko bug)
var animations = new Array(); // running animators
var timeZero;

/**
 * if declarative animations are not supported,
 * the document animations are fetched and registered
 */
function initSMIL() {
  if (document.documentElement.getAttribute("smiling")=="fake")
    return;
  document.documentElement.setAttribute("smiling", "fake");

  var animates = document.getElementsByTagName("*");
  for(var j=0; j<animates.length ;j++) {
    var anim = animates.item(j);
    var namespaceURI = anim.namespaceURI;
    if (namespaceURI!=svgns && namespaceURI!=smilanimns && 
        namespaceURI!=smil2ns && namespaceURI!=basicanim2ns && namespaceURI!=splineanim2ns && 
        namespaceURI!=smil21ns && namespaceURI!=basicanim21ns && namespaceURI!=splineanim21ns)
      continue;
    var nodeName = anim.localName;
    if (nodeName=="set" || nodeName=="animate" || nodeName=="animateColor" || nodeName=="animateMotion" || nodeName=="animateTransform") {
      var href = anim.getAttributeNS(xlinkns, "href");
      var target;
      if (href!=null && href!="")
        target = document.getElementById(href.substring(1))
      else
        target = anim.parentNode;
      if (target.namespaceURI==svgns && document.implementation.hasFeature("http://www.w3.org/TR/SVG11/feature#SVG-animation", "1.1"))
        continue;
      var animator = new Animator(anim, target);
      animators.push(animator);
      var id = anim.getAttribute("id");
      if (id)
        id2anim[id] = anim;
    }
  }

  timeZero = new Date();
  // I schedule them (after having instanciating them, for sync-based events)
  // (it doesn't work either: first 0s animation don't trigger begin event to the following -> make it asynchronous)
  for (var i=0; i<animators.length; i++)
    animators[i].register();

  // starts the rendering loop
  window.setInterval(animate, mpf);
}


function getEventTargetById(id, ref) {
  var element = null;
  if (id=="prev") {
    element = ref.previousSibling;
    while(element && element.nodeType!=1)
      element = element.previousSibling;
  }
  if (element==null)
    element = document.getElementById(id);
  if (element==null)
    element = id2anim[id]; // because getElementById doesn't returns smil elems in gecko
  if (element==null)
    return null;
  if (element.animator)
    return element.animator;
  return element;
}


/**
 * corresponds to one <animate>, <set>, <animateTransform>, ...
 */
Animator.prototype = {

  /**
   * Registers the animation.
   * It schedules the beginings and endings
   */
  register : function() {
    var begin = this.anim.getAttribute("begin");
    if (!begin)
      begin = "0";
    this.schedule(begin, this.begin);
    var end  = this.anim.getAttribute("end");
    if (end)
      this.schedule(end, this.finish);
  },
  
  /**
   * schedules the starts or ends of the animation
   */
  schedule : function(timeValueList, func) {
    var me = this; // I do that because if I use "this", the addEventListener understands the event source
    var timeValues = timeValueList.split(";");
    for(var i=0; i<timeValues.length ;i++) {
      var time = timeValues[i].trim();
      if(isNaN(parseInt(time))) {
        var offset = 0;
        var io = time.indexOf("+");
        if (io==-1)
          io = time.indexOf("-");
        if (io!=-1) {
          offset = toMillis(time.substring(io).replace(/ /g, ""));
          time = time.substring(0, io).trim();
        }
        io = time.indexOf(".");
        var element;
        if (io==-1) {
          element = this.target;
        } else {
          var id = time.substring(0, io);
          element = getEventTargetById(id, this.anim);
        }
        if(element==null)
          continue;
        var event = time.substring(io+1);
        
        var call = funk(func, me, offset);
        element.addEventListener(event, call, false);
      } else {
        time = toMillis(time);
        func.call(me, time);
      }
    }
  },
  
  /**
   * Remembers the initial value of the animated attribute.
   * This function is overriden
   */
  getCurVal : function() {
    if (this.attributeType=="CSS") {
      // should use this.target.getPresentationAttribute instead
      return this.target.style.getPropertyValue(this.attributeName);
    } else {
      //var animAtt = this.target[this.attributeName];
      //if (animAtt && animAtt.animVal)
      //  return animAtt.animVal.value;
      //else
        return this.target.getAttribute(this.attributeName);
    }
  },
  
  /**
   * starts the animation
   * I mean the very beginning of it.
   * not called when repeating
   */
  begin : function(offset) {
    if (this.restart=="never" || (this.running && this.restart=="whenNotActive"))
      return;
    if (offset!=null && offset>=0) {
      var me = this;
      var myself = this.begin;
      var call = function() {myself.call(me)};
      window.setTimeout(call, offset);
      return;
    }

    this.startTime = new Date();
    if (offset && offset<0)
      this.startTime.setTime(this.startTime.getTime()+offset);
    this.stop();
    this.running = true;
    var initVal = this.getCurVal();
    this.realInitVal = initVal;
    // TODO
    // I should get the inherited value here (getPresentationAttribute is not supported) 
    if (!initVal && propDefaults[this.attributeName] )
      initVal = propDefaults[this.attributeName];
    if (this.anim.nodeName=="set")
      this.step(this.to);
    this.iteration = 0;

    if (this.values) {
      this.animVals = this.values.split(";");
      for(var i=0; i<this.animVals.length ;i++)
        this.animVals[i] = this.animVals[i].trim();
    } else {
      this.animVals = new Array();
      if (this.from)
        this.animVals[0] = this.from;
      else
        this.animVals[0] = initVal;
      if (this.by && this.animVals[0])
        this.animVals[1] = this.add(this.normalize(this.animVals[0]), this.normalize(this.by));
      else
        this.animVals[1] = this.to;
    }
    if (this.animVals[this.animVals.length-1]) {
      this.freezed = this.animVals[this.animVals.length-1];

      if (this.animVals[0]) {
        if ( (this.animVals[0].substring(0,1)=="#" || colors[this.animVals[0]] || (this.animVals[0].length>5 && this.animVals[0].trim().substring(0,4)=="rgb(")) &&
             (this.freezed.substring(0,1)=="#" || colors[this.freezed] || (this.freezed.length>5 && this.freezed.trim().substring(0,4)=="rgb(")) )
          this.color();
        else {
          var cp = new Array();
          var oneVal = this.animVals[0];
          var qualified = getUnit(oneVal);
          cp[0] = qualified[0];
          this.unit = qualified[1];
          for(var i=1; i<this.animVals.length ;i++) {
            var oneVal = this.animVals[i];
            var qualified = getUnit(oneVal);
            if (qualified[1]==this.unit)
              cp[i] = qualified[0];
            else {
              cp = this.animVals;
              break;
            }
          }
          this.animVals = cp;
        }
      }
    }

    this.iterBegin = this.startTime;
    animations.push(this);
    for(var i=0; i<this.beginListeners.length ;i++)
      this.beginListeners[i].call();
  },
  
  /**
   * This function is overriden for multiple values attributes (scale, rotate, translate)
   */
  normalize : function(value) {
    return value;
  },

  /**
   * Sums up two normalized values
   */
  add : function(a, b) {
    return ""+(parseFloat(a)+parseFloat(b));
  },

  /**
   * Computes and apply the animated value for a given time
   * It returns false if this animation has been stopped (removed from the running array)
   */
  f : function(curTime) {
    var anim = this.anim;
    
    var dur = this.computedDur;
    if (isNaN(dur))
      return true;

    var beginTime = this.iterBegin;

    var diff = curTime-beginTime;
    var percent = diff/dur;
    if (percent>=1)
      return this.end();

    var iteration = parseFloat(this.iteration);
    if (this.repeatCount && this.repeatCount!="indefinite" && (iteration+percent)>=this.repeatCount) {
      if (this.fill=="freeze")
        this.freezed = this.valueAt(this.repeatCount-iteration);
      return this.end();
    }
    if (this.repeatDur && this.repeatDur!="indefinite" && (curTime-this.startTime)>=toMillis(this.repeatDur)) {
      if (this.fill=="freeze") {
        var div = toMillis(this.repeatDur)/dur;
        this.freezed = this.valueAt(div-Math.floor(div));
      }
      return this.end();
    }
 
    if (anim.localName=="set")
      return true;

    var curVal = this.valueAt(percent);

    this.step(curVal);
    return true;
  },
  
  isInterpolable : function(from, to) {
    var areN = (!isNaN(from) && !isNaN(to));
    if (!areN && from.trim().indexOf(" ")!=-1 && to.trim().indexOf(" ")!=-1) {
      var tfrom = from.trim().split(" ");
      var tto = to.trim().split(" ");
      areN = true;
      if (tfrom.length==tto.length)
        for(var i=0; i<tto.length ;i++)
          if(!this.isInterpolable(tfrom[i], tto[i]))
            return false
    }
    return areN;
  },
  
  valueAt : function(percent) {
    var tValues = this.animVals;
    if (percent==1)
      return tValues[tValues.length-1];
    if (this.calcMode=="discrete" || !this.isInterpolable(tValues[0],tValues[1])) {
      if (this.keyTimes) {
        for(var i=1; i<this.keyTimes.length ;i++)
          if(this.keyTimes[i]>percent)
            return tValues[i-1];
        return tValues[tValues.length-1];
      }
      var parts = tValues.length;
      var div = Math.floor(percent*parts);
      return tValues[div];
    } else {
      var index;
      if (this.keyTimes) {
        for(var i=1; i<this.keyTimes.length ;i++)
          if(this.keyTimes[i]>percent) {
            index = i-1;
            var t1 = this.keyTimes[index];
            percent = (percent-t1)/(this.keyTimes[i]-t1);
            break;
          }
      } else {
        var parts = tValues.length-1;
        index = Math.floor(percent*parts);
        percent = (percent%(1/parts))*parts;
      }
      if (this.calcMode=="spline")
        percent = this.spline(percent, index);
      return this.interpolate(this.normalize(tValues[index]), this.normalize(tValues[index+1]), percent);
    }
  },

  spline : function(percent, index) {
    var path = this.keySplines[index];
    var tot = path.getTotalLength();
    var step = tot/splinePrecision;
    for(var i=0; i<=tot ;i+=step) {
      var pt = path.getPointAtLength(i);
      if(pt.x>percent) {
        var pt1 = path.getPointAtLength(i-step);
        percent -= pt1.x;
        percent /= pt.x-pt1.x;
        return pt1.y+((pt.y-pt1.y)*percent);
      }
    }
    var pt = path.getPointAtLength(tot);
    var pt1 = path.getPointAtLength(tot-step);
    percent -= pt1.x;
    percent /= pt.x-pt1.x;
    return pt1.y+((pt.y-pt1.y)*percent);
  },
  
  /**
   * Does the interpolation
   * This function is overriden
   */ 
  interpolate : function(from, to, percent) {
    if (!this.isInterpolable(from, to)) {
      if (percent<.5)
        return from;
      else
        return to;
    }
    if(from.trim().indexOf(" ")!=-1) {
      var tfrom = from.split(" ");
      var tto = to.split(" ");
      var ret = new Array();
      for(var i=0; i<tto.length ;i++)
        ret[i] = parseFloat(tfrom[i])+((tto[i]-tfrom[i])*percent);
      return ret.join(" ");
    }
    return parseFloat(from)+((to-from)*percent);
  },

  /**
   * apply a value to the attribute the animator is linked to
   * This function is overriden
   */
  step : function(value) {
    if (this.unit)
      value += this.unit;
    var attributeName = this.attributeName;
    var attributeType = this.attributeType;
    if (attributeType=="CSS") {
      // workaround a gecko and webkit bug
      if (attributeName=="font-size" && !isNaN(value))
        value += "px";
      this.target.style.setProperty(attributeName, value, "");
    } else {
      //var animAtt = this.target[attributeName];
      //if (animAtt && animAtt.animVal)
      //  animAtt.animVal.value = value;
      //else
      	this.target.setAttribute(attributeName, value);
    }
  },
  
  /**
   * Normal end of the animation:
   * it restarts if repeatCount
   */
  end : function() {
    if (!this.repeatCount && !this.repeatDur)
      return this.finish();
    else {
      this.iteration++;
      var now = new Date();
      if (this.repeatCount && this.repeatCount!="indefinite" && this.iteration>=this.repeatCount)
        return this.finish();
      else if (this.repeatDur && this.repeatDur!="indefinite" && (now-this.startTime)>=toMillis(this.repeatDur))
        return this.finish();
      else {
        if (this.accumulate=="sum") {
          var curVal = this.getCurVal();
          if (!curVal && propDefaults[this.attributeName] )
            curVal = propDefaults[this.attributeName];

          for (var i=0; i<this.animVals.length ;i++)
            this.animVals[i] = this.add(this.normalize(curVal), this.normalize(this.animVals[i]));
          this.freezed = this.animVals[this.animVals.length-1];
        }
        this.iterBegin = now;
        for(var i=0; i<this.repeatIterations.length ;i++) {
          if (this.repeatIterations[i]==this.iteration)
            this.repeatListeners[i].call();
        }
      } 
    }
    return true;
  },
  
  /**
   * Real stop of the animation (it doesn't repeat)
   * Freezes or remove the animated value
   */
  finish : function(offset) {
    if (this.min && this.min!="indefinite") {
      var now = new Date();
      if ((now-this.startTime)>=toMillis(this.min))
        return true;
    }
    if (offset && offset>0) {
      var me = this;
      var myself = this.finish;
      var call = function() {myself.call(me)};
      window.setTimeout(call, offset);
      return true;
    }
    if (offset && offset<0) {
      var now = new Date();
      now.setTime(now.getTime()+offset);
      if (now<this.startTime)
        return true;
    }

    var fill = this.fill;
    var kept = true;
    if (fill=="freeze") {
      this.freeze();
    } else {
      this.stop();
      this.step(this.realInitVal);
      kept = false;
    }
    if (this.running) {
      for(var i=0; i<this.endListeners.length ;i++)
        this.endListeners[i].call();
      this.running = false;
    }
    return kept;
  },
  
  /**
   * Removes this animation from the running array
   */
  stop : function() {
    for(var i=0; i<animations.length ;i++)
      if (animations[i]==this) {
        animations.splice(i, 1);
        break;
      }
  },

  /**
   * freezes the attribute value to the ending value
   */
  freeze : function() {
    this.step(this.freezed);
  },
  
  /**
   * Adds a listener to this animation beginning or ending
   */
  addEventListener : function(event, func, b) {
    if (event=="begin")
      this.beginListeners.push(func);
    else if (event=="end")
      this.endListeners.push(func);
    else if (event.length>7 && event.substring(0,6)=="repeat") {
      var iteration = event.substring(7,event.length-1);
      this.repeatListeners.push(func);
      this.repeatIterations.push(iteration);
    }
  },
  
  /**
   * Returns the path linked to this animateMotion
   */
  getPath : function() {
    var mpath = this.anim.getElementsByTagNameNS(svgns,"mpath")[0];
    if (mpath) {
      var pathHref = mpath.getAttributeNS(xlinkns, "href");
      return document.getElementById(pathHref.substring(1));
    } else {
      var d = this.anim.getAttribute("path");
      if (d) {
        var pathEl = createPath(d);
        //pathEl.setAttribute("display", "none");
        //this.anim.parentNode.appendChild(pathEl);
        return pathEl;
      }
    }
    return null;  
  },
  
  /**
   * initializes this animator as a translation (x,y) :
   * <animateTransform type="translate"> or
   * <animateMotion> without a path
   */
  translation : function() {
    if (this.by && this.by.indexOf(",")==-1)
      this.by = this.by+",0";
    this.normalize = function(value) {
      var coords = value.replace(/,/g," ").replace(/ +/," ").split(/ /);
      if (coords.length==1)
        coords[1] = "0";
        //coords[1] = this.initVal.split(",")[1];
      coords[0] = parseFloat(coords[0]);
      coords[1] = parseFloat(coords[1]);
      return coords;
    };
    this.add = function(a, b) {
      var x = a[0]+b[0];
      var y = a[1]+b[1];
      return x+","+y;
    };
    this.isInterpolable = function(from, to) { return true; };
    this.interpolate = function(from, to, percent) {
      var x = from[0]+((to[0]-from[0])*percent);
      var y = from[1]+((to[1]-from[1])*percent);
      return x+","+y;
    };
  },
  
  /**
   * initializes this animator as a color animation :
   * <animateColor> or
   * <animate> ona a color attribute
   */
  color : function() {
    this.isInterpolable = function(from, to) { return true; };
    this.interpolate = function(from, to, percent) {
      var r = Math.round(from[0]+((to[0]-from[0])*percent));
      var g = Math.round(from[1]+((to[1]-from[1])*percent));
      var b = Math.round(from[2]+((to[2]-from[2])*percent));
      var val = "rgb("+r+","+g+","+b+")";
      return val;
    };
    this.normalize = function(value) {
      var rgb = toRGB(value);
      if (rgb==null)
        return toRGB(propDefaults[this.attributeName]);
      return rgb;
    }
    this.add = function(a, b) {
      var ret = new Array();
      for (var i=0; i<a.length ;i++)
        ret.push(Math.min(a[i],255)+Math.min(b[i],255));
      return ret.join(",");
    };
  },

  d : function() {
    this.isInterpolable = function(from, to) { return true; };
    this.interpolate = function(from, to, percent) {
      var path = "";
      var listFrom = from.myNormalizedPathSegList;
      var listTo = to.myNormalizedPathSegList;
      var segFrom;
      var segTo;
      for (var i=0; i<listFrom.numberOfItems && i<listTo.numberOfItems ;i++) {
        segFrom = listFrom.getItem(i);
        segTo = listTo.getItem(i);
        typeFrom = segFrom.pathSegType;
        typeTo = segTo.pathSegType;
        if (typeFrom==1 || typeTo==1)
          path += " z ";
        else {
          var x = segFrom.x+((segTo.x-segFrom.x)*percent);
          var y = segFrom.y+((segTo.y-segFrom.y)*percent);
          if (typeFrom==2 || typeTo==2)
            path += " M ";
          else if (typeFrom==4 || typeTo==4)
            path += " L ";
          else {
            var x1 = segFrom.x1+((segTo.x1-segFrom.x1)*percent);
            var y1 = segFrom.y1+((segTo.y1-segFrom.y1)*percent);
            var x2 = segFrom.x2+((segTo.x2-segFrom.x2)*percent);
            var y2 = segFrom.y2+((segTo.y2-segFrom.y2)*percent);
            path += " C "+x1+","+y1+" "+x2+","+y2+" ";
          }
          path += x+","+y;
        } 
      }
      return path;
    };
    this.normalize = function(value) {
      var path = createPath(value);
      return path;
    };
  }

};
/**
 * contructor : 
 * - initializes
 * - gets the attributes
 * - corrects and precomputes some values
 * - specializes some functions
 */
function Animator(anim, target) {
  this.anim = anim;
  this.target = target;
  anim.targetElement = this.target;
  anim.animator = this;
  this.attributeType = anim.getAttribute("attributeType");
  this.attributeName = anim.getAttribute("attributeName");
  if (this.attributeType!="CSS" && this.attributeType!="XML") {
    if(propDefaults[this.attributeName] && this.target.style)
      this.attributeType = "CSS";
    else
      this.attributeType = "XML";
  }
    
  if (this.attributeName=="d")
    this.d();
  else if (this.attributeName=="points") {
    this.isInterpolable = function(from, to) { return true; };
    this.interpolate = function(from, to, percent) {
      var ret = new Array();
      var xyFrom, xyTo, x, y;
      for (var i=0; i<from.length && i<to.length ;i++) {
        xyFrom = from[i].split(",");
        xyTo = to[i].split(",");
        x = parseFloat(xyFrom[0])+((parseFloat(xyTo[0])-xyFrom[0])*percent);
        y = parseFloat(xyFrom[1])+((parseFloat(xyTo[1])-xyFrom[1])*percent);
        ret.push(x+","+y);
      }
      return ret.join(" ");
    };
    this.normalize = function(value) {
      var ar = value.split(" ");
      for(var i=ar.length-1 ;i>=0; i--)
        if (ar[i]=="")
          ar.splice(i,1);
      return ar;
    };
  }
  this.from = anim.getAttribute("from");
  this.to = anim.getAttribute("to");
  this.by = anim.getAttribute("by");
  this.values = anim.getAttribute("values");
  this.calcMode = anim.getAttribute("calcMode");
  this.keyTimes = anim.getAttribute("keyTimes");
  if (this.keyTimes) {
    this.keyTimes = this.keyTimes.split(";");
    for(var i=0; i<this.keyTimes.length ;i++)
      this.keyTimes[i] = parseFloat(this.keyTimes[i]);
    this.keyPoints = anim.getAttribute("keyPoints");
    if (this.keyPoints) {
      this.keyPoints = this.keyPoints.split(";");
      for(var i=0; i<this.keyPoints.length ;i++)
        this.keyPoints[i] = parseFloat(this.keyPoints[i]);
    }
  }
  this.keySplines = anim.getAttribute("keySplines");
  if (this.keySplines) {
    this.keySplines = this.keySplines.split(";");
    for(var i=0; i<this.keySplines.length ;i++)
      this.keySplines[i] = createPath("M 0 0 C "+this.keySplines[i]+" 1 1");
  }
  this.dur = anim.getAttribute("dur");
  if (this.dur && this.dur!="indefinite")
    this.computedDur = toMillis(this.dur);
  this.max = anim.getAttribute("max");
  if (this.max && this.max!="indefinite") {
    this.computedMax = toMillis(this.max);
    if (!isNaN(this.computedMax) && this.computedMax>0 && (!this.computedDur || this.computedDur>this.computedMax))
      this.computedDur = this.computedMax;
  }
  this.min = anim.getAttribute("min");
  if (this.min) {
    this.computedMin = toMillis(this.min);
    if (!this.computedDur || this.computedDur<this.computedMin)
      this.computedDur = this.computedMin;
  }
  
  this.fill = anim.getAttribute("fill");
  this.type = anim.getAttribute("type");
  this.repeatCount = anim.getAttribute("repeatCount");
  this.repeatDur = anim.getAttribute("repeatDur");
  this.accumulate = anim.getAttribute("accumulate");
  this.additive = anim.getAttribute("additive");
  this.restart = anim.getAttribute("restart");
  if (!this.restart)
    this.restart = "always";
  
  this.beginListeners = new Array();
  this.endListeners = new Array();
  this.repeatListeners = new Array();
  this.repeatIterations = new Array();
  
  var nodeName = anim.localName;

  if (nodeName=="animateColor") {
  
    this.color();

  } else if (nodeName=="animateMotion") {
  
    this.isInterpolable = function(from, to) { return true; };
    this.getCurVal = function() {
      var curTrans = this.target.transform;
      if (curTrans && curTrans.animVal.numberOfItems>0) {
        var transList = curTrans.animVal;
        return decompose(transList.getItem(0).matrix, "translate");
      } else
        return "0,0";
    };
    this.path = this.getPath();
    if (this.path) {
      this.valueAt = function(percent) {
        var length = this.path.getTotalLength();
        var point = this.path.getPointAtLength(percent*length);
        return point.x+","+point.y;
      };
    } else {
      this.translation();
    }
    this.freeze = function() {
      var val = this.valueAt(1);
      this.step(val);
    };
    if (this.keyPoints && this.keyTimes) {
      this.pathKeyTimes = this.keyTimes;
      this.keyTimes = null;
      this.superValueAt = this.valueAt;
      this.valueAt = function(percent) {
        for(var i=1; i<this.keyPoints.length ;i++) {
          var fakePC = this.keyPoints[this.keyPoints.length-1]
          if (this.pathKeyTimes[i]>percent) {
            var pt = this.keyPoints[i-1];
            if (this.calcMode=="discrete")
              fakePC = pt;
            else {
              var t1 = this.pathKeyTimes[i-1];
              percent = (percent-t1)/(this.pathKeyTimes[i]-t1);
              fakePC = pt+((this.keyPoints[i]-pt)*percent)
            }
            break;
          }
        }
        return this.superValueAt(fakePC);
      };
    }
    this.step = function(value) {
      var attributeName = this.attributeName;
      value = "translate("+value+")";
      this.target.setAttribute("transform", value);
    };
    
  } else if (nodeName=="animateTransform") {
  
    this.isInterpolable = function(from, to) { return true; };
    this.getCurVal = function() {
      var type = this.type;
      var curTrans = this.target.transform;
      if (curTrans && curTrans.animVal.numberOfItems>0) {
        var transList = curTrans.animVal;
        return decompose(transList.getItem(0).matrix, type);
      } else {
        if (type=="scale")
          return "1,1";
        else if (type=="translate")
          return "0,0";
        else if (type=="rotate")
          return "0,0,0";
        else
          return 0;
      }
    };
    
    if (this.type=="scale") {
      this.normalize = function(value) {
        value = value.replace(/,/g," ");
        var coords = value.split(" ");
        if (coords.length==1)
          coords[1] = coords[0];
        coords[0] = parseFloat(coords[0]);
        coords[1] = parseFloat(coords[1]);
        return coords;
      };
      this.add = function(a, b) {
        var ret = new Array();
        for (var i=0; i<a.length ;i++)
          ret.push(a[i]*b[i]);
        return ret.join(",");
      };
    } else if (this.type=="translate") {
      this.translation();
    } else if (this.type=="rotate") {
      this.normalize = function(value) {
        value = value.replace(/,/g," ");
        var coords = value.split(" ");
        if (coords.length<3) {
          coords[0] = parseFloat(coords[0]);
          coords[1] = 0;
          coords[2] = 0;
        } else {
          coords[0] = parseFloat(coords[0]);
          coords[1] = parseFloat(coords[1]);
          coords[2] = parseFloat(coords[2]);
        }
        return coords;
      };
      this.add = function(a, b) {
        var ret = new Array();
        for (var i=0; i<a.length ;i++)
          ret.push(a[i]+b[i]);
        return ret.join(",");
      };
    }
    
    if (this.type=="scale" || this.type=="rotate") {
      if (this.from)
        this.from = this.normalize(this.from).join(",");
      if (this.to)
        this.to = this.normalize(this.to).join(",");
      if (this.by)
        this.by = this.normalize(this.by).join(",");
      if (this.values) {
        var tvals = this.values.split(";");
        for(var i=0; i<tvals.length ;i++)
          tvals[i] = this.normalize(tvals[i]).join(",");
        this.values = tvals.join(";");
      }
      this.interpolate = function(from, to, percent) {
        var ret = new Array();
        for (var i=0; i<from.length ;i++)
          ret.push(from[i]+((to[i]-from[i])*percent));
        return ret.join(",");
      };
    }
    
    this.step = function(value) {
      var attributeName = this.attributeName;
      value = this.type+"("+value+")";
      this.target.setAttribute(attributeName, value);
    };
  }
  
  var me = this;
  this.anim.beginElement = function() { me.begin(); return true; };
  this.anim.beginElementAt = function(offset) { me.begin(offset*1000); return true; };
  this.anim.endElement = function() { me.finish(); return true; };
  this.anim.endElementAt = function(offset) { me.finish(offset*1000); return true; };
  
  this.anim.getStartTime = function() { return parseFloat(me.iterBegin-timeZero)/1000; };
  this.anim.getCurrentTime = function() { 
    var now = new Date();
    return parseFloat(now-me.iterBegin)/1000; 
  };
}



/**
 * can be called at any time.
 * It's the main loop
 */
function animate() {
  var curTime = new Date();
  for(var i=0; i<animations.length ;i++) {
    try {
      if (!animations[i].f(curTime))
        i--;
    } catch(exc) {
      if (exc.message!="Component returned failure code: 0x80004005 (NS_ERROR_FAILURE) [nsIDOMSVGPathElement.getTotalLength]") {
        console.log(exc);
        //alert(exc);
      }
    }
  }
  // it would be cool if the attributes would be computed only, in the previous loop
  // and then the last values applied after the loop
  // for that, f(t) must return the value, and we must have a map for object(?).attributeType.attributeName -> value
  // then f(t) cannot return false when autostoping -> we must find another mechanism
}



/**
 * converts a clock-value to milliseconds
 * supported : "s" | "ms" | "min" | "h" | no-units
 */
function toMillis(time) {
  time = time.trim();
  var len = time.length;
  var io = time.indexOf(":");
  
  if (io!=-1) {
    var clockVal = time.split(":");
    var len = clockVal.length;
    time = 0;
    if (clockVal.length==3)
      time += parseInt(clockVal[0])*3600000;
    time += parseInt(clockVal[len-2])*60000;
    time += parseFloat(clockVal[len-1])*1000;
  } else if (len>2 && time.substring(len-2)=="ms") {
    time = time.substring(0, time.length-2);
  } else if (len>1 && time.substring(len-1)=="s") {
    time = time.substring(0, time.length-1);
    time = time*1000;
  } else if (len>3 && time.substring(len-3)=="min") {
    time = time.substring(0, time.length-3);
    time = time*60000;
  } else if (len>1 && time.substring(len-1)=="h") {
    time = time.substring(0, time.length-1);
    time = time*3600000;
  } else {
    time = time*1000;
  }
  return parseFloat(time);
}

/**
 * decompose a matrix into its scale or translate or rotate or skew
 */
function decompose(matrix, type) {
  if (type=="translate")
    return matrix.e+","+matrix.f;
    
  var a = matrix.a;
  var b = matrix.b;
  var c = matrix.c;
  var d = matrix.d;
  
  if (type=="rotate")
    return Math.atan2(c,a)+",0,0";
  
  var ModA = Math.sqrt(a*a+c*c);
  var ModB = Math.sqrt(b*b+d*d);
  
  if (type=="scale") {
    var AxB = a*d-b*c;
    var scaleX = AxB==0?0:(AxB/ModA);
    var scaleY = ModB;
    return scaleX+","+scaleY;
  }
  var AdotB = a*b+c*d;
  var shear = Math.PI/2-Math.acos(AdotB==0?0:(AdotB/(ModB*ModA)));
  return (shear*180)/Math.PI;
}

/**
 * Convert a rgb(), #XXX, #XXXXXX or named color
 * into an [r,g,b] array
 */
function toRGB(color) {
  if (color.substring(0, 3)=="rgb") {
    color = color.replace(/ /g, "");
    color = color.replace("rgb(", "");
    color = color.replace(")", "");
    var rgb = color.split(",");
    for (var i=0; i<rgb.length ;i++) {
      var len = rgb[i].length-1;
      if (rgb[i].substring(len)=="%")
        rgb[i] = Math.round((rgb[i].substring(0,len))*2.55);
      else
        rgb[i] = parseInt(rgb[i]);
    }
    return rgb;
  } else if (color.charAt(0)=="#") {
    color = color.trim();
    var rgb = new Array();
    if (color.length==7) {
      rgb[0] = parseInt(color.substring(1,3),16);
      rgb[1] = parseInt(color.substring(3,5),16);
      rgb[2] = parseInt(color.substring(5,7),16);
    } else {
      rgb[0] = color.substring(1,2);
      rgb[1] = color.substring(2,3);
      rgb[2] = color.substring(3,4);
      rgb[0] = parseInt(rgb[0]+rgb[0],16);
      rgb[1] = parseInt(rgb[1]+rgb[1],16);
      rgb[2] = parseInt(rgb[2]+rgb[2],16);
    }
    return rgb;
  } else {
    return colors[color];
  }
}

function createPath(d) {
  var path = document.createElementNS(svgns, "path");
  path.setAttribute("d", d);
  try { 
    if (path.normalizedPathSegList)
      path.myNormalizedPathSegList = path.normalizedPathSegList;
  } catch(exc) {}
  if(!path.myNormalizedPathSegList) {
    // TODO : normalize the path
    path.myNormalizedPathSegList = path.pathSegList;
  }
  return path;
}

var units = ["grad", "deg", "rad", "kHz", "Hz", "em", "em", "px", "pt", "pc", "mm", "cm", "in", "ms", "s", "%"];
function getUnit(str) {
  if (str && str.substring) {
    for (var i=0; i<units.length ;i++) {
      var vlen = str.length-units[i].length;
      if (vlen>0 && str.substring(vlen)==units[i]) {
        var val = str.substring(0, vlen);
        if (!isNaN(val))
          return [val,units[i]];
      }
    }
  }
  return [str,null];
}

var colors = {
  aliceblue : [240, 248, 255], 
  antiquewhite : [250, 235, 215], 
  aqua : [0, 255, 255], 
  aquamarine : [127, 255, 212], 
  azure : [240, 255, 255], 
  beige : [245, 245, 220], 
  bisque : [255, 228, 196], 
  black : [0, 0, 0], 
  blanchedalmond : [255, 235, 205], 
  blue : [0, 0, 255], 
  blueviolet : [138, 43, 226], 
  brown : [165, 42, 42], 
  burlywood : [222, 184, 135], 
  cadetblue : [95, 158, 160], 
  chartreuse : [127, 255, 0], 
  chocolate : [210, 105, 30], 
  coral : [255, 127, 80], 
  cornflowerblue : [100, 149, 237], 
  cornsilk : [255, 248, 220], 
  crimson : [220, 20, 60], 
  cyan : [0, 255, 255], 
  darkblue : [0, 0, 139], 
  darkcyan : [0, 139, 139], 
  darkgoldenrod : [184, 134, 11], 
  darkgray : [169, 169, 169], 
  darkgreen : [0, 100, 0], 
  darkgrey : [169, 169, 169], 
  darkkhaki : [189, 183, 107], 
  darkmagenta : [139, 0, 139], 
  darkolivegreen : [85, 107, 47], 
  darkorange : [255, 140, 0], 
  darkorchid : [153, 50, 204], 
  darkred : [139, 0, 0], 
  darksalmon : [233, 150, 122], 
  darkseagreen : [143, 188, 143], 
  darkslateblue : [72, 61, 139], 
  darkslategray : [47, 79, 79], 
  darkslategrey : [47, 79, 79], 
  darkturquoise : [0, 206, 209], 
  darkviolet : [148, 0, 211], 
  deeppink : [255, 20, 147], 
  deepskyblue : [0, 191, 255], 
  dimgray : [105, 105, 105], 
  dimgrey : [105, 105, 105], 
  dodgerblue : [30, 144, 255], 
  firebrick : [178, 34, 34], 
  floralwhite : [255, 250, 240], 
  forestgreen : [34, 139, 34], 
  fuchsia : [255, 0, 255], 
  gainsboro : [220, 220, 220], 
  ghostwhite : [248, 248, 255], 
  gold : [255, 215, 0], 
  goldenrod : [218, 165, 32], 
  gray : [128, 128, 128], 
  grey : [128, 128, 128], 
  green : [0, 128, 0], 
  greenyellow : [173, 255, 47], 
  honeydew : [240, 255, 240], 
  hotpink : [255, 105, 180], 
  indianred : [205, 92, 92], 
  indigo : [75, 0, 130], 
  ivory : [255, 255, 240], 
  khaki : [240, 230, 140], 
  lavender : [230, 230, 250], 
  lavenderblush : [255, 240, 245], 
  lawngreen : [124, 252, 0], 
  lemonchiffon : [255, 250, 205], 
  lightblue : [173, 216, 230], 
  lightcoral : [240, 128, 128], 
  lightcyan : [224, 255, 255], 
  lightgoldenrodyellow : [250, 250, 210], 
  lightgray : [211, 211, 211], 
  lightgreen : [144, 238, 144], 
  lightgrey : [211, 211, 211], 
  lightpink : [255, 182, 193], 
  lightsalmon : [255, 160, 122], 
  lightseagreen : [32, 178, 170], 
  lightskyblue : [135, 206, 250], 
  lightslategray : [119, 136, 153], 
  lightslategrey : [119, 136, 153], 
  lightsteelblue : [176, 196, 222], 
  lightyellow : [255, 255, 224], 
  lime : [0, 255, 0], 
  limegreen : [50, 205, 50], 
  linen : [250, 240, 230], 
  magenta : [255, 0, 255], 
  maroon : [128, 0, 0], 
  mediumaquamarine : [102, 205, 170], 
  mediumblue : [0, 0, 205], 
  mediumorchid : [186, 85, 211], 
  mediumpurple : [147, 112, 219], 
  mediumseagreen : [60, 179, 113], 
  mediumslateblue : [123, 104, 238], 
  mediumspringgreen : [0, 250, 154], 
  mediumturquoise : [72, 209, 204], 
  mediumvioletred : [199, 21, 133], 
  midnightblue : [25, 25, 112], 
  mintcream : [245, 255, 250], 
  mistyrose : [255, 228, 225], 
  moccasin : [255, 228, 181], 
  navajowhite : [255, 222, 173], 
  navy : [0, 0, 128], 
  oldlace : [253, 245, 230], 
  olive : [128, 128, 0], 
  olivedrab : [107, 142, 35], 
  orange : [255, 165, 0], 
  orangered : [255, 69, 0], 
  orchid : [218, 112, 214], 
  palegoldenrod : [238, 232, 170], 
  palegreen : [152, 251, 152], 
  paleturquoise : [175, 238, 238], 
  palevioletred : [219, 112, 147], 
  papayawhip : [255, 239, 213], 
  peachpuff : [255, 218, 185], 
  peru : [205, 133, 63], 
  pink : [255, 192, 203], 
  plum : [221, 160, 221], 
  powderblue : [176, 224, 230], 
  purple : [128, 0, 128], 
  red : [255, 0, 0], 
  rosybrown : [188, 143, 143], 
  royalblue : [65, 105, 225], 
  saddlebrown : [139, 69, 19], 
  salmon : [250, 128, 114], 
  sandybrown : [244, 164, 96], 
  seagreen : [46, 139, 87], 
  seashell : [255, 245, 238], 
  sienna : [160, 82, 45], 
  silver : [192, 192, 192], 
  skyblue : [135, 206, 235], 
  slateblue : [106, 90, 205], 
  slategray : [112, 128, 144], 
  slategrey : [112, 128, 144], 
  snow : [255, 250, 250], 
  springgreen : [0, 255, 127], 
  steelblue : [70, 130, 180], 
  tan : [210, 180, 140], 
  teal : [0, 128, 128], 
  thistle : [216, 191, 216], 
  tomato : [255, 99, 71], 
  turquoise : [64, 224, 208], 
  violet : [238, 130, 238], 
  wheat : [245, 222, 179], 
  white : [255, 255, 255], 
  whitesmoke : [245, 245, 245], 
  yellow : [255, 255, 0], 
  yellowgreen : [154, 205, 50]
};

var propDefaults = [];
propDefaults["font"] = "see individual properties";
propDefaults["font-family"] = "Arial";
propDefaults["font-size"] = "medium";
propDefaults["font-size-adjust"] = "none";
propDefaults["font-stretch"] = "normal";
propDefaults["font-style"] = "normal";
propDefaults["font-variant"] = "normal";
propDefaults["font-weight"] = "normal";

propDefaults["direction"] = "ltr";
propDefaults["letter-spacing"] = "normal";
propDefaults["text-decoration"] = "none";
propDefaults["unicode-bidi"] = "normal";
propDefaults["word-spacing"] = "normal";

propDefaults["clip"] = "auto";
propDefaults["color"] = "depends on user agent";
propDefaults["cursor"] = "auto";
propDefaults["display"] = "inline";
propDefaults["overflow"] = "hidden";
propDefaults["visibility"] = "visible";

propDefaults["clip-path"] = "none";
propDefaults["clip-rule"] = "nonzero";
propDefaults["mask"] = "none";
propDefaults["opacity"] = "1";

propDefaults["enable-background"] = "accumulate";
propDefaults["filter"] = "none";
propDefaults["flood-color"] = "black";
propDefaults["flood-opacity"] = "1";
propDefaults["lighting-color"] = "white";

propDefaults["stop-color"] = "black";
propDefaults["stop-opacity"] = "1";

propDefaults["pointer-events"] = "visiblePainted";

propDefaults["color-interpolation"] = "sRGB";
propDefaults["color-interpolation-filters"] = "linearRGB";
propDefaults["color-profile"] = "auto";
propDefaults["color-rendering"] = "auto";
propDefaults["fill"] = "black";
propDefaults["fill-opacity"] = "1";
propDefaults["fill-rule"] = "nonzero";
propDefaults["image-rendering"] = "auto";
propDefaults["marker-end"] = "none";
propDefaults["marker-mid"] = "none";
propDefaults["marker-start"] = "none";
propDefaults["shape-rendering"] = "auto";
propDefaults["stroke"] = "none";
propDefaults["stroke-dasharray"] = "none";
propDefaults["stroke-dashoffset"] = "0";
propDefaults["stroke-linecap"] = "butt";
propDefaults["stroke-linejoin"] = "miter";
propDefaults["stroke-miterlimit"] = "4";
propDefaults["stroke-opacity"] = "1";
propDefaults["stroke-width"] = "1";
propDefaults["text-rendering"] = "auto";

propDefaults["alignment-baseline"] = "0";
propDefaults["baseline-shift"] = "baseline";
propDefaults["dominant-baseline"] = "auto";
propDefaults["glyph-orientation-horizontal"] = "0";
propDefaults["glyph-orientation-vertical"] = "auto";
propDefaults["kerning"] = "auto";
propDefaults["text-anchor"] = "start";
propDefaults["writing-mode"] = "lr-tb";

function funk(func, obj, arg) {
  return function() {func.call(obj, arg);};
}

/**
 * removes the leading and trailing spaces chars from the string
 */
String.prototype.trim = function() { return this.replace(/^\s+|\s+$/g, ""); };


window.addEventListener("load", initSMIL, false);
